// Suggested models for the model picker. Users can also load the live list from
// their account or type any model id.

import type { ProviderId } from './platform-types'

export interface ModelOption {
  id: string
  label: string
  /** USD per 1 million tokens, Anthropic first-party prices (checked 2026-10-06). */
  price?: { input: number; output: number }
  note?: string
}

export const MODEL_CATALOG: Record<ProviderId, ModelOption[]> = {
  anthropic: [
    { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', price: { input: 0.1, output: 0.5 }, note: 'Cheapest and fastest' },
    { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', price: { input: 2, output: 10 }, note: 'Good balance (default)' },
    { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', price: { input: 4, output: 20 }, note: 'Higher quality' },
    { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', price: { input: 10, output: 50 }, note: 'Most capable, most expensive' }
  ],
  // OpenAI model names change often — use "Load list" to see what your key can use.
  openai: [],
  mock: [{ id: 'mock-fixtures-v1', label: 'Mock fixtures (no AI)' }]
}

export function modelLabel(provider: ProviderId, id: string): string {
  const m = MODEL_CATALOG[provider].find((x) => x.id === id)
  return m ? m.label : id
}

export function formatPrice(p: ModelOption['price']): string {
  if (!p) return ''
  const f = (n: number) => (n < 1 ? `$${n.toFixed(2)}` : `$${n}`)
  return `${f(p.input)} in / ${f(p.output)} out per 1M tokens`
}
