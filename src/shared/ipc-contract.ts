// The typed contract between renderer and main. Every IPC payload is validated
// against these schemas in the main process before a handler runs.

import { z } from 'zod'
import type { ContentPackage, GenerationInput } from './content-schema'
import type { AccuracyWarning } from './guards/accuracy'
import type { ChannelProfile } from './guards/branding'
import type { PlatformRules } from './limits'
import {
  CONTENT_TYPE_IDS,
  EMOJI_LEVELS,
  LANGUAGES,
  PLATFORMS,
  PROVIDERS,
  QUICK_ACTIONS,
  TONES,
  type ContentTypeId,
  type Platform,
  type ProviderId
} from './platform-types'

// ---------------------------------------------------------------------------
// Result envelope — errors cross the bridge as data, never as thrown objects.
// ---------------------------------------------------------------------------

export type ErrorCode =
  | 'validation'
  | 'not_found'
  | 'no_key'
  | 'invalid_key'
  | 'rate_limit'
  | 'quota'
  | 'timeout'
  | 'offline'
  | 'cancelled'
  | 'bad_request'
  | 'server'
  | 'schema'
  | 'storage'
  | 'forbidden'
  | 'unknown'

export interface AppError {
  code: ErrorCode
  message: string
  retryAfterSec?: number
  details?: string[]
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: AppError }

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
}

export interface PackageRecord {
  id: number
  draftId: number
  platform: Platform
  contentType: ContentTypeId
  generated: ContentPackage
  edited: ContentPackage | null
  /** edited ?? generated — what the editor shows. */
  current: ContentPackage
  provider: ProviderId
  model: string
  skillVersion: string
  generatedAt: string
  warnings: AccuracyWarning[]
  historyCount: number
}

export interface DraftSummary {
  id: number
  title: string
  headline: string
  status: string
  contentTypes: ContentTypeId[]
  platforms: Platform[]
  providers: ProviderId[]
  createdAt: string
  updatedAt: string
}

export interface DraftDetail {
  id: number
  title: string
  headline: string
  input: GenerationInput
  status: string
  profileId: number | null
  createdAt: string
  updatedAt: string
  packages: PackageRecord[]
  usage?: TokenUsage
}

export interface ProviderStatus {
  provider: ProviderId
  model: string
  timeoutMs: number
  enabled: boolean
  keySaved: boolean
  keyLast4: string | null
  active: boolean
}

export interface AppInfo {
  version: string
  skillName: string
  skillVersion: string
  isPackaged: boolean
  userDataPath: string
  platformRules: PlatformRules
  encryptionAvailable: boolean
}

export const templatePresetSchema = z.strictObject({
  language: z.enum(LANGUAGES),
  tone: z.enum(TONES),
  emojiLevel: z.enum(EMOJI_LEVELS),
  contentTypes: z.array(z.enum(CONTENT_TYPE_IDS)).min(1).max(14),
  hashtagPrefs: z.strictObject({
    maxRecommended: z.number().int().min(1).max(30),
    includeExpanded: z.boolean(),
    extraTags: z.array(z.string().max(80)).max(20)
  }),
  profileId: z.number().int().positive().nullable()
})
export type TemplatePreset = z.infer<typeof templatePresetSchema>

export interface Template {
  id: number
  name: string
  preset: TemplatePreset
  createdAt: string
}

export interface AppSettings {
  hypePhrases: string[]
  timezone: string
  activeProvider: ProviderId
  defaultLanguage: (typeof LANGUAGES)[number]
  defaultTone: (typeof TONES)[number]
}

export interface ImportPreview {
  token: string
  fileName: string
  appVersion: string
  exportedAt: string
  counts: { drafts: number; packages: number; profiles: number; templates: number }
  draftTitles: string[]
}

export interface FieldProposal {
  packageId: number
  fieldPath: string
  previous: unknown
  proposal: unknown
  warnings: AccuracyWarning[]
  provider: ProviderId
  model: string
}

export interface SaveResult {
  saved: boolean
  path?: string
}

// ---------------------------------------------------------------------------
// Payload schemas (renderer → main)
// ---------------------------------------------------------------------------

const id = z.number().int().positive()
const requestId = z.string().min(8).max(64).regex(/^[A-Za-z0-9-]+$/)
const fieldPath = z
  .string()
  .max(64)
  .regex(/^[a-zA-Z0-9]+(\.[a-zA-Z0-9]+)*$/)

export const profileInputSchema = z.strictObject({
  id: id.optional(),
  name: z.string().trim().min(1).max(100),
  youtubeHandle: z.string().trim().max(100),
  facebookPage: z.string().trim().max(100),
  instagramHandle: z.string().trim().max(100),
  youtubeHashtag: z.string().trim().max(100),
  facebookHashtag: z.string().trim().max(100),
  instagramHashtag: z.string().trim().max(100)
})
export type ProfileInput = z.infer<typeof profileInputSchema>

export const settingKeySchema = z.enum(['hypePhrases', 'timezone', 'activeProvider', 'defaultLanguage', 'defaultTone'])

export const settingValueSchemas = {
  hypePhrases: z.array(z.string().trim().min(1).max(100)).max(200),
  timezone: z.string().min(1).max(64),
  activeProvider: z.enum(PROVIDERS),
  defaultLanguage: z.enum(LANGUAGES),
  defaultTone: z.enum(TONES)
} as const

const realProvider = z.enum(['openai', 'anthropic'])

export const draftListFilterSchema = z.strictObject({
  search: z.string().max(200).optional(),
  platform: z.enum(PLATFORMS).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  limit: z.number().int().min(1).max(1000).optional()
})
export type DraftListFilter = z.infer<typeof draftListFilterSchema>

