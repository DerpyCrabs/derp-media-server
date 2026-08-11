import {
  ExplorerAdapterError,
  explorerError,
  explorerItemKey,
  type ExplorerCapability,
  type ExplorerCommandReceipt,
  type ExplorerErrorCode,
  type ExplorerItem,
} from '@/lib/explorer-model'
import type { ResourceOpenTarget, ResourceRef, ResourceSummary } from '@/lib/resource'
import type { FileItem } from '@/lib/types'
import type { VirtualEntry, VirtualOpenTarget } from '@/lib/virtual-directory'
import { resourceForFileItem } from '@/src/lib/legacy-resource-adapter'

export type ExplorerFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type ExplorerSubscription = (listener: () => void) => () => void

export type ExplorerOfflineCallbacks = Readonly<{
  isKept?: (item: ExplorerItem) => boolean
  keep?: (item: ExplorerItem, signal: AbortSignal) => Promise<unknown> | unknown
  remove?: (item: ExplorerItem, signal: AbortSignal) => Promise<unknown> | unknown
  subscribe?: ExplorerSubscription
}>

export function combineExplorerSubscriptions(
  ...subscriptions: ReadonlyArray<ExplorerSubscription | undefined>
): ExplorerSubscription | undefined {
  const active = subscriptions.filter(
    (subscription): subscription is ExplorerSubscription => !!subscription,
  )
  if (active.length === 0) return undefined
  return (listener) => {
    const unsubscribers = active.map((subscribe) => subscribe(listener))
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe()
    }
  }
}

type ApiErrorBody = Readonly<{
  code?: unknown
  error?: unknown
  message?: unknown
  retryable?: unknown
}>

type CommandResponse = Readonly<{
  receipt?: unknown
  receipts?: unknown
  [key: string]: unknown
}>

const apiCodeMap: Readonly<Record<string, ExplorerErrorCode>> = {
  invalidRequest: 'invalidIntent',
  unauthorized: 'forbidden',
  forbidden: 'forbidden',
  notFound: 'notFound',
  resourceNotFound: 'notFound',
  resourceMissing: 'notFound',
  sourceUnavailable: 'notFound',
  conflict: 'conflict',
  idempotencyConflict: 'conflict',
  needsReconciliation: 'conflict',
  versionMismatch: 'versionMismatch',
  quotaExceeded: 'quotaExceeded',
  offlineUnavailable: 'offlineUnavailable',
  cancelled: 'cancelled',
  network: 'network',
  internal: 'internal',
}

function statusCode(status: number): ExplorerErrorCode {
  if (status === 400 || status === 422) return 'invalidIntent'
  if (status === 401 || status === 403) return 'forbidden'
  if (status === 404) return 'notFound'
  if (status === 409) return 'conflict'
  if (status === 413) return 'quotaExceeded'
  if (status === 408 || status === 429) return 'network'
  return 'internal'
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

async function responseBody(response: Response): Promise<unknown> {
  const raw = await response.text()
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return raw
  }
}

function apiError(response: Response, body: unknown): ExplorerAdapterError {
  const record = body && typeof body === 'object' ? (body as ApiErrorBody) : undefined
  const rawCode = text(record?.code)
  const code = (rawCode && apiCodeMap[rawCode]) || statusCode(response.status)
  const message =
    text(record?.message) ||
    text(record?.error) ||
    text(body) ||
    response.statusText ||
    `Explorer request failed (${response.status})`
  const retryable =
    typeof record?.retryable === 'boolean'
      ? record.retryable
      : response.status === 408 || response.status === 429 || response.status >= 500
  return new ExplorerAdapterError(explorerError(code, message, retryable))
}

export function defaultExplorerFetch(): ExplorerFetch {
  return globalThis.fetch.bind(globalThis)
}

export async function fetchExplorerJson<T>(
  fetcher: ExplorerFetch,
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<T> {
  try {
    signal.throwIfAborted()
    const response = await fetcher(url, { ...init, signal })
    signal.throwIfAborted()
    const body = await responseBody(response)
    if (!response.ok) throw apiError(response, body)
    return body as T
  } catch (error) {
    if (error instanceof ExplorerAdapterError) throw error
    if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      throw new ExplorerAdapterError(
        explorerError('cancelled', 'Explorer request was cancelled', true),
      )
    }
    if (error instanceof TypeError) {
      throw new ExplorerAdapterError(
        explorerError('network', error.message || 'Explorer request failed', true),
      )
    }
    throw new ExplorerAdapterError(
      explorerError(
        'internal',
        error instanceof Error ? error.message : 'Explorer request failed',
        true,
      ),
    )
  }
}

export function postExplorerJson<T>(
  fetcher: ExplorerFetch,
  url: string,
  body: unknown,
  signal: AbortSignal,
): Promise<T> {
  return fetchExplorerJson<T>(
    fetcher,
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    signal,
  )
}

export function normalizeExplorerPath(path: string): string {
  if (path.includes('\0')) {
    throw new ExplorerAdapterError(explorerError('invalidIntent', 'Path contains invalid data'))
  }
  const segments = path.replace(/\\/g, '/').split('/').filter(Boolean)
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new ExplorerAdapterError(explorerError('forbidden', 'Path traversal is forbidden'))
  }
  return segments.join('/')
}

