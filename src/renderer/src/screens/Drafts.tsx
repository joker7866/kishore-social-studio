import { useCallback, useEffect, useState } from 'react'
import type { DraftSummary } from '@shared/ipc-contract'
import { CONTENT_TYPES, PLATFORM_LABELS, PLATFORMS, type Platform } from '@shared/platform-types'
import { EmptyState, MockBadge, Modal, PageHeader, Spinner } from '../components/ui'
import { call, formatDate } from '../lib/api'
import { useApp } from '../state/app-state'

export function Drafts() {
  const { navigate, toast } = useApp()
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null)
  const [search, setSearch] = useState('')
  const [platform, setPlatform] = useState<Platform | ''>('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [renaming, setRenaming] = useState<DraftSummary | null>(null)
  const [newTitle, setNewTitle] = useState('')

  const load = useCallback(async () => {
    const r = await call('drafts:list', {
      search: search || undefined,
      platform: platform || undefined,
      from: from ? new Date(from + 'T00:00:00').toISOString() : undefined,
      to: to ? new Date(to + 'T23:59:59.999').toISOString() : undefined
    })
    setDrafts(r.ok ? r.data : [])
  }, [search, platform, from, to])

  useEffect(() => {
    const t = setTimeout(load, 200)
    return () => clearTimeout(t)
  }, [load])

  async function remove(d: DraftSummary) {
    const r = await call('drafts:delete', { id: d.id })
    if (!r.ok) return toast('error', r.error.message)
    await load()
    toast('info', `Deleted "${d.title}"`, {
      label: 'Undo',
      run: async () => {
        await call('drafts:restore', { id: d.id })
        await load()
      }
    })
  }

  async function duplicate(d: DraftSummary) {
    const r = await call('drafts:duplicate', { id: d.id })
    if (r.ok) {
      toast('success', 'Draft duplicated')
      await load()
    } else toast('error', r.error.message)
  }

  async function rename() {
    if (!renaming || !newTitle.trim()) return
    const r = await call('drafts:rename', { id: renaming.id, title: newTitle.trim() })
    if (r.ok) {
      setRenaming(null)
      await load()
    } else toast('error', r.error.message)
  }

  const filtersOn = !!(search || platform || from || to)

  return (
    <div>
      <PageHeader
        title="Saved Drafts"
        subtitle="Every generation is saved automatically. Deleted drafts can be restored for 30 days via Undo."
        actions={
          <button className="btn-primary" onClick={() => navigate({ screen: 'generate' })}>
            New generation
          </button>
        }
      />
      <div className="card mb-4 grid gap-3 p-4 md:grid-cols-[1fr_180px_160px_160px_auto]">
        <input className="input" placeholder="Search title or headline" lang="ta" value={search} onChange={(e) => setSearch(e.target.value)} data-testid="draft-search" />
        <select className="input" value={platform} onChange={(e) => setPlatform(e.target.value as Platform | '')} aria-label="Platform">
          <option value="">All platforms</option>
          {PLATFORMS.map((p) => (
            <option key={p} value={p}>
              {PLATFORM_LABELS[p]}
            </option>
          ))}
        </select>
        <input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        <input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        <button
          className="btn-ghost"
          disabled={!filtersOn}
          onClick={() => {
            setSearch('')
            setPlatform('')
            setFrom('')
            setTo('')
          }}
        >
          Clear
        </button>
      </div>

      {drafts === null ? (
        <Spinner className="text-brand" />
      ) : drafts.length === 0 ? (
        <EmptyState
          title={filtersOn ? 'No drafts match these filters' : 'No drafts yet'}
          text={filtersOn ? 'Try a different search or clear the filters.' : 'Generate packages from a headline and they will appear here.'}
        />
      ) : (
        <div className="card divide-y divide-slate-200" data-testid="draft-list">
          {drafts.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <button className="min-w-0 flex-1 text-left" onClick={() => navigate({ screen: 'results', draftId: d.id })}>
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold" lang="ta">
                    {d.title}
                  </span>
                  {d.providers.includes('mock') && <MockBadge />}
                </div>
                <div className="mt-0.5 truncate text-xs text-slate-500">
                  {d.contentTypes.map((c) => `${PLATFORM_LABELS[CONTENT_TYPES[c].platform]} ${CONTENT_TYPES[c].label}`).join(' · ')}
                </div>
              </button>
              <span className="text-xs text-slate-500">{formatDate(d.updatedAt)}</span>
              <div className="flex gap-1">
                <button className="btn-secondary btn-sm" onClick={() => navigate({ screen: 'results', draftId: d.id })}>
                  Open
                </button>
                <button
                  className="btn-ghost btn-sm"
                  onClick={() => {
                    setRenaming(d)
                    setNewTitle(d.title)
                  }}
                >
                  Rename
                </button>
                <button className="btn-ghost btn-sm" onClick={() => duplicate(d)}>
                  Duplicate
                </button>
                <button className="btn-ghost btn-sm text-red-700" onClick={() => remove(d)} data-testid={`delete-${d.id}`}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {renaming && (
        <Modal
          title="Rename draft"
          onClose={() => setRenaming(null)}
          footer={
            <>
              <button className="btn-secondary" onClick={() => setRenaming(null)}>
                Cancel
              </button>
              <button className="btn-primary" disabled={!newTitle.trim()} onClick={rename}>
                Save
              </button>
            </>
          }
        >
          <input className="input" autoFocus lang="ta" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && rename()} />
        </Modal>
      )}
    </div>
  )
}
