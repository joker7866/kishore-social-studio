// Full backup and import-with-preview. Backups contain drafts, packages, edit
// history, channel profiles and templates. They never contain API keys.

import { z } from 'zod'
import { generationInputSchema, validatePackage } from '@shared/content-schema'
import { templatePresetSchema } from '@shared/ipc-contract'
import { CONTENT_TYPE_IDS, PLATFORMS, PROVIDERS } from '@shared/platform-types'
import { nowIso, transaction, type Db } from '../db/database'
import type { DraftRow, HistoryRow, PackageRow } from '../db/repo'
import { redactDeep } from '../security/redact'

export const BACKUP_FORMAT = 'kishore-social-studio-backup'
export const BACKUP_VERSION = 1
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024

const str = (max: number) => z.string().max(max)

const historySchema = z.strictObject({
  field_path: str(64),
  previous_value: z.string().nullable(),
  new_value: z.string().nullable(),
  source: z.enum(['user', 'regen']),
  created_at: str(40)
})

const packageSchema = z.strictObject({
  platform: z.enum(PLATFORMS),
  content_type: z.enum(CONTENT_TYPE_IDS),
  generated_json: z.string().max(2_000_000),
  edited_json: z.string().max(2_000_000).nullable(),
  provider: z.enum(PROVIDERS),
  model: str(200),
  skill_version: str(40),
  generated_at: str(40),
  history: z.array(historySchema).max(10_000)
})

const draftSchema = z.strictObject({
  id: z.number().int(),
  title: str(500),
  headline: str(1000),
  context_json: z.string().max(500_000),
  languages: str(20),
  tone: str(40),
  status: str(40),
  profile_id: z.number().int().nullable(),
  created_at: str(40),
  updated_at: str(40),
  packages: z.array(packageSchema).max(14)
})

const profileSchema = z.strictObject({
  id: z.number().int(),
  name: str(100),
  youtube_handle: str(100),
  facebook_page: str(100),
  instagram_handle: str(100),
  youtube_hashtag: str(100),
  facebook_hashtag: str(100),
  instagram_hashtag: str(100),
  is_default: z.number().int()
})

const templateSchema = z.strictObject({ name: str(100), preset_json: z.string().max(100_000) })

export const backupSchema = z.strictObject({
  format: z.literal(BACKUP_FORMAT),
  backupVersion: z.number().int(),
  appVersion: str(40),
  exportedAt: str(40),
  data: z.strictObject({
    profiles: z.array(profileSchema).max(500),
    drafts: z.array(draftSchema).max(100_000),
    templates: z.array(templateSchema).max(5_000)
  })
})
export type Backup = z.infer<typeof backupSchema>

export function buildBackup(db: Db, appVersion: string): Backup {
  const profiles = db
    .prepare(
      `SELECT id, name, youtube_handle, facebook_page, instagram_handle, youtube_hashtag, facebook_hashtag,
              instagram_hashtag, is_default FROM channel_profiles ORDER BY id`
    )
    .all() as unknown as Backup['data']['profiles']
  const drafts = (db.prepare('SELECT * FROM drafts WHERE deleted_at IS NULL ORDER BY id').all() as unknown as DraftRow[]).map(
    (d) => {
      const pkgs = db.prepare('SELECT * FROM packages WHERE draft_id = ? ORDER BY id').all(d.id) as unknown as PackageRow[]
      return {
        id: d.id,
        title: d.title,
        headline: d.headline,
        context_json: d.context_json,
        languages: d.languages,
        tone: d.tone,
        status: d.status,
        profile_id: d.profile_id,
        created_at: d.created_at,
        updated_at: d.updated_at,
        packages: pkgs.map((p) => ({
          platform: p.platform,
          content_type: p.content_type,
          generated_json: p.generated_json,
          edited_json: p.edited_json,
          provider: p.provider,
          model: p.model,
          skill_version: p.skill_version,
          generated_at: p.generated_at,
          history: (
            db.prepare('SELECT * FROM field_history WHERE package_id = ? ORDER BY id').all(p.id) as unknown as HistoryRow[]
          ).map((h) => ({
            field_path: h.field_path,
            previous_value: h.previous_value,
            new_value: h.new_value,
            source: h.source,
            created_at: h.created_at
          }))
        }))
      }
    }
  )
  const templates = db.prepare('SELECT name, preset_json FROM templates ORDER BY id').all() as unknown as Backup['data']['templates']
  return redactDeep({
    format: BACKUP_FORMAT,
    backupVersion: BACKUP_VERSION,
    appVersion,
    exportedAt: nowIso(),
    data: { profiles, drafts, templates }
  })
}

export type ParseResult = { ok: true; backup: Backup } | { ok: false; error: string }