export function explorerChildName(name: string): string {
  const trimmed = name.trim()
  if (
    !trimmed ||
    trimmed === '.' ||
    trimmed === '..' ||
    trimmed.includes('/') ||
    trimmed.includes('\\') ||
    trimmed.includes('\0')
  ) {
    throw new ExplorerAdapterError(explorerError('invalidIntent', 'Invalid resource name'))
  }
  return trimmed
}

export function joinExplorerPath(parent: string, name: string): string {
  return [normalizeExplorerPath(parent), explorerChildName(name)].filter(Boolean).join('/')
}

export function explorerParentPath(path: string): string {
  const parts = normalizeExplorerPath(path).split('/').filter(Boolean)
  return parts.slice(0, -1).join('/')
}

export function explorerBaseName(path: string): string {
  const value = normalizeExplorerPath(path).split('/').filter(Boolean).at(-1)
  if (!value) {
    throw new ExplorerAdapterError(explorerError('invalidIntent', 'Resource path is empty'))
  }
  return value
}

function resourceOpenTarget(target?: VirtualOpenTarget): ResourceOpenTarget | undefined {
  if (!target) return undefined
  if (target.type === 'hermesSession') {
    if (!target.sessionId) return undefined
    return { type: 'hermesSession', sessionId: target.sessionId, readOnly: target.readOnly }
  }
  return {
    type: 'hermesDraft',
    ...(target.projectPath ? { projectPath: target.projectPath } : {}),
    readOnly: target.readOnly,
  }
}

export function explorerResourceForFile(
  file: FileItem,
  virtualEntry?: VirtualEntry,
): ResourceSummary {
  const openTarget = resourceOpenTarget(virtualEntry?.openTarget)
  const resource = file.resource
    ? file.resource
    : resourceForFileItem(file, {
        ...(virtualEntry?.appearance ? { appearance: virtualEntry.appearance } : {}),
        ...(openTarget
          ? {
              kind: openTarget.type === 'hermesSession' ? 'conversation' : 'draft',
              presentation: 'conversation',
              providerOperations: ['read'],
              openTarget,
            }
          : {}),
      })
  if (!openTarget || resource.openTarget) return resource
  return { ...resource, openTarget }
}

export function uniqueCapabilities(
  ...groups: ReadonlyArray<readonly ExplorerCapability[]>
): ExplorerCapability[] {
  return [...new Set(groups.flat())]
}

export function explorerItemFromFile(
  file: FileItem,
  capabilities: readonly ExplorerCapability[],
  virtualEntry?: VirtualEntry,
): ExplorerItem {
  const resource = explorerResourceForFile(file, virtualEntry)
  return Object.freeze({
    key: explorerItemKey(resource.ref),
    file: { ...file, resource },
    resource,
    capabilities: Object.freeze(uniqueCapabilities(resource.providerOperations, capabilities)),
    ...(virtualEntry ? { virtualEntry } : {}),
  })
}

function resourceRefs(value: unknown): ResourceRef[] | undefined {
  if (!Array.isArray(value)) return undefined
  const refs = value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return []
    const ref = candidate as Partial<ResourceRef>
    return typeof ref.libraryId === 'string' && typeof ref.resourceId === 'string'
      ? [{ libraryId: ref.libraryId, resourceId: ref.resourceId }]
      : []
  })
  return refs.length ? refs : undefined
}

function receiptRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

export function commandReceipt(response: CommandResponse | unknown): ExplorerCommandReceipt {
  const body = receiptRecord(response)
  const direct = receiptRecord(body?.receipt)
  const first = Array.isArray(body?.receipts) ? receiptRecord(body.receipts[0]) : undefined
  const receipt = direct ?? first ?? body
  const commandId = text(receipt?.commandId)
  const affectedRefs = resourceRefs(receipt?.affectedRefs)
  return Object.freeze({
    ...(commandId ? { commandId } : {}),
    ...(affectedRefs ? { affectedRefs } : {}),
    data: response,
  })
}

export function forbiddenAdapterCommand(message: string): never {
  throw new ExplorerAdapterError(explorerError('forbidden', message))
}

export function offlineCapabilities(
  item: ExplorerItem,
  offline?: ExplorerOfflineCallbacks,
): ExplorerCapability[] {
  if (!offline) return []
  const kept = offline.isKept?.(item) ?? false
  if (kept && offline.remove) return ['removeOffline']
  if (!kept && offline.keep) return ['keepOffline']
  return []
}

export async function executeOfflineCommand(
  kind: 'keepOffline' | 'removeOffline',
  item: ExplorerItem,
  offline: ExplorerOfflineCallbacks | undefined,
  signal: AbortSignal,
): Promise<ExplorerCommandReceipt> {
  const callback = kind === 'keepOffline' ? offline?.keep : offline?.remove
  if (!callback) forbiddenAdapterCommand(`${kind} is unavailable`)
  const data = await callback(item, signal)
  return Object.freeze({ affectedRefs: [item.resource.ref], data })
}
