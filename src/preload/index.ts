// The only bridge between the page and the main process. It exposes a single
// narrow `invoke` function — never ipcRenderer itself.

import { contextBridge, ipcRenderer } from 'electron'

const CHANNEL_RE = /^[a-z]+:[A-Za-z]+$/

const api = {
  invoke(channel: string, payload?: unknown): Promise<unknown> {
    if (typeof channel !== 'string' || !CHANNEL_RE.test(channel)) {
      return Promise.resolve({ ok: false, error: { code: 'forbidden', message: 'Unknown channel' } })
    }
    return ipcRenderer.invoke('kss:invoke', channel, payload)
  }
}

contextBridge.exposeInMainWorld('api', Object.freeze(api))
