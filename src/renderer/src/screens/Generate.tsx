import { useEffect, useMemo, useRef, useState } from 'react'
import type { GenerationInputDraft, LiveDetails } from '@shared/content-schema'
import type { AppError, Template } from '@shared/ipc-contract'
import {
  CONTENT_TYPES,
  EMOJI_LEVELS,
  LANGUAGE_LABELS,
  LANGUAGES,
  LIVE_STATUSES,
  PLATFORM_LABELS,
  PLATFORMS,
  TONE_LABELS,
  TONES,
  contentTypesFor,
  type ContentTypeId,
  type EmojiLevel,
  type Language,
  type Tone
} from '@shared/platform-types'
import { modelLabel } from '@shared/models'
import { Checkbox, ErrorBanner, Field, InfoBanner, MockBadge, Modal, PageHeader, Spinner } from '../components/ui'
import { call, newRequestId } from '../lib/api'
import { useApp, useGenerateBlocker } from '../state/app-state'

const DEFAULT_TYPES: ContentTypeId[] = ['yt_shorts', 'yt_long', 'fb_reel', 'fb_text', 'ig_reel', 'ig_feed']

interface FormState {
  headline: string
  summary: string
  transcript: string
  sourceText: string
  sourceUrl: string
  confirmedFacts: string
  allegations: string
  liveEnabled: boolean
  live: LiveDetails
  flags: { official: boolean; exclusive: boolean; breaking: boolean; fullSpeech: boolean }
  contentTypes: ContentTypeId[]
  language: Language
  tone: Tone
  emojiLevel: EmojiLevel
  maxRecommended: number
  includeExpanded: boolean
  extraTags: string
  profileId: number | null
}

function initialForm(prefill: GenerationInputDraft | undefined, lang: Language, tone: Tone, tz: string): FormState {
  const p = prefill ?? ({} as Partial<GenerationInputDraft>)
  return {
    headline: p.headline ?? '',
    summary: p.summary ?? '',
    transcript: p.transcript ?? '',
    sourceText: p.sourceText ?? '',
    sourceUrl: p.sourceUrl ?? '',
    confirmedFacts: p.confirmedFacts ?? '',
    allegations: p.allegations ?? '',
    liveEnabled: !!p.live,
    live: {
      eventName: p.live?.eventName ?? '',
      dateTime: p.live?.dateTime ?? '',
      timezone: p.live?.timezone ?? tz,
      venue: p.live?.venue ?? '',
      speakers: p.live?.speakers ?? '',
      status: p.live?.status ?? 'upcoming'
    },
    flags: {
      official: p.flags?.official ?? false,
      exclusive: p.flags?.exclusive ?? false,
      breaking: p.flags?.breaking ?? false,
      fullSpeech: p.flags?.fullSpeech ?? false
    },
    contentTypes: p.contentTypes?.length ? [...p.contentTypes] : DEFAULT_TYPES,
    language: p.language ?? lang,
    tone: p.tone ?? tone,
    emojiLevel: p.emojiLevel ?? 'few',
    maxRecommended: p.hashtagPrefs?.maxRecommended ?? 5,
    includeExpanded: p.hashtagPrefs?.includeExpanded ?? true,
    extraTags: (p.hashtagPrefs?.extraTags ?? []).join(' '),
    profileId: p.profileId ?? null
  }
}

function toInput(f: FormState): GenerationInputDraft {
  return {
    headline: f.headline,
    summary: f.summary,
    transcript: f.transcript,
    sourceText: f.sourceText,
    sourceUrl: f.sourceUrl.trim(),
    confirmedFacts: f.confirmedFacts,
    allegations: f.allegations,
    live: f.liveEnabled ? f.live : null,
    flags: f.flags,
    contentTypes: f.contentTypes,
    language: f.language,
    tone: f.tone,
    emojiLevel: f.emojiLevel,
    hashtagPrefs: {
      maxRecommended: f.maxRecommended,
      includeExpanded: f.includeExpanded,
      extraTags: f.extraTags.split(/[\s,]+/).filter(Boolean).slice(0, 20)
    },
    profileId: f.profileId
  }
}