/** Every channel, its payload schema. Handlers in main are keyed by these names. */
export const IPC_SCHEMAS = {
  'app:info': z.undefined(),
  'profiles:list': z.undefined(),
  'profiles:save': profileInputSchema,
  'profiles:delete': z.strictObject({ id }),
  'profiles:setDefault': z.strictObject({ id }),
  'settings:get': z.undefined(),
  'settings:set': z.strictObject({ key: settingKeySchema, value: z.unknown() }),
  'provider:list': z.undefined(),
  'provider:save': z.strictObject({
    provider: z.enum(PROVIDERS),
    model: z.string().trim().max(200),
    timeoutMs: z.number().int().min(10_000).max(600_000),
    enabled: z.boolean()
  }),
  'provider:saveKey': z.strictObject({ provider: realProvider, key: z.string().trim().min(10).max(500) }),
  'provider:clearKey': z.strictObject({ provider: realProvider }),
  'provider:test': z.strictObject({ provider: z.enum(PROVIDERS) }),
  'provider:models': z.strictObject({ provider: z.enum(PROVIDERS) }),
  'gen:run': z.strictObject({ requestId, input: z.unknown() }),
  'gen:cancel': z.strictObject({ requestId }),
  'gen:regenerateField': z.strictObject({
    requestId,
    packageId: id,
    fieldPath,
    action: z.enum(QUICK_ACTIONS).optional()
  }),
  'gen:regeneratePackage': z.strictObject({ requestId, packageId: id, action: z.enum(QUICK_ACTIONS).optional() }),
  'gen:regeneratePlatform': z.strictObject({
    requestId,
    draftId: id,
    platform: z.enum(PLATFORMS),
    action: z.enum(QUICK_ACTIONS).optional()
  }),
  'packages:applyField': z.strictObject({
    packageId: id,
    fieldPath,
    value: z.unknown(),
    source: z.enum(['user', 'regen'])
  }),
  'packages:undo': z.strictObject({ packageId: id }),
  'packages:reset': z.strictObject({ packageId: id }),
  'drafts:list': draftListFilterSchema,
  'drafts:get': z.strictObject({ id }),
  'drafts:rename': z.strictObject({ id, title: z.string().trim().min(1).max(200) }),
  'drafts:duplicate': z.strictObject({ id }),
  'drafts:delete': z.strictObject({ id }),
  'drafts:restore': z.strictObject({ id }),
  'templates:list': z.undefined(),
  'templates:save': z.strictObject({ id: id.optional(), name: z.string().trim().min(1).max(100), preset: templatePresetSchema }),
  'templates:delete': z.strictObject({ id }),
  'export:draft': z.strictObject({ draftId: id, format: z.enum(['txt', 'json', 'html', 'pdf']) }),
  'export:csv': z.strictObject({ draftIds: z.array(id).min(1).max(1000) }),
  'backup:create': z.undefined(),
  'backup:importPreview': z.undefined(),
  'backup:importApply': z.strictObject({ token: z.string().min(8).max(64) }),
  'clipboard:write': z.strictObject({ text: z.string().max(200_000) }),
  'shell:openExternal': z.strictObject({ url: z.string().url().max(2000) })
} as const

export type IpcChannel = keyof typeof IPC_SCHEMAS
export type IpcPayload<C extends IpcChannel> = z.input<(typeof IPC_SCHEMAS)[C]>

export interface IpcResults {
  'app:info': AppInfo
  'profiles:list': ChannelProfile[]
  'profiles:save': ChannelProfile
  'profiles:delete': true
  'profiles:setDefault': true
  'settings:get': AppSettings
  'settings:set': AppSettings
  'provider:list': ProviderStatus[]
  'provider:save': ProviderStatus[]
  'provider:saveKey': ProviderStatus[]
  'provider:clearKey': ProviderStatus[]
  'provider:test': { message: string }
  'provider:models': string[]
  'gen:run': DraftDetail
  'gen:cancel': true
  'gen:regenerateField': FieldProposal
  'gen:regeneratePackage': DraftDetail
  'gen:regeneratePlatform': DraftDetail
  'packages:applyField': PackageRecord
  'packages:undo': PackageRecord
  'packages:reset': PackageRecord
  'drafts:list': DraftSummary[]
  'drafts:get': DraftDetail
  'drafts:rename': true
  'drafts:duplicate': DraftDetail
  'drafts:delete': true
  'drafts:restore': true
  'templates:list': Template[]
  'templates:save': Template
  'templates:delete': true
  'export:draft': SaveResult
  'export:csv': SaveResult
  'backup:create': SaveResult
  'backup:importPreview': ImportPreview | null
  'backup:importApply': { drafts: number; profiles: number; templates: number }
  'clipboard:write': true
  'shell:openExternal': true
}

/** Shape of `window.api` exposed by the preload script. */
export type KssApi = {
  invoke<C extends IpcChannel>(
    channel: C,
    ...payload: IpcPayload<C> extends undefined ? [] : [IpcPayload<C>]
  ): Promise<Result<IpcResults[C]>>
}

export const EXTERNAL_URL_ALLOWLIST = [
  'platform.openai.com',
  'console.anthropic.com',
  'platform.claude.com',
  'docs.claude.com',
  'support.google.com',
  'help.instagram.com',
  'www.facebook.com',
  'www.youtube.com',
  'studio.youtube.com',
  'www.instagram.com',
  'fonts.google.com'
]

export function isAllowedExternalUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    return u.protocol === 'https:' && EXTERNAL_URL_ALLOWLIST.includes(u.hostname) && !u.username && !u.password
  } catch {
    return false
  }
}
