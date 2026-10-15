import { useEffect, useRef, type ReactNode } from 'react'
import type { AppError } from '@shared/ipc-contract'
import { PROVIDER_LABELS, type ProviderId } from '@shared/platform-types'

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-navy">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  )
}

export function MockBadge({ className = '' }: { className?: string }) {
  return (
    <span
      data-testid="mock-badge"
      title="Made by the Mock provider — no AI was used. Do not publish as-is."
      className={`inline-flex items-center rounded bg-amber-600 px-2 py-0.5 text-[11px] font-bold tracking-wider text-white ${className}`}
    >
      MOCK OUTPUT
    </span>
  )
}

export function ProviderBadge({ provider, model }: { provider: ProviderId; model?: string }) {
  if (provider === 'mock') return <MockBadge />
  return (
    <span className="inline-flex items-center gap-1 rounded bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand">
      {PROVIDER_LABELS[provider]}
      {model && <span className="text-slate-500">· {model}</span>}
    </span>
  )
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  )
}

export function EmptyState({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-12 text-center">
      <div className="text-base font-semibold text-navy">{title}</div>
      {text && <p className="max-w-md text-sm text-slate-600">{text}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function ErrorBanner({ error, onClose }: { error: AppError | string; onClose?: () => void }) {
  const e = typeof error === 'string' ? { message: error, code: 'unknown', details: undefined } : error
  return (
    <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{e.message}</div>
          {e.details && e.details.length > 0 && (
            <details className="mt-1 text-xs text-red-700">
              <summary className="cursor-pointer">Technical details</summary>
              <ul className="mt-1 list-disc pl-5">
                {e.details.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
        {onClose && (
          <button className="text-red-700 hover:text-red-900" onClick={onClose} aria-label="Dismiss">
            ✕
          </button>
        )}
      </div>
    </div>
  )
}

export function InfoBanner({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  const cls = tone === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-brand-100 bg-brand-50 text-navy'
  return <div className={`rounded-md border px-4 py-3 text-sm ${cls}`}>{children}</div>
}

export function Modal({
  title,
  children,
  onClose,
  footer,
  wide
}: {
  title: string
  children: ReactNode
  onClose: () => void
  footer?: ReactNode
  wide?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-6" onMouseDown={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`card flex max-h-full w-full flex-col ${wide ? 'max-w-3xl' : 'max-w-lg'}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="text-slate-500 hover:text-navy" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="overflow-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

export function Field({ label, hint, children, htmlFor }: { label: string; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

export function Checkbox({
  checked,
  onChange,
  label,
  hint,
  testId
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: ReactNode
  hint?: string
  testId?: string
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm">
      <input
        type="checkbox"
        data-testid={testId}
        className="mt-0.5 h-4 w-4 accent-brand"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {label}
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  )
}

/** Simple word-level diff for the regenerate preview. */
export function DiffView({ before, after }: { before: string; after: string }) {
  const a = before.split(/(\s+)/)
  const b = after.split(/(\s+)/)
  const n = a.length
  const m = b.length
  if (n * m > 400_000) {
    return (
      <div className="grid grid-cols-2 gap-3 text-sm">
        <pre className="whitespace-pre-wrap rounded bg-red-50 p-2">{before}</pre>
        <pre className="whitespace-pre-wrap rounded bg-green-50 p-2">{after}</pre>
      </div>
    )
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out: { t: string; k: 'same' | 'del' | 'add' }[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ t: a[i++], k: 'same' })
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: a[i++], k: 'del' })
    else out.push({ t: b[j++], k: 'add' })
  }
  while (i < n) out.push({ t: a[i++], k: 'del' })
  while (j < m) out.push({ t: b[j++], k: 'add' })
  return (
    <div className="whitespace-pre-wrap rounded-md border border-slate-200 bg-white p-3 text-sm leading-relaxed" data-testid="diff-view">
      {out.map((p, idx) =>
        p.k === 'same' ? (
          <span key={idx}>{p.t}</span>
        ) : p.k === 'del' ? (
          <del key={idx} className="bg-red-100 text-red-800">
            {p.t}
          </del>
        ) : (
          <ins key={idx} className="bg-green-100 text-green-900 no-underline">
            {p.t}
          </ins>
        )
      )}
    </div>
  )
}