const EMOJI_LABELS: Record<EmojiLevel, string> = { none: 'No emojis', few: 'Few emojis', normal: 'Normal' }

export function Generate({ prefill }: { prefill?: GenerationInputDraft }) {
  const { settings, profiles, navigate, toast, activeProvider } = useApp()
  const blocker = useGenerateBlocker()
  const [form, setForm] = useState<FormState>(() => initialForm(prefill, 'ta', 'neutral', 'Asia/Kolkata'))
  const [touchedDefaults, setTouchedDefaults] = useState(!!prefill?.language)
  const [showContext, setShowContext] = useState(
    !!(prefill?.summary || prefill?.transcript || prefill?.sourceText || prefill?.confirmedFacts || prefill?.allegations || prefill?.sourceUrl)
  )
  const [templates, setTemplates] = useState<Template[]>([])
  const [running, setRunning] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<AppError | null>(null)
  const [saveTplOpen, setSaveTplOpen] = useState(false)
  const [tplName, setTplName] = useState('')
  const headlineRef = useRef<HTMLTextAreaElement>(null)

  // Apply saved defaults once settings arrive (unless the form came prefilled).
  useEffect(() => {
    if (settings && !touchedDefaults) {
      setForm((f) => ({ ...f, language: settings.defaultLanguage, tone: settings.defaultTone, live: { ...f.live, timezone: settings.timezone } }))
      setTouchedDefaults(true)
    }
  }, [settings, touchedDefaults])

  useEffect(() => {
    void call('templates:list').then((r) => r.ok && setTemplates(r.data))
    headlineRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!running) return
    const started = Date.now()
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 500)
    return () => clearInterval(t)
  }, [running])

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((f) => ({ ...f, [k]: v }))
  const toggleType = (id: ContentTypeId) =>
    setForm((f) => ({
      ...f,
      contentTypes: f.contentTypes.includes(id) ? f.contentTypes.filter((x) => x !== id) : [...f.contentTypes, id]
    }))
  const togglePlatform = (p: (typeof PLATFORMS)[number], on: boolean) =>
    setForm((f) => {
      const ids = contentTypesFor(p)
      return { ...f, contentTypes: on ? [...new Set([...f.contentTypes, ...ids])] : f.contentTypes.filter((x) => !ids.includes(x)) }
    })

  const hasLiveType = form.contentTypes.some((id) => CONTENT_TYPES[id].live)
  const canSubmit = form.headline.trim().length > 0 && form.contentTypes.length > 0 && !blocker && !running
  const orderedTypes = useMemo(
    () => (ids: ContentTypeId[]) => [...ids].sort((a, b) => Object.keys(CONTENT_TYPES).indexOf(a) - Object.keys(CONTENT_TYPES).indexOf(b)),
    []
  )

  async function generate() {
    if (!canSubmit) return
    setError(null)
    const requestId = newRequestId()
    setRunning(requestId)
    setElapsed(0)
    const input = { ...toInput(form), contentTypes: orderedTypes(form.contentTypes) }
    const r = await call('gen:run', { requestId, input })
    setRunning(null)
    if (r.ok) {
      toast('success', `Generated ${r.data.packages.length} packages`)
      navigate({ screen: 'results', draftId: r.data.id })
    } else if (r.error.code !== 'cancelled') {
      setError(r.error)
    } else {
      toast('info', 'Generation cancelled')
    }
  }

  async function cancel() {
    if (running) await call('gen:cancel', { requestId: running })
  }

  function applyTemplate(id: number) {
    const t = templates.find((x) => x.id === id)
    if (!t) return
    setForm((f) => ({
      ...f,
      language: t.preset.language,
      tone: t.preset.tone,
      emojiLevel: t.preset.emojiLevel,
      contentTypes: [...t.preset.contentTypes],
      maxRecommended: t.preset.hashtagPrefs.maxRecommended,
      includeExpanded: t.preset.hashtagPrefs.includeExpanded,
      extraTags: t.preset.hashtagPrefs.extraTags.join(' '),
      profileId: t.preset.profileId
    }))
    toast('info', `Template "${t.name}" applied`)
  }

  async function saveTemplate() {
    const i = toInput(form)
    const r = await call('templates:save', {
      name: tplName.trim(),
      preset: {
        language: form.language,
        tone: form.tone,
        emojiLevel: form.emojiLevel,
        contentTypes: form.contentTypes,
        hashtagPrefs: { maxRecommended: form.maxRecommended, includeExpanded: form.includeExpanded, extraTags: i.hashtagPrefs!.extraTags! },
        profileId: form.profileId
      }
    })
    if (r.ok) {
      setTemplates((t) => [...t.filter((x) => x.id !== r.data.id), r.data].sort((a, b) => a.name.localeCompare(b.name)))
      setSaveTplOpen(false)
      setTplName('')
      toast('success', 'Template saved')
    } else toast('error', r.error.message)
  }

  return (
    <div>
      <PageHeader
        title="Generate Content"
        subtitle="Only what you enter here is used. The app never adds names, dates, amounts or quotes that are not in your input."
        actions={
          <>
            <select
              className="input w-52"
              aria-label="Apply template"
              value=""
              onChange={(e) => e.target.value && applyTemplate(Number(e.target.value))}
            >
              <option value="">Apply template…</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <button className="btn-secondary" onClick={() => setSaveTplOpen(true)} disabled={!form.contentTypes.length}>
              Save as template
            </button>
          </>
        }
      />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-5">
          <section className="card space-y-4 p-5">
            <Field label="Headline *" htmlFor="headline">
              <textarea
                id="headline"
                ref={headlineRef}
                data-testid="headline"
                lang="ta"
                rows={2}
                className="input min-h-[3.5rem] text-base"
                placeholder="உதா: பள்ளியில் கட்டாய கட்டண வசூல் என பெற்றோர் புகார்"
                value={form.headline}
                onChange={(e) => set('headline', e.target.value)}
                maxLength={500}
              />
            </Field>

            <button className="btn-ghost btn-sm -ml-2" onClick={() => setShowContext((s) => !s)} aria-expanded={showContext}>
              {showContext ? '▾' : '▸'} Context, facts, allegations, transcript and source text (optional)
            </button>

            {showContext && (
              <div className="space-y-4">
                <Field label="Summary / context" hint="Short background in your own words.">
                  <textarea className="input min-h-[4rem]" lang="ta" value={form.summary} onChange={(e) => set('summary', e.target.value)} />
                </Field>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Confirmed facts" hint="Facts you have verified. These may be stated plainly.">
                    <textarea className="input min-h-[5rem]" lang="ta" value={form.confirmedFacts} onChange={(e) => set('confirmedFacts', e.target.value)} />
                  </Field>
                  <Field label="Allegations / claims" hint="Anything not confirmed. It will always be worded as an allegation or question.">
                    <textarea
                      className="input min-h-[5rem]"
                      lang="ta"
                      data-testid="allegations"
                      value={form.allegations}
                      onChange={(e) => set('allegations', e.target.value)}
                    />
                  </Field>
                </div>
                <Field label="Transcript" hint="Paste the video transcript if you have one.">
                  <textarea className="input min-h-[5rem]" lang="ta" value={form.transcript} onChange={(e) => set('transcript', e.target.value)} />
                </Field>
                <Field label="Source text" hint="Paste the article text here. This is the only way source material is used.">
                  <textarea className="input min-h-[5rem]" lang="ta" value={form.sourceText} onChange={(e) => set('sourceText', e.target.value)} />
                </Field>
                <Field
                  label="Source URL (reference only)"
                  hint="Links are stored for your reference only — the app does not open or read them. Paste the article text above to use it."
                >
                  <div className="flex items-center gap-2">
                    <input className="input" type="url" value={form.sourceUrl} onChange={(e) => set('sourceUrl', e.target.value)} placeholder="https://" />
                    {form.sourceUrl.trim() && (
                      <span className="shrink-0 rounded bg-slate-200 px-2 py-1 text-xs font-semibold text-slate-700" data-testid="url-not-read">
                        NOT READ
                      </span>
                    )}
                  </div>
                </Field>
              </div>
            )}
          </section>

          <section className="card space-y-3 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">What is confirmed?</h2>
            <p className="text-xs text-slate-500">
              Tick only what is true. Unticked words such as "official", "exclusive", "breaking" or "full speech" are flagged if the AI uses them.
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <Checkbox checked={form.flags.official} onChange={(v) => set('flags', { ...form.flags, official: v })} label="This is an official announcement" />
              <Checkbox checked={form.flags.exclusive} onChange={(v) => set('flags', { ...form.flags, exclusive: v })} label="This is our exclusive" />
              <Checkbox checked={form.flags.breaking} onChange={(v) => set('flags', { ...form.flags, breaking: v })} label="This is breaking news" />
              <Checkbox checked={form.flags.fullSpeech} onChange={(v) => set('flags', { ...form.flags, fullSpeech: v })} label="The video has the full speech" />
            </div>
          </section>

          <section className="card space-y-3 p-5">
            <Checkbox
              checked={form.liveEnabled}
              onChange={(v) => set('liveEnabled', v)}
              label={<span className="font-semibold">This is about a live event</span>}
              hint={hasLiveType && !form.liveEnabled ? 'You selected a live content type — add the event details so wording matches the live status.' : undefined}
              testId="live-toggle"
            />
            {form.liveEnabled && (
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Event name">
                  <input className="input" lang="ta" value={form.live.eventName} onChange={(e) => set('live', { ...form.live, eventName: e.target.value })} />
                </Field>
                <Field label="Live status">
                  <select
                    className="input"
                    data-testid="live-status"
                    value={form.live.status}
                    onChange={(e) => set('live', { ...form.live, status: e.target.value as LiveDetails['status'] })}
                  >
                    {LIVE_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s === 'upcoming' ? 'Upcoming (not live yet)' : s === 'live' ? 'Live now' : 'Ended (recording)'}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Date and time" hint="Written exactly as it should appear. Leave empty if not confirmed.">
                  <input className="input" lang="ta" value={form.live.dateTime} onChange={(e) => set('live', { ...form.live, dateTime: e.target.value })} />
                </Field>
                <Field label="Timezone">
                  <input className="input" value={form.live.timezone} onChange={(e) => set('live', { ...form.live, timezone: e.target.value })} />
                </Field>
                <Field label="Venue">
                  <input className="input" lang="ta" value={form.live.venue} onChange={(e) => set('live', { ...form.live, venue: e.target.value })} />
                </Field>
                <Field label="Speakers">
                  <input className="input" lang="ta" value={form.live.speakers} onChange={(e) => set('live', { ...form.live, speakers: e.target.value })} />
                </Field>
              </div>
            )}
          </section>
        </div>

        <div className="space-y-5">
          <section className="card space-y-3 p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Content types</h2>
              <span className="text-xs text-slate-500">{form.contentTypes.length} selected</span>
            </div>
            {PLATFORMS.map((p) => {
              const ids = contentTypesFor(p)
              const all = ids.every((id) => form.contentTypes.includes(id))
              return (
                <div key={p}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-sm font-semibold">{PLATFORM_LABELS[p]}</span>
                    <button className="btn-ghost btn-sm" onClick={() => togglePlatform(p, !all)} data-testid={`all-${p}`}>
                      {all ? 'Clear' : 'All'}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {ids.map((id) => {
                      const on = form.contentTypes.includes(id)
                      return (
                        <button
                          key={id}
                          data-testid={`type-${id}`}
                          aria-pressed={on}
                          onClick={() => toggleType(id)}
                          className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                            on ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white text-navy hover:border-brand'
                          }`}
                        >
                          {CONTENT_TYPES[id].label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </section>

          <section className="card space-y-3 p-5">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Language">
                <select className="input" value={form.language} onChange={(e) => set('language', e.target.value as Language)}>
                  {LANGUAGES.map((l) => (
                    <option key={l} value={l}>
                      {LANGUAGE_LABELS[l]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Tone">
                <select className="input" value={form.tone} onChange={(e) => set('tone', e.target.value as Tone)}>
                  {TONES.map((t) => (
                    <option key={t} value={t}>
                      {TONE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Emojis">
                <select className="input" value={form.emojiLevel} onChange={(e) => set('emojiLevel', e.target.value as EmojiLevel)}>
                  {EMOJI_LEVELS.map((l) => (
                    <option key={l} value={l}>
                      {EMOJI_LABELS[l]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Channel profile">
                <select
                  className="input"
                  value={form.profileId ?? ''}
                  onChange={(e) => set('profileId', e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Default</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.isDefault ? ' (default)' : ''}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Recommended hashtags" hint="Includes the channel hashtag.">
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={30}
                  value={form.maxRecommended}
                  onChange={(e) => set('maxRecommended', Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
                />
              </Field>
              <div className="pt-6">
                <Checkbox checked={form.includeExpanded} onChange={(v) => set('includeExpanded', v)} label="Also suggest more hashtags" />
              </div>
            </div>
            <Field label="Always add these hashtags" hint="Separated by spaces. The channel hashtag is added automatically.">
              <input className="input" lang="ta" value={form.extraTags} onChange={(e) => set('extraTags', e.target.value)} placeholder="#Chennai #TamilNadu" />
            </Field>
          </section>

          <section className="card space-y-3 p-5">
            {activeProvider?.provider === 'mock' && (
              <div className="flex items-center gap-2 text-xs text-amber-900">
                <MockBadge /> Results will be test fixtures, not AI writing.
              </div>
            )}
            {blocker && <InfoBanner tone="warn">{blocker}</InfoBanner>}
            {error && <ErrorBanner error={error} onClose={() => setError(null)} />}
            {running ? (
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <Spinner className="text-brand" />
                  Generating {form.contentTypes.length} packages… {elapsed}s
                </div>
                <button className="btn-danger" onClick={cancel} data-testid="cancel-generate">
                  Cancel
                </button>
              </div>
            ) : (
              <button className="btn-primary w-full py-2.5 text-base" disabled={!canSubmit} onClick={generate} data-testid="generate">
                Generate {form.contentTypes.length || ''} package{form.contentTypes.length === 1 ? '' : 's'}
              </button>
            )}
            {!form.headline.trim() && <p className="text-xs text-slate-500">Enter a headline to continue.</p>}
            {activeProvider && activeProvider.provider !== 'mock' && (
              <p className="text-xs text-slate-500" data-testid="active-model">
                Model: <span className="font-medium text-navy">{modelLabel(activeProvider.provider, activeProvider.model)}</span>{' '}
                <button className="text-brand underline" onClick={() => navigate({ screen: 'providers' })}>
                  Change
                </button>
                <br />
                Each generation uses API credit on your own {activeProvider.provider === 'openai' ? 'OpenAI' : 'Anthropic'} account.
              </p>
            )}
          </section>
        </div>
      </div>

      {saveTplOpen && (
        <Modal
          title="Save as template"
          onClose={() => setSaveTplOpen(false)}
          footer={
            <>
              <button className="btn-secondary" onClick={() => setSaveTplOpen(false)}>
                Cancel
              </button>
              <button className="btn-primary" disabled={!tplName.trim()} onClick={saveTemplate}>
                Save
              </button>
            </>
          }
        >
          <Field label="Template name" hint="Saves content types, language, tone, emojis, hashtag preferences and channel profile — not the headline.">
            <input className="input" autoFocus value={tplName} onChange={(e) => setTplName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && tplName.trim() && saveTemplate()} />
          </Field>
        </Modal>
      )}
    </div>
  )
}
