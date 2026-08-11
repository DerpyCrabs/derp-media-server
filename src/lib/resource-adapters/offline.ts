import type {
  ExplorerActionPlan,
  ExplorerBrowseQuery,
  ExplorerCapability,
  ExplorerCommand,
  ExplorerCommandReceipt,
  ExplorerItem,
  ExplorerPage,
  ExplorerResourceAdapter,
} from '@/lib/explorer-model'
import type { ProviderOperation, ResourceSummary } from '@/lib/resource'
import { MediaType, type FileItem } from '@/lib/types'
import { ExplorerAdapterError, explorerError, explorerItemKey } from '@/lib/explorer-model'
import { resourceForFileItem } from '../legacy-resource-adapter'
import {
  readWebOfflineEntries,
  removeWebOfflineAndWait,
  subscribeWebOfflineCatalog,
  type StoredOfflineEntry,
} from '../web-offline-storage'

export type OfflineExplorerCatalog = Readonly<{
  read(signal: AbortSignal): Promise<readonly StoredOfflineEntry[]>
  remove(path: string, name: string, signal: AbortSignal): Promise<void>
  subscribe?(listener: () => void): () => void
}>

type OfflineResourceAdapterOptions = Readonly<{
  catalog?: OfflineExplorerCatalog
  scopeId?: string
  mediaBaseUrl?: string
}>

const MEDIA_TYPES = new Set<string>(Object.values(MediaType))

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException('Offline catalog request was cancelled', 'AbortError')
}

function normalizedPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/')
}

function mediaType(type: string | undefined, isDirectory: boolean): MediaType {
  if (isDirectory) return MediaType.FOLDER
  return type && MEDIA_TYPES.has(type) ? (type as MediaType) : MediaType.OTHER
}

function operationsFor(file: FileItem): ProviderOperation[] {
  if (file.isDirectory) return ['browse']
  if (file.type === MediaType.AUDIO || file.type === MediaType.VIDEO) {
    return ['read', 'stream', 'download']
  }
  return ['read', 'download']
}

function offlineResource(file: FileItem, stored?: ResourceSummary): ResourceSummary {
  const base = stored ?? resourceForFileItem(file)
  return {
    ...base,
    name: file.name,
    size: file.size,
    providerOperations: operationsFor(file),
    availability: 'present',
  }
}

function itemCapabilities(file: FileItem): readonly ExplorerCapability[] {
  return ['open', ...operationsFor(file), 'removeOffline']
}

function offlineListing(entries: readonly StoredOfflineEntry[], directory: string): FileItem[] {
  const normalizedDirectory = normalizedPath(directory)
  const exactEntries = new Map<string, StoredOfflineEntry>()
  for (const candidate of entries) {
    const path = normalizedPath(candidate.path)
    if (!exactEntries.has(path)) exactEntries.set(path, candidate)
  }

  const children = new Map<string, FileItem>()
  for (const entry of entries) {
    const path = normalizedPath(entry.path)
    let relative: string
    if (!normalizedDirectory) relative = path
    else if (path === normalizedDirectory) continue
    else if (path.startsWith(`${normalizedDirectory}/`)) {
      relative = path.slice(normalizedDirectory.length + 1)
    } else continue
    if (!relative) continue

    const name = relative.split('/')[0]!
    const childPath = normalizedDirectory ? `${normalizedDirectory}/${name}` : name
    const exact = exactEntries.get(childPath)
    const isDirectory = relative.includes('/') || exact?.isDirectory === true
    const type = mediaType(isDirectory ? 'folder' : (exact?.type ?? entry.type), isDirectory)
    const file: FileItem = {
      name,
      path: childPath,
      type,
      size: isDirectory ? 0 : (exact?.size ?? entry.size ?? 0),
      extension: isDirectory ? '' : name.includes('.') ? (name.split('.').pop() ?? '') : '',
      isDirectory,
      thumbnailGenerated: type === MediaType.IMAGE || exact?.thumbnailBlob !== undefined,
    }
    const resource = offlineResource(file, exact?.resource)
    children.set(name, { ...file, resource })
  }
  return [...children.values()]
}

