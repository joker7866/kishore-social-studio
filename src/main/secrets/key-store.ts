// API keys are encrypted with Electron safeStorage (Windows DPAPI) and stored as
// files in userData/secrets — never in SQLite, logs, exports or backups.
// The renderer only ever learns "saved yes/no" and the last 4 characters.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { forgetSecret, registerSecret } from '../security/redact'

export type SecretProvider = 'openai' | 'anthropic'

export interface Encryptor {
  isAvailable(): boolean
  encrypt(plain: string): Buffer
  decrypt(data: Buffer): string
}

export class KeyStore {
  constructor(
    private readonly dir: string,
    private readonly enc: Encryptor
  ) {}

  private file(provider: SecretProvider): string {
    if (provider !== 'openai' && provider !== 'anthropic') throw new Error('Unknown provider')
    return join(this.dir, `${provider}.key`)
  }

  isAvailable(): boolean {
    return this.enc.isAvailable()
  }

  save(provider: SecretProvider, key: string): void {
    if (!this.enc.isAvailable()) {
      throw new Error('Windows secure storage is not available, so the API key cannot be saved safely.')
    }
    const clean = key.trim()
    mkdirSync(this.dir, { recursive: true })
    writeFileSync(this.file(provider), this.enc.encrypt(clean), { mode: 0o600 })
    registerSecret(clean)
  }

  get(provider: SecretProvider): string | null {
    const f = this.file(provider)
    if (!existsSync(f)) return null
    try {
      const key = this.enc.decrypt(readFileSync(f))
      registerSecret(key)
      return key
    } catch {
      return null
    }
  }

  clear(provider: SecretProvider): void {
    const existing = this.get(provider)
    rmSync(this.file(provider), { force: true })
    if (existing) forgetSecret(existing)
  }

  status(provider: SecretProvider): { saved: boolean; last4: string | null } {
    const key = this.get(provider)
    return { saved: !!key, last4: key ? key.slice(-4) : null }
  }
}
