import type {
  ExplorerActionPlan,
  ExplorerCapability,
  ExplorerCommand,
  ExplorerCommandReceipt,
  ExplorerItem,
  ExplorerPage,
  ExplorerResourceAdapter,
  ExplorerViewMode,
} from '@/lib/explorer-model'
import { MediaType, type FileItem } from '@/lib/types'
import type { DirectoryListing, VirtualEntry } from '@/lib/virtual-directory'
import type { AuthConfig } from '@/src/file-browser/types'
import type { OpenSurface } from '@/src/lib/open-resource'
import { isVirtualFolderPath } from '@/lib/constants'
import { isPathEditable, type ClientMediaRoot } from '@/lib/utils'
import {
  commandReceipt,
  combineExplorerSubscriptions,
  defaultExplorerFetch,
  executeOfflineCommand,
  explorerBaseName,
  explorerItemFromFile,
  explorerParentPath,
  fetchExplorerJson,
  forbiddenAdapterCommand,
  joinExplorerPath,
  normalizeExplorerPath,
  offlineCapabilities,
  postExplorerJson,
  uniqueCapabilities,
  type ExplorerFetch,
  type ExplorerOfflineCallbacks,
  type ExplorerSubscription,
} from './shared'

export type OwnerExplorerSurface = Exclude<OpenSurface, 'share'>

export type OwnerExplorerAdapterOptions = Readonly<{
  authConfig?: AuthConfig | (() => AuthConfig)
  editableRoots?: readonly string[]
  mediaRoots?: readonly ClientMediaRoot[]
  initialListing?: Readonly<{ path: string; listing: DirectoryListing }>
  surface?: OwnerExplorerSurface
  scopeId?: string
  fetch?: ExplorerFetch
  subscribe?: ExplorerSubscription
  dispose?: () => void
  offline?: ExplorerOfflineCallbacks
}>

function cursorOffset(cursor?: string): number {
  if (!cursor) return 0
  const match = /^offset:(\d+)$/.exec(cursor)
  if (!match) forbiddenAdapterCommand('Invalid Explorer page cursor')
  return Number(match[1])
}

function authConfig(options: OwnerExplorerAdapterOptions): AuthConfig {
  const supplied =
    typeof options.authConfig === 'function' ? options.authConfig() : options.authConfig
  if (supplied) return supplied
  return {
    enabled: false,
    editableFolders: [...(options.editableRoots ?? [])],
    ...(options.mediaRoots
      ? {
          mediaRoots: options.mediaRoots.map((root) => ({
            id: root.id ?? root.name,
            name: root.name,
            editableFolders: [...root.editableFolders],
            readOnly: !!root.readOnly,
            source: 'config' as const,
          })),
        }
      : {}),
  }
}

function editable(options: OwnerExplorerAdapterOptions, path: string): boolean {
  const config = authConfig(options)
  return isPathEditable(normalizeExplorerPath(path), config.editableFolders, config.mediaRoots)
}

function hasEditableDestination(options: OwnerExplorerAdapterOptions): boolean {
  const config = authConfig(options)
  return (
    config.editableFolders.length > 0 &&
    !(config.mediaRoots?.length && config.mediaRoots.every((root) => root.readOnly))
  )
}

function ordinaryItemCapabilities(
  options: OwnerExplorerAdapterOptions,
  file: FileItem,
): ExplorerCapability[] {
  if (file.isVirtual) return []
  if (file.shareToken) return ['open', 'revokeShare', 'copyShareLink']
  const result: ExplorerCapability[] = ['open', 'share', 'setAppearance', 'favorite']
  if (file.isDirectory) result.push('setKnowledgeBase')
  if (hasEditableDestination(options)) result.push('copy')
  if (editable(options, file.path)) {
    result.push('rename', 'move', 'delete')
    if (!file.isDirectory) result.push('replace')
  }
  return result
}

function listingItem(
  options: OwnerExplorerAdapterOptions,
  file: FileItem,
  entry?: VirtualEntry,
): ExplorerItem {
  const base = explorerItemFromFile(
    file,
    entry ? entry.capabilities : ordinaryItemCapabilities(options, file),
    entry,
  )
  if (entry) {
    const capabilities = uniqueCapabilities(
      entry.capabilities,
      entry.capabilities.includes('open') ? (file.isDirectory ? ['browse'] : ['read']) : [],
    )
    return Object.freeze({ ...base, capabilities: Object.freeze(capabilities) })
  }
  const extra = offlineCapabilities(base, options.offline)
  return extra.length
    ? Object.freeze({
        ...base,
        capabilities: Object.freeze(uniqueCapabilities(base.capabilities, extra)),
      })
    : base
}

