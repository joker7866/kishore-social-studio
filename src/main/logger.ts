import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { redact } from './security/redact'

export interface Logger {
  info(msg: string, extra?: unknown): void
  warn(msg: string, extra?: unknown): void
  error(msg: string, extra?: unknown): void
}

const MAX_BYTES = 5 * 1024 * 1024

function serialize(extra: unknown): string {
  if (extra === undefined) return ''
  if (extra instanceof Error) return ` ${extra.name}: ${extra.message}`
  try {
    return ' ' + JSON.stringify(extra)
  } catch {
    return ' [unserializable]'
  }
}

/** File logger. Every line passes through redact() before it touches disk. */
export function createLogger(file: string | null, alsoConsole = true): Logger {
  if (file) mkdirSync(dirname(file), { recursive: true })
  const write = (level: string, msg: string, extra?: unknown) => {
    const line = redact(`${new Date().toISOString()} ${level} ${msg}${serialize(extra)}`)
    if (alsoConsole) (level === 'ERROR' ? console.error : console.log)(line)
    if (!file) return
    try {
      if (existsSync(file) && statSync(file).size > MAX_BYTES) renameSync(file, file + '.1')
      appendFileSync(file, line + '\n', 'utf8')
    } catch {
      // Logging must never crash the app.
    }
  }
  return {
    info: (m, e) => write('INFO', m, e),
    warn: (m, e) => write('WARN', m, e),
    error: (m, e) => write('ERROR', m, e)
  }
}
