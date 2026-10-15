// Maps OpenAI / Anthropic SDK errors to distinct, user-readable messages.
// Works by duck typing so it does not depend on SDK class identity.

import { PROVIDER_LABELS, type ProviderId } from '@shared/platform-types'
import { redact } from '../../security/redact'
import { ProviderError } from './types'

interface SdkLikeError {
  name?: string
  message?: string
  status?: number
  headers?: Headers | Record<string, string>
  error?: { type?: string; code?: string; message?: string; error?: { type?: string; code?: string; message?: string } }
  code?: string
}

function header(h: SdkLikeError['headers'], name: string): string | undefined {
  if (!h) return undefined
  if (typeof (h as Headers).get === 'function') return (h as Headers).get(name) ?? undefined
  const rec = h as Record<string, string>
  return rec[name] ?? rec[name.toLowerCase()]
}

function retryAfter(h: SdkLikeError['headers']): number | undefined {
  const ms = header(h, 'retry-after-ms')
  if (ms && !Number.isNaN(Number(ms))) return Math.ceil(Number(ms) / 1000)
  const s = header(h, 'retry-after')
  if (!s) return undefined
  if (!Number.isNaN(Number(s))) return Math.ceil(Number(s))
  const date = Date.parse(s)
  return Number.isNaN(date) ? undefined : Math.max(1, Math.ceil((date - Date.now()) / 1000))
}

export interface AbortInfo {
  timedOut: boolean
}

export function mapProviderError(err: unknown, provider: ProviderId, abort?: AbortInfo): ProviderError {
  if (err instanceof ProviderError) return err
  const e = (err ?? {}) as SdkLikeError
  const name = e.name ?? ''
  const label = PROVIDER_LABELS[provider]
  const inner = e.error?.error ?? e.error
  const text = redact(`${e.message ?? ''} ${inner?.message ?? ''}`).toLowerCase()

  if (abort?.timedOut) return new ProviderError('timeout', `${label} did not answer in time. Try again, or raise the timeout in AI Provider Settings.`)
  if (name === 'APIUserAbortError' || name === 'AbortError') return new ProviderError('cancelled', 'Generation cancelled.')
  if (name.includes('Timeout')) return new ProviderError('timeout', `${label} did not answer in time. Try again, or raise the timeout in AI Provider Settings.`)
  if (name === 'APIConnectionError' || e.code === 'ENOTFOUND' || e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET') {
    return new ProviderError('offline', `Could not reach ${label}. Check your internet connection.`)
  }

  const status = e.status
  if (status === 401) return new ProviderError('invalid_key', `${label} rejected the API key. Check the key in AI Provider Settings.`)
  if (status === 403) return new ProviderError('invalid_key', `${label} says this key does not have permission for this request or model.`)
  if (status === 402) return new ProviderError('quota', `${label} reports a billing problem. Add credit to your ${label} account.`)
  if (status === 429) {
    const code = inner?.code ?? inner?.type ?? ''
    if (code === 'insufficient_quota' || text.includes('quota') || text.includes('billing')) {
      return new ProviderError('quota', `Your ${label} account is out of credit or over its quota.`)
    }
    const after = retryAfter(e.headers)
    return new ProviderError(
      'rate_limit',
      `${label} rate limit reached.${after ? ` Try again in about ${after} seconds.` : ' Wait a minute and try again.'}`,
      after
    )
  }
  if (status === 400 && (text.includes('credit balance') || text.includes('billing'))) {
    return new ProviderError('quota', `Your ${label} account does not have enough credit.`)
  }
  if (status === 404) return new ProviderError('bad_request', `${label} could not find that model. Pick another model in AI Provider Settings.`)
  if (status === 400 || status === 422) {
    return new ProviderError('bad_request', `${label} rejected the request: ${redact(inner?.message ?? e.message ?? 'bad request').slice(0, 300)}`)
  }
  if (status === 529 || (status !== undefined && status >= 500)) {
    return new ProviderError('server', `${label} is having problems right now (HTTP ${status}). Try again shortly.`)
  }
  return new ProviderError('unknown', `${label} error: ${redact(e.message ?? String(err)).slice(0, 300)}`)
}