function directoryCapabilities(
  options: OwnerExplorerAdapterOptions,
  path: string,
  listing: DirectoryListing,
): ExplorerCapability[] {
  if (listing.virtualDirectory) return [...listing.virtualDirectory.capabilities]
  return editable(options, path)
    ? ['createFile', 'createFolder', 'upload', 'move', 'setAppearance']
    : []
}

function itemForPath(
  options: OwnerExplorerAdapterOptions,
  path: string,
  isVirtualPath: (path: string) => boolean = isVirtualFolderPath,
): ExplorerItem | undefined {
  const normalized = normalizeExplorerPath(path)
  if (normalized && isVirtualPath(normalized)) return undefined
  const name = normalized.split('/').filter(Boolean).at(-1) ?? 'Library'
  return explorerItemFromFile(
    {
      name,
      path: normalized,
      type: MediaType.FOLDER,
      size: 0,
      extension: '',
      isDirectory: true,
    },
    normalized && editable(options, normalized) ? ['open', 'move', 'setAppearance'] : ['open'],
  )
}

function requireEditable(options: OwnerExplorerAdapterOptions, path: string, action: string) {
  if (!editable(options, path)) forbiddenAdapterCommand(`${action} is unavailable for this path`)
}

function requireDestination(options: OwnerExplorerAdapterOptions, path: string, action: string) {
  requireEditable(options, path, action)
}

function providerBody(command: Readonly<{ value?: unknown }>) {
  const value = command.value
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    return {
      ...(typeof record.name === 'string' ? { name: record.name } : {}),
      ...(record.metadata && typeof record.metadata === 'object'
        ? { metadata: record.metadata }
        : {}),
    }
  }
  return typeof value === 'string' ? { name: value } : {}
}

