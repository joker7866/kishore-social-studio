import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { MockProvider } from '../../src/main/ai/providers/mock'
import type { ProviderAdapter } from '../../src/main/ai/providers/types'
import { loadSkill } from '../../src/main/ai/skill-loader'
import { migrate } from '../../src/main/db/database'
import { ensureDefaults } from '../../src/main/db/repo'
import { createHandlers, dispatch, type AppContext } from '../../src/main/ipc/handlers'
import { createLogger } from '../../src/main/logger'
import { KeyStore, type Encryptor } from '../../src/main/secrets/key-store'
import type { IpcChannel } from '../../src/shared/ipc-contract'

export const SKILLS_ROOT = resolve(__dirname, '../../skills')

/** Reversible fake "encryption" so tests can check the key never appears in plain text. */
export const fakeEncryptor: Encryptor = {
  isAvailable: () => true,
  encrypt: (s) => Buffer.from(s.split('').reverse().join('') + '::enc', 'utf8'),
  decrypt: (b) => b.toString('utf8').replace(/::enc$/, '').split('').reverse().join('')
}

export function memoryDb() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  ensureDefaults(db)
  return db
}

export function makeCtx(over: Partial<AppContext> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kss-test-'))
  const logFile = join(dir, 'app.log')
  let saveCounter = 0
  const openQueue: string[] = []
  const ctx: AppContext = {
    db: memoryDb(),
    keyStore: new KeyStore(join(dir, 'secrets'), fakeEncryptor),
    skill: loadSkill(SKILLS_ROOT),
    log: createLogger(logFile, false),
    appVersion: '1.0.0-test',
    isPackaged: false,
    userDataPath: dir,
    createProvider: (id): ProviderAdapter => new MockProvider(0),
    isOnline: () => true,
    fontCss: () => '',
    dialogs: {
      save: async (name) => join(dir, `${++saveCounter}-${name}`),
      open: async () => openQueue.shift() ?? null
    },
    files: {
      write: (p, d) => writeFileSync(p, d),
      read: (p) => readFileSync(p),
      size: (p) => statSync(p).size
    },
    printToPdf: async (html) => Buffer.from(html),
    clipboardWrite: () => {},
    openExternal: async () => {},
    ...over
  }
  const handlers = createHandlers(ctx)
  const call = <C extends IpcChannel>(channel: C, payload?: unknown) => dispatch(handlers, channel, payload)
  /** Call and unwrap, failing the test on an error result. */
  const ok = async <C extends IpcChannel>(channel: C, payload?: unknown) => {
    const r = await call(channel, payload)
    if (!r.ok) throw new Error(`${channel} failed: ${r.error.code} ${r.error.message} ${JSON.stringify(r.error.details ?? [])}`)
    return r.data
  }
  return { ctx, dir, logFile, call, ok, openQueue }
}

let n = 0
export const rid = () => `req-${Date.now()}-${++n}`
