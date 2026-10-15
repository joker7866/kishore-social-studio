import { useEffect, useState } from 'react'
import type { Template } from '@shared/ipc-contract'
import { CONTENT_TYPES, LANGUAGE_LABELS, PLATFORM_LABELS, TONE_LABELS } from '@shared/platform-types'
import { EmptyState, Modal, PageHeader, Spinner } from '../components/ui'
import { call } from '../lib/api'
import { useApp } from '../state/app-state'

export function Templates() {
  const { navigate, toast, profiles } = useApp()
  const [templates, setTemplates] = useState<Template[] | null>(null)
  const [renaming, setRenaming] = useState<Template | null>(null)
  const [name, setName] = useState('')

  const load = async () => {
    const r = await call('templates:list')
    setTemplates(r.ok ? r.data : [])
  }
  useEffect(() => {
    void load()
  }, [])

  async function remove(t: Template) {
    const r = await call('templates:delete', { id: t.id })
    if (r.ok) {
      toast('info', `Template "${t.name}" deleted`, {
        label: 'Undo',
        run: async () => {
          await call('templates:save', { name: t.name, preset: t.preset })
          await load()
        }
      })
      await load()
    } else toast('error', r.error.message)
  }

  async function rename() {
    if (!renaming || !name.trim()) return
    const r = await call('templates:save', { id: renaming.id, name: name.trim(), preset: renaming.preset })
    if (r.ok) {
      setRenaming(null)
      await load()
    } else toast('error', r.error.message)
  }

  return (
    <div>
      <PageHeader
        title="Templates"
        subtitle="Reusable generation presets: content types, language, tone, emojis, hashtags and channel profile. Create one from the Generate screen."
        actions={
          <button className="btn-primary" onClick={() => navigate({ screen: 'generate' })}>
            Create on Generate screen
          </button>
        }
      />
      {templates === null ? (
        <Spinner />
      ) : templates.length === 0 ? (
        <EmptyState title="No templates yet" text='Set up the Generate screen the way you like it and click "Save as template".' />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {templates.map((t) => {
            const profile = profiles.find((p) => p.id === t.preset.profileId)
            return (
              <div key={t.id} className="card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold">{t.name}</div>
                  <div className="flex gap-1">
                    <button
                      className="btn-primary btn-sm"
                      onClick={() =>
                        navigate({
                          screen: 'generate',
                          prefill: {
                            headline: '',
                            contentTypes: t.preset.contentTypes,
                            language: t.preset.language,
                            tone: t.preset.tone,
                            emojiLevel: t.preset.emojiLevel,
                            hashtagPrefs: t.preset.hashtagPrefs,
                            profileId: t.preset.profileId
                          }
                        })
                      }
                    >
                      Use
                    </button>
                    <button
                      className="btn-ghost btn-sm"
                      onClick={() => {
                        setRenaming(t)
                        setName(t.name)
                      }}
                    >
                      Rename
                    </button>
                    <button className="btn-ghost btn-sm text-red-700" onClick={() => remove(t)}>
                      Delete
                    </button>
                  </div>
                </div>
                <dl className="mt-2 grid grid-cols-[110px_1fr] gap-y-1 text-xs text-slate-600">
                  <dt>Language</dt>
                  <dd>{LANGUAGE_LABELS[t.preset.language]}</dd>
                  <dt>Tone</dt>
                  <dd>{TONE_LABELS[t.preset.tone]}</dd>
                  <dt>Emojis</dt>
                  <dd>{t.preset.emojiLevel}</dd>
                  <dt>Content types</dt>
                  <dd>{t.preset.contentTypes.map((c) => `${PLATFORM_LABELS[CONTENT_TYPES[c].platform]} ${CONTENT_TYPES[c].label}`).join(', ')}</dd>
                  <dt>Hashtags</dt>
                  <dd>
                    up to {t.preset.hashtagPrefs.maxRecommended}
                    {t.preset.hashtagPrefs.extraTags.length ? ` · always ${t.preset.hashtagPrefs.extraTags.join(' ')}` : ''}
                  </dd>
                  <dt>Channel profile</dt>
                  <dd>{profile?.name ?? 'Default'}</dd>
                </dl>
              </div>
            )
          })}
        </div>
      )}
      {renaming && (
        <Modal
          title="Rename template"
          onClose={() => setRenaming(null)}
          footer={
            <>
              <button className="btn-secondary" onClick={() => setRenaming(null)}>
                Cancel
              </button>
              <button className="btn-primary" disabled={!name.trim()} onClick={rename}>
                Save
              </button>
            </>
          }
        >
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && rename()} />
        </Modal>
      )}
    </div>
  )
}
