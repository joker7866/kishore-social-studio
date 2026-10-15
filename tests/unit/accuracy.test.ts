import { describe, expect, it } from 'vitest'
import type { ContentPackage } from '../../src/shared/content-schema'
import { checkPackageAccuracy, containsTerm, extractNumbers, extractQuotes } from '../../src/shared/guards/accuracy'
import { actorQuestion, examNoDate, feeAllegation, headlineOnly, liveUpcoming, makeInput } from '../fixtures/inputs'

const fb = (over: Partial<ContentPackage>): ContentPackage => ({
  platform: 'facebook',
  contentType: 'fb_text',
  hook: 'hook',
  caption: 'caption',
  hashtags: { recommended: ['#growwithkishorenews'], expanded: [] },
  qualitativeFeedback: { clearTopic: '', specificWording: '', faithfulToSource: '', readableLength: '', missingContext: '' },
  missingInfoNotes: [],
  sourceRefs: [],
  ...over
})

const yt = (titles: string[], over: Partial<ContentPackage> = {}): ContentPackage => ({
  platform: 'youtube',
  contentType: 'yt_shorts',
  titleOptions: titles,
  recommendedIndex: 0,
  description: 'விவரம்',
  hashtags: { recommended: ['#growwithkishore'], expanded: [] },
  thumbnailText: 'தலைப்பு',
  hook3s: 'தலைப்பு',
  cta: 'Subscribe',
  qualitativeFeedback: { clearTopic: '', specificWording: '', faithfulToSource: '', readableLength: '', missingContext: '' },
  missingInfoNotes: [],
  sourceRefs: [],
  ...over
})

const codes = (w: { code: string }[]) => w.map((x) => x.code)

describe('helpers', () => {
  it('normalises Tamil digits and thousands separators', () => {
    expect(extractNumbers('₹1,500 மற்றும் ௨௦ பேர்')).toEqual(['1500', '20'])
  })
  it('matches Tamil terms with suffixes but not inside other words', () => {
    expect(containsTerm('இன்றைய செய்தி', 'இன்று')).toBe(false) // different stem form
    expect(containsTerm('இன்றைய செய்தி', 'இன்றைய')).toBe(true)
    expect(containsTerm('breakingnews', 'breaking')).toBe(false)
    expect(containsTerm('BREAKING: news', 'breaking')).toBe(true)
  })
  it('extracts quoted text', () => {
    expect(extractQuotes('அவர் "நான் ராஜினாமா செய்கிறேன்" என்றார்')).toEqual(['நான் ராஜினாமா செய்கிறேன்'])
  })
})

describe('spec example: fee collection allegation', () => {
  const input = feeAllegation()
  it('flags a title that states the allegation as fact', () => {
    const w = checkPackageAccuracy(yt(['பள்ளியில் கட்டாய கட்டண வசூல் அம்பலம்!', 'x என குற்றச்சாட்டு', 'y?']), input)
    expect(w.filter((x) => x.code === 'uncertainty_dropped').map((x) => x.path)).toEqual(['titleOptions.0', 'thumbnailText', 'hook3s'])
  })
  it('accepts attributed wording', () => {
    const w = checkPackageAccuracy(
      yt(['பள்ளியில் கட்டாய கட்டண வசூல் என பெற்றோர் புகார்', 'Parent alleges forced fee collection', 'கட்டாய கட்டண வசூல்?'], {
        thumbnailText: 'கட்டண வசூல் புகார்',
        hook3s: 'பள்ளி மீது பெற்றோர் புகார்'
      }),
      input
    )
    expect(codes(w)).not.toContain('uncertainty_dropped')
  })
  it('flags an invented amount', () => {
    const w = checkPackageAccuracy(fb({ caption: '₹5,000 கட்டாய வசூல் என புகார்' }), input)
    expect(w.find((x) => x.code === 'new_number')?.match).toBe('5000')
  })
  it('flags a "more engaging" rewrite that drops attribution', () => {
    const before = fb({ hook: 'கட்டாய கட்டண வசூல் என பெற்றோர் புகார்' })
    const after = fb({ hook: 'கட்டாய கட்டண வசூல் — பள்ளியின் அதிர்ச்சி செயல்!' })
    expect(codes(checkPackageAccuracy(before, input))).not.toContain('uncertainty_dropped')
    expect(codes(checkPackageAccuracy(after, input))).toContain('uncertainty_dropped')
  })
})

describe('spec example: missing exam date stays missing', () => {
  const input = examNoDate()
  it('flags an invented date in numbers or month words', () => {
    const w = checkPackageAccuracy(fb({ caption: 'மார்ச் 15 முதல் பொதுத் தேர்வு' }), input)
    expect(codes(w)).toContain('new_number')
    expect(codes(w)).toContain('new_date')
  })
  it('flags English month names and relative dates', () => {
    const w = checkPackageAccuracy(fb({ caption: 'Exams begin in April, timetable tomorrow' }), input)
    expect(w.filter((x) => x.code === 'new_date').map((x) => x.match)).toEqual(expect.arrayContaining(['april', 'tomorrow']))
  })
  it('does not flag "may" used as a verb', () => {
    const w = checkPackageAccuracy(fb({ caption: 'The schedule may be released soon' }), input)
    expect(codes(w)).not.toContain('new_date')
  })
})