/** Parse and deeply validate a backup file's text. Nothing is written here. */
export function parseBackup(text: string, byteLength: number): ParseResult {
  if (byteLength > MAX_BACKUP_BYTES) return { ok: false, error: 'This file is too large to be a Kishore Social Studio backup (limit 50 MB).' }
  let json: unknown
  try {
    json = JSON.parse(text.replace(/^﻿/, ''))
  } catch {
    return { ok: false, error: 'This file is not valid JSON.' }
  }
  const head = z.object({ format: z.string(), backupVersion: z.number() }).safeParse(json)
  if (!head.success || head.data.format !== BACKUP_FORMAT) {
    return { ok: false, error: 'This file is not a Kishore Social Studio backup.' }
  }
  if (head.data.backupVersion !== BACKUP_VERSION) {
    return { ok: false, error: `Unsupported backup version ${head.data.backupVersion}. This app reads version ${BACKUP_VERSION}.` }
  }
  const parsed = backupSchema.safeParse(json)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    return { ok: false, error: `Backup file is damaged or incomplete (${first.path.join('.')}: ${first.message}).` }
  }
  // Deep checks: inputs and every package must match the current schemas.
  for (const d of parsed.data.data.drafts) {
    let ctx: unknown
    try {
      ctx = JSON.parse(d.context_json)
    } catch {
      return { ok: false, error: `Draft "${d.title}" has damaged input data.` }
    }
    if (!generationInputSchema.safeParse(ctx).success) return { ok: false, error: `Draft "${d.title}" has invalid input data.` }
    for (const p of d.packages) {
      for (const raw of [p.generated_json, p.edited_json]) {
        if (raw === null) continue
        let obj: unknown
        try {
          obj = JSON.parse(raw)
        } catch {
          return { ok: false, error: `Draft "${d.title}" has a damaged package.` }
        }
        const v = validatePackage(obj)
        if (!v.ok || v.pkg.contentType !== p.content_type) {
          return { ok: false, error: `Draft "${d.title}" has a package that does not match its content type (${p.content_type}).` }
        }
      }
    }
  }
  for (const t of parsed.data.data.templates) {
    try {
      if (!templatePresetSchema.safeParse(JSON.parse(t.preset_json)).success) throw new Error()
    } catch {
      return { ok: false, error: `Template "${t.name}" is invalid.` }
    }
  }
  return { ok: true, backup: parsed.data }
}

/**
 * Import adds to existing data — it never overwrites or deletes. Drafts get new
 * ids; profiles with the same name are reused.
 */
export function applyBackup(db: Db, b: Backup): { drafts: number; profiles: number; templates: number } {
  return transaction(db, () => {
    const t = nowIso()
    const profileMap = new Map<number, number>()
    let profiles = 0
    for (const p of b.data.profiles) {
      const existing = db.prepare('SELECT id FROM channel_profiles WHERE name = ?').get(p.name) as { id: number } | undefined
      if (existing) {
        profileMap.set(p.id, existing.id)
        continue
      }
      const res = db
        .prepare(
          `INSERT INTO channel_profiles (name, youtube_handle, facebook_page, instagram_handle, youtube_hashtag,
            facebook_hashtag, instagram_hashtag, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
        )
        .run(p.name, p.youtube_handle, p.facebook_page, p.instagram_handle, p.youtube_hashtag, p.facebook_hashtag, p.instagram_hashtag, t, t)
      profileMap.set(p.id, Number(res.lastInsertRowid))
      profiles++
    }
    for (const d of b.data.drafts) {
      const profileId = d.profile_id !== null ? (profileMap.get(d.profile_id) ?? null) : null
      const res = db
        .prepare(
          `INSERT INTO drafts (title, headline, context_json, languages, tone, status, profile_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(d.title, d.headline, d.context_json, d.languages, d.tone, d.status, profileId, d.created_at, d.updated_at)
      const draftId = Number(res.lastInsertRowid)
      for (const p of d.packages) {
        const pr = db
          .prepare(
            `INSERT INTO packages (draft_id, platform, content_type, generated_json, edited_json, provider, model, skill_version, generated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(draftId, p.platform, p.content_type, p.generated_json, p.edited_json, p.provider, p.model, p.skill_version, p.generated_at)
        const pkgId = Number(pr.lastInsertRowid)
        for (const h of p.history) {
          db.prepare(
            'INSERT INTO field_history (package_id, field_path, previous_value, new_value, source, created_at) VALUES (?, ?, ?, ?, ?, ?)'
          ).run(pkgId, h.field_path, h.previous_value, h.new_value, h.source, h.created_at)
        }
      }
    }
    let templates = 0
    for (const tp of b.data.templates) {
      const preset = templatePresetSchema.parse(JSON.parse(tp.preset_json))
      const exists = db.prepare('SELECT id FROM templates WHERE name = ?').get(tp.name)
      if (exists) continue
      db.prepare('INSERT INTO templates (name, tone, language, platforms, preset_json, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
        tp.name,
        preset.tone,
        preset.language,
        '',
        JSON.stringify(preset),
        t
      )
      templates++
    }
    return { drafts: b.data.drafts.length, profiles, templates }
  })
}
