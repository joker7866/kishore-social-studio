import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { GenerationInputDraft } from '@shared/content-schema'
import type { ChannelProfile } from '@shared/guards/branding'
import type { AppInfo, AppSettings, ProviderStatus } from '@shared/ipc-contract'
import { call } from '../lib/api'

export type Screen = 'dashboard' | 'generate' | 'results' | 'drafts' | 'templates' | 'channels' | 'providers' | 'export'

export interface Route {
  screen: Screen
  draftId?: number
  prefill?: GenerationInputDraft
}

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  text: string
  action?: { label: string; run: () => void }
}

interface AppState {
  route: Route
  navigate(route: Route): void
  info: AppInfo | null
  settings: AppSettings | null
  providers: ProviderStatus[]
  profiles: ChannelProfile[]
  online: boolean
  activeProvider: ProviderStatus | undefined
  refreshSettings(): Promise<void>
  refreshProviders(): Promise<void>
  refreshProfiles(): Promise<void>
  toast(kind: Toast['kind'], text: string, action?: Toast['action']): void
  toasts: Toast[]
  dismissToast(id: number): void
  loadError: string | null
}

const Ctx = createContext<AppState | null>(null)

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>({ screen: 'dashboard' })
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [providers, setProviders] = useState<ProviderStatus[]>([])
  const [profiles, setProfiles] = useState<ChannelProfile[]>([])
  const [online, setOnline] = useState(navigator.onLine)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const toastId = useRef(0)

  const refreshSettings = useCallback(async () => {
    const r = await call('settings:get')
    if (r.ok) setSettings(r.data)
  }, [])
  const refreshProviders = useCallback(async () => {
    const r = await call('provider:list')
    if (r.ok) setProviders(r.data)
  }, [])
  const refreshProfiles = useCallback(async () => {
    const r = await call('profiles:list')
    if (r.ok) setProfiles(r.data)
  }, [])

  useEffect(() => {
    void (async () => {
      const r = await call('app:info')
      if (r.ok) setInfo(r.data)
      else setLoadError(r.error.message)
      await Promise.all([refreshSettings(), refreshProviders(), refreshProfiles()])
    })()
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [refreshSettings, refreshProviders, refreshProfiles])

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const toast = useCallback(
    (kind: Toast['kind'], text: string, action?: Toast['action']) => {
      const id = ++toastId.current
      setToasts((t) => [...t.slice(-3), { id, kind, text, action }])
      setTimeout(() => dismissToast(id), action ? 8000 : kind === 'error' ? 7000 : 3000)
    },
    [dismissToast]
  )

  const navigate = useCallback((r: Route) => {
    setRoute(r)
    document.getElementById('main-scroll')?.scrollTo({ top: 0 })
  }, [])

  const value = useMemo<AppState>(
    () => ({
      route,
      navigate,
      info,
      settings,
      providers,
      profiles,
      online,
      activeProvider: providers.find((p) => p.active),
      refreshSettings,
      refreshProviders,
      refreshProfiles,
      toast,
      toasts,
      dismissToast,
      loadError
    }),
    [route, navigate, info, settings, providers, profiles, online, refreshSettings, refreshProviders, refreshProfiles, toast, toasts, dismissToast, loadError]
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useApp outside provider')
  return v
}

/** Can the user generate right now? Returns a reason when not. */
export function useGenerateBlocker(): string | null {
  const { activeProvider, online } = useApp()
  if (!activeProvider) return 'Loading provider settings…'
  if (activeProvider.provider === 'mock') return null
  if (!activeProvider.keySaved) return 'No API key saved for the active provider. Add one in AI Provider Settings, or switch to Mock mode.'
  if (!online) return 'You are offline. Generation needs the internet — drafts, editing, copy and export still work.'
  return null
}
