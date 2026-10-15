import type { ContentPackage, GenerationInput } from '@shared/content-schema'
import type { ChannelProfile } from '@shared/guards/branding'
import type { AppError, ErrorCode, TokenUsage } from '@shared/ipc-contract'
import type { ContentTypeId, ProviderId, QuickAction } from '@shared/platform-types'

/** Structured context so the Mock provider can answer without parsing prompts. */
export type RequestContext =
  | {
      kind: 'generate'
      input: GenerationInput
      contentTypes: ContentTypeId[]
      profile: ChannelProfile
      skillVersion: string
      action?: QuickAction
      current?: ContentPackage[]
    }
  | {
      kind: 'field'
      input: GenerationInput
      current: ContentPackage
      fieldPath: string
      profile: ChannelProfile
      skillVersion: string
      action?: QuickAction
    }

export interface ProviderRequest {
  model: string
  system: string
  user: string
  /** JSON Schema the response must follow. */
  jsonSchema: Record<string, unknown>
  schemaName: string
  maxOutputTokens: number
  timeoutMs: number
  context: RequestContext
}

export interface ProviderResponse {
  json: unknown
  rawText: string
  model: string
  usage?: TokenUsage
}

export interface ProviderAdapter {
  readonly id: ProviderId
  generate(req: ProviderRequest, signal: AbortSignal): Promise<ProviderResponse>
  testConnection(model: string, signal: AbortSignal): Promise<string>
  listModels(signal: AbortSignal): Promise<string[]>
}

export class ProviderError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly retryAfterSec?: number,
    readonly details?: string[]
  ) {
    super(message)
    this.name = 'ProviderError'
  }

  toAppError(): AppError {
    return { code: this.code, message: this.message, retryAfterSec: this.retryAfterSec, details: this.details }
  }
}
