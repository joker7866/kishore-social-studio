// IPC handlers. Kept free of Electron imports (everything platform-specific comes
// through AppContext) so they can be unit-tested with an in-memory database.

import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { ZodError } from 'zod'
import {
  generationInputSchema,
  getFieldValue,
  regenerableFieldPaths,
  setFieldValue,
  validatePackage,
  type ContentPackage,
  type GenerationInput
} from '@shared/content-schema'
import { checkPackageAccuracy, type AccuracyWarning } from '@shared/guards/accuracy'
import { hasMandatoryHashtag, mandatoryHashtag, type ChannelProfile } from '@shared/guards/branding'
import {
  IPC_SCHEMAS,
  isAllowedExternalUrl,
  settingValueSchemas,
  type AppError,
  type DraftDetail,
  type DraftSummary,
  type IpcChannel,
  type IpcResults,
  type PackageRecord,
  type ProviderStatus,
  type Result,
  type TokenUsage
} from '@shared/ipc-contract'
import { CONTENT_TYPES, PLATFORMS, type ContentTypeId, type Platform, type ProviderId, type QuickAction } from '@shared/platform-types'
import { runFieldRegeneration, runGeneration, type PipelineDeps } from '../ai/pipeline'
import { mapProviderError } from '../ai/providers/errors'
import { ProviderError, type ProviderAdapter } from '../ai/providers/types'
import type { Skill } from '../ai/skill-loader'
import { transaction, type Db } from '../db/database'
import * as repo from '../db/repo'
import { NotFoundError, ValidationError } from '../db/repo'
import { MAX_BACKUP_BYTES, applyBackup, buildBackup, parseBackup, type Backup } from '../export/backup'
import { draftToHtml, draftToJson, draftToText, draftsToCsv } from '../export/exporters'
import type { Logger } from '../logger'
import type { KeyStore } from '../secrets/key-store'
import { redact } from '../security/redact'

export interface FileFilter {
  name: string
  extensions: string[]
}

export interface AppContext {
  db: Db
  keyStore: KeyStore
  skill: Skill
  log: Logger
  appVersion: string
  isPackaged: boolean
  userDataPath: string
  createProvider(id: ProviderId, key: string | null): ProviderAdapter
  isOnline(): boolean
  fontCss(): string
  dialogs: {
    save(defaultName: string, filters: FileFilter[]): Promise<string | null>
    open(filters: FileFilter[]): Promise<string | null>
  }
  files: {
    write(path: string, data: string | Buffer): void
    read(path: string): Buffer
    size(path: string): number
  }
  printToPdf(html: string): Promise<Buffer>
  clipboardWrite(text: string): void
  openExternal(url: string): Promise<void>
}

type Handler = (payload: never) => unknown | Promise<unknown>

// ---------------------------------------------------------------------------
// Record builders
// ---------------------------------------------------------------------------

function parseInput(json: string): GenerationInput {
  return generationInputSchema.parse(JSON.parse(json))
}

function brandTags(profile: ChannelProfile): string[] {
  return PLATFORMS.map((p) => mandatoryHashtag(profile, p))
}

export function warningsFor(
  pkg: ContentPackage,
  input: GenerationInput,
  profile: ChannelProfile,
  hypePhrases: string[]
): AccuracyWarning[] {
  const out = checkPackageAccuracy(pkg, input, { hypePhrases, brandHashtags: brandTags(profile) })
  const brand = mandatoryHashtag(profile, CONTENT_TYPES[pkg.contentType].platform)
  if (!hasMandatoryHashtag(pkg, brand)) {
    out.push({
      path: 'hashtags.recommended',
      code: 'missing_brand_hashtag',
      severity: 'warning',
      match: brand,
      message: `The channel hashtag ${brand} is missing.`
    })
  }
  return out
}

function toRecord(ctx: AppContext, row: repo.PackageRow, input: GenerationInput, profile: ChannelProfile): PackageRecord {
  const generated = JSON.parse(row.generated_json) as ContentPackage
  const edited = row.edited_json ? (JSON.parse(row.edited_json) as ContentPackage) : null
  const current = edited ?? generated
  const settings = repo.getSettings(ctx.db)
  return {
    id: row.id,
    draftId: row.draft_id,
    platform: row.platform,
    contentType: row.content_type,
    generated,
    edited,
    current,
    provider: row.provider,
    model: row.model,
    skillVersion: row.skill_version,
    generatedAt: row.generated_at,
    warnings: warningsFor(current, input, profile, settings.hypePhrases),
    historyCount: repo.historyCount(ctx.db, row.id)
  }
}

