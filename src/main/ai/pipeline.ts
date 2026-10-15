// Generation pipeline: build prompt → call provider → validate schema (one repair
// retry) → branding guard. Accuracy warnings are computed when packages are read,
// so they also cover later edits.

import { z } from 'zod'
import {
  hashtagsSchema,
  outputJsonSchema,
  pollSchema,
  stripNulls,
  validateGenerationOutput,
  type ContentPackage,
  type GenerationInput
} from '@shared/content-schema'
import { applyBranding, dedupeHashtags, mandatoryHashtag, type ChannelProfile } from '@shared/guards/branding'
import type { TokenUsage } from '@shared/ipc-contract'
import { CONTENT_TYPES, type ContentTypeId, type ProviderId, type QuickAction } from '@shared/platform-types'
import type { Logger } from '../logger'
import { mapProviderError, type AbortInfo } from './providers/errors'
import { ProviderError, type ProviderAdapter, type ProviderRequest, type ProviderResponse } from './providers/types'
import { buildFieldPrompt, buildRepairPrompt, buildSystemPrompt, buildUserPrompt } from './prompt-builder'
import type { Skill } from './skill-loader'

export interface PipelineDeps {
  provider: ProviderAdapter
  providerId: ProviderId
  model: string
  timeoutMs: number
  skill: Skill
  profile: ChannelProfile
  signal: AbortSignal
  abortInfo?: AbortInfo
  log?: Logger
}

export interface GenerationResult {
  packages: ContentPackage[]
  model: string
  usage: TokenUsage
  repaired: boolean
}

/**
 * Tamil text uses many tokens per word, and current models think before
 * answering (thinking tokens count toward the limit). Only used tokens are billed.
 */
export function outputBudget(count: number): number {
  return Math.min(64_000, 12_000 + count * 3_500)
}

function addUsage(a: TokenUsage, b?: TokenUsage): TokenUsage {
  return {
    inputTokens: (a.inputTokens ?? 0) + (b?.inputTokens ?? 0) || undefined,
    outputTokens: (a.outputTokens ?? 0) + (b?.outputTokens ?? 0) || undefined
  }
}

async function call(deps: PipelineDeps, req: ProviderRequest): Promise<ProviderResponse> {
  try {
    return await deps.provider.generate(req, deps.signal)
  } catch (err) {
    throw mapProviderError(err, deps.providerId, deps.abortInfo)
  }
}

/** Generate (or regenerate) packages for the given content types. */
export async function runGeneration(
  input: GenerationInput,
  deps: PipelineDeps,
  opts: { contentTypes?: ContentTypeId[]; action?: QuickAction; current?: ContentPackage[] } = {}
): Promise<GenerationResult> {
  const ids = opts.contentTypes ?? input.contentTypes
  const system = buildSystemPrompt(deps.skill, ids, deps.profile)
  const user = buildUserPrompt(input, deps.skill.version, ids, { action: opts.action, current: opts.current })
  const base: Omit<ProviderRequest, 'user'> = {
    model: deps.model,
    system,
    jsonSchema: outputJsonSchema(ids),
    schemaName: 'social_packages',
    maxOutputTokens: outputBudget(ids.length),
    timeoutMs: deps.timeoutMs,
    context: {
      kind: 'generate',
      input,
      contentTypes: ids,
      profile: deps.profile,
      skillVersion: deps.skill.version,
      action: opts.action,
      current: opts.current
    }
  }

  let res = await call(deps, { ...base, user })
  let usage = addUsage({}, res.usage)
  let check = validateGenerationOutput(res.json, ids)
  let repaired = false
  if (!check.ok) {
    deps.log?.warn('AI output failed schema validation; trying one repair', { errors: check.errors.slice(0, 10) })
    const repairUser = buildRepairPrompt(user, res.rawText, res.json === undefined ? ['Output was not valid JSON'] : check.errors)
    res = await call(deps, { ...base, user: repairUser })
    usage = addUsage(usage, res.usage)
    check = validateGenerationOutput(res.json, ids)
    repaired = true
  }
  if (!check.ok) {
    throw new ProviderError(
      'schema',
      'The AI answer did not match the required format, even after one automatic repair. Nothing was saved. Try again or choose fewer content types.',
      undefined,
      check.errors.slice(0, 20)
    )
  }
  const packages = check.output.packages.map((p) =>
    applyBranding(p, mandatoryHashtag(deps.profile, CONTENT_TYPES[p.contentType].platform), input.hashtagPrefs)
  )
  return { packages, model: res.model, usage, repaired }
}

/** The schema a single regenerated field must follow. */
export function fieldValueSchema(fieldPath: string): z.ZodType {
  if (fieldPath === 'hashtags.recommended') return hashtagsSchema.shape.recommended.min(1)
  if (fieldPath === 'keywords') return z.array(z.string().min(1)).min(1)
  if (fieldPath === 'slideTexts') return z.array(z.string().min(1)).min(1).max(20)
  if (fieldPath === 'poll') return pollSchema
  return z.string().trim().min(1)
}

export interface FieldResult {
  value: unknown
  model: string
  usage: TokenUsage
}

export async function runFieldRegeneration(
  input: GenerationInput,
  current: ContentPackage,
  fieldPath: string,
  deps: PipelineDeps,
  action?: QuickAction
): Promise<FieldResult> {
  const system = buildSystemPrompt(deps.skill, [current.contentType], deps.profile)
  const user = buildFieldPrompt(input, deps.skill.version, current, fieldPath, action)
  const valueSchema = fieldValueSchema(fieldPath)
  const wrapper = z.strictObject({ value: valueSchema })
  const base: Omit<ProviderRequest, 'user'> = {
    model: deps.model,
    system,
    jsonSchema: z.toJSONSchema(wrapper, { target: 'draft-7' }) as Record<string, unknown>,
    schemaName: 'field_value',
    maxOutputTokens: 16_000,
    timeoutMs: deps.timeoutMs,
    context: { kind: 'field', input, current, fieldPath, profile: deps.profile, skillVersion: deps.skill.version, action }
  }
  delete (base.jsonSchema as Record<string, unknown>).$schema

  let res = await call(deps, { ...base, user })
  let usage = addUsage({}, res.usage)
  let parsed = wrapper.safeParse(stripNulls(res.json))
  if (!parsed.success) {
    const errors = parsed.error.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`)
    res = await call(deps, { ...base, user: buildRepairPrompt(user, res.rawText, errors) })
    usage = addUsage(usage, res.usage)
    parsed = wrapper.safeParse(stripNulls(res.json))
  }
  if (!parsed.success) {
    throw new ProviderError('schema', 'The AI answer for this field was not in the expected format. Nothing was changed.')
  }
  let value: unknown = parsed.data.value
  if (fieldPath === 'hashtags.recommended') {
    const brand = mandatoryHashtag(deps.profile, CONTENT_TYPES[current.contentType].platform)
    value = dedupeHashtags([brand, ...(value as string[])])
  }
  return { value, model: res.model, usage }
}
