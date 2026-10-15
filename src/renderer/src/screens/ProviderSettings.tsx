import { useEffect, useState } from 'react'
import type { ProviderStatus } from '@shared/ipc-contract'
import { MODEL_CATALOG, formatPrice, modelLabel } from '@shared/models'
import { PROVIDER_LABELS, type ProviderId } from '@shared/platform-types'
import { ErrorBanner, Field, InfoBanner, MockBadge, PageHeader, Spinner } from '../components/ui'
import { call } from '../lib/api'
import { useApp } from '../state/app-state'

const KEY_PAGES: Partial<Record<ProviderId, string>> = {
  openai: 'https://platform.openai.com/api-keys',
  anthropic: 'https://console.anthropic.com/settings/keys'
}

function ProviderCard({ status }: { status: ProviderStatus }) {
  const { refreshProviders, refreshSettings, toast, info } = useApp()
  const [model, setModel] = useState(status.model)
  const [timeoutSec, setTimeoutSec] = useState(Math.round(status.timeoutMs / 1000))
  const [key, setKey] = useState('')
  const [models, setModels] = useState<string[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const isMock = status.provider === 'mock'

  useEffect(() => {
    setModel(status.model)
    setTimeoutSec(Math.round(status.timeoutMs / 1000))
  }, [status.model, status.timeoutMs])

  async function saveSettings() {
    const r = await call('provider:save', {
      provider: status.provider,
      model: model.trim(),
      timeoutMs: Math.max(10, Math.min(600, timeoutSec)) * 1000,
      enabled: true
    })
    if (r.ok) {
      await refreshProviders()
      toast('success', 'Provider settings saved')
    } else toast('error', r.error.message)
  }

  async function saveModel(m: string) {
    if (!m.trim() || m.trim() === status.model) return
    const r = await call('provider:save', { provider: status.provider, model: m.trim(), timeoutMs: status.timeoutMs, enabled: true })
    if (r.ok) {
      await refreshProviders()
      setResult(null)
      toast('success', `Model changed to ${modelLabel(status.provider, m.trim())}`)
    } else toast('error', r.error.message)
  }

  async function saveKey() {
    if (status.provider === 'mock') return
    setBusy('key')
    const r = await call('provider:saveKey', { provider: status.provider, key: key.trim() })
    setBusy(null)
    setKey('')
    if (r.ok) {
      await refreshProviders()
      toast('success', 'API key saved (encrypted with Windows)')
    } else toast('error', r.error.message)
  }

  async function clearKey() {
    if (status.provider === 'mock') return
    const r = await call('provider:clearKey', { provider: status.provider })
    if (r.ok) {
      await refreshProviders()
      toast('info', 'API key removed')
    }
  }

  async function test() {
    setBusy('test')
    setResult(null)
    if (model.trim() !== status.model) await saveSettings()
    const r = await call('provider:test', { provider: status.provider })
    setBusy(null)
    setResult(r.ok ? { ok: true, text: r.data.message } : { ok: false, text: r.error.message })
  }

  async function loadModels() {
    setBusy('models')
    const r = await call('provider:models', { provider: status.provider })
    setBusy(null)
    if (r.ok) {
      setModels(r.data)
      toast('info', `${r.data.length} models available`)
    } else toast('error', r.error.message)
  }

  async function activate() {
    const r = await call('settings:set', { key: 'activeProvider', value: status.provider })
    if (r.ok) {
      await Promise.all([refreshSettings(), refreshProviders()])
      toast('success', `${PROVIDER_LABELS[status.provider]} is now the active provider`)
    }
  }

  return (
    <section className={`card p-5 ${status.active ? 'ring-2 ring-brand' : ''}`} data-testid={`provider-${status.provider}`}>
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          {PROVIDER_LABELS[status.provider]}
          {isMock && <MockBadge />}
        </h2>
        {status.active ? (
          <span className="rounded bg-brand px-2 py-1 text-xs font-semibold text-white">Active</span>
        ) : (
          <button className="btn-secondary btn-sm" onClick={activate} data-testid={`activate-${status.provider}`}>
            Use this provider
          </button>
        )}
      </div>

      {isMock ? (
        <p className="text-sm text-slate-600">
          Makes deterministic test output from your headline without calling any AI. Every result is labelled MOCK OUTPUT. Use it to try the app and check
          screens — never publish mock text.
        </p>
      ) : (
        <div className="space-y-4">
          <Field
            label="API key"
            hint={
              <>
                Stored encrypted on this PC with Windows Data Protection. It is never shown again, never logged, and never included in exports or backups.{' '}
                {KEY_PAGES[status.provider] && (
                  <button className="text-brand underline" onClick={() => call('shell:openExternal', { url: KEY_PAGES[status.provider]! })}>
                    Get a key
                  </button>
                )}
              </>
            }
          >
            <div className="flex gap-2">
              <input
                className="input font-mono"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={status.keySaved ? `Saved — ends with …${status.keyLast4}` : 'Paste your API key'}
                value={key}
                onChange={(e) => setKey(e.target.value)}
                disabled={!info?.encryptionAvailable}
              />
              <button className="btn-primary shrink-0" disabled={key.trim().length < 10 || busy === 'key'} onClick={saveKey}>
                {status.keySaved ? 'Replace' : 'Save'}
              </button>
              {status.keySaved && (
                <button className="btn-danger shrink-0" onClick={clearKey}>
                  Remove
                </button>
              )}
            </div>
          </Field>
          {info && !info.encryptionAvailable && <ErrorBanner error="Windows secure storage is not available, so keys cannot be saved safely on this PC." />}
          <div className="grid gap-3 md:grid-cols-[1fr_140px]">
            <Field label="Model" hint="Each generation is billed to your own account at this model's price. You can change it any time.">
              <ModelPicker
                provider={status.provider}
                value={model}
                loaded={models}
                onChange={(m) => {
                  setModel(m)
                  void saveModel(m)
                }}
                onLoad={loadModels}
                canLoad={status.keySaved && !busy}
                loading={busy === 'models'}
              />
            </Field>
            <Field label="Timeout (seconds)">
              <input
                className="input"
                type="number"
                min={10}
                max={600}
                value={timeoutSec}
                onChange={(e) => setTimeoutSec(Number(e.target.value) || 60)}
                onBlur={() => timeoutSec * 1000 !== status.timeoutMs && saveSettings()}
              />
            </Field>
          </div>
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button className="btn-secondary" onClick={test} disabled={(!isMock && !status.keySaved) || busy === 'test'} data-testid={`test-${status.provider}`}>
          {busy === 'test' ? <Spinner className="h-3 w-3" /> : null} Test connection
        </button>
        {result && (
          <span className={`text-sm ${result.ok ? 'text-green-700' : 'text-red-700'}`} role="status">
            {result.ok ? '✓ ' : '✕ '}
            {result.text}
          </span>
        )}
      </div>
    </section>
  )
}

const CUSTOM = '__custom__'

function ModelPicker({
  provider,
  value,
  loaded,
  onChange,
  onLoad,
  canLoad,
  loading
}: {
  provider: ProviderId
  value: string
  loaded: string[]
  onChange: (m: string) => void
  onLoad: () => void
  canLoad: boolean
  loading: boolean
}) {
  const catalog = MODEL_CATALOG[provider]
  const extra = loaded.filter((id) => !catalog.some((c) => c.id === id))
  const known = catalog.some((c) => c.id === value) || extra.includes(value)
  const [custom, setCustom] = useState(!known && !!value)
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const selected = catalog.find((c) => c.id === value)
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <select
          className="input"
          data-testid={`model-select-${provider}`}
          value={custom ? CUSTOM : value}
          onChange={(e) => {
            if (e.target.value === CUSTOM) setCustom(true)
            else {
              setCustom(false)
              onChange(e.target.value)
            }
          }}
        >
          {catalog.length > 0 && (
            <optgroup label="Recommended">
              {catalog.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                  {c.note ? ` — ${c.note}` : ''}
                </option>
              ))}
            </optgroup>
          )}
          {extra.length > 0 && (
            <optgroup label="Available to your key">
              {extra.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </optgroup>
          )}
          {!known && !custom && value && <option value={value}>{value}</option>}
          <option value={CUSTOM}>Type another model id…</option>
        </select>
        <button className="btn-secondary shrink-0" disabled={!canLoad} onClick={onLoad} title="Load the models your API key can use">
          {loading ? <Spinner className="h-3 w-3" /> : 'Load list'}
        </button>
      </div>
      {custom && (
        <input
          className="input font-mono"
          placeholder="model id, e.g. claude-sonnet-5-5"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text.trim() && onChange(text.trim())}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      )}
      <div className="text-xs text-slate-500">
        Using <span className="font-mono">{value}</span>
        {selected?.price && <> · {formatPrice(selected.price)}</>}
      </div>
    </div>
  )
}

export function ProviderSettings() {
  const { providers } = useApp()
  const order: ProviderId[] = ['openai', 'anthropic', 'mock']
  return (
    <div>
      <PageHeader title="AI Provider Settings" subtitle="Generation runs through your own API account. Only the main app process talks to the AI service." />
      <div className="mb-5">
        <InfoBanner>
          The app is free to run; each real generation uses API credit on your account. The provider and model are shown on every result, and token usage
          when the provider reports it.
        </InfoBanner>
      </div>
      {providers.length === 0 ? (
        <Spinner />
      ) : (
        <div className="grid gap-5 xl:grid-cols-2">
          {order
            .map((id) => providers.find((p) => p.provider === id))
            .filter((p): p is ProviderStatus => !!p)
            .map((p) => (
              <ProviderCard key={p.provider} status={p} />
            ))}
        </div>
      )}
    </div>
  )
}
