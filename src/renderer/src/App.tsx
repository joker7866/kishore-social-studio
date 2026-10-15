import type { ReactNode } from 'react'
import { MockBadge } from './components/ui'
import { ChannelSettings } from './screens/ChannelSettings'
import { Dashboard } from './screens/Dashboard'
import { Drafts } from './screens/Drafts'
import { ExportBackup } from './screens/ExportBackup'
import { Generate } from './screens/Generate'
import { ProviderSettings } from './screens/ProviderSettings'
import { Results } from './screens/Results'
import { Templates } from './screens/Templates'
import { AppStateProvider, useApp, type Screen } from './state/app-state'
import { PROVIDER_LABELS } from '@shared/platform-types'

const NAV: { screen: Screen; label: string; icon: string }[] = [
  { screen: 'dashboard', label: 'Dashboard', icon: '⌂' },
  { screen: 'generate', label: 'Generate Content', icon: '✦' },
  { screen: 'drafts', label: 'Saved Drafts', icon: '▤' },
  { screen: 'templates', label: 'Templates', icon: '❏' },
  { screen: 'channels', label: 'Channel Settings', icon: '#' },
  { screen: 'providers', label: 'AI Provider Settings', icon: '⚙' },
  { screen: 'export', label: 'Export & Backup', icon: '⇩' }
]

function Sidebar() {
  const { route, navigate, activeProvider, info, online } = useApp()
  return (
    <aside className="flex w-60 shrink-0 flex-col bg-navy text-white">
      <div className="px-5 pb-4 pt-5">
        <div className="text-lg font-bold leading-tight">Kishore Social Studio</div>
        <div className="mt-0.5 text-xs text-blue-200">Tamil news publishing packages</div>
      </div>
      <nav className="flex-1 space-y-0.5 px-3" aria-label="Main">
        {NAV.map((n) => {
          const active = route.screen === n.screen || (n.screen === 'drafts' && route.screen === 'results')
          return (
            <button
              key={n.screen}
              data-testid={`nav-${n.screen}`}
              onClick={() => navigate({ screen: n.screen })}
              className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition ${
                active ? 'bg-brand text-white' : 'text-blue-100 hover:bg-navy-light'
              }`}
              aria-current={active ? 'page' : undefined}
            >
              <span className="w-4 text-center opacity-80" aria-hidden>
                {n.icon}
              </span>
              {n.label}
            </button>
          )
        })}
      </nav>
      <div className="space-y-2 border-t border-navy-light px-5 py-4 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-blue-200">AI provider</span>
          <span className={`h-2 w-2 rounded-full ${online ? 'bg-green-400' : 'bg-slate-400'}`} title={online ? 'Online' : 'Offline'} />
        </div>
        {activeProvider ? (
          activeProvider.provider === 'mock' ? (
            <MockBadge />
          ) : (
            <div className="font-medium">
              {PROVIDER_LABELS[activeProvider.provider]}
              <div className="truncate text-blue-200">{activeProvider.model}</div>
            </div>
          )
        ) : (
          <div className="text-blue-200">…</div>
        )}
        {info && (
          <div className="pt-1 text-blue-300">
            v{info.version} · skill {info.skillVersion}
          </div>
        )}
      </div>
    </aside>
  )
}

function Toasts() {
  const { toasts, dismissToast } = useApp()
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-96 flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-center justify-between gap-3 rounded-md px-4 py-3 text-sm shadow-lg ${
            t.kind === 'error' ? 'bg-red-700 text-white' : t.kind === 'success' ? 'bg-navy text-white' : 'bg-white text-navy'
          }`}
        >
          <span>{t.text}</span>
          <span className="flex shrink-0 items-center gap-2">
            {t.action && (
              <button
                className="rounded bg-white/15 px-2 py-0.5 font-semibold hover:bg-white/25"
                onClick={() => {
                  t.action!.run()
                  dismissToast(t.id)
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="opacity-70 hover:opacity-100" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
              ✕
            </button>
          </span>
        </div>
      ))}
    </div>
  )
}

function StatusBar() {
  const { online, activeProvider, navigate } = useApp()
  const banners: ReactNode[] = []
  if (!online) {
    banners.push(
      <div key="off" className="bg-slate-700 px-6 py-1.5 text-xs text-white">
        You are offline. Drafts, editing, copy and export work; generating with a real AI provider needs the internet.
      </div>
    )
  }
  if (activeProvider?.provider === 'mock') {
    banners.push(
      <div key="mock" className="flex items-center gap-3 bg-amber-100 px-6 py-1.5 text-xs text-amber-900" data-testid="mock-mode-banner">
        <MockBadge />
        Mock mode is on — results are test fixtures, not AI writing.
        <button className="font-semibold underline" onClick={() => navigate({ screen: 'providers' })}>
          Change provider
        </button>
      </div>
    )
  }
  return <>{banners}</>
}

function CurrentScreen() {
  const { route, loadError } = useApp()
  if (loadError) {
    return (
      <div className="p-8">
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-red-800">The app could not start: {loadError}</div>
      </div>
    )
  }
  switch (route.screen) {
    case 'dashboard':
      return <Dashboard />
    case 'generate':
      return <Generate key={JSON.stringify(route.prefill ?? null)} prefill={route.prefill} />
    case 'results':
      return route.draftId ? <Results key={route.draftId} draftId={route.draftId} /> : <Drafts />
    case 'drafts':
      return <Drafts />
    case 'templates':
      return <Templates />
    case 'channels':
      return <ChannelSettings />
    case 'providers':
      return <ProviderSettings />
    case 'export':
      return <ExportBackup />
  }
}

export function App() {
  return (
    <AppStateProvider>
      <div className="flex h-full">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <StatusBar />
          <main id="main-scroll" className="flex-1 overflow-auto">
            <div className="mx-auto max-w-[1400px] px-8 py-6">
              <CurrentScreen />
            </div>
          </main>
        </div>
      </div>
      <Toasts />
    </AppStateProvider>
  )
}