export function getDraftDetail(ctx: AppContext, id: number, usage?: TokenUsage): DraftDetail {
  const d = repo.getDraftRow(ctx.db, id)
  const input = parseInput(d.context_json)
  const profile = repo.getProfile(ctx.db, d.profile_id)
  const packages = repo
    .listPackageRows(ctx.db, id)
    .map((r) => toRecord(ctx, r, input, profile))
    .sort((a, b) => input.contentTypes.indexOf(a.contentType) - input.contentTypes.indexOf(b.contentType))
  return {
    id: d.id,
    title: d.title,
    headline: d.headline,
    input,
    status: d.status,
    profileId: d.profile_id,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    packages,
    usage
  }
}

function packageRecord(ctx: AppContext, packageId: number): PackageRecord {
  const row = repo.getPackageRow(ctx.db, packageId)
  const d = repo.getDraftRow(ctx.db, row.draft_id)
  return toRecord(ctx, row, parseInput(d.context_json), repo.getProfile(ctx.db, d.profile_id))
}

function providerStatuses(ctx: AppContext): ProviderStatus[] {
  const active = repo.getSettings(ctx.db).activeProvider
  return repo.listProviderSettings(ctx.db).map((s) => {
    const key = s.provider === 'mock' ? { saved: true, last4: null } : ctx.keyStore.status(s.provider)
    return {
      provider: s.provider,
      model: s.model,
      timeoutMs: s.timeout_ms,
      enabled: s.enabled === 1,
      keySaved: key.saved,
      keyLast4: key.last4,
      active: s.provider === active
    }
  })
}

// ---------------------------------------------------------------------------
// Running providers with cancel + timeout
// ---------------------------------------------------------------------------

const running = new Map<string, AbortController>()

function providerFor(ctx: AppContext, id: ProviderId): { adapter: ProviderAdapter; model: string; timeoutMs: number } {
  const setting = repo.getProviderSetting(ctx.db, id)
  if (id !== 'mock') {
    const key = ctx.keyStore.get(id)
    if (!key) throw new ProviderError('no_key', `No API key saved for ${id === 'openai' ? 'OpenAI' : 'Anthropic'}. Add one in AI Provider Settings, or switch to Mock mode.`)
    if (!ctx.isOnline()) throw new ProviderError('offline', 'You are offline. Generation needs the internet; drafts, editing and export still work.')
    return { adapter: ctx.createProvider(id, key), model: setting.model, timeoutMs: setting.timeout_ms }
  }
  return { adapter: ctx.createProvider('mock', null), model: setting.model, timeoutMs: setting.timeout_ms }
}

async function withRun<T>(
  ctx: AppContext,
  requestId: string,
  profile: ChannelProfile,
  fn: (deps: PipelineDeps) => Promise<T>
): Promise<T> {
  if (running.has(requestId)) throw new ValidationError('This request is already running.')
  const providerId = repo.getSettings(ctx.db).activeProvider
  const { adapter, model, timeoutMs } = providerFor(ctx, providerId)
  const controller = new AbortController()
  const abortInfo = { timedOut: false }
  const timer = setTimeout(() => {
    abortInfo.timedOut = true
    controller.abort()
  }, timeoutMs + 5_000)
  running.set(requestId, controller)
  const started = Date.now()
  try {
    const out = await fn({
      provider: adapter,
      providerId,
      model,
      timeoutMs,
      skill: ctx.skill,
      profile,
      signal: controller.signal,
      abortInfo,
      log: ctx.log
    })
    ctx.log.info('AI request finished', { provider: providerId, model, ms: Date.now() - started })
    return out
  } catch (err) {
    const mapped = mapProviderError(err, providerId, abortInfo)
    ctx.log.warn('AI request failed', { provider: providerId, model, code: mapped.code, message: mapped.message })
    throw mapped
  } finally {
    clearTimeout(timer)
    running.delete(requestId)
  }
}

function activeProviderId(ctx: AppContext): ProviderId {
  return repo.getSettings(ctx.db).activeProvider
}

