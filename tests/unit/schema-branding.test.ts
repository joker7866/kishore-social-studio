import { describe, expect, it } from 'vitest'
import { mockPackage } from '../../src/main/ai/providers/mock'
import {
  outputJsonSchema,
  setFieldValue,
  validateGenerationOutput,
  validatePackage,
  type ContentPackage
} from '../../src/shared/content-schema'
import { applyBranding, DEFAULT_PROFILE, hasMandatoryHashtag, mandatoryHashtag, normalizeHashtag } from '../../src/shared/guards/branding'
import { CONTENT_TYPE_IDS, CONTENT_TYPES } from '../../src/shared/platform-types'
import { makeInput } from '../fixtures/inputs'

const profile = { id: 1, ...DEFAULT_PROFILE }
const prefs = { maxRecommended: 5, includeExpanded: true, extraTags: [] }

describe('output schema', () => {
  const input = makeInput()
  const all = CONTENT_TYPE_IDS.map((id) => mockPackage(id, input, profile))

  it('accepts a valid package for all 14 content types', () => {
    const r = validateGenerationOutput({ skillVersion: '1.0.0', packages: all }, [...CONTENT_TYPE_IDS])
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.output.packages).toHaveLength(14)
  })

  it('rejects malformed JSON shapes', () => {
    expect(validateGenerationOutput(undefined, ['yt_shorts']).ok).toBe(false)
    expect(validateGenerationOutput('not json', ['yt_shorts']).ok).toBe(false)
    expect(validateGenerationOutput({ packages: [] }, ['yt_shorts']).ok).toBe(false)
  })

  it('rejects an Instagram package with keywords', () => {
    const ig = { ...mockPackage('ig_reel', input, profile), keywords: ['a'] }
    const r = validateGenerationOutput({ skillVersion: '1', packages: [ig] }, ['ig_reel'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/keywords/)
  })

  it('rejects an Instagram Story with titles or hashtags', () => {
    const story = mockPackage('ig_story', input, profile)
    expect(validatePackage({ ...story, titleOptions: ['a', 'b', 'c'] }).ok).toBe(false)
    expect(validatePackage({ ...story, hashtags: { recommended: [], expanded: [] } }).ok).toBe(false)
  })

  it('requires exactly three title options', () => {
    const p = mockPackage('yt_long', input, profile)
    expect(validatePackage({ ...p, titleOptions: ['only one'] }).ok).toBe(false)
  })

  it('reports missing, duplicate and unrequested packages', () => {
    const yt = mockPackage('yt_shorts', input, profile)
    const r1 = validateGenerationOutput({ skillVersion: '1', packages: [yt] }, ['yt_shorts', 'fb_reel'])
    expect(!r1.ok && r1.errors.some((e) => e.includes('missing package for content type fb_reel'))).toBe(true)
    const r2 = validateGenerationOutput({ skillVersion: '1', packages: [yt, yt] }, ['yt_shorts'])
    expect(!r2.ok && r2.errors.some((e) => e.includes('duplicate'))).toBe(true)
    const r3 = validateGenerationOutput({ skillVersion: '1', packages: [yt] }, ['fb_reel'])
    expect(r3.ok).toBe(false)
  })

  it('treats null optional fields as absent', () => {
    const p = { ...mockPackage('yt_shorts', input, profile), pinnedComment: null, keywords: null }
    expect(validatePackage(p).ok).toBe(true)
  })

  it('produces a JSON schema limited to the requested types', () => {
    const s = outputJsonSchema(['ig_story', 'yt_shorts']) as { properties: { packages: { items: { anyOf: unknown[] } } } }
    expect(s.properties.packages.items.anyOf).toHaveLength(2)
    expect(JSON.stringify(s)).not.toContain('fb_reel')
  })

  it('setFieldValue is immutable and creates paths', () => {
    const p = mockPackage('yt_shorts', input, profile)
    const q = setFieldValue(p, 'titleOptions.1', 'புதிய தலைப்பு')
    expect(q.titleOptions?.[1]).toBe('புதிய தலைப்பு')
    expect(p.titleOptions?.[1]).not.toBe('புதிய தலைப்பு')
  })
})

describe('branding', () => {
  const input = makeInput()

  it('uses the right mandatory hashtag per platform', () => {
    expect(mandatoryHashtag(profile, 'youtube')).toBe('#growwithkishore')
    expect(mandatoryHashtag(profile, 'facebook')).toBe('#growwithkishorenews')
    expect(mandatoryHashtag(profile, 'instagram')).toBe('#growwithkishorenews')
  })

  it('adds the channel hashtag first and dedupes', () => {
    const base = mockPackage('yt_shorts', input, profile)
    const pkg: ContentPackage = { ...base, hashtags: { recommended: ['#TamilNews', '#tamilnews', 'Chennai News'], expanded: ['#TamilNews', '#Chennai'] } }
    const out = applyBranding(pkg, '#growwithkishore', prefs)
    expect(out.hashtags!.recommended).toEqual(['#growwithkishore', '#TamilNews', '#ChennaiNews'])
    expect(out.hashtags!.expanded).toEqual(['#Chennai'])
  })

  it('keeps the brand tag even when the limit is 1', () => {
    const base = mockPackage('ig_reel', input, profile)
    const out = applyBranding({ ...base, hashtags: { recommended: ['#a', '#b'], expanded: [] } }, '#growwithkishorenews', {
      ...prefs,
      maxRecommended: 1
    })
    expect(out.hashtags!.recommended).toEqual(['#growwithkishorenews'])
    expect(out.hashtags!.expanded).toEqual(['#a', '#b'])
  })

  it('propagates a changed channel hashtag from Settings', () => {
    const changed = { ...profile, youtubeHashtag: '#NewChannel' }
    const out = applyBranding(mockPackage('yt_long', input, changed), mandatoryHashtag(changed, 'youtube'), prefs)
    expect(out.hashtags!.recommended[0]).toBe('#NewChannel')
    expect(hasMandatoryHashtag(out, '#NewChannel')).toBe(true)
    expect(hasMandatoryHashtag(out, '#growwithkishore')).toBe(false)
  })

  it('leaves Instagram Story without a hashtag block', () => {
    const story = mockPackage('ig_story', input, profile)
    expect(applyBranding(story, '#growwithkishorenews', prefs).hashtags).toBeUndefined()
  })

  it('normalises Tamil hashtags keeping vowel signs', () => {
    expect(normalizeHashtag('# தமிழ் செய்திகள் !')).toBe('#தமிழ்செய்திகள்')
    expect(normalizeHashtag('###')).toBeNull()
  })

  it('every content type with hashtags gets the correct brand tag', () => {
    for (const id of CONTENT_TYPE_IDS) {
      const spec = CONTENT_TYPES[id]
      const pkg = applyBranding(mockPackage(id, input, profile), mandatoryHashtag(profile, spec.platform), prefs)
      expect(hasMandatoryHashtag(pkg, mandatoryHashtag(profile, spec.platform))).toBe(true)
    }
  })
})
