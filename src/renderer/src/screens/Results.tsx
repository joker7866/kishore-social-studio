import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ContentPackage } from '@shared/content-schema'
import { hashtagLine, publishableText, recommendedTitle } from '@shared/format'
import type { AccuracyWarning } from '@shared/guards/accuracy'
import type { AppError, DraftDetail, FieldProposal, PackageRecord } from '@shared/ipc-contract'
import { charCount, countInlineHashtags, hardViolations, type LimitRule, type PlatformRules } from '@shared/limits'
import {
  CONTENT_TYPES,
  FIELD_LABELS,
  PLATFORM_LABELS,
  PLATFORMS,
  QUICK_ACTION_LABELS,
  QUICK_ACTIONS,
  type FieldKey,
  type Platform,
  type QuickAction
} from '@shared/platform-types'
import { DiffView, EmptyState, ErrorBanner, MockBadge, Modal, PageHeader, ProviderBadge, Spinner } from '../components/ui'
import { call, copyText, formatDate, newRequestId } from '../lib/api'
import { useApp } from '../state/app-state'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function warningsAt(warnings: AccuracyWarning[], path: string): AccuracyWarning[] {
  return warnings.filter((w) => w.path === path || w.path.startsWith(path + '.'))
}

function ruleFor(rules: PlatformRules | undefined, pkg: ContentPackage, field: string): LimitRule | undefined {
  return rules?.limits?.[pkg.contentType]?.[field]
}

function Counter({ count, rule }: { count: number; rule?: LimitRule }) {
  if (!rule) return <span className="text-[11px] text-slate-400">{count}</span>
  const over = count > rule.max
  const cls = over ? (rule.kind === 'hard' ? 'font-semibold text-red-700' : 'font-semibold text-amber-700') : 'text-slate-500'
  return (
    <span className={`text-[11px] ${cls}`} title={rule.kind === 'hard' ? 'Platform limit' : 'Recommended length'}>
      {count}/{rule.max}
      {over && (rule.kind === 'hard' ? ' · over platform limit' : ' · longer than recommended')}
    </span>
  )
}

function WarningList({ warnings }: { warnings: AccuracyWarning[] }) {
  if (!warnings.length) return null
  return (
    <ul className="mt-1 space-y-0.5">
      {warnings.map((w, i) => (
        <li key={i} className={`text-xs ${w.severity === 'warning' ? 'text-amber-800' : 'text-slate-600'}`} data-testid="field-warning">
          ⚠ {w.message}
        </li>
      ))}
    </ul>
  )
}

interface FieldActions {
  busyPath: string | null
  onSave(path: string, value: unknown): Promise<void>
  onRegenerate(path: string, action?: QuickAction): void
}

