// Deterministic accuracy checks (code, not prompt). They compare AI output with
// the user's input and flag anything the input does not support. Nothing is
// rewritten — warnings are shown beside the field for the user to decide.

import { collectTexts, type ContentPackage, type GenerationInput } from '../content-schema'
import { CONTENT_TYPES } from '../platform-types'

export type WarningCode =
  | 'new_number'
  | 'new_date'
  | 'new_quote'
  | 'forbidden_claim'
  | 'uncertainty_dropped'
  | 'hype'
  | 'possible_new_name'
  | 'missing_brand_hashtag'

export interface AccuracyWarning {
  path: string
  code: WarningCode
  severity: 'warning' | 'info'
  message: string
  match?: string
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const TAMIL_DIGITS = '௦௧௨௩௪௫௬௭௮௯'
const TAMIL_LETTER = /[஀-௿]/

export function normalize(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[௦-௯]/g, (d) => String(TAMIL_DIGITS.indexOf(d)))
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟«»]/g, '"')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim()
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Term match that respects word starts. English terms need word boundaries on
 * both sides; Tamil terms only need a non-Tamil-letter before them because Tamil
 * attaches suffixes (இன்று → இன்றைய).
 */
export function containsTerm(haystack: string, term: string): boolean {
  return containsNorm(normalize(haystack), term)
}

/** Same as containsTerm but the haystack is already normalized. */
export function containsNorm(h: string, term: string): boolean {
  const t = normalize(term)
  if (!t) return false
  if (/^[\x00-\x7F]+$/.test(t)) {
    return new RegExp(`(^|[^a-z0-9])${escapeRe(t)}($|[^a-z0-9])`, 'i').test(h)
  }
  let from = 0
  while (true) {
    const idx = h.indexOf(t, from)
    if (idx === -1) return false
    if (idx === 0 || !TAMIL_LETTER.test(h[idx - 1])) return true
    from = idx + 1
  }
}

function inputCorpus(input: GenerationInput): string {
  const live = input.live
  return [
    input.headline,
    input.summary,
    input.transcript,
    input.sourceText,
    input.confirmedFacts,
    input.allegations,
    live ? [live.eventName, live.dateTime, live.timezone, live.venue, live.speakers].join(' \n ') : ''
  ].join(' \n ')
}

/** Digit runs with thousands separators removed: "1,500" → "1500", "௨௦" → "20". */
export function extractNumbers(s: string): string[] {
  const n = normalize(s).replace(/(\d),(?=\d{2,3}\b)/g, '$1')
  return n.match(/\d+/g) ?? []
}

// ---------------------------------------------------------------------------
// Word lists (Tamil + English). Kept here so tests and UI share them.
// ---------------------------------------------------------------------------

const MONTHS_STRICT = [
  'january', 'february', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'jan', 'feb', 'apr', 'jun', 'jul', 'aug', 'sept', 'oct', 'nov', 'dec',
  'ஜனவரி', 'பிப்ரவரி', 'மார்ச்', 'ஏப்ரல்', 'ஜூன்', 'ஜூலை', 'ஆகஸ்ட்', 'செப்டம்பர்', 'அக்டோபர்', 'நவம்பர்', 'டிசம்பர்',
  'சித்திரை', 'வைகாசி', 'புரட்டாசி', 'ஐப்பசி', 'கார்த்திகை', 'மார்கழி', 'பங்குனி'
]
/** Ambiguous words (May, march, மே) only count as dates next to a number. */
const MONTHS_NEEDING_DIGIT = ['may', 'march', 'மே']
const RELATIVE_DATES = ['tomorrow', 'yesterday', 'நாளை', 'நேற்று', 'last week', 'next week', 'கடந்த வாரம்', 'அடுத்த வாரம்']
const WEEKDAYS = [
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'திங்கள்', 'செவ்வாய்', 'புதன்', 'வியாழன்', 'வெள்ளி', 'சனி', 'ஞாயிறு'
]

