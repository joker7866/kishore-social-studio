import { DatabaseSync } from 'node:sqlite'
import migration001 from './migrations/001_initial.sql?raw'

export type Db = DatabaseSync

/** Numbered migrations. Append new entries; never edit a shipped one. */
export const MIGRATIONS: { version: number; sql: string }[] = [{ version: 1, sql: migration001 }]

export function openDatabase(file: string): Db {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  migrate(db)
  return db
}

/** Runs pending migrations inside a transaction each. Safe to call repeatedly. */
export function migrate(db: Db): number {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`)
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null }
  const current = row.v ?? 0
  let applied = 0
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue
    transaction(db, () => {
      db.exec(m.sql)
      db.prepare('INSERT INTO schema_version (version, applied_at) VALUES (?, ?)').run(m.version, nowIso())
    })
    applied++
  }
  return applied
}

export function transaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN')
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function nowIso(): string {
  return new Date().toISOString()
}
