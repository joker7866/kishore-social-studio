// Removes anything that looks like an API key or credential header before text
// is written to logs, exports or backups.

const PATTERNS: [RegExp, string][] = [
  [/sk-ant-[A-Za-z0-9_-]{6,}/g, 'sk-ant-[REDACTED]'],
  [/sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{12,}/g, 'sk-[REDACTED]'],
  [/(authorization|x-api-key|api[-_]?key)(["']?\s*[:=]\s*["']?)(?:Bearer\s+)?[^\s"',}]+/gi, '$1$2[REDACTED]'],
  [/Bearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, 'Bearer [REDACTED]']
]

const knownSecrets = new Set<string>()

/** Register a secret so its literal value is always redacted (e.g. after loading a key). */
export function registerSecret(secret: string): void {
  if (secret && secret.length >= 8) knownSecrets.add(secret)
}

export function forgetSecret(secret: string): void {
  knownSecrets.delete(secret)
}

export function redact(text: string): string {
  let out = text
  for (const s of knownSecrets) out = out.split(s).join('[REDACTED]')
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep)
  return out
}

/** True if text still contains something shaped like a key (used by tests and export checks). */
export function containsSecretPattern(text: string): boolean {
  if ([...knownSecrets].some((s) => text.includes(s))) return true
  return /sk-ant-[A-Za-z0-9_-]{6,}|sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{12,}/.test(text)
}

/** Redact every string inside a JSON-able value. */
export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redact(value) as T
  if (Array.isArray(value)) return value.map(redactDeep) as T
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v)
    return out as T
  }
  return value
}