interface ClaimRule {
  key: 'live' | 'breaking' | 'official' | 'exclusive' | 'today' | 'fullSpeech'
  label: string
  terms: string[]
}

const CLAIM_RULES: ClaimRule[] = [
  { key: 'breaking', label: 'breaking', terms: ['breaking', 'பிரேக்கிங்', 'முக்கிய செய்தி'] },
  { key: 'official', label: 'official', terms: ['official', 'officially', 'அதிகாரப்பூர்வ', 'அதிகாரபூர்வ'] },
  { key: 'exclusive', label: 'exclusive', terms: ['exclusive', 'பிரத்யேக', 'எக்ஸ்க்ளூசிவ்'] },
  { key: 'today', label: 'today', terms: ['today', 'tonight', 'இன்று', 'இன்றிரவு', 'இன்றைய'] },
  { key: 'fullSpeech', label: 'full speech', terms: ['full speech', 'முழு பேச்சு', 'முழு உரை', 'முழுப் பேச்சு'] }
]
/** Claims that something is on air right now. */
const LIVE_NOW_TERMS = ['live now', 'now live', 'live:', '🔴', 'இப்போது நேரலை', 'நேரலையில்', 'நேரலை:']
const LIVE_TERMS = ['live', 'நேரலை']

export const DEFAULT_HYPE_PHRASES = [
  'everyone shocked',
  'everyone is shocked',
  'shocking',
  "you won't believe",
  'you will not believe',
  'internet is shocked',
  'fans shocked',
  'goes viral',
  'breaks the internet',
  'jaw-dropping',
  'அனைவரும் அதிர்ச்சி',
  'எல்லோரும் அதிர்ச்சி',
  'ரசிகர்கள் அதிர்ச்சி',
  'அதிர்ச்சியில் உறைந்த',
  'மிரண்டு போன',
  'தீயாய் பரவும்',
  'வைரலாகும்',
  'பரபரப்பு'
]

const ATTRIBUTION_MARKERS = [
  '?',
  'alleged', 'allegedly', 'alleges', 'allege', 'alleging', 'allegation', 'allegations', 'accused', 'accuses', 'accuse',
  'claims', 'claimed', 'claim',
  'reportedly', 'according to', 'complaint', 'complains', 'complained', 'says', 'said', 'reports',
  'குற்றச்சாட்டு', 'குற்றம் சாட்ட', 'குற்றம்சாட்ட', 'புகார்', 'கூறப்படுகிறது', 'சொல்லப்படுகிறது',
  'என தகவல்', 'எனத் தகவல்', 'என்று கூறு', 'எனக் கூறு', 'என கூறு', 'தெரிவித்த', 'தெரிவிக்கப்படுகிறது',
  'கேள்வி', 'சர்ச்சை'
]

const NAME_STOPWORDS = new Set(
  [
    'youtube', 'facebook', 'instagram', 'shorts', 'reel', 'reels', 'live', 'subscribe', 'follow', 'like', 'share',
    'comment', 'comments', 'watch', 'full', 'video', 'news', 'tamil', 'india', 'tamil nadu', 'chennai', 'story',
    'update', 'updates', 'details', 'click', 'link', 'bio', 'channel', 'kishore', 'grow', 'with', 'the', 'and', 'for',
    'what', 'why', 'how', 'who', 'when', 'where', 'is', 'are', 'was', 'this', 'that', 'here', 'more', 'read', 'new',
    'latest', 'today', 'stay', 'tuned', 'join', 'us', 'our', 'your', 'do', 'did', 'does', 'will', 'a', 'an', 'of',
    'in', 'on', 'to', 'from', 'by', 'at', 'it', 'its', 'tell', 'let', 'know', 'below', 'drop', 'thoughts', 'complete',
    'explained', 'breaking', 'official', 'exclusive', 'community', 'poll', 'question', 'answer', 'opinion'
  ].map((w) => w.toLowerCase())
)

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

