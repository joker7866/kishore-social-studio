// Tamil sample inputs, including the four behaviours called out in the spec.
import { generationInputSchema, type GenerationInput, type GenerationInputDraft } from '../../src/shared/content-schema'
import { CONTENT_TYPE_IDS } from '../../src/shared/platform-types'

export function makeInput(over: Partial<GenerationInputDraft> = {}): GenerationInput {
  return generationInputSchema.parse({ headline: 'சென்னையில் பள்ளி கட்டண சர்ச்சை', contentTypes: [...CONTENT_TYPE_IDS], ...over })
}

/** Spec example 1: school forced fee collection, evidence = one parent's complaint. */
export const feeAllegation = () =>
  makeInput({
    headline: 'பள்ளியில் கட்டாய கட்டண வசூல்',
    allegations: 'ஒரு பெற்றோர் பள்ளி கட்டாயமாக கட்டணம் வசூலிப்பதாக புகார் அளித்துள்ளார்.'
  })

/** Spec example 2: exam news with no date. */
export const examNoDate = () => makeInput({ headline: 'பொதுத் தேர்வு அட்டவணை விரைவில் வெளியீடு' })

/** Spec example 3: question about an actor's attitude. */
export const actorQuestion = () => makeInput({ headline: 'நடிகரின் அணுகுமுறை மாறிவிட்டதா?' })

/** Spec example 4: headline only, nothing else. */
export const headlineOnly = () => makeInput({ headline: 'மெட்ரோ ரயில் சேவை நேர மாற்றம்' })

export const liveUpcoming = () =>
  makeInput({
    headline: 'முதல்வர் செய்தியாளர் சந்திப்பு',
    live: { eventName: 'செய்தியாளர் சந்திப்பு', dateTime: '15 அக்டோபர், மாலை 6 மணி', timezone: 'Asia/Kolkata', venue: 'சென்னை', speakers: '', status: 'upcoming' },
    contentTypes: ['yt_live', 'fb_live', 'ig_live']
  })