function assertEditablePath(pkg: ContentPackage, fieldPath: string): void {
  const top = fieldPath.split('.')[0]
  const spec = CONTENT_TYPES[pkg.contentType]
  const allowed = [...spec.required, ...spec.optional, ...(pkg.recommendedIndex !== undefined ? ['recommendedIndex'] : [])] as string[]
  if (!allowed.includes(top)) throw new ValidationError(`Field "${fieldPath}" does not belong to ${spec.label}.`)
}

function safeFileName(title: string): string {
  const cleaned = title.replace(/[<>:"/\\|?*\x00-\x1F]/g, '').replace(/\s+/g, ' ').trim().slice(0, 80)
  return cleaned || 'draft'
}

// ---------------------------------------------------------------------------
// Pending imports (renderer only ever sees a token + preview)
// ---------------------------------------------------------------------------

const pendingImports = new Map<string, { backup: Backup; expires: number }>()

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export function createHandlers(ctx: AppContext): { [C in IpcChannel]: Handler } {
  const db = ctx.db

  async function regenerate(requestId: string, draftId: number, ids: ContentTypeId[], action?: QuickAction) {
    const d = repo.getDraftRow(db, draftId)
    const input = parseInput(d.context_json)
    const profile = repo.getProfile(db, d.profile_id)
    const rows = repo.listPackageRows(db, draftId).filter((r) => ids.includes(r.content_type))
    const current = rows.map((r) => JSON.parse(r.edited_json ?? r.generated_json) as ContentPackage)
    const result = await withRun(ctx, requestId, profile, (deps) => runGeneration(input, deps, { contentTypes: ids, action, current }))
    const providerId = activeProviderId(ctx)
    transaction(db, () => {
      for (const pkg of result.packages) {
        repo.upsertPackage(db, draftId, { pkg, provider: providerId, model: result.model, skillVersion: ctx.skill.version }, true)
      }
    })
    return getDraftDetail(ctx, draftId, result.usage)
  }

  const h = {
    'app:info': () => ({
      version: ctx.appVersion,
      skillName: ctx.skill.name,
      skillVersion: ctx.skill.version,
      isPackaged: ctx.isPackaged,
      userDataPath: ctx.userDataPath,
      platformRules: ctx.skill.rules,
      encryptionAvailable: ctx.keyStore.isAvailable()
    }),

    // Profiles
    'profiles:list': () => repo.listProfiles(db),
    'profiles:save': (p: IpcPayloadOf<'profiles:save'>) => repo.saveProfile(db, p),
    'profiles:delete': (p: IpcPayloadOf<'profiles:delete'>) => (repo.deleteProfile(db, p.id), true),
    'profiles:setDefault': (p: IpcPayloadOf<'profiles:setDefault'>) => (repo.setDefaultProfile(db, p.id), true),

    // Settings
    'settings:get': () => repo.getSettings(db),
    'settings:set': (p: IpcPayloadOf<'settings:set'>) => {
      const value = settingValueSchemas[p.key].parse(p.value)
      repo.setSetting(db, p.key, value)
      return repo.getSettings(db)
    },

    // Providers
    'provider:list': () => providerStatuses(ctx),
    'provider:save': (p: IpcPayloadOf<'provider:save'>) => {
      repo.saveProviderSetting(db, p)
      return providerStatuses(ctx)
    },
    'provider:saveKey': (p: IpcPayloadOf<'provider:saveKey'>) => {
      ctx.keyStore.save(p.provider, p.key)
      ctx.log.info('API key saved', { provider: p.provider })
      return providerStatuses(ctx)
    },
    'provider:clearKey': (p: IpcPayloadOf<'provider:clearKey'>) => {
      ctx.keyStore.clear(p.provider)
      ctx.log.info('API key removed', { provider: p.provider })
      return providerStatuses(ctx)
    },
    'provider:test': async (p: IpcPayloadOf<'provider:test'>) => {
      const setting = repo.getProviderSetting(db, p.provider)
      const key = p.provider === 'mock' ? null : ctx.keyStore.get(p.provider)
      if (p.provider !== 'mock' && !key) throw new ProviderError('no_key', 'Save an API key first.')
      try {
        const message = await ctx.createProvider(p.provider, key).testConnection(setting.model, AbortSignal.timeout(25_000))
        return { message }
      } catch (err) {
        throw mapProviderError(err, p.provider)
      }
    },
    'provider:models': async (p: IpcPayloadOf<'provider:models'>) => {
      const key = p.provider === 'mock' ? null : ctx.keyStore.get(p.provider)
      if (p.provider !== 'mock' && !key) throw new ProviderError('no_key', 'Save an API key first.')
      try {
        return await ctx.createProvider(p.provider, key).listModels(AbortSignal.timeout(25_000))
      } catch (err) {
        throw mapProviderError(err, p.provider)
      }
    },

    // Generation
    'gen:run': async (p: IpcPayloadOf<'gen:run'>) => {
      const input = generationInputSchema.parse(p.input)
      const profile = repo.getProfile(db, input.profileId)
      const normalized: GenerationInput = { ...input, profileId: profile.id || null }
      const result = await withRun(ctx, p.requestId, profile, (deps) => runGeneration(normalized, deps))
      const providerId = activeProviderId(ctx)
      const draftId = transaction(db, () => {
        const id = repo.createDraft(db, normalized)
        for (const pkg of result.packages) {
          repo.upsertPackage(db, id, { pkg, provider: providerId, model: result.model, skillVersion: ctx.skill.version }, false)
        }
        return id
      })
      return getDraftDetail(ctx, draftId, result.usage)
    },
    'gen:cancel': (p: IpcPayloadOf<'gen:cancel'>) => {
      running.get(p.requestId)?.abort()
      return true
    },
    'gen:regenerateField': async (p: IpcPayloadOf<'gen:regenerateField'>) => {
      const row = repo.getPackageRow(db, p.packageId)
      const d = repo.getDraftRow(db, row.draft_id)
      const input = parseInput(d.context_json)
      const profile = repo.getProfile(db, d.profile_id)
      const current = JSON.parse(row.edited_json ?? row.generated_json) as ContentPackage
      if (!regenerableFieldPaths(current).includes(p.fieldPath)) {
        throw new ValidationError(`Field "${p.fieldPath}" cannot be regenerated for this content type.`)
      }
      const result = await withRun(ctx, p.requestId, profile, (deps) =>
        runFieldRegeneration(input, current, p.fieldPath, deps, p.action)
      )
      const proposed = setFieldValue(current, p.fieldPath, result.value)
      const warnings = warningsFor(proposed, input, profile, repo.getSettings(db).hypePhrases).filter(
        (w) => w.path === p.fieldPath || w.path.startsWith(p.fieldPath + '.')
      )
      return {
        packageId: p.packageId,
        fieldPath: p.fieldPath,
        previous: getFieldValue(current, p.fieldPath),
        proposal: result.value,
        warnings,
        provider: activeProviderId(ctx),
        model: result.model
      }
    },
    'gen:regeneratePackage': async (p: IpcPayloadOf<'gen:regeneratePackage'>) => {
      const row = repo.getPackageRow(db, p.packageId)
      return regenerate(p.requestId, row.draft_id, [row.content_type], p.action)
    },
    'gen:regeneratePlatform': async (p: IpcPayloadOf<'gen:regeneratePlatform'>) => {
      const ids = repo
        .listPackageRows(db, p.draftId)
        .filter((r) => r.platform === p.platform)
        .map((r) => r.content_type)
      if (!ids.length) throw new ValidationError('This draft has no packages for that platform.')
      return regenerate(p.requestId, p.draftId, ids, p.action)
    },

    // Package edits
    'packages:applyField': (p: IpcPayloadOf<'packages:applyField'>) => {
      const row = repo.getPackageRow(db, p.packageId)
      const current = JSON.parse(row.edited_json ?? row.generated_json) as ContentPackage
      assertEditablePath(current, p.fieldPath)
      const before = getFieldValue(current, p.fieldPath)
      if (JSON.stringify(before) === JSON.stringify(p.value)) return packageRecord(ctx, p.packageId)
      const next = setFieldValue(current, p.fieldPath, p.value)
      const valid = validatePackage(next)
      if (!valid.ok) throw new ValidationError(`That value is not valid here: ${valid.errors[0]}`)
      transaction(db, () => {
        repo.addHistory(
          db,
          p.packageId,
          p.fieldPath,
          before === undefined ? null : JSON.stringify(before),
          JSON.stringify(p.value),
          p.source
        )
        repo.setEdited(db, p.packageId, valid.pkg)
      })
      return packageRecord(ctx, p.packageId)
    },
    'packages:undo': (p: IpcPayloadOf<'packages:undo'>) => {
      const row = repo.getPackageRow(db, p.packageId)
      const last = repo.lastHistory(db, p.packageId)
      if (!last) throw new ValidationError('Nothing to undo.')
      transaction(db, () => {
        if (last.field_path === '*') {
          const prev = last.previous_value ? (JSON.parse(last.previous_value) as ContentPackage) : null
          repo.setEdited(db, p.packageId, prev)
        } else {
          const current = JSON.parse(row.edited_json ?? row.generated_json) as ContentPackage
          const prevValue = last.previous_value === null ? undefined : JSON.parse(last.previous_value)
          repo.setEdited(db, p.packageId, setFieldValue(current, last.field_path, prevValue))
        }
        repo.deleteHistory(db, last.id)
      })
      return packageRecord(ctx, p.packageId)
    },
    'packages:reset': (p: IpcPayloadOf<'packages:reset'>) => {
      const row = repo.getPackageRow(db, p.packageId)
      if (!row.edited_json) return packageRecord(ctx, p.packageId)
      transaction(db, () => {
        repo.addHistory(db, p.packageId, '*', row.edited_json, null, 'user')
        repo.setEdited(db, p.packageId, null)
      })
      return packageRecord(ctx, p.packageId)
    },

    // Drafts
    'drafts:list': (f: IpcPayloadOf<'drafts:list'>): DraftSummary[] =>
      repo.listDraftRows(db, f).map((r) => {
        const cts = (r.content_types ? r.content_types.split(',') : []) as ContentTypeId[]
        return {
          id: r.id,
          title: r.title,
          headline: r.headline,
          status: r.status,
          contentTypes: cts,
          platforms: [...new Set(cts.map((c) => CONTENT_TYPES[c]?.platform).filter(Boolean))] as Platform[],
          providers: (r.providers ? r.providers.split(',') : []) as ProviderId[],
          createdAt: r.created_at,
          updatedAt: r.updated_at
        }
      }),
    'drafts:get': (p: IpcPayloadOf<'drafts:get'>) => getDraftDetail(ctx, p.id),
    'drafts:rename': (p: IpcPayloadOf<'drafts:rename'>) => (repo.renameDraft(db, p.id, p.title), true),
    'drafts:duplicate': (p: IpcPayloadOf<'drafts:duplicate'>) => getDraftDetail(ctx, repo.duplicateDraft(db, p.id)),
    'drafts:delete': (p: IpcPayloadOf<'drafts:delete'>) => (repo.softDeleteDraft(db, p.id), true),
    'drafts:restore': (p: IpcPayloadOf<'drafts:restore'>) => (repo.restoreDraft(db, p.id), true),

    // Templates
    'templates:list': () => repo.listTemplates(db),
    'templates:save': (p: IpcPayloadOf<'templates:save'>) => repo.saveTemplate(db, p),
    'templates:delete': (p: IpcPayloadOf<'templates:delete'>) => (repo.deleteTemplate(db, p.id), true),

    // Export
    'export:draft': async (p: IpcPayloadOf<'export:draft'>) => {
      const d = getDraftDetail(ctx, p.draftId)
      const name = safeFileName(d.title)
      const filters: Record<typeof p.format, FileFilter> = {
        txt: { name: 'Text', extensions: ['txt'] },
        json: { name: 'JSON', extensions: ['json'] },
        html: { name: 'Printable HTML', extensions: ['html'] },
        pdf: { name: 'PDF', extensions: ['pdf'] }
      }
      const path = await ctx.dialogs.save(`${name}.${p.format}`, [filters[p.format]])
      if (!path) return { saved: false }
      if (p.format === 'txt') ctx.files.write(path, '﻿' + draftToText(d))
      else if (p.format === 'json') ctx.files.write(path, draftToJson(d, ctx.appVersion))
      else if (p.format === 'html') ctx.files.write(path, draftToHtml(d, ctx.fontCss()))
      else ctx.files.write(path, await ctx.printToPdf(draftToHtml(d, ctx.fontCss())))
      ctx.log.info('Draft exported', { format: p.format, file: basename(path) })
      return { saved: true, path }
    },
    'export:csv': async (p: IpcPayloadOf<'export:csv'>) => {
      const drafts = p.draftIds.map((id) => getDraftDetail(ctx, id))
      const path = await ctx.dialogs.save(`kishore-social-drafts-${new Date().toISOString().slice(0, 10)}.csv`, [
        { name: 'CSV', extensions: ['csv'] }
      ])
      if (!path) return { saved: false }
      ctx.files.write(path, draftsToCsv(drafts))
      return { saved: true, path }
    },
    'backup:create': async () => {
      const path = await ctx.dialogs.save(`kishore-social-studio-backup-${new Date().toISOString().slice(0, 10)}.json`, [
        { name: 'Backup', extensions: ['json'] }
      ])
      if (!path) return { saved: false }
      ctx.files.write(path, JSON.stringify(buildBackup(db, ctx.appVersion), null, 1))
      ctx.log.info('Backup created', { file: basename(path) })
      return { saved: true, path }
    },
    'backup:importPreview': async () => {
      const path = await ctx.dialogs.open([{ name: 'Backup', extensions: ['json'] }])
      if (!path) return null
      const size = ctx.files.size(path)
      if (size > MAX_BACKUP_BYTES) throw new ValidationError('This file is too large to be a backup (limit 50 MB).')
      const buf = ctx.files.read(path)
      const parsed = parseBackup(buf.toString('utf8'), buf.byteLength)
      if (!parsed.ok) throw new ValidationError(parsed.error)
      const now = Date.now()
      for (const [k, v] of pendingImports) if (v.expires < now) pendingImports.delete(k)
      const token = randomUUID()
      pendingImports.set(token, { backup: parsed.backup, expires: now + 10 * 60_000 })
      const b = parsed.backup
      return {
        token,
        fileName: basename(path),
        appVersion: b.appVersion,
        exportedAt: b.exportedAt,
        counts: {
          drafts: b.data.drafts.length,
          packages: b.data.drafts.reduce((n, d) => n + d.packages.length, 0),
          profiles: b.data.profiles.length,
          templates: b.data.templates.length
        },
        draftTitles: b.data.drafts.slice(0, 20).map((d) => d.title)
      }
    },
    'backup:importApply': (p: IpcPayloadOf<'backup:importApply'>) => {
      const pending = pendingImports.get(p.token)
      if (!pending || pending.expires < Date.now()) throw new ValidationError('This import preview has expired. Choose the file again.')
      pendingImports.delete(p.token)
      const counts = applyBackup(db, pending.backup)
      ctx.log.info('Backup imported', counts)
      return counts
    },

    // Misc
    'clipboard:write': (p: IpcPayloadOf<'clipboard:write'>) => (ctx.clipboardWrite(p.text), true),
    'shell:openExternal': async (p: IpcPayloadOf<'shell:openExternal'>) => {
      if (!isAllowedExternalUrl(p.url)) throw Object.assign(new Error('That link is not on the allowed list.'), { code: 'forbidden' })
      await ctx.openExternal(p.url)
      return true
    }
  }
  return h as unknown as { [C in IpcChannel]: Handler }
}

type IpcPayloadOf<C extends IpcChannel> = import('zod').output<(typeof IPC_SCHEMAS)[C]>

// ---------------------------------------------------------------------------
// Dispatch: validate → run → wrap result. Errors become data.
// ---------------------------------------------------------------------------

export function toAppError(err: unknown, log?: Logger): AppError {
  if (err instanceof ZodError) {
    return {
      code: 'validation',
      message: err.issues[0]?.message ?? 'Invalid input',
      details: err.issues.slice(0, 10).map((i) => `${i.path.join('.') || 'value'}: ${i.message}`)
    }
  }
  if (err instanceof ProviderError) return err.toAppError()
  if (err instanceof NotFoundError || err instanceof ValidationError) return { code: err.code, message: err.message }
  const code = (err as { code?: string })?.code
  if (code === 'forbidden') return { code: 'forbidden', message: (err as Error).message }
  log?.error('Unexpected error', err)
  return { code: 'unknown', message: redact((err as Error)?.message ?? 'Unexpected error') }
}

export async function dispatch<C extends IpcChannel>(
  handlers: { [K in IpcChannel]: Handler },
  channel: C,
  payload: unknown,
  log?: Logger
): Promise<Result<IpcResults[C]>> {
  if (!Object.prototype.hasOwnProperty.call(IPC_SCHEMAS, channel)) {
    return { ok: false, error: { code: 'forbidden', message: 'Unknown channel' } }
  }
  const parsed = IPC_SCHEMAS[channel].safeParse(payload)
  if (!parsed.success) return { ok: false, error: toAppError(parsed.error) }
  try {
    const data = await (handlers[channel] as (p: unknown) => unknown)(parsed.data)
    return { ok: true, data: data as IpcResults[C] }
  } catch (err) {
    return { ok: false, error: toAppError(err, log) }
  }
}