function RegenMenu({ path, actions, disabled }: { path: string; actions: FieldActions; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const busy = actions.busyPath === path
  return (
    <div className="relative">
      <button
        className="btn-ghost btn-sm"
        disabled={disabled || !!actions.busyPath}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={`regen-${path}`}
      >
        {busy ? <Spinner className="h-3 w-3" /> : '↻'} Regenerate
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-48 rounded-md border border-slate-200 bg-white py-1 shadow-lg" role="menu" onMouseLeave={() => setOpen(false)}>
          <button
            role="menuitem"
            className="block w-full px-3 py-1.5 text-left text-sm hover:bg-brand-50"
            onClick={() => {
              setOpen(false)
              actions.onRegenerate(path)
            }}
          >
            New wording
          </button>
          {QUICK_ACTIONS.map((a) => (
            <button
              key={a}
              role="menuitem"
              className="block w-full px-3 py-1.5 text-left text-sm hover:bg-brand-50"
              onClick={() => {
                setOpen(false)
                actions.onRegenerate(path, a)
              }}
            >
              {QUICK_ACTION_LABELS[a]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** A text field that saves on blur. `toValue`/`fromValue` convert lists to text. */
function TextField({
  path,
  label,
  value,
  rule,
  warnings,
  actions,
  multiline = true,
  regenerable = true,
  toValue = (s: string) => s as unknown,
  countValue,
  copyable = true
}: {
  path: string
  label: string
  value: string
  rule?: LimitRule
  warnings: AccuracyWarning[]
  actions: FieldActions
  multiline?: boolean
  regenerable?: boolean
  toValue?: (s: string) => unknown
  countValue?: (s: string) => number
  copyable?: boolean
}) {
  const { toast } = useApp()
  const [local, setLocal] = useState(value)
  useEffect(() => setLocal(value), [value])
  const dirty = local !== value
  const commit = async () => {
    if (!dirty) return
    if (!local.trim()) {
      toast('error', `${label} cannot be empty — use Undo or Regenerate instead.`)
      setLocal(value)
      return
    }
    await actions.onSave(path, toValue(local))
  }
  const count = countValue ? countValue(local) : charCount(local)
  return (
    <div className="group" data-field={path}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <label className="label mb-0" htmlFor={`f-${path}`}>
          {label}
        </label>
        <div className="flex items-center gap-1 opacity-80 group-focus-within:opacity-100 group-hover:opacity-100">
          <Counter count={count} rule={rule} />
          {copyable && (
            <button
              className="btn-ghost btn-sm"
              onClick={async () => (await copyText(local)) && toast('success', `${label} copied`)}
              data-testid={`copy-${path}`}
            >
              Copy
            </button>
          )}
          {regenerable && <RegenMenu path={path} actions={actions} />}
        </div>
      </div>
      {multiline ? (
        <textarea
          id={`f-${path}`}
          data-testid={`field-${path}`}
          lang="ta"
          className={`input min-h-[2.75rem] ${warnings.some((w) => w.severity === 'warning') ? 'border-amber-400' : ''}`}
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={commit}
        />
      ) : (
        <input
          id={`f-${path}`}
          data-testid={`field-${path}`}
          lang="ta"
          className={`input ${warnings.some((w) => w.severity === 'warning') ? 'border-amber-400' : ''}`}
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      )}
      {dirty && <div className="mt-0.5 text-[11px] text-slate-500">Unsaved — click outside the box to save.</div>}
      <WarningList warnings={warnings} />
    </div>
  )
}

function OptionsField({
  field,
  pkg,
  rules,
  warnings,
  actions
}: {
  field: 'titleOptions' | 'hookOptions'
  pkg: ContentPackage
  rules?: PlatformRules
  warnings: AccuracyWarning[]
  actions: FieldActions
}) {
  const list = pkg[field] ?? []
  const rec = pkg.recommendedIndex ?? 0
  return (
    <fieldset className="rounded-md border border-slate-200 p-3">
      <legend className="label px-1">{FIELD_LABELS[field]} — pick the one to use</legend>
      <div className="space-y-3">
        {list.map((opt, i) => (
          <div key={i} className="flex items-start gap-2">
            <input
              type="radio"
              name={`${pkg.contentType}-${field}`}
              className="mt-9 h-4 w-4 accent-brand"
              checked={rec === i}
              onChange={() => actions.onSave('recommendedIndex', i)}
              aria-label={`Use option ${i + 1}`}
              data-testid={`pick-${field}-${i}`}
            />
            <div className="flex-1">
              <TextField
                path={`${field}.${i}`}
                label={`Option ${i + 1}${rec === i ? ' · selected' : ''}`}
                value={opt}
                rule={ruleFor(rules, pkg, field)}
                warnings={warningsAt(warnings, `${field}.${i}`)}
                actions={actions}
              />
            </div>
          </div>
        ))}
      </div>
    </fieldset>
  )
}

// ---------------------------------------------------------------------------
// Package editor
// ---------------------------------------------------------------------------

function PackageEditor({ record, rules, actions }: { record: PackageRecord; rules?: PlatformRules; actions: FieldActions }) {
  const pkg = record.current
  const spec = CONTENT_TYPES[pkg.contentType]
  const fields = [...spec.required, ...spec.optional]
  const w = record.warnings
  const order: FieldKey[] = [
    'titleOptions', 'hookOptions', 'hook', 'hook3s', 'postText', 'description', 'caption', 'thumbnailText', 'overlayText',
    'slideTexts', 'poll', 'pinnedComment', 'cta', 'interactionPrompt', 'keywords', 'hashtags'
  ]
  return (
    <div className="space-y-4">
      {order
        .filter((f) => fields.includes(f))
        .map((f) => {
          if (f === 'titleOptions' || f === 'hookOptions') {
            return <OptionsField key={f} field={f} pkg={pkg} rules={rules} warnings={w} actions={actions} />
          }
          if (f === 'hashtags') {
            if (!pkg.hashtags) return null
            const rule = ruleFor(rules, pkg, 'hashtags')
            return (
              <div key={f} className="space-y-3">
                <TextField
                  path="hashtags.recommended"
                  label="Hashtags (recommended)"
                  value={pkg.hashtags.recommended.join(' ')}
                  rule={rule}
                  warnings={warningsAt(w, 'hashtags.recommended')}
                  actions={actions}
                  multiline={false}
                  toValue={(s) => s.split(/\s+/).filter(Boolean)}
                  countValue={(s) =>
                    s.split(/\s+/).filter(Boolean).length + (rule?.unit === 'hashtagsTotal' ? countInlineHashtags(pkg.caption ?? '') : 0)
                  }
                />
                {
                  <TextField
                    path="hashtags.expanded"
                    label="More hashtags (optional)"
                    value={pkg.hashtags.expanded.join(' ')}
                    warnings={warningsAt(w, 'hashtags.expanded')}
                    actions={actions}
                    multiline={false}
                    regenerable={false}
                    toValue={(s) => s.split(/\s+/).filter(Boolean)}
                    countValue={(s) => s.split(/\s+/).filter(Boolean).length}
                  />
                }
              </div>
            )
          }
          if (f === 'keywords' || f === 'slideTexts') {
            const list = pkg[f]
            if (!list) return <MissingOptional key={f} field={f} actions={actions} />
            const sep = f === 'keywords' ? ', ' : '\n'
            return (
              <TextField
                key={f}
                path={f}
                label={FIELD_LABELS[f] + (f === 'slideTexts' ? ' (one per line)' : ' (comma separated)')}
                value={list.join(sep)}
                rule={ruleFor(rules, pkg, f)}
                warnings={warningsAt(w, f)}
                actions={actions}
                multiline={f === 'slideTexts'}
                toValue={(s) => s.split(f === 'keywords' ? /\s*,\s*/ : /\n+/).map((x) => x.trim()).filter(Boolean)}
                countValue={f === 'keywords' ? (s) => charCount(s.split(/\s*,\s*/).filter(Boolean).join(',')) : undefined}
              />
            )
          }
          if (f === 'poll') {
            if (!pkg.poll) return <MissingOptional key={f} field={f} actions={actions} />
            return (
              <div key={f} className="grid gap-3 rounded-md border border-slate-200 p-3 md:grid-cols-2">
                <TextField path="poll.question" label="Poll question" value={pkg.poll.question} warnings={warningsAt(w, 'poll.question')} actions={actions} regenerable={false} />
                <TextField
                  path="poll.choices"
                  label="Poll choices (one per line)"
                  value={pkg.poll.choices.join('\n')}
                  warnings={warningsAt(w, 'poll.choices')}
                  actions={actions}
                  regenerable={false}
                  toValue={(s) => s.split(/\n+/).map((x) => x.trim()).filter(Boolean)}
                />
                <div className="md:col-span-2">
                  <RegenMenu path="poll" actions={actions} />
                </div>
              </div>
            )
          }
          const value = pkg[f] as string | undefined
          if (value === undefined) return <MissingOptional key={f} field={f} actions={actions} />
          return (
            <TextField
              key={f}
              path={f}
              label={FIELD_LABELS[f]}
              value={value}
              rule={ruleFor(rules, pkg, f)}
              warnings={warningsAt(w, f)}
              actions={actions}
              multiline={!['thumbnailText', 'overlayText', 'cta', 'hook3s'].includes(f) || value.length > 60}
            />
          )
        })}
    </div>
  )
}

function MissingOptional({ field, actions }: { field: FieldKey; actions: FieldActions }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500">
      <span>{FIELD_LABELS[field]} (optional) — not generated</span>
      <button className="btn-ghost btn-sm" disabled={!!actions.busyPath} onClick={() => actions.onRegenerate(field)}>
        Generate
      </button>
    </div>
  )
}

function SidePanel({ record, onFocusField }: { record: PackageRecord; onFocusField: (path: string) => void }) {
  const pkg = record.current
  const warnings = record.warnings.filter((w) => w.severity === 'warning')
  const infos = record.warnings.filter((w) => w.severity === 'info')
  return (
    <aside className="space-y-4 lg:sticky lg:top-0 lg:max-h-[calc(100vh-7rem)] lg:overflow-auto">
      <section className="card p-4" data-testid="accuracy-panel">
        <h3 className="mb-2 flex items-center justify-between text-sm font-semibold">
          Accuracy check
          <span className={`rounded px-2 py-0.5 text-xs ${warnings.length ? 'bg-amber-100 text-amber-900' : 'bg-green-100 text-green-800'}`}>
            {warnings.length ? `${warnings.length} to review` : 'No issues found'}
          </span>
        </h3>
        {warnings.length === 0 && infos.length === 0 && (
          <p className="text-xs text-slate-600">No new numbers, dates, quotes, unsupported claims or hype were found compared with your input. Still read before posting.</p>
        )}
        <ul className="space-y-2">
          {[...warnings, ...infos].map((w, i) => (
            <li key={i}>
              <button
                className={`w-full rounded-md border px-2 py-1.5 text-left text-xs ${
                  w.severity === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-50 text-slate-700'
                }`}
                onClick={() => onFocusField(w.path)}
              >
                <span className="font-semibold">{w.path}</span> — {w.message}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="card p-4">
        <h3 className="mb-2 text-sm font-semibold">Missing information</h3>
        {pkg.missingInfoNotes.length ? (
          <ul className="list-disc space-y-1 pl-4 text-xs text-slate-700" data-testid="missing-info">
            {pkg.missingInfoNotes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-500">None noted.</p>
        )}
        <p className="mt-2 text-[11px] text-slate-500">Editor notes are never added to the publishable text.</p>
      </section>

      {pkg.sourceRefs.length > 0 && (
        <section className="card p-4">
          <h3 className="mb-2 text-sm font-semibold">Sources used</h3>
          <ul className="list-disc space-y-1 pl-4 text-xs text-slate-700">
            {pkg.sourceRefs.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="card p-4">
        <h3 className="mb-2 text-sm font-semibold">Editor feedback</h3>
        <dl className="space-y-1.5 text-xs">
          {(
            [
              ['Clear topic', pkg.qualitativeFeedback.clearTopic],
              ['Specific wording', pkg.qualitativeFeedback.specificWording],
              ['Faithful to source', pkg.qualitativeFeedback.faithfulToSource],
              ['Readable length', pkg.qualitativeFeedback.readableLength],
              ['Missing context', pkg.qualitativeFeedback.missingContext]
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <dt className="font-semibold text-slate-600">{k}</dt>
              <dd className="text-slate-700">{v || '—'}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="card p-4 text-xs text-slate-600">
        <div className="mb-1 flex items-center gap-2">
          <ProviderBadge provider={record.provider} model={record.model} />
        </div>
        <div>Skill version {record.skillVersion}</div>
        <div>Generated {formatDate(record.generatedAt)}</div>
        {record.edited && <div className="mt-1 font-medium text-brand">Edited by you</div>}
      </section>
    </aside>
  )
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

export function Results({ draftId }: { draftId: number }) {
  const { navigate, toast, info } = useApp()
  const [draft, setDraft] = useState<DraftDetail | null>(null)
  const [loadError, setLoadError] = useState<AppError | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [busyRequest, setBusyRequest] = useState<string | null>(null)
  const [busyLabel, setBusyLabel] = useState('')
  const [proposal, setProposal] = useState<FieldProposal | null>(null)
  const [actionError, setActionError] = useState<AppError | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState('')
  const [confirmPlatform, setConfirmPlatform] = useState<{ platform: Platform; action?: QuickAction } | null>(null)
  const rules = info?.platformRules

  const load = useCallback(async () => {
    const r = await call('drafts:get', { id: draftId })
    if (r.ok) {
      setDraft(r.data)
      setTitle(r.data.title)
      setSelected((s) => s ?? r.data.packages[0]?.contentType ?? null)
    } else setLoadError(r.error)
  }, [draftId])

  useEffect(() => {
    void load()
  }, [load])

  const record = draft?.packages.find((p) => p.contentType === selected) ?? draft?.packages[0]

  const replaceRecord = (rec: PackageRecord) =>
    setDraft((d) => (d ? { ...d, packages: d.packages.map((p) => (p.id === rec.id ? rec : p)) } : d))

  const actions: FieldActions = useMemo(
    () => ({
      busyPath,
      async onSave(path, value) {
        if (!record) return
        const r = await call('packages:applyField', { packageId: record.id, fieldPath: path, value, source: 'user' })
        if (r.ok) replaceRecord(r.data)
        else toast('error', r.error.message)
      },
      async onRegenerate(path, action) {
        if (!record) return
        const requestId = newRequestId()
        setBusyPath(path)
        setBusyRequest(requestId)
        setBusyLabel(`Regenerating ${path}…`)
        setActionError(null)
        const r = await call('gen:regenerateField', { requestId, packageId: record.id, fieldPath: path, action })
        setBusyPath(null)
        setBusyRequest(null)
        if (r.ok) setProposal(r.data)
        else if (r.error.code !== 'cancelled') setActionError(r.error)
      }
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busyPath, record?.id, toast]
  )

  async function acceptProposal() {
    if (!proposal) return
    const r = await call('packages:applyField', { packageId: proposal.packageId, fieldPath: proposal.fieldPath, value: proposal.proposal, source: 'regen' })
    if (r.ok) {
      replaceRecord(r.data)
      toast('success', 'Field replaced — Undo is available')
    } else toast('error', r.error.message)
    setProposal(null)
  }

  async function undo() {
    if (!record) return
    const r = await call('packages:undo', { packageId: record.id })
    if (r.ok) {
      replaceRecord(r.data)
      toast('info', 'Undone')
    } else toast('error', r.error.message)
  }

  async function reset() {
    if (!record) return
    const r = await call('packages:reset', { packageId: record.id })
    if (r.ok) {
      replaceRecord(r.data)
      toast('info', 'Back to the generated version — Undo is available')
    }
  }

  async function runPackageRegen(action?: QuickAction) {
    if (!record) return
    const requestId = newRequestId()
    setBusyPath('*')
    setBusyRequest(requestId)
    setBusyLabel(action ? `${QUICK_ACTION_LABELS[action]}…` : 'Regenerating package…')
    setActionError(null)
    const r = await call('gen:regeneratePackage', { requestId, packageId: record.id, action })
    setBusyPath(null)
    setBusyRequest(null)
    if (r.ok) {
      setDraft(r.data)
      toast('success', 'Package updated — Undo restores the previous version')
    } else if (r.error.code !== 'cancelled') setActionError(r.error)
  }

  async function runPlatformRegen(platform: Platform, action?: QuickAction) {
    if (!draft) return
    const requestId = newRequestId()
    setBusyPath('*')
    setBusyRequest(requestId)
    setBusyLabel(`Regenerating all ${PLATFORM_LABELS[platform]} packages…`)
    setActionError(null)
    const r = await call('gen:regeneratePlatform', { requestId, draftId: draft.id, platform, action })
    setBusyPath(null)
    setBusyRequest(null)
    if (r.ok) {
      setDraft(r.data)
      toast('success', `${PLATFORM_LABELS[platform]} packages updated — Undo on each package restores it`)
    } else if (r.error.code !== 'cancelled') setActionError(r.error)
  }

  function askPlatformRegen(platform: Platform, action?: QuickAction) {
    const edited = draft?.packages.some((p) => p.platform === platform && p.edited)
    if (edited) setConfirmPlatform({ platform, action })
    else void runPlatformRegen(platform, action)
  }

  async function rename() {
    if (!draft || !title.trim()) return
    const r = await call('drafts:rename', { id: draft.id, title: title.trim() })
    if (r.ok) {
      setDraft({ ...draft, title: title.trim() })
      setRenaming(false)
    } else toast('error', r.error.message)
  }

  async function exportAs(format: 'txt' | 'json' | 'html' | 'pdf') {
    if (!draft) return
    const r = await call('export:draft', { draftId: draft.id, format })
    if (r.ok && r.data.saved) toast('success', `Saved ${format.toUpperCase()} to ${r.data.path}`)
    else if (!r.ok) toast('error', r.error.message)
  }

  async function duplicate() {
    if (!draft) return
    const r = await call('drafts:duplicate', { id: draft.id })
    if (r.ok) {
      toast('success', 'Draft duplicated')
      navigate({ screen: 'results', draftId: r.data.id })
    }
  }

  function focusField(path: string) {
    const top = path.split('.').slice(0, path.startsWith('hashtags') ? 2 : 2).join('.')
    const el =
      document.querySelector<HTMLElement>(`[data-field="${path}"] textarea, [data-field="${path}"] input`) ??
      document.querySelector<HTMLElement>(`[data-field="${top}"] textarea, [data-field="${top}"] input`) ??
      document.querySelector<HTMLElement>(`[data-field^="${path.split('.')[0]}"] textarea, [data-field^="${path.split('.')[0]}"] input`)
    el?.focus()
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  if (loadError) {
    return (
      <div className="space-y-4">
        <ErrorBanner error={loadError} />
        <button className="btn-secondary" onClick={() => navigate({ screen: 'drafts' })}>
          Back to drafts
        </button>
      </div>
    )
  }
  if (!draft) return <Spinner className="text-brand" />
  if (!record) {
    return <EmptyState title="This draft has no packages" action={<button className="btn-primary" onClick={() => navigate({ screen: 'generate', prefill: draft.input })}>Generate again</button>} />
  }

  const hard = hardViolations(record.current, rules)
  const isMock = draft.packages.some((p) => p.provider === 'mock')
  const platformsInDraft = PLATFORMS.filter((p) => draft.packages.some((x) => x.platform === p))
  const totalWarnings = draft.packages.reduce((n, p) => n + p.warnings.filter((w) => w.severity === 'warning').length, 0)

  return (
    <div>
      <PageHeader
        title="Results"
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {renaming ? (
              <span className="flex items-center gap-2">
                <input className="input w-96" value={title} autoFocus onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && rename()} />
                <button className="btn-primary btn-sm" onClick={rename}>
                  Save
                </button>
                <button className="btn-ghost btn-sm" onClick={() => setRenaming(false)}>
                  Cancel
                </button>
              </span>
            ) : (
              <>
                <span className="font-semibold text-navy" lang="ta" data-testid="draft-title">
                  {draft.title}
                </span>
                <button className="btn-ghost btn-sm" onClick={() => setRenaming(true)}>
                  Rename
                </button>
              </>
            )}
            {isMock && <MockBadge />}
            {draft.usage?.outputTokens ? (
              <span className="text-xs text-slate-500">
                Tokens: {draft.usage.inputTokens ?? '?'} in / {draft.usage.outputTokens} out
              </span>
            ) : null}
          </span>
        }
        actions={
          <>
            <button className="btn-secondary" onClick={() => navigate({ screen: 'generate', prefill: draft.input })}>
              Edit input & generate again
            </button>
            <button className="btn-secondary" onClick={duplicate}>
              Duplicate
            </button>
            <select className="input w-40" value="" aria-label="Export" onChange={(e) => e.target.value && exportAs(e.target.value as 'txt')}>
              <option value="">Export…</option>
              <option value="txt">Text (.txt)</option>
              <option value="json">JSON (.json)</option>
              <option value="html">Printable HTML</option>
              <option value="pdf">PDF</option>
            </select>
          </>
        }
      />

      {isMock && (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          <MockBadge className="mr-2" /> These packages were made by the Mock provider from your headline only. They are for testing — do not publish them as-is.
        </div>
      )}
      {totalWarnings > 0 && (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          The accuracy check found {totalWarnings} item{totalWarnings === 1 ? '' : 's'} to review across packages. Nothing was changed automatically.
        </div>
      )}
      {actionError && (
        <div className="mb-4">
          <ErrorBanner error={actionError} onClose={() => setActionError(null)} />
        </div>
      )}
      {busyRequest && (
        <div className="mb-4 flex items-center justify-between rounded-md border border-brand-100 bg-brand-50 px-4 py-2 text-sm">
          <span className="flex items-center gap-2">
            <Spinner className="text-brand" /> {busyLabel}
          </span>
          <button className="btn-danger btn-sm" onClick={() => call('gen:cancel', { requestId: busyRequest })}>
            Cancel
          </button>
        </div>
      )}

      {/* Tabs per content type, grouped by platform */}
      <div className="mb-4 space-y-2">
        {platformsInDraft.map((p) => (
          <div key={p} className="flex flex-wrap items-center gap-1.5">
            <span className="w-24 text-xs font-semibold uppercase tracking-wide text-slate-500">{PLATFORM_LABELS[p]}</span>
            {draft.packages
              .filter((x) => x.platform === p)
              .map((x) => {
                const n = x.warnings.filter((w) => w.severity === 'warning').length
                const on = x.id === record.id
                return (
                  <button
                    key={x.id}
                    data-testid={`tab-${x.contentType}`}
                    onClick={() => setSelected(x.contentType)}
                    className={`rounded-md border px-3 py-1.5 text-sm transition ${
                      on ? 'border-brand bg-brand text-white' : 'border-slate-300 bg-white hover:border-brand'
                    }`}
                    aria-pressed={on}
                  >
                    {CONTENT_TYPES[x.contentType].label}
                    {x.edited && <span className="ml-1 opacity-70">•</span>}
                    {n > 0 && <span className={`ml-1.5 rounded px-1 text-[11px] ${on ? 'bg-white/20' : 'bg-amber-100 text-amber-900'}`}>⚠{n}</span>}
                  </button>
                )
              })}
            <PlatformMenu platform={p} disabled={!!busyPath} onRun={askPlatformRegen} />
          </div>
        ))}
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="card p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
            <h2 className="text-lg font-semibold">
              {PLATFORM_LABELS[record.platform]} · {CONTENT_TYPES[record.contentType].label}
            </h2>
            <div className="flex flex-wrap items-center gap-1.5">
              <button className="btn-secondary btn-sm" disabled={!record.historyCount || !!busyPath} onClick={undo} data-testid="undo">
                ↶ Undo
              </button>
              <button className="btn-secondary btn-sm" disabled={!record.edited || !!busyPath} onClick={reset}>
                Reset to generated
              </button>
              <PackageMenu disabled={!!busyPath} onRun={runPackageRegen} />
            </div>
          </div>

          <CopyBar record={record} blocked={hard.length > 0} />
          {hard.length > 0 && (
            <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800" data-testid="hard-limit">
              Over a platform limit: {hard.map((h) => `${h.path} (${h.count}/${h.max})`).join(', ')}. Shorten it before copying the full package.
            </div>
          )}

          <PackageEditor record={record} rules={rules} actions={actions} />
        </section>

        <SidePanel record={record} onFocusField={focusField} />
      </div>

      {proposal && (
        <Modal
          title={`Replace ${proposal.fieldPath}?`}
          wide
          onClose={() => setProposal(null)}
          footer={
            <>
              <button className="btn-secondary" onClick={() => setProposal(null)} data-testid="discard-proposal">
                Keep current
              </button>
              <button className="btn-primary" onClick={acceptProposal} data-testid="accept-proposal">
                Replace
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Removed text is <del className="bg-red-100 text-red-800">red</del>, new text is <ins className="bg-green-100 text-green-900 no-underline">green</ins>. Only this field changes; you can Undo afterwards.
            </p>
            <DiffView before={asText(proposal.previous)} after={asText(proposal.proposal)} />
            {proposal.warnings.length > 0 && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3">
                <div className="mb-1 text-sm font-semibold text-amber-900">Accuracy check on the new text</div>
                <WarningList warnings={proposal.warnings} />
              </div>
            )}
            {proposal.provider === 'mock' && <MockBadge />}
          </div>
        </Modal>
      )}

      {confirmPlatform && (
        <Modal
          title={`Regenerate all ${PLATFORM_LABELS[confirmPlatform.platform]} packages?`}
          onClose={() => setConfirmPlatform(null)}
          footer={
            <>
              <button className="btn-secondary" onClick={() => setConfirmPlatform(null)}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={() => {
                  const c = confirmPlatform
                  setConfirmPlatform(null)
                  void runPlatformRegen(c.platform, c.action)
                }}
              >
                Regenerate
              </button>
            </>
          }
        >
          <p className="text-sm">
            You have edited some {PLATFORM_LABELS[confirmPlatform.platform]} packages. They will be replaced. Your edits are kept in history — use Undo on each package to bring them back.
          </p>
        </Modal>
      )}
    </div>
  )
}

function asText(v: unknown): string {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v.join(' ')
  if (v && typeof v === 'object') return JSON.stringify(v, null, 1)
  return v === undefined ? '' : String(v)
}

function CopyBar({ record, blocked }: { record: PackageRecord; blocked: boolean }) {
  const { toast } = useApp()
  const pkg = record.current
  const title = recommendedTitle(pkg)
  const body = pkg.caption ?? pkg.description ?? pkg.postText ?? pkg.overlayText
  const tags = hashtagLine(pkg)
  const copy = async (text: string | undefined, what: string) => {
    if (!text) return
    if (await copyText(text)) toast('success', `${what} copied`)
  }
  return (
    <div className="mb-4 flex flex-wrap gap-1.5">
      {title && (
        <button className="btn-secondary btn-sm" onClick={() => copy(title, 'Title')} data-testid="copy-title">
          Copy {pkg.titleOptions ? 'title' : 'hook'}
        </button>
      )}
      {body && (
        <button className="btn-secondary btn-sm" onClick={() => copy(body, 'Text')} data-testid="copy-body">
          Copy {pkg.caption ? 'caption' : pkg.description ? 'description' : pkg.postText ? 'post' : 'text'}
        </button>
      )}
      {tags && (
        <button className="btn-secondary btn-sm" onClick={() => copy(tags, 'Hashtags')} data-testid="copy-hashtags">
          Copy hashtags
        </button>
      )}
      <button
        className="btn-primary btn-sm"
        disabled={blocked}
        title={blocked ? 'Over a platform limit — fix it first' : 'Copy everything ready to paste'}
        onClick={() => copy(publishableText(pkg), 'Full package')}
        data-testid="copy-full"
      >
        Copy full package
      </button>
    </div>
  )
}

function PackageMenu({ disabled, onRun }: { disabled: boolean; onRun: (a?: QuickAction) => void }) {
  return (
    <select
      className="input w-48 py-1 text-xs"
      disabled={disabled}
      value=""
      aria-label="Rewrite this package"
      data-testid="package-actions"
      onChange={(e) => {
        const v = e.target.value
        if (!v) return
        onRun(v === 'fresh' ? undefined : (v as QuickAction))
      }}
    >
      <option value="">Rewrite this package…</option>
      <option value="fresh">Regenerate (new wording)</option>
      {QUICK_ACTIONS.map((a) => (
        <option key={a} value={a}>
          {QUICK_ACTION_LABELS[a]}
        </option>
      ))}
    </select>
  )
}

function PlatformMenu({ platform, disabled, onRun }: { platform: Platform; disabled: boolean; onRun: (p: Platform, a?: QuickAction) => void }) {
  return (
    <select
      className="input ml-1 w-44 py-1 text-xs"
      disabled={disabled}
      value=""
      aria-label={`Regenerate all ${PLATFORM_LABELS[platform]}`}
      onChange={(e) => {
        const v = e.target.value
        if (!v) return
        onRun(platform, v === 'fresh' ? undefined : (v as QuickAction))
      }}
    >
      <option value="">All {PLATFORM_LABELS[platform]}…</option>
      <option value="fresh">Regenerate platform</option>
      {QUICK_ACTIONS.map((a) => (
        <option key={a} value={a}>
          {QUICK_ACTION_LABELS[a]}
        </option>
      ))}
    </select>
  )
}
