import OpenAI from 'openai'
import { ProviderError, type ProviderAdapter, type ProviderRequest, type ProviderResponse } from './types'

/** OpenAI adapter — Chat Completions with a JSON-schema response format. */
export class OpenAIProvider implements ProviderAdapter {
  readonly id = 'openai' as const
  private readonly client: OpenAI

  /** baseURL is only overridden by tests (local fake server). */
  constructor(apiKey: string, baseURL?: string) {
    // maxRetries 1: one SDK retry on transient errors; no retry loops that cost money.
    this.client = new OpenAI({ apiKey, maxRetries: 1, ...(baseURL ? { baseURL } : {}) })
  }

  async generate(req: ProviderRequest, signal: AbortSignal): Promise<ProviderResponse> {
    const res = await this.client.chat.completions.create(
      {
        model: req.model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: req.schemaName, schema: req.jsonSchema, strict: false }
        },
        max_completion_tokens: req.maxOutputTokens
      },
      { signal, timeout: req.timeoutMs }
    )
    const choice = res.choices[0]
    if (!choice) throw new ProviderError('schema', 'OpenAI returned no answer.')
    if (choice.message.refusal) throw new ProviderError('bad_request', `OpenAI declined the request: ${choice.message.refusal}`)
    if (choice.finish_reason === 'length') {
      throw new ProviderError('schema', 'The answer was cut off because it was too long. Select fewer content types and try again.')
    }
    const text = choice.message.content ?? ''
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      json = undefined
    }
    return {
      json,
      rawText: text,
      model: res.model ?? req.model,
      usage: { inputTokens: res.usage?.prompt_tokens, outputTokens: res.usage?.completion_tokens }
    }
  }

  async testConnection(model: string, signal: AbortSignal): Promise<string> {
    const m = await this.client.models.retrieve(model, { signal, timeout: 20_000 })
    return `Connected to OpenAI. Model "${m.id}" is available to this key.`
  }

  async listModels(signal: AbortSignal): Promise<string[]> {
    const ids: string[] = []
    for await (const m of this.client.models.list({ signal, timeout: 20_000 })) {
      if (/^(gpt-|o\d|chatgpt-)/.test(m.id) && !/(audio|realtime|transcribe|tts|image|search|embedding)/.test(m.id)) ids.push(m.id)
    }
    return ids.sort().reverse()
  }
}
