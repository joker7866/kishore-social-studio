// Platforms, content types and the fields each content type carries.
// This file is the single source of truth used by the schema, prompt builder,
// guards and the Results editor.

export const PLATFORMS = ['youtube', 'facebook', 'instagram'] as const
export type Platform = (typeof PLATFORMS)[number]

export const PLATFORM_LABELS: Record<Platform, string> = {
  youtube: 'YouTube',
  facebook: 'Facebook',
  instagram: 'Instagram'
}

export const CONTENT_TYPE_IDS = [
  'yt_shorts',
  'yt_long',
  'yt_live',
  'yt_community',
  'fb_reel',
  'fb_video',
  'fb_text',
  'fb_image',
  'fb_live',
  'ig_reel',
  'ig_feed',
  'ig_carousel',
  'ig_story',
  'ig_live'
] as const
export type ContentTypeId = (typeof CONTENT_TYPE_IDS)[number]

/** Editable text fields. Array fields are addressed as `titleOptions.0` etc. */
export type FieldKey =
  | 'titleOptions'
  | 'hookOptions'
  | 'description'
  | 'caption'
  | 'postText'
  | 'hook'
  | 'hook3s'
  | 'thumbnailText'
  | 'overlayText'
  | 'pinnedComment'
  | 'cta'
  | 'interactionPrompt'
  | 'keywords'
  | 'slideTexts'
  | 'poll'
  | 'hashtags'

export interface ContentTypeSpec {
  id: ContentTypeId
  platform: Platform
  label: string
  /** Fields the model must return. */
  required: FieldKey[]
  /** Fields the model may return. Anything not listed is rejected by the schema. */
  optional: FieldKey[]
  /** True for live announcement / live stream types — wording depends on live status. */
  live: boolean
}

const ytVideo = (id: ContentTypeId, label: string, live = false): ContentTypeSpec => ({
  id,
  platform: 'youtube',
  label,
  required: ['titleOptions', 'description', 'hashtags', 'thumbnailText', 'hook3s', 'cta'],
  optional: ['keywords', 'pinnedComment'],
  live
})

const hookTriple = (
  id: ContentTypeId,
  platform: Platform,
  label: string
): ContentTypeSpec => ({
  id,
  platform,
  label,
  required: ['hookOptions', 'caption', 'hashtags', 'overlayText', 'cta'],
  optional: [],
  live: false
})

const liveAnnouncement = (id: ContentTypeId, platform: Platform): ContentTypeSpec => ({
  id,
  platform,
  label: 'Live announcement',
  required: ['hook', 'caption', 'hashtags'],
  optional: [],
  live: true
})

export const CONTENT_TYPES: Record<ContentTypeId, ContentTypeSpec> = {
  yt_shorts: ytVideo('yt_shorts', 'Shorts'),
  yt_long: ytVideo('yt_long', 'Long video'),
  yt_live: ytVideo('yt_live', 'Live stream', true),
  yt_community: {
    id: 'yt_community',
    platform: 'youtube',
    label: 'Community post',
    required: ['postText', 'hashtags'],
    optional: ['poll'],
    live: false
  },
  fb_reel: hookTriple('fb_reel', 'facebook', 'Reel'),
  fb_video: hookTriple('fb_video', 'facebook', 'Video post'),
  fb_text: {
    id: 'fb_text',
    platform: 'facebook',
    label: 'Text post',
    required: ['hook', 'caption', 'hashtags'],
    optional: [],
    live: false
  },
  fb_image: {
    id: 'fb_image',
    platform: 'facebook',
    label: 'Image post',
    required: ['hook', 'caption', 'hashtags', 'overlayText'],
    optional: [],
    live: false
  },
  fb_live: liveAnnouncement('fb_live', 'facebook'),
  ig_reel: hookTriple('ig_reel', 'instagram', 'Reel'),
  ig_feed: hookTriple('ig_feed', 'instagram', 'Feed post'),
  ig_carousel: {
    id: 'ig_carousel',
    platform: 'instagram',
    label: 'Carousel caption',
    required: ['hook', 'caption', 'hashtags'],
    optional: ['slideTexts'],
    live: false
  },
  ig_story: {
    id: 'ig_story',
    platform: 'instagram',
    label: 'Story text',
    required: ['overlayText'],
    optional: ['interactionPrompt'],
    live: false
  },
  ig_live: liveAnnouncement('ig_live', 'instagram')
}

export function contentTypesFor(platform: Platform): ContentTypeId[] {
  return CONTENT_TYPE_IDS.filter((id) => CONTENT_TYPES[id].platform === platform)
}

export function contentTypeLabel(id: ContentTypeId): string {
  const spec = CONTENT_TYPES[id]
  return `${PLATFORM_LABELS[spec.platform]} · ${spec.label}`
}

export const FIELD_LABELS: Record<FieldKey, string> = {
  titleOptions: 'Title options',
  hookOptions: 'Opening hook options',
  description: 'Description',
  caption: 'Caption',
  postText: 'Post text',
  hook: 'Opening hook',
  hook3s: 'First 3 seconds hook',
  thumbnailText: 'Thumbnail text',
  overlayText: 'Overlay text',
  pinnedComment: 'Pinned comment',
  cta: 'Call to action',
  interactionPrompt: 'Interaction prompt',
  keywords: 'Keywords',
  slideTexts: 'Per-slide text',
  poll: 'Poll',
  hashtags: 'Hashtags'
}

export const LANGUAGES = ['ta', 'en', 'ta-en'] as const
export type Language = (typeof LANGUAGES)[number]
export const LANGUAGE_LABELS: Record<Language, string> = {
  ta: 'Tamil',
  en: 'English',
  'ta-en': 'Tamil + English mix'
}

export const TONES = ['neutral', 'professional', 'engaging', 'simple'] as const
export type Tone = (typeof TONES)[number]
export const TONE_LABELS: Record<Tone, string> = {
  neutral: 'Neutral news',
  professional: 'Professional',
  engaging: 'Engaging (still factual)',
  simple: 'Simple Tamil'
}

export const EMOJI_LEVELS = ['none', 'few', 'normal'] as const
export type EmojiLevel = (typeof EMOJI_LEVELS)[number]

export const LIVE_STATUSES = ['upcoming', 'live', 'ended'] as const
export type LiveStatus = (typeof LIVE_STATUSES)[number]

export const QUICK_ACTIONS = [
  'shorter',
  'more_professional',
  'more_engaging',
  'simpler_tamil',
  'fewer_emojis',
  'no_emojis'
] as const
export type QuickAction = (typeof QUICK_ACTIONS)[number]
export const QUICK_ACTION_LABELS: Record<QuickAction, string> = {
  shorter: 'Shorter',
  more_professional: 'More professional',
  more_engaging: 'More engaging',
  simpler_tamil: 'Simpler Tamil',
  fewer_emojis: 'Fewer emojis',
  no_emojis: 'No emojis'
}

export const PROVIDERS = ['openai', 'anthropic', 'mock'] as const
export type ProviderId = (typeof PROVIDERS)[number]
export const PROVIDER_LABELS: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic (Claude)',
  mock: 'Mock (no AI, test output)'
}

export const DEFAULT_TIMEZONE = 'Asia/Kolkata'
