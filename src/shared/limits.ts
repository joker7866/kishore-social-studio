// Character counters and platform limits (rules come from platform-rules.json).

import type { ContentPackage } from './content-schema'
import type { ContentTypeId } from './platform-types'

export interface LimitRule {
  max: number
  unit: 'chars' | 'items' | 'joinedChars' | 'hashtagsTotal'
  kind: 'hard' | 'editorial'
  source: string
}

export interface LimitSource {
  url: string
  verifiedOn: string | null
  official: boolean
}

export interface PlatformRules {
  version: string
  note?: string
  sources: Record<string, LimitSource>
  limits: Partial<Record<ContentTypeId, Record<string, LimitRule>>>
  guidance: Partial<Record<ContentTypeId, string[]>>
}

export interface LimitCheck {
  path: string
  count: number
  max: number
  kind: 'hard' | 'editorial'
  unit: LimitRule['unit']
  over: boolean
}

/** Count characters the way people see them: by Unicode code point, not UTF-16 unit. */
export function charCount(s: string): number {
  return [...s].length
}

export function countInlineHashtags(s: string): number {
  return (s.match(/(^|\s)#[\p{L}\p{M}\p{N}_]+/gu) ?? []).length
}

export function evaluateLimits(pkg: ContentPackage, rules: PlatformRules | null | undefined): LimitCheck[] {
  const typeRules = rules?.limits?.[pkg.contentType]
  if (!typeRules) return []
  const out: LimitCheck[] = []
  const rec = pkg as unknown as Record<string, unknown>
  for (const [field, rule] of Object.entries(typeRules)) {
    const value = rec[field]
    if (value === undefined) continue
    const push = (path: string, count: number) =>
      out.push({ path, count, max: rule.max, kind: rule.kind, unit: rule.unit, over: count > rule.max })
    if (rule.unit === 'chars') {
      if (typeof value === 'string') push(field, charCount(value))
      else if (Array.isArray(value)) value.forEach((v, i) => typeof v === 'string' && push(`${field}.${i}`, charCount(v)))
    } else if (rule.unit === 'items') {
      if (field === 'hashtags' && pkg.hashtags) push('hashtags.recommended', pkg.hashtags.recommended.length)
      else if (Array.isArray(value)) push(field, value.length)
    } else if (rule.unit === 'joinedChars' && Array.isArray(value)) {
      push(field, charCount(value.join(',')))
    } else if (rule.unit === 'hashtagsTotal' && pkg.hashtags) {
      const inline = countInlineHashtags(pkg.caption ?? '')
      push('hashtags.recommended', pkg.hashtags.recommended.length + inline)
    }
  }
  return out
}

/** Hard-limit violations block "copy as ready". */
export function hardViolations(pkg: ContentPackage, rules: PlatformRules | null | undefined): LimitCheck[] {
  return evaluateLimits(pkg, rules).filter((c) => c.over && c.kind === 'hard')
}

export function limitFor(checks: LimitCheck[], path: string): LimitCheck | undefined {
  return checks.find((c) => c.path === path)
}
