import { useEffect, useState } from 'react'
import type { DraftSummary } from '@shared/ipc-contract'
import { PLATFORM_LABELS, PROVIDER_LABELS } from '@shared/platform-types'
import { EmptyState, MockBadge, PageHeader, Spinner } from '../components/ui'
import { call, formatDate } from '../lib/api'
import { useApp } from '../state/app-state'

export function Dashboard() {
  const { navigate, activeProvider, settings } = useApp()
  const [drafts, setDrafts] = useState<DraftSummary[] | null>(null)
  const [headline, setHeadline] = useState('')

  useEffect(() => {
    void call('drafts:list', { limit: 8 }).then((r) => setDrafts(r.ok ? r.data : []))
  }, [])

  const quick = () => {
    if (!headline.trim()) return
    navigate({ screen: 'generate', prefill: { headline: headline.trim(), contentTypes: [] } })
  }

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Turn a headline into separate, editable YouTube, Facebook and Instagram packages." />

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="card p-5 lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">Quick generate</h2>
          <div className="flex gap-2">
            <input
              className="input text-base"
              data-testid="quick-headline"
              lang="ta"
              placeholder="தலைப்புச் செய்தியை இங்கே எழுதுங்கள் / type the headline"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && quick()}
            />
            <button className="btn-primary shrink-0" onClick={quick} disabled={!headline.trim()} data-testid="quick-generate">
              Continue →
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-500">You can add context, facts and allegations on the next screen before generating.</p>
        </section>

        <section className="card p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">AI provider</h2>
          {activeProvider ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-base font-semibold">
                {PROVIDER_LABELS[activeProvider.provider]}
                {activeProvider.provider === 'mock' && <MockBadge />}
              </div>
              {activeProvider.provider !== 'mock' && (
                <div className="text-sm text-slate-600">
                  Model: {activeProvider.model}
                  <br />
                  API key: {activeProvider.keySaved ? `saved (…${activeProvider.keyLast4})` : <span className="text-red-700">not saved</span>}
                </div>
              )}
              {activeProvider.provider === 'mock' && (
                <p className="text-sm text-slate-600">Mock mode makes test output without calling any AI. Each real generation uses credit on your own API account.</p>
              )}
              <button className="btn-secondary btn-sm" onClick={() => navigate({ screen: 'providers' })}>
                Provider settings
              </button>
            </div>
          ) : (
            <Spinner />
          )}
          {settings && <div className="mt-3 text-xs text-slate-500">Timezone: {settings.timezone}</div>}
        </section>
      </div>

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-600">Recent drafts</h2>
          <button className="btn-ghost btn-sm" onClick={() => navigate({ screen: 'drafts' })}>
            All drafts →
          </button>
        </div>
        {drafts === null ? (
          <Spinner />
        ) : drafts.length === 0 ? (
          <EmptyState
            title="No drafts yet"
            text="Generate your first package from a headline. Every generation is saved here automatically."
            action={
              <button className="btn-primary" onClick={() => navigate({ screen: 'generate' })}>
                Generate content
              </button>
            }
          />
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {drafts.map((d) => (
              <button
                key={d.id}
                className="card p-4 text-left transition hover:border-brand"
                onClick={() => navigate({ screen: 'results', draftId: d.id })}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="font-semibold leading-snug" lang="ta">
                    {d.title}
                  </div>
                  {d.providers.includes('mock') && <MockBadge />}
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  {d.platforms.map((p) => PLATFORM_LABELS[p]).join(' · ')} · {d.contentTypes.length} packages · {formatDate(d.updatedAt)}
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