describe('spec example: question stays a question', () => {
  const input = actorQuestion()
  it('flags any title option that answers the question', () => {
    const w = checkPackageAccuracy(yt(['நடிகரின் அணுகுமுறை மாறிவிட்டதா?', 'நடிகரின் அணுகுமுறை மாறியது!', 'உண்மையில் மாறிவிட்டதா?']), input)
    expect(w.filter((x) => x.code === 'uncertainty_dropped').map((x) => x.path)).toContain('titleOptions.1')
    expect(w.filter((x) => x.code === 'uncertainty_dropped').map((x) => x.path)).not.toContain('titleOptions.0')
  })
  it('flags an invented reaction (hype)', () => {
    const w = checkPackageAccuracy(fb({ caption: 'ரசிகர்கள் அதிர்ச்சி' }), input)
    expect(codes(w)).toContain('hype')
  })
})

describe('spec example: headline only', () => {
  const input = headlineOnly()
  it('flags invented quotes, names and claims', () => {
    const w = checkPackageAccuracy(
      fb({ caption: 'அமைச்சர் "இது தற்காலிகம்" என்றார். Minister Ravi Kumar said it is official. Breaking!' }),
      input
    )
    expect(codes(w)).toEqual(expect.arrayContaining(['new_quote', 'possible_new_name', 'forbidden_claim']))
  })
  it('passes clean output', () => {
    const w = checkPackageAccuracy(fb({ hook: 'மெட்ரோ ரயில் சேவை நேர மாற்றம்', caption: 'மெட்ரோ ரயில் சேவை நேர மாற்றம் குறித்த தகவல்.' }), input)
    expect(w).toEqual([])
  })
})

describe('forbidden claims and flags', () => {
  it('allows "official" only when the user ticks it', () => {
    const pkg = fb({ caption: 'அதிகாரப்பூர்வ அறிவிப்பு' })
    expect(codes(checkPackageAccuracy(pkg, makeInput()))).toContain('forbidden_claim')
    expect(codes(checkPackageAccuracy(pkg, makeInput({ flags: { official: true, exclusive: false, breaking: false, fullSpeech: false } })))).not.toContain(
      'forbidden_claim'
    )
  })
  it('flags "today" unless the input says it', () => {
    expect(codes(checkPackageAccuracy(fb({ caption: 'இன்று முக்கிய அறிவிப்பு' }), makeInput()))).toContain('forbidden_claim')
    expect(codes(checkPackageAccuracy(fb({ caption: 'இன்று முக்கிய அறிவிப்பு' }), makeInput({ summary: 'இன்று அறிவிப்பு வெளியானது' })))).not.toContain(
      'forbidden_claim'
    )
  })
  it('flags LIVE NOW when status is upcoming, but allows mentioning the live stream', () => {
    const input = liveUpcoming()
    const live = (caption: string): ContentPackage => ({ ...fb({ caption }), contentType: 'fb_live' })
    expect(codes(checkPackageAccuracy(live('🔴 LIVE NOW: செய்தியாளர் சந்திப்பு'), input))).toContain('forbidden_claim')
    expect(codes(checkPackageAccuracy(live('செய்தியாளர் சந்திப்பு நேரலை நிகழ்ச்சி அறிவிப்பு'), input))).not.toContain('forbidden_claim')
  })
  it('flags LIVE when no live event was entered', () => {
    expect(codes(checkPackageAccuracy(fb({ caption: 'Watch live' }), makeInput()))).toContain('forbidden_claim')
  })
  it('allows LIVE when status = live', () => {
    const input = makeInput({ live: { eventName: 'x', dateTime: '', timezone: 'Asia/Kolkata', venue: '', speakers: '', status: 'live' } })
    expect(codes(checkPackageAccuracy(fb({ caption: 'LIVE NOW' }), input))).not.toContain('forbidden_claim')
  })
})

describe('numbers present in input are fine', () => {
  it('accepts numbers from the summary, incl. Tamil digits', () => {
    const input = makeInput({ summary: '20 பேர் காயம், ₹1,500 அபராதம்' })
    expect(checkPackageAccuracy(fb({ caption: '௨௦ பேர் காயம்; 1500 ரூபாய் அபராதம்' }), input)).toEqual([])
  })
  it('skips brand hashtags', () => {
    const w = checkPackageAccuracy(fb({ hashtags: { recommended: ['#growwithkishorenews'], expanded: [] } }), makeInput(), {
      brandHashtags: ['#growwithkishorenews']
    })
    expect(w).toEqual([])
  })
})
