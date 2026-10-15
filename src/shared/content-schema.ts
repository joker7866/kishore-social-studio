import { z } from 'zod'
import {
  CONTENT_TYPES,
  CONTENT_TYPE_IDS,
  EMOJI_LEVELS,
  LANGUAGES,
  LIVE_STATUSES,
  PLATFORMS,
  TONES,
  type ContentTypeId,
  type FieldKey
} from './platform-types'

// ---------------------------------------------------------------------------
// Generation input (what the user types on the Generate screen)
// ---------------------------------------------------------------------------

const text = (max: number) => z.string().max(max)

export const liveDetailsSchema = z.strictObject({
  eventName: text(300).default(''),
  dateTime: text(100).default(''),
  timezone: text(64).default('Asia/Kolkata'),
  venue: text(300).default(''),
  speakers: text(1000).default(''),
  status: z.enum(LIVE_STATUSES)
})
export type LiveDetails = z.infer<typeof liveDetailsSchema>

export const claimFlagsSchema = z.strictObject({
  official: z.boolean().default(false),
  exclusive: z.boolean().default(false),
  breaking: z.boolean().default(false),
  fullSpeech: z.boolean().default(false)
})
export type ClaimFlags = z.infer<typeof claimFlagsSchema>

export const hashtagPrefsSchema = z.strictObject({
  maxRecommended: z.number().int().min(1).max(30).default(5),
  includeExpanded: z.boolean().default(true),
  extraTags: z.array(text(80)).max(20).default([])
})
export type HashtagPrefs = z.infer<typeof hashtagPrefsSchema>

export const generationInputSchema = z.strictObject({
  headline: z.string().trim().min(1, 'Headline is required').max(500),
  summary: text(5000).default(''),
  transcript: text(60000).default(''),
  sourceText: text(60000).default(''),
  sourceUrl: text(2000).default(''),
  confirmedFacts: text(10000).default(''),
  allegations: text(10000).default(''),
  live: liveDetailsSchema.nullable().default(null),
  flags: claimFlagsSchema.default({ official: false, exclusive: false, breaking: false, fullSpeech: false }),
  contentTypes: z.array(z.enum(CONTENT_TYPE_IDS)).min(1, 'Pick at least one content type').max(14),
  language: z.enum(LANGUAGES).default('ta'),
  tone: z.enum(TONES).default('neutral'),
  emojiLevel: z.enum(EMOJI_LEVELS).default('few'),
  hashtagPrefs: hashtagPrefsSchema.default({ maxRecommended: 5, includeExpanded: true, extraTags: [] }),
  profileId: z.number().int().positive().nullable().default(null)
})
export type GenerationInput = z.infer<typeof generationInputSchema>
export type GenerationInputDraft = z.input<typeof generationInputSchema>

// ---------------------------------------------------------------------------
// Output contract (what the AI must return) — enforced per content type
// ---------------------------------------------------------------------------

const outText = z.string().min(1)

export const hashtagsSchema = z.strictObject({
  recommended: z.array(z.string()),
  expanded: z.array(z.string())
})

export const pollSchema = z.strictObject({
  question: outText,
  choices: z.array(outText).min(2).max(5)
})

export const qualitativeFeedbackSchema = z.strictObject({
  clearTopic: z.string(),
  specificWording: z.string(),
  faithfulToSource: z.string(),
  readableLength: z.string(),
  missingContext: z.string()
})

const FIELD_SCHEMAS: Record<FieldKey, z.ZodType> = {
  titleOptions: z.array(outText).length(3),
  hookOptions: z.array(outText).length(3),
  description: outText,
  caption: outText,
  postText: outText,
  hook: outText,
  hook3s: outText,
  thumbnailText: outText,
  overlayText: outText,
  pinnedComment: outText,
  cta: outText,
  interactionPrompt: outText,
  keywords: z.array(z.string()),
  slideTexts: z.array(outText).max(20),
  poll: pollSchema,
  hashtags: hashtagsSchema
}

