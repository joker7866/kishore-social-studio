// Data access. Plain SQL with prepared statements — every value is bound, never
// concatenated into SQL text.

import type { ContentPackage, GenerationInput } from '@shared/content-schema'
import { DEFAULT_HYPE_PHRASES } from '@shared/guards/accuracy'
import { DEFAULT_PROFILE, type ChannelProfile } from '@shared/guards/branding'
import type {
  AppSettings,
  DraftListFilter,
  ProfileInput,
  Template,
  TemplatePreset
} from '@shared/ipc-contract'
import {
  CONTENT_TYPES,
  DEFAULT_TIMEZONE,
  type ContentTypeId,
  type Platform,
  type ProviderId
} from '@shared/platform-types'
import { nowIso, transaction, type Db } from './database'

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

export interface DraftRow {
  id: number
  title: string
  headline: string
  context_json: string
  languages: string
  tone: string
  status: string
  profile_id: number | null
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface PackageRow {
  id: number
  draft_id: number
  platform: Platform
  content_type: ContentTypeId
  generated_json: string
  edited_json: string | null
  provider: ProviderId
  model: string
  skill_version: string
  generated_at: string
}

export interface HistoryRow {
  id: number
  package_id: number
  field_path: string
  previous_value: string | null
  new_value: string | null
  source: 'user' | 'regen'
  created_at: string
}

export interface ProviderSettingRow {
  provider: ProviderId
  model: string
  timeout_ms: number
  enabled: number
}

export const DEFAULT_MODELS: Record<ProviderId, string> = {
  openai: 'gpt-5',
  anthropic: 'claude-sonnet-5-5',
  mock: 'mock-fixtures-v1'
}

// ---------------------------------------------------------------------------
// Seed defaults
// ---------------------------------------------------------------------------

export function ensureDefaults(db: Db): void {
  transaction(db, () => {
    const count = (db.prepare('SELECT COUNT(*) AS c FROM channel_profiles').get() as { c: number }).c
    if (count === 0) {
      const t = nowIso()
      db.prepare(
        `INSERT INTO channel_profiles (name, youtube_handle, facebook_page, instagram_handle,
          youtube_hashtag, facebook_hashtag, instagram_hashtag, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      ).run(
        DEFAULT_PROFILE.name,
        DEFAULT_PROFILE.youtubeHandle,
        DEFAULT_PROFILE.facebookPage,
        DEFAULT_PROFILE.instagramHandle,
        DEFAULT_PROFILE.youtubeHashtag,
        DEFAULT_PROFILE.facebookHashtag,
        DEFAULT_PROFILE.instagramHashtag,
        t,
        t
      )
    }
    for (const p of ['openai', 'anthropic', 'mock'] as ProviderId[]) {
      db.prepare(
        'INSERT OR IGNORE INTO provider_settings (provider, model, timeout_ms, enabled) VALUES (?, ?, ?, 1)'
      ).run(p, DEFAULT_MODELS[p], 180_000)
    }
  })
}

// ---------------------------------------------------------------------------
// Channel profiles
// ---------------------------------------------------------------------------

interface ProfileRow {
  id: number
  name: string
  youtube_handle: string
  facebook_page: string
  instagram_handle: string
  youtube_hashtag: string
  facebook_hashtag: string
  instagram_hashtag: string
  is_default: number
}

const toProfile = (r: ProfileRow): ChannelProfile => ({
  id: r.id,
  name: r.name,
  youtubeHandle: r.youtube_handle,
  facebookPage: r.facebook_page,
  instagramHandle: r.instagram_handle,
  youtubeHashtag: r.youtube_hashtag,
  facebookHashtag: r.facebook_hashtag,
  instagramHashtag: r.instagram_hashtag,
  isDefault: r.is_default === 1
})

export function listProfiles(db: Db): ChannelProfile[] {
  return (db.prepare('SELECT * FROM channel_profiles ORDER BY is_default DESC, name').all() as unknown as ProfileRow[]).map(
    toProfile
  )
}

export function getProfile(db: Db, id: number | null | undefined): ChannelProfile {
  const row =
    (id ? (db.prepare('SELECT * FROM channel_profiles WHERE id = ?').get(id) as ProfileRow | undefined) : undefined) ??
    (db.prepare('SELECT * FROM channel_profiles ORDER BY is_default DESC, id LIMIT 1').get() as ProfileRow | undefined)
  if (!row) return { id: 0, ...DEFAULT_PROFILE }
  return toProfile(row)
}

export function saveProfile(db: Db, p: ProfileInput): ChannelProfile {
  const t = nowIso()
  if (p.id) {
    const res = db
      .prepare(
        `UPDATE channel_profiles SET name=?, youtube_handle=?, facebook_page=?, instagram_handle=?,
          youtube_hashtag=?, facebook_hashtag=?, instagram_hashtag=?, updated_at=? WHERE id=?`
      )
      .run(p.name, p.youtubeHandle, p.facebookPage, p.instagramHandle, p.youtubeHashtag, p.facebookHashtag, p.instagramHashtag, t, p.id)
    if (res.changes === 0) throw new NotFoundError('Channel profile not found')
    return getProfile(db, p.id)
  }
  const res = db
    .prepare(
      `INSERT INTO channel_profiles (name, youtube_handle, facebook_page, instagram_handle,
        youtube_hashtag, facebook_hashtag, instagram_hashtag, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(p.name, p.youtubeHandle, p.facebookPage, p.instagramHandle, p.youtubeHashtag, p.facebookHashtag, p.instagramHashtag, t, t)
  return getProfile(db, Number(res.lastInsertRowid))
}

export function deleteProfile(db: Db, id: number): void {
  transaction(db, () => {
    const all = listProfiles(db)
    if (all.length <= 1) throw new ValidationError('At least one channel profile is required.')
    const target = all.find((p) => p.id === id)
    if (!target) throw new NotFoundError('Channel profile not found')
    db.prepare('DELETE FROM channel_profiles WHERE id = ?').run(id)
    if (target.isDefault) {
      const next = all.find((p) => p.id !== id)!
      db.prepare('UPDATE channel_profiles SET is_default = 1 WHERE id = ?').run(next.id)
    }
  })
}

export function setDefaultProfile(db: Db, id: number): void {
  transaction(db, () => {
    const exists = db.prepare('SELECT id FROM channel_profiles WHERE id = ?').get(id)
    if (!exists) throw new NotFoundError('Channel profile not found')
    db.prepare('UPDATE channel_profiles SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END').run(id)
  })
}

// ---------------------------------------------------------------------------
// App settings
// ---------------------------------------------------------------------------

export const DEFAULT_SETTINGS: AppSettings = {
  hypePhrases: DEFAULT_HYPE_PHRASES,
  timezone: DEFAULT_TIMEZONE,
  activeProvider: 'mock',
  defaultLanguage: 'ta',
  defaultTone: 'neutral'
}

export function getSettings(db: Db): AppSettings {
  const rows = db.prepare('SELECT key, value FROM app_settings').all() as { key: string; value: string }[]
  const out: AppSettings = { ...DEFAULT_SETTINGS }
  for (const r of rows) {
    if (r.key in out) {
      try {
        ;(out as unknown as Record<string, unknown>)[r.key] = JSON.parse(r.value)
      } catch {
        // ignore a corrupt value and keep the default
      }
    }
  }
  return out
}

export function setSetting(db: Db, key: keyof AppSettings, value: unknown): void {
  db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value)
  )
}

// ---------------------------------------------------------------------------
// Provider settings (no secrets here)
// ---------------------------------------------------------------------------

export function listProviderSettings(db: Db): ProviderSettingRow[] {
  return db.prepare('SELECT * FROM provider_settings ORDER BY provider').all() as unknown as ProviderSettingRow[]
}

export function getProviderSetting(db: Db, provider: ProviderId): ProviderSettingRow {
  const row = db.prepare('SELECT * FROM provider_settings WHERE provider = ?').get(provider) as ProviderSettingRow | undefined
  return row ?? { provider, model: DEFAULT_MODELS[provider], timeout_ms: 180_000, enabled: 1 }
}

export function saveProviderSetting(db: Db, s: { provider: ProviderId; model: string; timeoutMs: number; enabled: boolean }): void {
  db.prepare(
    `INSERT INTO provider_settings (provider, model, timeout_ms, enabled) VALUES (?, ?, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET model = excluded.model, timeout_ms = excluded.timeout_ms, enabled = excluded.enabled`
  ).run(s.provider, s.model || DEFAULT_MODELS[s.provider], s.timeoutMs, s.enabled ? 1 : 0)
}

// ---------------------------------------------------------------------------
// Drafts and packages
// ---------------------------------------------------------------------------

export function draftTitleFrom(headline: string): string {
  const t = headline.trim().replace(/\s+/g, ' ')
  return [...t].length > 80 ? [...t].slice(0, 79).join('') + '…' : t
}

export function createDraft(db: Db, input: GenerationInput, title?: string): number {
  const t = nowIso()
  const res = db
    .prepare(
      `INSERT INTO drafts (title, headline, context_json, languages, tone, status, profile_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'generated', ?, ?, ?)`
    )
    .run(title ?? draftTitleFrom(input.headline), input.headline, JSON.stringify(input), input.language, input.tone, input.profileId, t, t)
  return Number(res.lastInsertRowid)
}

export interface NewPackage {
  pkg: ContentPackage
  provider: ProviderId
  model: string
  skillVersion: string
}

/** Insert, or replace generated_json of an existing package for the same type. */
export function upsertPackage(db: Db, draftId: number, p: NewPackage, resetEdits: boolean): number {
  const t = nowIso()
  const existing = db
    .prepare('SELECT * FROM packages WHERE draft_id = ? AND content_type = ?')
    .get(draftId, p.pkg.contentType) as PackageRow | undefined
  if (existing) {
    if (resetEdits) {
      // Keep the user's previous visible state in history so the whole regenerate can be undone.
      const prev = existing.edited_json ?? existing.generated_json
      addHistory(db, existing.id, '*', prev, JSON.stringify(p.pkg), 'regen')
    }
    db.prepare(
      `UPDATE packages SET generated_json = ?, edited_json = ?, provider = ?, model = ?, skill_version = ?, generated_at = ?
       WHERE id = ?`
    ).run(JSON.stringify(p.pkg), resetEdits ? null : existing.edited_json, p.provider, p.model, p.skillVersion, t, existing.id)
    touchDraft(db, draftId)
    return existing.id
  }
  const res = db
    .prepare(
      `INSERT INTO packages (draft_id, platform, content_type, generated_json, edited_json, provider, model, skill_version, generated_at)
       VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)`
    )
    .run(draftId, CONTENT_TYPES[p.pkg.contentType].platform, p.pkg.contentType, JSON.stringify(p.pkg), p.provider, p.model, p.skillVersion, t)
  return Number(res.lastInsertRowid)
}

export function touchDraft(db: Db, draftId: number): void {
  db.prepare('UPDATE drafts SET updated_at = ? WHERE id = ?').run(nowIso(), draftId)
}

export function getDraftRow(db: Db, id: number, includeDeleted = false): DraftRow {
  const row = db
    .prepare(`SELECT * FROM drafts WHERE id = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`)
    .get(id) as DraftRow | undefined
  if (!row) throw new NotFoundError('Draft not found')
  return row
}

export function listPackageRows(db: Db, draftId: number): PackageRow[] {
  return db.prepare('SELECT * FROM packages WHERE draft_id = ? ORDER BY id').all(draftId) as unknown as PackageRow[]
}

export function getPackageRow(db: Db, id: number): PackageRow {
  const row = db
    .prepare(
      `SELECT p.* FROM packages p JOIN drafts d ON d.id = p.draft_id WHERE p.id = ? AND d.deleted_at IS NULL`
    )
    .get(id) as PackageRow | undefined
  if (!row) throw new NotFoundError('Package not found')
  return row
}

export function setEdited(db: Db, packageId: number, edited: ContentPackage | null): void {
  const row = getPackageRow(db, packageId)
  db.prepare('UPDATE packages SET edited_json = ? WHERE id = ?').run(edited ? JSON.stringify(edited) : null, packageId)
  touchDraft(db, row.draft_id)
}

export function addHistory(
  db: Db,
  packageId: number,
  fieldPath: string,
  previous: string | null,
  next: string | null,
  source: 'user' | 'regen'
): void {
  db.prepare(
    'INSERT INTO field_history (package_id, field_path, previous_value, new_value, source, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(packageId, fieldPath, previous, next, source, nowIso())
}

export function lastHistory(db: Db, packageId: number): HistoryRow | undefined {
  return db.prepare('SELECT * FROM field_history WHERE package_id = ? ORDER BY id DESC LIMIT 1').get(packageId) as
    | HistoryRow
    | undefined
}

export function deleteHistory(db: Db, id: number): void {
  db.prepare('DELETE FROM field_history WHERE id = ?').run(id)
}

export function historyCount(db: Db, packageId: number): number {
  return (db.prepare('SELECT COUNT(*) AS c FROM field_history WHERE package_id = ?').get(packageId) as { c: number }).c
}

export interface DraftListRow extends DraftRow {
  content_types: string | null
  providers: string | null
}

export function listDraftRows(db: Db, f: DraftListFilter): DraftListRow[] {
  const where: string[] = ['d.deleted_at IS NULL']
  const params: (string | number)[] = []
  if (f.search?.trim()) {
    const like = `%${f.search.trim().replace(/[\\%_]/g, (c) => '\\' + c)}%`
    where.push("(d.title LIKE ? ESCAPE '\\' OR d.headline LIKE ? ESCAPE '\\')")
    params.push(like, like)
  }
  if (f.platform) {
    where.push('EXISTS (SELECT 1 FROM packages p2 WHERE p2.draft_id = d.id AND p2.platform = ?)')
    params.push(f.platform)
  }
  if (f.from) {
    where.push('d.updated_at >= ?')
    params.push(f.from)
  }
  if (f.to) {
    where.push('d.updated_at <= ?')
    params.push(f.to)
  }
  params.push(f.limit ?? 500)
  return db
    .prepare(
      `SELECT d.*, GROUP_CONCAT(p.content_type) AS content_types, GROUP_CONCAT(DISTINCT p.provider) AS providers
       FROM drafts d LEFT JOIN packages p ON p.draft_id = d.id
       WHERE ${where.join(' AND ')}
       GROUP BY d.id ORDER BY d.updated_at DESC LIMIT ?`
    )
    .all(...params) as unknown as DraftListRow[]
}

export function renameDraft(db: Db, id: number, title: string): void {
  getDraftRow(db, id)
  db.prepare('UPDATE drafts SET title = ?, updated_at = ? WHERE id = ?').run(title, nowIso(), id)
}

export function softDeleteDraft(db: Db, id: number): void {
  getDraftRow(db, id)
  db.prepare('UPDATE drafts SET deleted_at = ? WHERE id = ?').run(nowIso(), id)
}

export function restoreDraft(db: Db, id: number): void {
  getDraftRow(db, id, true)
  db.prepare('UPDATE drafts SET deleted_at = NULL WHERE id = ?').run(id)
}

/** Permanently remove drafts soft-deleted more than `days` ago. */
export function purgeDeletedDrafts(db: Db, days = 30): number {
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString()
  return Number(db.prepare('DELETE FROM drafts WHERE deleted_at IS NOT NULL AND deleted_at < ?').run(cutoff).changes)
}

export function duplicateDraft(db: Db, id: number): number {
  return transaction(db, () => {
    const d = getDraftRow(db, id)
    const t = nowIso()
    const res = db
      .prepare(
        `INSERT INTO drafts (title, headline, context_json, languages, tone, status, profile_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(`${d.title} (copy)`, d.headline, d.context_json, d.languages, d.tone, d.status, d.profile_id, t, t)
    const newId = Number(res.lastInsertRowid)
    db.prepare(
      `INSERT INTO packages (draft_id, platform, content_type, generated_json, edited_json, provider, model, skill_version, generated_at)
       SELECT ?, platform, content_type, generated_json, edited_json, provider, model, skill_version, generated_at
       FROM packages WHERE draft_id = ?`
    ).run(newId, id)
    return newId
  })
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

interface TemplateRow {
  id: number
  name: string
  preset_json: string
  created_at: string
}

export function listTemplates(db: Db): Template[] {
  return (db.prepare('SELECT id, name, preset_json, created_at FROM templates ORDER BY name').all() as unknown as TemplateRow[]).map(
    (r) => ({ id: r.id, name: r.name, preset: JSON.parse(r.preset_json) as TemplatePreset, createdAt: r.created_at })
  )
}

export function saveTemplate(db: Db, t: { id?: number; name: string; preset: TemplatePreset }): Template {
  const platforms = [...new Set(t.preset.contentTypes.map((c) => CONTENT_TYPES[c].platform))].join(',')
  if (t.id) {
    const res = db
      .prepare('UPDATE templates SET name = ?, tone = ?, language = ?, platforms = ?, preset_json = ? WHERE id = ?')
      .run(t.name, t.preset.tone, t.preset.language, platforms, JSON.stringify(t.preset), t.id)
    if (res.changes === 0) throw new NotFoundError('Template not found')
    return listTemplates(db).find((x) => x.id === t.id)!
  }
  const res = db
    .prepare('INSERT INTO templates (name, tone, language, platforms, preset_json, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(t.name, t.preset.tone, t.preset.language, platforms, JSON.stringify(t.preset), nowIso())
  const newId = Number(res.lastInsertRowid)
  return listTemplates(db).find((x) => x.id === newId)!
}

export function deleteTemplate(db: Db, id: number): void {
  const res = db.prepare('DELETE FROM templates WHERE id = ?').run(id)
  if (res.changes === 0) throw new NotFoundError('Template not found')
}

// ---------------------------------------------------------------------------
// Errors understood by the IPC layer
// ---------------------------------------------------------------------------

export class NotFoundError extends Error {
  readonly code = 'not_found' as const
}

export class ValidationError extends Error {
  readonly code = 'validation' as const
}
