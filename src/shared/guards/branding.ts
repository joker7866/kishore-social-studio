// Branding guard: make sure each platform's mandatory channel hashtag is present,
// normalise hashtag spelling and remove duplicates.

import type { ContentPackage, HashtagPrefs } from '../content-schema'
import type { Platform } from '../platform-types'

export interface ChannelProfile {
  id: number
  name: string
  youtubeHandle: string
  facebookPage: string
  instagramHandle: string
  youtubeHashtag: string
  facebookHashtag: string
  instagramHashtag: string
  isDefault: boolean
}

export const DEFAULT_PROFILE: Omit<ChannelProfile, 'id'> = {
  name: 'Grow With Kishore',
  youtubeHandle: 'growwithkishore',
  facebookPage: 'growwithkishorenews',
  instagramHandle: 'growwithkishorenews',
  youtubeHashtag: '#growwithkishore',
  facebookHashtag: '#growwithkishorenews',
  instagramHashtag: '#growwithkishorenews',
  isDefault: true
}

export function mandatoryHashtag(profile: Pick<ChannelProfile, 'youtubeHashtag' | 'facebookHashtag' | 'instagramHashtag'>, platform: Platform): string {
  const raw =
    platform === 'youtube'
      ? profile.youtubeHashtag
      : platform === 'facebook'
        ? profile.facebookHashtag
        : profile.instagramHashtag
  return normalizeHashtag(raw) ?? ''
}

export function accountName(profile: ChannelProfile, platform: Platform): string {
  return platform === 'youtube'
    ? profile.youtubeHandle
    : platform === 'facebook'
      ? profile.facebookPage
      : profile.instagramHandle
}

/**
 * "#Grow With Kishore!" → "#GrowWithKishore". Keeps letters (incl. Tamil and its
 * combining vowel signs), digits and underscores. Returns null if nothing is left.
 */
export function normalizeHashtag(tag: string): string | null {
  const body = tag
    .normalize('NFC')
    .trim()
    .replace(/^#+/, '')
    .replace(/[^\p{L}\p{M}\p{N}_]/gu, '')
  return body ? `#${body}` : null
}

export function dedupeHashtags(tags: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of tags) {
    const n = normalizeHashtag(t)
    if (!n) continue
    const key = n.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(n)
  }
  return out
}

/**
 * Apply branding to one package. The mandatory hashtag is always first in the
 * recommended list. Packages without a hashtag block (Instagram Story) are untouched.
 */
export function applyBranding(pkg: ContentPackage, mandatory: string, prefs: HashtagPrefs): ContentPackage {
  if (!pkg.hashtags) return pkg
  const brand = normalizeHashtag(mandatory)
  const extras = dedupeHashtags(prefs.extraTags)
  const fromModel = dedupeHashtags(pkg.hashtags.recommended)
  const head = dedupeHashtags([...(brand ? [brand] : []), ...extras])
  const limit = Math.max(prefs.maxRecommended, head.length)
  const recommended = dedupeHashtags([...head, ...fromModel]).slice(0, limit)
  const recKeys = new Set(recommended.map((t) => t.toLowerCase()))
  const overflow = dedupeHashtags([...head, ...fromModel]).slice(limit)
  const expanded = prefs.includeExpanded
    ? dedupeHashtags([...overflow, ...pkg.hashtags.expanded]).filter((t) => !recKeys.has(t.toLowerCase()))
    : []
  return { ...pkg, hashtags: { recommended, expanded } }
}

/** True if the package carries the correct mandatory hashtag (or has no hashtag block). */
export function hasMandatoryHashtag(pkg: ContentPackage, mandatory: string): boolean {
  if (!pkg.hashtags) return true
  const brand = normalizeHashtag(mandatory)?.toLowerCase()
  return !brand || pkg.hashtags.recommended.some((t) => normalizeHashtag(t)?.toLowerCase() === brand)
}