function packageSchemaFor(id: ContentTypeId) {
  const spec = CONTENT_TYPES[id]
  const shape: Record<string, z.ZodType> = {
    platform: z.literal(spec.platform),
    contentType: z.literal(id),
    qualitativeFeedback: qualitativeFeedbackSchema,
    missingInfoNotes: z.array(z.string()),
    sourceRefs: z.array(z.string())
  }
  for (const f of spec.required) shape[f] = FIELD_SCHEMAS[f]
  for (const f of spec.optional) shape[f] = FIELD_SCHEMAS[f].optional()
  if (spec.required.includes('titleOptions') || spec.required.includes('hookOptions')) {
    shape.recommendedIndex = z.number().int().min(0).max(2)
  }
  // strictObject: a field that does not belong to this content type is rejected
  // (e.g. Instagram never gets keywords, Stories never get titles).
  return z.strictObject(shape)
}

export const PACKAGE_SCHEMAS = Object.fromEntries(
  CONTENT_TYPE_IDS.map((id) => [id, packageSchemaFor(id)])
) as Record<ContentTypeId, z.ZodObject>

export interface ContentPackage {
  platform: (typeof PLATFORMS)[number]
  contentType: ContentTypeId
  titleOptions?: string[]
  hookOptions?: string[]
  recommendedIndex?: number
  description?: string
  caption?: string
  postText?: string
  hook?: string
  hook3s?: string
  thumbnailText?: string
  overlayText?: string
  pinnedComment?: string
  cta?: string
  interactionPrompt?: string
  keywords?: string[]
  slideTexts?: string[]
  poll?: { question: string; choices: string[] }
  hashtags?: { recommended: string[]; expanded: string[] }
  qualitativeFeedback: z.infer<typeof qualitativeFeedbackSchema>
  missingInfoNotes: string[]
  sourceRefs: string[]
}

export interface GenerationOutput {
  skillVersion: string
  packages: ContentPackage[]
}

/** Recursively drop `null` values — models often send null for "not applicable". */
export function stripNulls(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((v) => v !== null).map(stripNulls)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      if (v === null) continue
      out[k] = stripNulls(v)
    }
    return out
  }
  return value
}

export type OutputValidation =
  | { ok: true; output: GenerationOutput }
  | { ok: false; errors: string[] }

/**
 * Validate raw AI JSON against the contract for exactly the requested content types.
 * Never guesses: anything that does not parse is reported as an error.
 */
export function validateGenerationOutput(
  raw: unknown,
  requested: ContentTypeId[]
): OutputValidation {
  const errors: string[] = []
  const cleaned = stripNulls(raw)
  const root = z
    .strictObject({ skillVersion: z.string(), packages: z.array(z.unknown()) })
    .safeParse(cleaned)
  if (!root.success) {
    return { ok: false, errors: root.error.issues.map((i) => `${i.path.join('.') || 'root'}: ${i.message}`) }
  }
  const packages: ContentPackage[] = []
  const seen = new Set<string>()
  root.data.packages.forEach((pkg, idx) => {
    const ct = (pkg as { contentType?: unknown })?.contentType
    if (typeof ct !== 'string' || !(CONTENT_TYPE_IDS as readonly string[]).includes(ct)) {
      errors.push(`packages.${idx}.contentType: unknown content type ${JSON.stringify(ct)}`)
      return
    }
    const id = ct as ContentTypeId
    if (!requested.includes(id)) {
      errors.push(`packages.${idx}: content type ${id} was not requested`)
      return
    }
    if (seen.has(id)) {
      errors.push(`packages.${idx}: duplicate content type ${id}`)
      return
    }
    const parsed = PACKAGE_SCHEMAS[id].safeParse(pkg)
    if (!parsed.success) {
      for (const i of parsed.error.issues) {
        errors.push(`packages.${idx} (${id}).${i.path.join('.')}: ${i.message}`)
      }
      return
    }
    seen.add(id)
    packages.push(parsed.data as unknown as ContentPackage)
  })
  for (const id of requested) {
    if (!seen.has(id) && !errors.some((e) => e.includes(`(${id})`))) {
      errors.push(`missing package for content type ${id}`)
    }
  }
  if (errors.length) return { ok: false, errors }
  // Keep the order the user asked for.
  packages.sort((a, b) => requested.indexOf(a.contentType) - requested.indexOf(b.contentType))
  return { ok: true, output: { skillVersion: root.data.skillVersion, packages } }
}

