import { useEffect, useState } from 'react'
import type { ChannelProfile } from '@shared/guards/branding'
import type { ProfileInput } from '@shared/ipc-contract'
import { LANGUAGE_LABELS, LANGUAGES, TONE_LABELS, TONES, type Language, type Tone } from '@shared/platform-types'
import { Field, Modal, PageHeader } from '../components/ui'
import { call } from '../lib/api'
import { useApp } from '../state/app-state'

const EMPTY: ProfileInput = {
  name: '',
  youtubeHandle: '',
  facebookPage: '',
  instagramHandle: '',
  youtubeHashtag: '#',
  facebookHashtag: '#',
  instagramHashtag: '#'
}

export function ChannelSettings() {
  const { profiles, refreshProfiles, settings, refreshSettings, toast } = useApp()
  const [editing, setEditing] = useState<ProfileInput | null>(null)
  const [hype, setHype] = useState('')
  const [tz, setTz] = useState('')

  useEffect(() => {
    if (settings) {
      setHype(settings.hypePhrases.join('\n'))
      setTz(settings.timezone)
    }
  }, [settings])

  async function saveProfile() {
    if (!editing) return
    const r = await call('profiles:save', editing)
    if (r.ok) {
      toast('success', 'Channel profile saved')
      setEditing(null)
      await refreshProfiles()
    } else toast('error', r.error.message)
  }

  async function remove(p: ChannelProfile) {
    const r = await call('profiles:delete', { id: p.id })
    if (r.ok) {
      toast('info', `Profile "${p.name}" deleted`)
      await refreshProfiles()
    } else toast('error', r.error.message)
  }

  async function makeDefault(p: ChannelProfile) {
    const r = await call('profiles:setDefault', { id: p.id })
    if (r.ok) await refreshProfiles()
  }

  async function saveSetting<K extends 'hypePhrases' | 'timezone' | 'defaultLanguage' | 'defaultTone'>(key: K, value: unknown) {
    const r = await call('settings:set', { key, value })
    if (r.ok) {
      await refreshSettings()
      toast('success', 'Saved')
    } else toast('error', r.error.message)
  }

  return (
    <div>
      <PageHeader
        title="Channel Settings"
        subtitle="Channel names and the mandatory hashtag added to every package for each platform."
        actions={
          <button className="btn-primary" onClick={() => setEditing({ ...EMPTY })}>
            Add channel profile
          </button>
        }
      />

      <div className="grid gap-3 lg:grid-cols-2">
        {profiles.map((p) => (
          <div key={p.id} className="card p-4" data-testid="profile-card">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 font-semibold">
                {p.name}
                {p.isDefault && <span className="rounded bg-brand-50 px-2 py-0.5 text-xs text-brand">Default</span>}
              </div>
              <div className="flex gap-1">
                {!p.isDefault && (
                  <button className="btn-ghost btn-sm" onClick={() => makeDefault(p)}>
                    Make default
                  </button>
                )}
                <button
                  className="btn-secondary btn-sm"
                  onClick={() =>
                    setEditing({
                      id: p.id,
                      name: p.name,
                      youtubeHandle: p.youtubeHandle,
                      facebookPage: p.facebookPage,
                      instagramHandle: p.instagramHandle,
                      youtubeHashtag: p.youtubeHashtag,
                      facebookHashtag: p.facebookHashtag,
                      instagramHashtag: p.instagramHashtag
                    })
                  }
                >
                  Edit
                </button>
                {profiles.length > 1 && (
                  <button className="btn-ghost btn-sm text-red-700" onClick={() => remove(p)}>
                    Delete
                  </button>
                )}
              </div>
            </div>
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-1 font-semibold">Platform</th>
                  <th className="py-1 font-semibold">Account</th>
                  <th className="py-1 font-semibold">Mandatory hashtag</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="py-1">YouTube</td>
                  <td>{p.youtubeHandle}</td>
                  <td className="font-medium text-brand">{p.youtubeHashtag}</td>
                </tr>
                <tr>
                  <td className="py-1">Facebook</td>
                  <td>{p.facebookPage}</td>
                  <td className="font-medium text-brand">{p.facebookHashtag}</td>
                </tr>
                <tr>
                  <td className="py-1">Instagram</td>
                  <td>{p.instagramHandle}</td>
                  <td className="font-medium text-brand">{p.instagramHashtag}</td>
                </tr>
              </tbody>
            </table>
          </div>
        ))}
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">Defaults</h2>
      <div className="card grid gap-4 p-5 md:grid-cols-3">
        <Field label="Default language">
          <select className="input" value={settings?.defaultLanguage ?? 'ta'} onChange={(e) => saveSetting('defaultLanguage', e.target.value as Language)}>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_LABELS[l]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Default tone">
          <select className="input" value={settings?.defaultTone ?? 'neutral'} onChange={(e) => saveSetting('defaultTone', e.target.value as Tone)}>
            {TONES.map((t) => (
              <option key={t} value={t}>
                {TONE_LABELS[t]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Timezone for live events" hint="IANA name, e.g. Asia/Kolkata">
          <input className="input" value={tz} onChange={(e) => setTz(e.target.value)} onBlur={() => tz.trim() && tz !== settings?.timezone && saveSetting('timezone', tz.trim())} />
        </Field>
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">Accuracy check — hype phrases</h2>
      <div className="card space-y-3 p-5">
        <p className="text-sm text-slate-600">
          Phrases flagged when they appear in output but not in your input (one per line, Tamil or English). Names, numbers, dates, quotes and words like
          "official", "breaking", "exclusive", "LIVE" are always checked.
        </p>
        <textarea className="input min-h-[10rem] font-mono text-xs" lang="ta" value={hype} onChange={(e) => setHype(e.target.value)} />
        <div className="flex justify-end">
          <button
            className="btn-primary"
            onClick={() =>
              saveSetting(
                'hypePhrases',
                [...new Set(hype.split('\n').map((s) => s.trim()).filter(Boolean))]
              )
            }
          >
            Save phrases
          </button>
        </div>
      </div>

      {editing && (
        <Modal
          title={editing.id ? 'Edit channel profile' : 'New channel profile'}
          wide
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn-secondary" onClick={() => setEditing(null)}>
                Cancel
              </button>
              <button className="btn-primary" disabled={!editing.name.trim()} onClick={saveProfile} data-testid="save-profile">
                Save
              </button>
            </>
          }
        >
          <div className="space-y-4">
            <Field label="Profile name">
              <input className="input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            {(
              [
                ['YouTube', 'youtubeHandle', 'youtubeHashtag'],
                ['Facebook', 'facebookPage', 'facebookHashtag'],
                ['Instagram', 'instagramHandle', 'instagramHashtag']
              ] as const
            ).map(([label, acc, tag]) => (
              <div key={label} className="grid gap-3 md:grid-cols-2">
                <Field label={`${label} account`}>
                  <input className="input" value={editing[acc]} onChange={(e) => setEditing({ ...editing, [acc]: e.target.value })} />
                </Field>
                <Field label={`${label} mandatory hashtag`}>
                  <input className="input" value={editing[tag]} onChange={(e) => setEditing({ ...editing, [tag]: e.target.value })} />
                </Field>
              </div>
            ))}
            <p className="text-xs text-slate-500">Changes apply to new generations and regenerations. Existing drafts show a warning if their hashtag no longer matches.</p>
          </div>
        </Modal>
      )}
    </div>
  )
}