function checkNumbers(path: string, text: string, inputNums: Set<string>, out: AccuracyWarning[]) {
  const seen = new Set<string>()
  for (const num of extractNumbers(text)) {
    if (inputNums.has(num) || seen.has(num)) continue
    seen.add(num)
    out.push({
      path,
      code: 'new_number',
      severity: 'warning',
      match: num,
      message: `"${num}" does not appear in your input. Check it is not an invented number, amount or date.`
    })
  }
}

function checkDates(path: string, n: string, corpus: string, out: AccuracyWarning[]) {
  const hits = new Set<string>()
  for (const m of [...MONTHS_STRICT, ...RELATIVE_DATES, ...WEEKDAYS]) {
    if (containsNorm(n, m) && !containsNorm(corpus, m)) hits.add(m)
  }
  for (const m of MONTHS_NEEDING_DIGIT) {
    const re = new RegExp(`(\\d\\s*${escapeRe(m)}|${escapeRe(m)}\\s*\\d)`, 'i')
    if (re.test(n) && !containsNorm(corpus, m)) hits.add(m)
  }
  for (const h of hits) {
    out.push({
      path,
      code: 'new_date',
      severity: 'warning',
      match: h,
      message: `Date word "${h}" is not in your input. Missing dates must stay missing.`
    })
  }
}

const QUOTE_PATTERNS = [/"([^"]{2,})"/g, /(?:^|[\s(\[])'([^']{2,})'(?=$|[\s.,!?;:)\]])/g]

export function extractQuotes(text: string): string[] {
  return extractQuotesNorm(normalize(text))
}

function extractQuotesNorm(n: string): string[] {
  const quotes: string[] = []
  for (const re of QUOTE_PATTERNS) {
    for (const m of n.matchAll(re)) quotes.push(m[1].trim())
  }
  return quotes.filter((q) => q.length >= 2)
}

function checkQuotes(path: string, n: string, corpusNorm: string, out: AccuracyWarning[]) {
  for (const q of extractQuotesNorm(n)) {
    if (corpusNorm.includes(q)) continue
    out.push({
      path,
      code: 'new_quote',
      severity: 'warning',
      match: q,
      message: `Quoted text "${q}" does not match anything in your input. It may be an invented quote.`
    })
  }
}

function checkClaims(
  path: string,
  text: string,
  input: GenerationInput,
  corpus: string,
  isLiveType: boolean,
  out: AccuracyWarning[]
) {
  for (const rule of CLAIM_RULES) {
    const flagged = rule.key in input.flags && input.flags[rule.key as keyof typeof input.flags]
    if (flagged) continue
    for (const term of rule.terms) {
      if (containsNorm(text, term) && !containsNorm(corpus, term)) {
        out.push({
          path,
          code: 'forbidden_claim',
          severity: 'warning',
          match: term,
          message: `"${term}" makes a ${rule.label} claim your input does not support.${
            rule.key === 'today' ? '' : ` Tick "${rule.label}" on the Generate screen only if it is true.`
          }`
        })
        break
      }
    }
  }
  // LIVE: allowed only when status = live. Upcoming/ended events may mention the
  // live stream but may not claim it is on air now.
  const status = input.live?.status
  if (status === 'live') return
  const terms = input.live || isLiveType ? LIVE_NOW_TERMS : [...LIVE_NOW_TERMS, ...LIVE_TERMS]
  for (const term of terms) {
    if (containsNorm(text, term)) {
      out.push({
        path,
        code: 'forbidden_claim',
        severity: 'warning',
        match: term,
        message: status
          ? `"${term}" says it is live now, but live status is "${status}".`
          : `"${term}" claims a live stream, but no live event was entered.`
      })
      break
    }
  }
}

function checkHype(path: string, text: string, corpus: string, phrases: string[], out: AccuracyWarning[]) {
  for (const p of phrases) {
    if (containsNorm(text, p) && !containsNorm(corpus, p)) {
      out.push({
        path,
        code: 'hype',
        severity: 'warning',
        match: p,
        message: `"${p}" is an unsupported reaction/hype phrase.`
      })
    }
  }
}