/** Validate a single package (used after edits and imports). */
export function validatePackage(raw: unknown): { ok: true; pkg: ContentPackage } | { ok: false; errors: string[] } {
  const ct = (raw as { contentType?: unknown })?.contentType
  if (typeof ct !== 'string' || !(CONTENT_TYPE_IDS as readonly string[]).includes(ct)) {
    return { ok: false, errors: ['unknown content type'] }
  }
  const parsed = PACKAGE_SCHEMAS[ct as ContentTypeId].safeParse(stripNulls(raw))
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }
  }
  return { ok: true, pkg: parsed.data as unknown as ContentPackage }
}

/** JSON Schema sent to providers so they return exactly the requested types. */
export function outputJsonSchema(requested: ContentTypeId[]): Record<string, unknown> {
  const variants = requested.map((id) => z.toJSONSchema(PACKAGE_SCHEMAS[id], { target: 'draft-7' }))
  for (const v of variants) delete (v as Record<string, unknown>).$schema
  return {
    type: 'object',
    additionalProperties: false,
    required: ['skillVersion', 'packages'],
    properties: {
      skillVersion: { type: 'string' },
      packages: {
        type: 'array',
        minItems: requested.length,
        maxItems: requested.length,
        items: variants.length === 1 ? variants[0] : { anyOf: variants }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Field paths for editing / regeneration
// ---------------------------------------------------------------------------

/** Read a dotted field path such as `titleOptions.1` or `hashtags.recommended`. */
export function getFieldValue(pkg: ContentPackage, path: string): unknown {
  let cur: unknown = pkg
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined) return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

/** Immutable set of a dotted path. Creates intermediate objects/arrays as needed. */
export function setFieldValue(pkg: ContentPackage, path: string, value: unknown): ContentPackage {
  const parts = path.split('.')
  const clone = structuredClone(pkg) as unknown as Record<string, unknown>
  let cur: Record<string, unknown> = clone
  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i]
    const nextIsIndex = /^\d+$/.test(parts[i + 1])
    if (cur[key] === undefined || cur[key] === null) cur[key] = nextIsIndex ? [] : {}
    cur = cur[key] as Record<string, unknown>
  }
  const last = parts[parts.length - 1]
  if (value === undefined) delete cur[last]
  else cur[last] = value
  return clone as unknown as ContentPackage
}

/** Paths a user can regenerate one at a time. */
export function regenerableFieldPaths(pkg: ContentPackage): string[] {
  const spec = CONTENT_TYPES[pkg.contentType]
  const paths: string[] = []
  for (const f of [...spec.required, ...spec.optional]) {
    if (f === 'titleOptions' || f === 'hookOptions') {
      paths.push(`${f}.0`, `${f}.1`, `${f}.2`)
    } else if (f === 'hashtags') {
      paths.push('hashtags.recommended')
    } else if (f === 'poll' || f === 'keywords' || f === 'slideTexts') {
      paths.push(f)
    } else {
      paths.push(f)
    }
  }
  return paths
}

/** Collect every text value in a package with its path (for guards, search, export). */
export function collectTexts(pkg: ContentPackage): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = []
  const spec = CONTENT_TYPES[pkg.contentType]
  for (const f of [...spec.required, ...spec.optional]) {
    const v = (pkg as unknown as Record<string, unknown>)[f]
    if (v === undefined) continue
    if (typeof v === 'string') out.push({ path: f, text: v })
    else if (Array.isArray(v)) v.forEach((s, i) => typeof s === 'string' && out.push({ path: `${f}.${i}`, text: s }))
    else if (f === 'poll') {
      const p = v as { question: string; choices: string[] }
      out.push({ path: 'poll.question', text: p.question })
      p.choices.forEach((c, i) => out.push({ path: `poll.choices.${i}`, text: c }))
    } else if (f === 'hashtags') {
      const h = v as { recommended: string[]; expanded: string[] }
      h.recommended.forEach((t, i) => out.push({ path: `hashtags.recommended.${i}`, text: t }))
      h.expanded.forEach((t, i) => out.push({ path: `hashtags.expanded.${i}`, text: t }))
    }
  }
  return out
}
