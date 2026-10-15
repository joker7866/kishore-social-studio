import Anthropic from '@anthropic-ai/sdk'
import { ProviderError, type ProviderAdapter, type ProviderRequest, type ProviderResponse } from './types'

/** Models that accept the server-side refusal fallback (`fallbacks: "default"`). */
const FALLBACK_MODELS = /^claude-(fable-5-1|opus-5-5|opus-5|sonnet-5-5)$/

/** Keywords structured outputs does not accept. zod re-checks them after the response. */
const UNSUPPORTED_KEYS = new Set([
  '$schema',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength'
])

/**
 * Pull a JSON object out of model text: plain JSON, a ```json fenced block, or
 * the outermost {...} span. Returns undefined if nothing parses.
 */
export function extractJson(text: string): unknown {
  const tryParse = (t: string) => {
    try {
      return JSON.parse(t)
    } catch {
      return undefined
    }
  }
  const trimmed = text.trim()
  const direct = tryParse(trimmed)
  if (direct !== undefined) return direct
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)
  if (fenced) {
    const f = tryParse(fenced[1].trim())
    if (f !== undefined) return f
  }
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  return start >= 0 && end > start ? tryParse(trimmed.slice(start, end + 1)) : undefined
}

/** Claude rejects structured-output schemas whose compiled grammar is too big. */
export function isSchemaTooLarge(err: unknown): boolean {
  const e = err as { status?: number; message?: string; error?: { error?: { message?: string } } }
  const msg = `${e?.message ?? ''} ${e?.error?.error?.message ?? ''}`
  return e?.status === 400 && /grammar is too large|schema is too (large|complex)|too many (strict|optional)/i.test(msg)
}

/** Number of content-type variants in a generation schema (1 for field schemas). */
function schemaVariants(schema: Record<string, unknown>): number {
  const items = (schema.properties as { packages?: { items?: { anyOf?: unknown[] } } } | undefined)?.packages?.items
  return items?.anyOf?.length ?? 1
}

/** Sent instead of a schema when the schema is too large to enforce. */
const JSON_ONLY_INSTRUCTION = `

# RESPONSE FORMAT (strict)
Reply with ONLY one JSON object — no prose before or after, no Markdown code fences.
Shape: {"skillVersion": string, "packages": [ { "platform": string, "contentType": string,
  ...only the fields allowed for that content type (see CONTENT TYPES AND ALLOWED FIELDS),
  "qualitativeFeedback": {"clearTopic": string, "specificWording": string, "faithfulToSource": string, "readableLength": string, "missingContext": string},
  "missingInfoNotes": [string], "sourceRefs": [string] } ]}
Field shapes: titleOptions / hookOptions = array of exactly 3 strings; recommendedIndex = 0, 1 or 2;
hashtags = {"recommended": [string], "expanded": [string]}; poll = {"question": string, "choices": [2-5 strings]};
keywords / slideTexts = array of strings; every other field = a non-empty string. Omit optional fields that do not apply.`

/** Make a JSON schema acceptable to Claude structured outputs. */
export function toStructuredOutputSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(toStructuredOutputSchema)
  if (!schema || typeof schema !== 'object') return schema
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(schema)) {
    if (UNSUPPORTED_KEYS.has(k)) continue
    out[k] = k === 'properties' && v && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, toStructuredOutputSchema(pv)]))
      : toStructuredOutputSchema(v)
  }
  if (out.type === 'object' || out.properties) out.additionalProperties = false
  return out
}

/**
 * Anthropic adapter — JSON is requested with structured outputs
 * (`output_config.format`), which current models support; forced tool use is
 * rejected by Claude Sonnet 5.5 / Opus 5.5 / Fable 5.1. Streaming is used so long
 * Tamil outputs do not hit the SDK's non-streaming time limit.
 */
export class AnthropicProvider implements ProviderAdapter {
  readonly id = 'anthropic' as const
  private readonly client: Anthropic

  /** baseURL is only overridden by tests (local fake server). */
  constructor(apiKey: string, baseURL?: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 1, ...(baseURL ? { baseURL } : {}) })
  }

  /**
   * Smallest number of content types whose schema Claude rejected as too large.
   * Requests at or above it skip the schema and go straight to plain JSON.
   */
  private static schemaLimit = Number.POSITIVE_INFINITY

  async generate(req: ProviderRequest, signal: AbortSignal): Promise<ProviderResponse> {
    const variants = schemaVariants(req.jsonSchema)
    if (variants < AnthropicProvider.schemaLimit) {
      try {
        return await this.run(req, signal, true)
      } catch (err) {
        if (!isSchemaTooLarge(err)) throw err
        // Rejected requests are not billed. Remember the size and fall back to
        // plain JSON; zod still validates the answer, with one repair retry.
        AnthropicProvider.schemaLimit = Math.min(AnthropicProvider.schemaLimit, variants)
      }
    }
    return this.run(req, signal, false)
  }

  private async run(req: ProviderRequest, signal: AbortSignal, useSchema: boolean): Promise<ProviderResponse> {
    const fallback = FALLBACK_MODELS.test(req.model)
    const stream = this.client.beta.messages.stream(
      {
        model: req.model,
        max_tokens: req.maxOutputTokens,
        system: useSchema ? req.system : req.system + JSON_ONLY_INSTRUCTION,
        messages: [{ role: 'user', content: req.user }],
        ...(useSchema
          ? {
              output_config: {
                format: { type: 'json_schema' as const, schema: toStructuredOutputSchema(req.jsonSchema) as Record<string, unknown> }
              }
            }
          : {}),
        // On a safety decline, let the API retry on a suitable model inside the same call.
        ...(fallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {})
      },
      { signal, timeout: req.timeoutMs }
    )
    const msg = await stream.finalMessage()
    if (msg.stop_reason === 'max_tokens') {
      throw new ProviderError('schema', 'The answer was cut off because it was too long. Select fewer content types and try again.')
    }
    if (msg.stop_reason === 'refusal') {
      throw new ProviderError('bad_request', 'Claude declined this request.')
    }
    const text = msg.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('')
    return {
      json: extractJson(text),
      rawText: text,
      model: msg.model ?? req.model,
      usage: { inputTokens: msg.usage?.input_tokens, outputTokens: msg.usage?.output_tokens }
    }
  }

  /** Test hook: forget the remembered schema limit. */
  static resetSchemaLimit(): void {
    AnthropicProvider.schemaLimit = Number.POSITIVE_INFINITY
  }

  async testConnection(model: string, signal: AbortSignal): Promise<string> {
    const m = await this.client.models.retrieve(model, undefined, { signal, timeout: 20_000 })
    return `Connected to Anthropic. Model "${m.display_name ?? m.id}" is available to this key.`
  }

  async listModels(signal: AbortSignal): Promise<string[]> {
    const ids: string[] = []
    for await (const m of this.client.models.list(undefined, { signal, timeout: 20_000 })) ids.push(m.id)
    return ids
  }
}