export function createOwnerExplorerAdapter(
  options: OwnerExplorerAdapterOptions = {},
): ExplorerResourceAdapter {
  const fetcher = options.fetch ?? defaultExplorerFetch()
  const surface = options.surface ?? 'library'
  const viewModeWrites = new Map<string, Promise<void>>()
  const virtualPaths = new Set<string>()
  const subscribe = combineExplorerSubscriptions(options.subscribe, options.offline?.subscribe)
  let initialListing = options.initialListing

  function rememberVirtualPath(path: string) {
    const parts = normalizeExplorerPath(path).split('/').filter(Boolean)
    for (let index = 0; index < parts.length; index += 1) {
      virtualPaths.add(parts.slice(0, index + 1).join('/'))
    }
  }

  function knownVirtualPath(path: string) {
    const normalized = normalizeExplorerPath(path)
    return isVirtualFolderPath(normalized) || virtualPaths.has(normalized)
  }

  async function browse(
    query: Parameters<ExplorerResourceAdapter['browse']>[0],
    signal: AbortSignal,
  ): Promise<ExplorerPage> {
    const path = normalizeExplorerPath(query.path)
    const offset = cursorOffset(query.cursor)
    const hydrated =
      !signal.aborted &&
      offset === 0 &&
      initialListing &&
      normalizeExplorerPath(initialListing.path) === path
        ? initialListing
        : undefined
    if (hydrated) initialListing = undefined
    const listing = hydrated
      ? hydrated.listing
      : await fetchExplorerJson<DirectoryListing>(
          fetcher,
          `/api/files?surface=${encodeURIComponent(surface)}&dir=${encodeURIComponent(path)}&offset=${offset}`,
          { method: 'GET' },
          signal,
        )
    const entries = listing.virtualEntries ?? {}
    if (listing.virtualDirectory) rememberVirtualPath(path)
    for (const file of listing.files) {
      if (file.isDirectory && entries[file.path]) rememberVirtualPath(file.path)
    }
    const items = listing.files.map((file) => listingItem(options, file, entries[file.path]))
    const total = listing.virtualDirectory?.total ?? items.length
    const nextOffset = listing.virtualDirectory?.nextOffset
    return Object.freeze({
      items: Object.freeze(items),
      capabilities: Object.freeze(directoryCapabilities(options, path, listing)),
      ...(listing.virtualDirectory ? { virtualDirectory: listing.virtualDirectory } : {}),
      ...(nextOffset === undefined ? {} : { nextCursor: `offset:${nextOffset}` }),
      total,
    })
  }

  async function execute(
    command: ExplorerCommand,
    signal: AbortSignal,
  ): Promise<ExplorerCommandReceipt> {
    if (command.kind === 'createFile' || command.kind === 'createFolder') {
      requireEditable(options, command.parentPath, command.kind)
      const path = joinExplorerPath(command.parentPath, command.name)
      return commandReceipt(
        await postExplorerJson(
          fetcher,
          '/api/files/create',
          command.kind === 'createFolder'
            ? { type: 'folder', path }
            : {
                type: 'file',
                path,
                ...(command.content === undefined
                  ? command.base64Content === undefined
                    ? { content: '' }
                    : {}
                  : { content: command.content }),
                ...(command.base64Content === undefined
                  ? {}
                  : { base64Content: command.base64Content }),
              },
          signal,
        ),
      )
    }
    if (command.kind === 'upload') {
      requireEditable(options, command.parentPath, command.kind)
      const form = new FormData()
      form.append('targetDir', normalizeExplorerPath(command.parentPath))
      for (const file of command.files) form.append('files', file, file.name)
      return commandReceipt(
        await fetchExplorerJson(
          fetcher,
          '/api/files/upload',
          { method: 'POST', body: form },
          signal,
        ),
      )
    }
    if (command.kind === 'replace') {
      requireEditable(options, command.item.file.path, command.kind)
      if (command.item.file.isDirectory) forbiddenAdapterCommand('Folders cannot be replaced')
      if (command.content === undefined && command.base64Content === undefined) {
        forbiddenAdapterCommand('Replacement content is required')
      }
      return commandReceipt(
        await postExplorerJson(
          fetcher,
          '/api/files/edit',
          {
            path: normalizeExplorerPath(command.item.file.path),
            ...(command.content === undefined ? {} : { content: command.content }),
            ...(command.base64Content === undefined
              ? {}
              : { base64Content: command.base64Content }),
            ...(command.expectedVersion === undefined
              ? {}
              : { expectedVersion: command.expectedVersion }),
          },
          signal,
        ),
      )
    }
    if (command.kind === 'rename') {
      requireEditable(options, command.item.file.path, command.kind)
      const oldPath = normalizeExplorerPath(command.item.file.path)
      const newPath = joinExplorerPath(explorerParentPath(oldPath), command.name)
      return commandReceipt(
        await postExplorerJson(fetcher, '/api/files/rename', { oldPath, newPath }, signal),
      )
    }
    if (command.kind === 'move') {
      requireEditable(options, command.item.file.path, command.kind)
      requireDestination(options, command.destinationPath, command.kind)
      const oldPath = normalizeExplorerPath(command.item.file.path)
      const newPath = joinExplorerPath(command.destinationPath, explorerBaseName(oldPath))
      return commandReceipt(
        await postExplorerJson(fetcher, '/api/files/rename', { oldPath, newPath }, signal),
      )
    }
    if (command.kind === 'moveExternal') {
      requireEditable(options, command.source.file.path, command.kind)
      requireDestination(options, command.destinationPath, command.kind)
      const oldPath = normalizeExplorerPath(command.source.file.path)
      const newPath = joinExplorerPath(command.destinationPath, explorerBaseName(oldPath))
      return commandReceipt(
        await postExplorerJson(fetcher, '/api/files/rename', { oldPath, newPath }, signal),
      )
    }
    if (command.kind === 'copy') {
      requireDestination(options, command.destinationPath, command.kind)
      return commandReceipt(
        await postExplorerJson(
          fetcher,
          '/api/files/copy',
          {
            sourcePath: normalizeExplorerPath(command.item.file.path),
            destinationDir: normalizeExplorerPath(command.destinationPath),
          },
          signal,
        ),
      )
    }
    if (command.kind === 'delete') {
      requireEditable(options, command.item.file.path, command.kind)
      return commandReceipt(
        await postExplorerJson(
          fetcher,
          '/api/files/delete',
          { path: normalizeExplorerPath(command.item.file.path) },
          signal,
        ),
      )
    }
    if (command.kind === 'favorite') {
      return commandReceipt(
        await postExplorerJson(
          fetcher,
          '/api/settings/favorite',
          { filePath: normalizeExplorerPath(command.item.file.path) },
          signal,
        ),
      )
    }
    if (command.kind === 'setKnowledgeBase') {
      if (!command.item.file.isDirectory) forbiddenAdapterCommand('Knowledge bases must be folders')
      return commandReceipt(
        await postExplorerJson(
          fetcher,
          '/api/settings/knowledgeBase',
          { filePath: normalizeExplorerPath(command.item.file.path) },
          signal,
        ),
      )
    }
    if (command.kind === 'setAppearance') {
      const path = normalizeExplorerPath(command.item.file.path)
      return commandReceipt(
        await postExplorerJson(
          fetcher,
          command.iconName ? '/api/settings/icon' : '/api/settings/icon/remove',
          command.iconName ? { path, iconName: command.iconName } : { path },
          signal,
        ),
      )
    }
    if (command.kind === 'setAppearanceExternal') {
      const path = normalizeExplorerPath(command.target.file.path)
      requireEditable(options, path, command.kind)
      return commandReceipt(
        await postExplorerJson(
          fetcher,
          command.iconName ? '/api/settings/icon' : '/api/settings/icon/remove',
          command.iconName ? { path, iconName: command.iconName } : { path },
          signal,
        ),
      )
    }
    if (command.kind === 'providerAction') {
      if (!command.item.virtualEntry?.capabilities.includes(command.action)) {
        forbiddenAdapterCommand(`Provider action ${command.action} is unavailable`)
      }
      return commandReceipt(
        await postExplorerJson(
          fetcher,
          '/api/virtual-directory/action',
          {
            ...providerBody(command),
            action: command.action,
            path: normalizeExplorerPath(command.item.file.path),
          },
          signal,
        ),
      )
    }
    if (command.kind === 'providerDirectoryAction') {
      return commandReceipt(
        await postExplorerJson(
          fetcher,
          '/api/virtual-directory/action',
          {
            ...providerBody(command),
            action: command.action,
            path: normalizeExplorerPath(command.path),
          },
          signal,
        ),
      )
    }
    if (command.kind === 'recordView') {
      return commandReceipt(
        await postExplorerJson(
          fetcher,
          '/api/stats/views',
          { filePath: normalizeExplorerPath(command.item.file.path) },
          signal,
        ),
      )
    }
    if (command.kind === 'revokeShare') {
      if (!command.item.file.shareToken) {
        forbiddenAdapterCommand('Resource is not a shared collection')
      }
      return commandReceipt(
        await postExplorerJson(
          fetcher,
          '/api/shares/delete',
          { token: command.item.file.shareToken },
          signal,
        ),
      )
    }
    if (command.kind === 'keepOffline' || command.kind === 'removeOffline') {
      return executeOfflineCommand(command.kind, command.item, options.offline, signal)
    }
    if (command.kind === 'share')
      return Object.freeze({ data: { kind: 'share', item: command.item } })
    forbiddenAdapterCommand('Command is unavailable for owner resources')
  }

  function plan(action: ExplorerActionPlan['kind'], item: ExplorerItem): ExplorerActionPlan {
    if (action === 'download' && item.capabilities.includes('download')) {
      if (item.virtualEntry) {
        return {
          kind: 'download',
          href: `/api/virtual-directory/export?path=${encodeURIComponent(item.file.path)}`,
          fileName: `${item.file.name}.json`,
        }
      }
      return {
        kind: 'download',
        href: `/api/files/download?path=${encodeURIComponent(item.file.path)}`,
        fileName: item.file.isDirectory ? `${item.file.name}.zip` : item.file.name,
      }
    }
    if (action === 'share' && item.capabilities.includes('share')) return { kind: 'share', item }
    forbiddenAdapterCommand(`${action} is unavailable for this resource`)
  }

  return {
    scope: { kind: 'owner', id: options.scopeId ?? 'owner' },
    browse,
    async prefetch(query, signal) {
      await browse(query, signal)
    },
    execute,
    plan,
    itemForPath: (path) => itemForPath(options, path, knownVirtualPath),
    capabilitiesForPath: (path) => itemForPath(options, path, knownVirtualPath)?.capabilities ?? [],
    provisionalPageCapabilitiesForPath(path) {
      const normalized = normalizeExplorerPath(path)
      if (knownVirtualPath(normalized)) return []
      return editable(options, normalized)
        ? ['createFile', 'createFolder', 'upload', 'move', 'setAppearance']
        : []
    },
    persistViewMode(path: string, viewMode: ExplorerViewMode, signal: AbortSignal) {
      const normalized = normalizeExplorerPath(path)
      const previous = viewModeWrites.get(normalized) ?? Promise.resolve()
      const next = previous
        .catch(() => undefined)
        .then(async () => {
          await postExplorerJson(
            fetcher,
            '/api/settings/viewMode',
            { path: normalized, viewMode },
            signal,
          )
        })
      viewModeWrites.set(normalized, next)
      const cleanup = () => {
        if (viewModeWrites.get(normalized) === next) viewModeWrites.delete(normalized)
      }
      void next.then(cleanup, cleanup)
      return next
    },
    ...(subscribe ? { subscribe } : {}),
    ...(options.dispose ? { dispose: options.dispose } : {}),
  }
}
