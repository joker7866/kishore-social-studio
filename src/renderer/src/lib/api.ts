import type { AppError, IpcChannel, IpcPayload, IpcResults, Result } from '@shared/ipc-contract'

/** Typed call to the main process. Never throws — errors come back as data. */
export async function call<C extends IpcChannel>(
  channel: C,
  ...payload: IpcPayload<C> extends undefined ? [] : [IpcPayload<C>]
): Promise<Result<IpcResults[C]>> {
  try {
    return await window.api.invoke(channel, ...payload)
  } catch (err) {
    return { ok: false, error: { code: 'unknown', message: (err as Error)?.message ?? 'Unexpected error' } }
  }
}

export function newRequestId(): string {
  return crypto.randomUUID()
}

export function errorText(e: AppError): string {
  return e.message
}

export async function copyText(text: string): Promise<boolean> {
  const r = await call('clipboard:write', { text })
  return r.ok
}

export function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(iso))
  } catch {
    return iso
  }
}
