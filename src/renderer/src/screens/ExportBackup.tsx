import { useEffect, useState } from 'react'
import type { DraftSummary, ImportPreview } from '@shared/ipc-contract'
import { EmptyState, ErrorBanner, InfoBanner, Modal, PageHeader, Spinner } from '../components/ui'
import { call, formatDate } from '../lib/api'
import { useApp } from '../state/app-state'

export function ExportBackup() {
  const { toast, refreshProfiles } = useApp()
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const r = await call('drafts:list', {})
    setDrafts(r.ok ? r.data : [])
  }
  useEffect(() => {
    void load()
  }, [])

  const toggle = (id: number) =>
    setPicked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  async function exportCsv() {
    const r = await call('export:csv', { draftIds: [...picked] })
    if (r.ok && r.data.saved) toast('success', `CSV saved to ${r.data.path}`)
    else if (!r.ok) toast('error', r.error.message)
  }

  async function backup() {
    const r = await call('backup:create')
    if (r.ok && r.data.saved) toast('success', `Backup saved to ${r.data.path}`)
    else if (!r.ok) toast('error', r.error.message)
  }

  async function chooseImport() {
    setImportError(null)
    const r = await call('backup:importPreview')
    if (!r.ok) setImportError(r.error.message)
    else if (r.data) setPreview(r.data)
  }

  async function applyImport() {
    if (!preview) return
    setBusy(true)
    const r = await call('backup:importApply', { token: preview.token })
    setBusy(false)
    setPreview(null)
    if (r.ok) {
      toast('success', `Imported ${r.data.drafts} drafts, ${r.data.profiles} new profiles, ${r.data.templates} new templates`)
      await Promise.all([load(), refreshProfiles()])
    } else setImportError(r.error.message)
  }

  return (
    <div>
      <PageHeader title="Export & Backup" subtitle="Single drafts can be exported from the Results screen as TXT, JSON, printable HTML or PDF." />
      <div className="mb-5">
        <InfoBanner>API keys are never included in exports or backups.</InfoBanner>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="mb-1 text-lg font-semibold">Full backup</h2>
          <p className="mb-4 text-sm text-slate-600">Saves all drafts, edits, edit history, channel profiles and templates to one JSON file.</p>
          <button className="btn-primary" onClick={backup} data-testid="backup">
            Create backup…
          </button>
        </section>

        <section className="card p-5">
          <h2 className="mb-1 text-lg font-semibold">Import backup</h2>
          <p className="mb-4 text-sm text-slate-600">
            You will see what the file contains before anything is imported. Importing adds drafts — it never deletes or overwrites existing ones.
          </p>
          <button className="btn-secondary" onClick={chooseImport} data-testid="import">
            Choose backup file…
          </button>
          {importError && (
            <div className="mt-3">
              <ErrorBanner error={importError} onClose={() => setImportError(null)} />
            </div>
          )}
        </section>
      </div>

      <section className="card mt-5 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">CSV export (several drafts)</h2>
            <p className="text-sm text-slate-600">One row per field. Opens in Excel with Tamil text intact; formula-like cells are made safe.</p>
          </div>
          <div className="flex gap-2">
            <button
              className="btn-ghost"
              disabled={!drafts?.length}
              onClick={() => setPicked(picked.size === drafts?.length ? new Set() : new Set(drafts?.map((d) => d.id)))}
            >
              {picked.size === drafts?.length && drafts?.length ? 'Select none' : 'Select all'}
            </button>
            <button className="btn-primary" disabled={!picked.size} onClick={exportCsv} data-testid="export-csv">
              Export {picked.size || ''} to CSV…
            </button>
          </div>
        </div>
        {drafts === null ? (
          <Spinner />
        ) : drafts.length === 0 ? (
          <EmptyState title="No drafts to export" />
        ) : (
          <div className="max-h-[420px] divide-y divide-slate-100 overflow-auto rounded-md border border-slate-200">
            {drafts.map((d) => (
              <label key={d.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-brand-50">
                <input type="checkbox" className="h-4 w-4 accent-brand" checked={picked.has(d.id)} onChange={() => toggle(d.id)} />
                <span className="flex-1 truncate" lang="ta">
                  {d.title}
                </span>
                <span className="text-xs text-slate-500">{formatDate(d.updatedAt)}</span>
              </label>
            ))}
          </div>
        )}
      </section>

      {preview && (
        <Modal
          title="Import this backup?"
          onClose={() => setPreview(null)}
          footer={
            <>
              <button className="btn-secondary" onClick={() => setPreview(null)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={applyImport} disabled={busy} data-testid="confirm-import">
                Import
              </button>
            </>
          }
        >
          <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-sm">
            <dt className="text-slate-500">File</dt>
            <dd>{preview.fileName}</dd>
            <dt className="text-slate-500">Made by version</dt>
            <dd>{preview.appVersion}</dd>
            <dt className="text-slate-500">Created</dt>
            <dd>{formatDate(preview.exportedAt)}</dd>
            <dt className="text-slate-500">Drafts</dt>
            <dd>
              {preview.counts.drafts} ({preview.counts.packages} packages)
            </dd>
            <dt className="text-slate-500">Channel profiles</dt>
            <dd>{preview.counts.profiles} (profiles with the same name are reused)</dd>
            <dt className="text-slate-500">Templates</dt>
            <dd>{preview.counts.templates}</dd>
          </dl>
          {preview.draftTitles.length > 0 && (
            <div className="mt-3">
              <div className="label">Drafts in this file</div>
              <ul className="max-h-40 list-disc overflow-auto pl-5 text-sm" lang="ta">
                {preview.draftTitles.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
                {preview.counts.drafts > preview.draftTitles.length && <li>…and {preview.counts.drafts - preview.draftTitles.length} more</li>}
              </ul>
            </div>
          )}
        </Modal>
      )}
    </div>
  )
}