function pageOffset(cursor: string | undefined): number {
  if (cursor === undefined) return 0
  if (!/^\d+$/.test(cursor)) {
    throw new ExplorerAdapterError(explorerError('invalidIntent', 'Invalid offline page cursor'))
  }
  return Number(cursor)
}

function explorerItem(file: FileItem): ExplorerItem {
  const resource = file.resource ?? resourceForFileItem(file)
  return {
    key: explorerItemKey(resource.ref),
    file,
    resource,
    capabilities: itemCapabilities(file),
  }
}

function directoryItemForPath(path: string): ExplorerItem {
  const normalized = normalizedPath(path)
  const name = normalized.split('/').filter(Boolean).at(-1) ?? 'Offline'
  const file: FileItem = {
    name,
    path: normalized,
    type: MediaType.FOLDER,
    size: 0,
    extension: '',
    isDirectory: true,
  }
  const resource = offlineResource(file)
  return explorerItem({ ...file, resource })
}

function mediaHref(baseUrl: string, path: string): string {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  return `${base}${normalizedPath(path).split('/').map(encodeURIComponent).join('/')}`
}

export function createBrowserOfflineExplorerCatalog(): OfflineExplorerCatalog {
  return {
    async read(signal) {
      throwIfAborted(signal)
      const entries = await readWebOfflineEntries()
      throwIfAborted(signal)
      return entries
    },
    remove: (path, name, signal) => removeWebOfflineAndWait(path, name, 'owner', signal),
    subscribe: subscribeWebOfflineCatalog,
  }
}

export function createOfflineResourceAdapter(
  options: OfflineResourceAdapterOptions = {},
): ExplorerResourceAdapter {
  const catalog = options.catalog ?? createBrowserOfflineExplorerCatalog()
  const mediaBaseUrl = options.mediaBaseUrl ?? '/api/media/'

  async function browse(query: ExplorerBrowseQuery, signal: AbortSignal): Promise<ExplorerPage> {
    throwIfAborted(signal)
    const files = offlineListing(await catalog.read(signal), query.path)
    throwIfAborted(signal)
    const offset = pageOffset(query.cursor)
    const pageSize = Math.max(1, query.pageSize)
    const items = files.slice(offset, offset + pageSize).map(explorerItem)
    const nextOffset = offset + items.length
    return {
      items,
      capabilities: [],
      ...(nextOffset < files.length ? { nextCursor: String(nextOffset) } : {}),
      total: files.length,
    }
  }

  return {
    scope: { kind: 'offline', id: options.scopeId ?? 'derp-offline-v1' },
    browse,
    async prefetch(query, signal) {
      await browse(query, signal)
    },
    async execute(command: ExplorerCommand, signal: AbortSignal): Promise<ExplorerCommandReceipt> {
      if (command.kind === 'removeOffline') {
        throwIfAborted(signal)
        await catalog.remove(command.item.file.path, command.item.file.name, signal)
        throwIfAborted(signal)
        return { affectedRefs: [command.item.resource.ref] }
      }
      throw new ExplorerAdapterError(
        explorerError(
          'offlineUnavailable',
          `${command.kind} is unavailable while browsing offline files`,
        ),
      )
    },
    plan(action, item): ExplorerActionPlan {
      if (action === 'download' && !item.file.isDirectory) {
        return {
          kind: 'download',
          href: mediaHref(mediaBaseUrl, item.file.path),
          fileName: item.file.name,
        }
      }
      throw new ExplorerAdapterError(
        explorerError('offlineUnavailable', `${action} is unavailable for this offline item`),
      )
    },
    itemForPath: directoryItemForPath,
    capabilitiesForPath: (path) => directoryItemForPath(path).capabilities,
    provisionalPageCapabilitiesForPath: () => [],
    subscribe: catalog.subscribe,
  }
}