function checkNames(path: string, text: string, corpus: string, out: AccuracyWarning[]) {
  // English proper-noun heuristic: two or more Capitalised words in a row.
  // Tamil has no capital letters, so Tamil names cannot be detected this way.
  const re = /\b([A-Z][a-zA-Z.'-]+(?:\s+[A-Z][a-zA-Z.'-]+)+)\b/g
  for (const m of text.matchAll(re)) {
    const words = m[1].split(/\s+/)
    const unknown = words.filter((w) => {
      const lw = w.toLowerCase().replace(/[.'-]+$/, '')
      return lw.length > 1 && !NAME_STOPWORDS.has(lw) && !containsNorm(corpus, lw)
    })
    if (unknown.length) {
      out.push({
        path,
        code: 'possible_new_name',
        severity: 'info',
        match: m[1],
        message: `"${m[1]}" looks like a name that is not in your input. Check it.`
      })
    }
  }
}

function checkUncertainty(
  path: string,
  text: string,
  isQuestion: boolean,
  isAllegation: boolean,
  out: AccuracyWarning[]
) {
  if (isQuestion && !text.includes('?')) {
    out.push({
      path,
      code: 'uncertainty_dropped',
      severity: 'warning',
      message: 'The headline is a question, but this line states it as fact. Keep it a question.'
    })
    return
  }
  if (isAllegation && !ATTRIBUTION_MARKERS.some((m) => (m === '?' ? text.includes('?') : containsNorm(text, m)))) {
    out.push({
      path,
      code: 'uncertainty_dropped',
      severity: 'warning',
      message:
        'Your input contains an allegation, but this line presents it as confirmed. Add attribution (e.g. "…என குற்றச்சாட்டு", "alleged") or a question.'
    })
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface AccuracyOptions {
  hypePhrases?: string[]
  /** Brand hashtags are always allowed and skipped by the checks. */
  brandHashtags?: string[]
}

export function inputIsQuestion(input: GenerationInput): boolean {
  return /[?？]\s*$/.test(input.headline.trim())
}

export function inputHasAllegation(input: GenerationInput): boolean {
  if (input.allegations.trim()) return true
  const h = input.headline
  return ['alleged', 'allegedly', 'allegation', 'accused', 'குற்றச்சாட்டு', 'குற்றம் சாட்ட', 'புகார்'].some((m) =>
    containsTerm(h, m)
  )
}

/** Fields whose wording must keep the question / attribution of the headline. */
function isHeadlineLike(path: string): boolean {
  return /^(titleOptions\.\d|hookOptions\.\d|hook|hook3s|thumbnailText)$/.test(path)
}

export function checkPackageAccuracy(
  pkg: ContentPackage,
  input: GenerationInput,
  options: AccuracyOptions = {}
): AccuracyWarning[] {
  const corpus = inputCorpus(input)
  const corpusNorm = normalize(corpus)
  // Every check below receives normalized text and the normalized corpus.
  const inputNums = new Set(extractNumbers(corpus))
  const brand = new Set((options.brandHashtags ?? []).map((t) => normalize(t)))
  const phrases = options.hypePhrases ?? DEFAULT_HYPE_PHRASES
  const isQuestion = inputIsQuestion(input)
  const isAllegation = inputHasAllegation(input)
  const isLiveType = CONTENT_TYPES[pkg.contentType].live
  const out: AccuracyWarning[] = []

  for (const { path, text } of collectTexts(pkg)) {
    const tn = normalize(text)
    if (path.startsWith('hashtags.') && brand.has(tn)) continue
    checkNumbers(path, text, inputNums, out)
    checkDates(path, tn, corpusNorm, out)
    checkQuotes(path, tn, corpusNorm, out)
    checkClaims(path, tn, input, corpusNorm, isLiveType, out)
    checkHype(path, tn, corpusNorm, phrases, out)
    checkNames(path, text, corpusNorm, out)
    if (isHeadlineLike(path)) checkUncertainty(path, tn, isQuestion, isAllegation, out)
  }
  return out
}
