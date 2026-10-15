// Mock provider: deterministic fixtures built only from the user's own headline,
// so it never invents facts. Every result made with it carries a permanent
// "MOCK OUTPUT" badge in the UI. It goes through the same validation and guards
// as a real provider.

import type { ContentPackage, GenerationInput } from '@shared/content-schema'
import { inputHasAllegation, inputIsQuestion } from '@shared/guards/accuracy'
import { accountName, mandatoryHashtag, type ChannelProfile } from '@shared/guards/branding'
import { CONTENT_TYPES, type ContentTypeId, type QuickAction } from '@shared/platform-types'
import { ProviderError, type ProviderAdapter, type ProviderRequest, type ProviderResponse } from './types'

const EMOJI_RE = /\p{Extended_Pictographic}️?/gu

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    const t = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
      },
      { once: true }
    )
  })
}

interface Words {
  details: string
  watch: string
  whatHappened: string
  cta: (handle: string) => string
  comment: string
  overlayNote: string
  storyPrompt: string
  allegation: string
  live: Record<'upcoming' | 'live' | 'ended', string>
  generic: string[]
  feedback: ContentPackage['qualitativeFeedback']
  missingHeadlineOnly: string
}

const TA: Words = {
  details: 'முழு விவரம்',
  watch: 'இந்த செய்தி குறித்த விவரங்களை இந்த வீடியோவில் பாருங்கள்.',
  whatHappened: 'என்ன நடந்தது?',
  cta: (h) => `மேலும் செய்திகளுக்கு ${h} பக்கத்தை பின்தொடருங்கள்.`,
  comment: 'உங்கள் கருத்தை கமெண்ட்டில் பதிவு செய்யுங்கள்.',
  overlayNote: 'விவரம் கீழே',
  storyPrompt: 'இதைப் பற்றி உங்கள் கருத்து என்ன?',
  allegation: 'என குற்றச்சாட்டு',
  live: {
    upcoming: 'நேரலை நிகழ்ச்சி அறிவிப்பு',
    live: 'இப்போது நேரலையில்',
    ended: 'நேரலை நிகழ்ச்சியின் பதிவு'
  },
  generic: ['#தமிழ்செய்திகள்', '#TamilNews'],
  feedback: {
    clearTopic: 'தலைப்பு உள்ளீட்டில் உள்ளபடியே உள்ளது.',
    specificWording: 'உள்ளீட்டில் இல்லாத விவரங்கள் சேர்க்கப்படவில்லை.',
    faithfulToSource: 'தலைப்பு மட்டுமே பயன்படுத்தப்பட்டது.',
    readableLength: 'சுருக்கமாக உள்ளது.',
    missingContext: 'தேதி, இடம், ஆதாரம் உள்ளீட்டில் இல்லை.'
  },
  missingHeadlineOnly: 'Only a headline was given — date, place and source are not in the input.'
}

const EN: Words = {
  details: 'Full details',
  watch: 'Watch this video for the details of this story.',
  whatHappened: 'What happened?',
  cta: (h) => `Follow ${h} for more news.`,
  comment: 'Share your view in the comments.',
  overlayNote: 'Details below',
  storyPrompt: 'What do you think about this?',
  allegation: '— allegation',
  live: { upcoming: 'Live programme announcement', live: 'Live now', ended: 'Recording of the live programme' },
  generic: ['#TamilNews', '#News'],
  feedback: {
    clearTopic: 'Topic is taken directly from the headline.',
    specificWording: 'No details beyond the input were added.',
    faithfulToSource: 'Only the headline was used.',
    readableLength: 'Short and readable.',
    missingContext: 'Date, place and source are not in the input.'
  },
  missingHeadlineOnly: 'Only a headline was given — date, place and source are not in the input.'
}

function withAttribution(h: string, isAllegation: boolean, w: Words): string {
  if (!isAllegation || /[?？]\s*$/.test(h)) return h
  return `${h.replace(/[.!]+$/, '')} ${w.allegation}`
}

function firstWords(s: string, n: number): string {
  return s.split(/\s+/).slice(0, n).join(' ')
}

