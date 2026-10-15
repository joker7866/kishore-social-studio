import type { KssApi } from '../shared/ipc-contract'

declare global {
  interface Window {
    api: KssApi
  }
}

export {}