export function mockPackage(
  id: ContentTypeId,
  input: GenerationInput,
  profile: ChannelProfile,
  variant = 0
): ContentPackage {
  const spec = CONTENT_TYPES[id]
  const w = input.language === 'en' ? EN : TA
  const isQ = inputIsQuestion(input)
  const isA = inputHasAllegation(input)
  const h = input.headline.trim()
  const ha = withAttribution(h, isA, w)
  const handle = accountName(profile, spec.platform)
  const brand = mandatoryHashtag(profile, spec.platform)
  const liveLine = input.live ? w.live[input.live.status] : ''
  const lead = spec.live && liveLine ? `${liveLine}: ${ha}` : ha
  const q = isQ ? '' : ` | ${w.whatHappened}`
  const options = [lead, `${lead} | ${w.details}`, isQ ? `${w.details}: ${lead}` : `${ha}${q}`]
  const rotated = options.map((_, i) => options[(i + variant) % options.length])
  const cta = w.cta(handle)
  const notes = [
    ...(input.summary || input.sourceText || input.transcript || input.confirmedFacts || input.allegations ? [] : [w.missingHeadlineOnly]),
    ...(input.sourceUrl ? ['Source URL was not read. Paste the article text to use it.'] : [])
  ]
  const sourceRefs = [
    ...(input.sourceText ? ['Pasted source text'] : []),
    ...(input.transcript ? ['Transcript'] : []),
    ...(input.confirmedFacts ? ['Confirmed facts (entered by user)'] : [])
  ]
  const base = {
    platform: spec.platform,
    contentType: id,
    qualitativeFeedback: w.feedback,
    missingInfoNotes: notes,
    sourceRefs
  }
  const hashtags = { recommended: [brand, ...w.generic], expanded: [] as string[] }
  const caption = [lead, '', input.summary.trim() || w.watch, '', cta].join('\n')

  const pkg: Record<string, unknown> = { ...base }
  for (const f of [...spec.required, ...spec.optional]) {
    switch (f) {
      case 'titleOptions':
      case 'hookOptions':
        pkg[f] = rotated
        pkg.recommendedIndex = 0
        break
      case 'description':
        pkg[f] = [ha, '', input.summary.trim() || w.watch, '', cta].join('\n')
        break
      case 'caption':
        pkg[f] = caption
        break
      case 'postText':
        pkg[f] = `${ha}\n\n${w.comment}`
        break
      case 'hook':
      case 'hook3s':
        pkg[f] = lead
        break
      case 'thumbnailText':
        pkg[f] = isQ
          ? `${firstWords(h.replace(/[?？]\s*$/, ''), 4)}?`
          : isA
            ? `${firstWords(h, 3)} ${w.allegation}`
            : firstWords(h, 4)
        break
      case 'overlayText':
        pkg[f] = id === 'ig_story' ? firstWords(lead, 6) : w.overlayNote
        break
      case 'cta':
        pkg[f] = cta
        break
      case 'interactionPrompt':
        pkg[f] = w.storyPrompt
        break
      case 'hashtags':
        pkg[f] = hashtags
        break
      // Optional extras are left out by the mock (keywords, pinnedComment, poll, slideTexts).
    }
  }
  return pkg as unknown as ContentPackage
}

export function applyQuickActionText(text: string, action: QuickAction | undefined): string {
  switch (action) {
    case 'no_emojis':
      return text.replace(EMOJI_RE, '').replace(/[ \t]{2,}/g, ' ').trim()
    case 'fewer_emojis': {
      let seen = 0
      return text.replace(EMOJI_RE, (m) => (seen++ === 0 ? m : '')).trim()
    }
    case 'shorter': {
      const firstPara = text.split(/\n\s*\n/)[0]
      return firstPara.length < text.length ? firstPara.trim() : text
    }
    case 'more_professional':
      return text.replace(/!+/g, '.').trim()
    default:
      return text
  }
}

function applyActionDeep(value: unknown, action: QuickAction | undefined): unknown {
  if (typeof value === 'string') return applyQuickActionText(value, action)
  if (Array.isArray(value)) return value.map((v) => applyActionDeep(v, action))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = ['platform', 'contentType', 'qualitativeFeedback', 'missingInfoNotes', 'sourceRefs', 'hashtags'].includes(k)
        ? v
        : applyActionDeep(v, action)
    }
    return out
  }
  return value
}

/** Optional fields the mock leaves out at first, built only from the user's input. */
export function mockOptional(path: string, input: GenerationInput): unknown {
  const w = input.language === 'en' ? EN : TA
  const h = input.headline.trim()
  switch (path) {
    case 'keywords':
      return h.replace(/[?？!.,|]/g, ' ').split(/\s+/).filter((x) => [...x].length > 2).slice(0, 8)
    case 'pinnedComment':
      return w.comment
    case 'slideTexts':
      return [h, ...(input.summary.trim() ? [input.summary.trim()] : [])]
    case 'poll':
      return input.language === 'en'
        ? { question: w.storyPrompt, choices: ['Agree', 'Disagree', 'Not sure'] }
        : { question: w.storyPrompt, choices: ['ஆதரிக்கிறேன்', 'எதிர்க்கிறேன்', 'தெரியவில்லை'] }
    default:
      return undefined
  }
}

export class MockProvider implements ProviderAdapter {
  readonly id = 'mock' as const
  private calls = 0

  constructor(private readonly latencyMs = 400) {}

  async generate(req: ProviderRequest, signal: AbortSignal): Promise<ProviderResponse> {
    await delay(this.latencyMs, signal)
    this.calls++
    const ctx = req.context
    let json: unknown
    if (ctx.kind === 'generate') {
      const packages = ctx.contentTypes.map((id) => {
        const fresh = mockPackage(id, ctx.input, ctx.profile, ctx.current ? this.calls : 0)
        return ctx.action ? applyActionDeep(ctx.current?.find((c) => c.contentType === id) ?? fresh, ctx.action) : fresh
      })
      json = { skillVersion: ctx.skillVersion, packages }
    } else {
      const fresh = mockPackage(ctx.current.contentType, ctx.input, ctx.profile, this.calls)
      const path = ctx.fieldPath
      const pick = (pkg: ContentPackage) =>
        path.split('.').reduce<unknown>((cur, part) => (cur as Record<string, unknown> | undefined)?.[part], pkg)
      const base = ctx.action ? pick(ctx.current) : (pick(fresh) ?? pick(ctx.current) ?? mockOptional(path, ctx.input))
      if (base === undefined) throw new ProviderError('bad_request', `The mock provider cannot write "${path}".`)
      json = { value: applyActionDeep(base, ctx.action) }
    }
    return { json, rawText: JSON.stringify(json), model: req.model, usage: undefined }
  }

  async testConnection(): Promise<string> {
    return 'Mock provider is always available. It does not call any AI service.'
  }

  async listModels(): Promise<string[]> {
    return ['mock-fixtures-v1']
  }
}
