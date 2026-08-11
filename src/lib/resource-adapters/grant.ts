import type {
  ExplorerActionPlan,
  ExplorerCapability,
  ExplorerCommand,
  ExplorerCommandReceipt,
  ExplorerItem,
  ExplorerPage,
  ExplorerResourceAdapter,
} from '@/lib/explorer-model'
import type { ShareRestrictions } from '@/lib/shares'
import { MediaType, type FileItem } from '@/lib/types'
import type { DirectoryListing } from '@/lib/virtual-directory'
import { grantOpenScope } from '@/src/lib/legacy-resource-adapter'
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

export type GrantExplorerAdapterOptions = Readonly<{
  token: string
  rootPath: string
  editable: boolean
  restrictions?: ShareRestrictions
  initialListing?: Readonly<{ path: string; listing: DirectoryListing }>
  scopeId?: string
  fetch?: ExplorerFetch
  subscribe?: ExplorerSubscription
  dispose?: () => void
  offline?: ExplorerOfflineCallbacks
}>

type GrantAccess = Readonly<{
  edit: boolean
  upload: boolean
  delete: boolean
}>

function access(options: GrantExplorerAdapterOptions): GrantAccess {
  return {
    edit: options.editable && options.restrictions?.allowEdit !== false,
    upload: options.editable && options.restrictions?.allowUpload !== false,
    delete: options.editable && options.restrictions?.allowDelete !== false,
  }
}

function requireAccess(allowed: boolean, action: string) {
  if (!allowed) forbiddenAdapterCommand(`${action} is forbidden by Grant restrictions`)
}

function relativePath(rootPath: string, input: string): string {
  const root = normalizeExplorerPath(rootPath)
  const path = normalizeExplorerPath(input)
  if (!root || path === root) return path === root ? '' : path
  return path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

function fullPath(rootPath: string, relative: string): string {
  const root = normalizeExplorerPath(rootPath)
  const path = normalizeExplorerPath(relative)
  return [root, path].filter(Boolean).join('/')
}

function itemCapabilities(
  options: GrantExplorerAdapterOptions,
  file: FileItem,
): ExplorerCapability[] {
  const grant = access(options)
  const result: ExplorerCapability[] = ['open']
  if (grant.edit) {
    result.push('rename', 'move')
    if (!file.isDirectory) result.push('replace')
  }
  if (grant.upload) result.push('copy')
  if (grant.delete) result.push('delete')
  return result
}

function listingItem(options: GrantExplorerAdapterOptions, file: FileItem): ExplorerItem {
  const base = explorerItemFromFile(file, itemCapabilities(options, file))
  const extra = offlineCapabilities(base, options.offline)
  return extra.length
    ? Object.freeze({
        ...base,
        capabilities: Object.freeze(uniqueCapabilities(base.capabilities, extra)),
      })
    : base
}

function pageCapabilities(options: GrantExplorerAdapterOptions): ExplorerCapability[] {
  const grant = access(options)
  return uniqueCapabilities(
    grant.upload ? ['createFile', 'createFolder', 'upload'] : [],
    grant.edit ? ['move'] : [],
  )
}

export function createGrantExplorerAdapter(
  options: GrantExplorerAdapterOptions,
): ExplorerResourceAdapter {
  if (!options.token) forbiddenAdapterCommand('Grant token is required')
  const fetcher = options.fetch ?? defaultExplorerFetch()
  const base = `/api/share/${encodeURIComponent(options.token)}`
  let resolvedRootPath = normalizeExplorerPath(options.rootPath)
  let initialListing = options.initialListing
  const toRelativePath = (path: string) => relativePath(resolvedRootPath, path)

  function validPagePath(path: string): boolean {
    return !path
      .replace(/\\/g, '/')
      .split('/')
      .filter(Boolean)
      .some((segment) => segment === '.' || segment === '..')
  }

  function requireGrantItemPath(path: string): string {
    const normalized = normalizeExplorerPath(path)
    if (
      resolvedRootPath &&
      normalized !== resolvedRootPath &&
      !normalized.startsWith(`${resolvedRootPath}/`)
    ) {
      forbiddenAdapterCommand('Resource is outside this Grant root')
    }
    return normalized
  }

  function inferHiddenRoot(queryPath: string, files: readonly FileItem[]) {
    if (resolvedRootPath || files.length === 0) return
    const expectedParent = normalizeExplorerPath(queryPath)
    const parents = new Set(files.map((file) => explorerParentPath(file.path)))
    if (parents.size !== 1) return
    const [parent = ''] = parents
    if (!expectedParent) {
      resolvedRootPath = parent
      return
    }
    if (parent.endsWith(`/${expectedParent}`)) {
      resolvedRootPath = parent.slice(0, -(expectedParent.length + 1))
    }
  }

  function itemForPath(path: string): ExplorerItem {
    const full = fullPath(resolvedRootPath, path)
    const name = full.split('/').filter(Boolean).at(-1) ?? 'Shared folder'
    return listingItem(options, {
      name,
      path: full,
      type: MediaType.FOLDER,
      size: 0,
      extension: '',
      isDirectory: true,
    })
  }
  const subscribe = combineExplorerSubscriptions(options.subscribe, options.offline?.subscribe)

  async function browse(
    query: Parameters<ExplorerResourceAdapter['browse']>[0],
    signal: AbortSignal,
  ): Promise<ExplorerPage> {
    if (query.cursor) forbiddenAdapterCommand('Grant listing does not support pagination cursors')
    const path = normalizeExplorerPath(query.path)
    const relative = toRelativePath(path)
    const hydrated =
      !signal.aborted && initialListing && normalizeExplorerPath(initialListing.path) === path
        ? initialListing
        : undefined
    if (hydrated) initialListing = undefined
    const listing = hydrated
      ? hydrated.listing
      : await fetchExplorerJson<DirectoryListing>(
          fetcher,
          `${base}/files?dir=${encodeURIComponent(relative)}`,
          { method: 'GET' },
          signal,
        )
    inferHiddenRoot(relative, listing.files)
    const items = listing.files.map((file) => listingItem(options, file))
    return Object.freeze({
      items: Object.freeze(items),
      capabilities: Object.freeze(pageCapabilities(options)),
      total: items.length,
    })
  }

  async function execute(
    command: ExplorerCommand,
    signal: AbortSignal,
  ): Promise<ExplorerCommandReceipt> {
    const grant = access(options)
    if (command.kind === 'createFile' || command.kind === 'createFolder') {
      requireAccess(grant.upload, command.kind)
      const parent = toRelativePath(command.parentPath)
      const path = joinExplorerPath(parent, command.name)
      return commandReceipt(
        await postExplorerJson(
          fetcher,
          `${base}/create`,
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
      requireAccess(grant.upload, command.kind)
      const form = new FormData()
      form.append('targetDir', toRelativePath(command.parentPath))
      for (const file of command.files) form.append('files', file, file.name)
      return commandReceipt(
        await fetchExplorerJson(fetcher, `${base}/upload`, { method: 'POST', body: form }, signal),
      )
    }
    if (command.kind === 'replace') {
      requireAccess(grant.edit, command.kind)
      if (command.item.file.isDirectory) forbiddenAdapterCommand('Folders cannot be replaced')
      if (command.content === undefined && command.base64Content === undefined) {
        forbiddenAdapterCommand('Replacement content is required')
      }
      return commandReceipt(
        await postExplorerJson(
          fetcher,
          `${base}/edit`,
          {
            path: toRelativePath(command.item.file.path),
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
      requireAccess(grant.edit, command.kind)
      const oldPath = toRelativePath(command.item.file.path)
      const newPath = joinExplorerPath(explorerParentPath(oldPath), command.name)
      return commandReceipt(
        await postExplorerJson(fetcher, `${base}/rename`, { oldPath, newPath }, signal),
      )
    }
    if (command.kind === 'move') {
      requireAccess(grant.edit, command.kind)
      const oldPath = toRelativePath(command.item.file.path)
      const destination = toRelativePath(command.destinationPath)
      const newPath = joinExplorerPath(destination, explorerBaseName(oldPath))
      return commandReceipt(
        await postExplorerJson(fetcher, `${base}/rename`, { oldPath, newPath }, signal),
      )
    }
    if (command.kind === 'moveExternal') {
      requireAccess(grant.edit, command.kind)
      const oldPath = toRelativePath(command.source.file.path)
      const destination = toRelativePath(command.destinationPath)
      const newPath = joinExplorerPath(destination, explorerBaseName(oldPath))
      return commandReceipt(
        await postExplorerJson(fetcher, `${base}/rename`, { oldPath, newPath }, signal),
      )
    }
    if (command.kind === 'copy') {
      requireAccess(grant.upload, command.kind)
      return commandReceipt(
        await postExplorerJson(
          fetcher,
          `${base}/copy`,
          {
            sourcePath: toRelativePath(command.item.file.path),
            destinationDir: toRelativePath(command.destinationPath),
          },
          signal,
        ),
      )
    }
    if (command.kind === 'delete') {
      requireAccess(grant.delete, command.kind)
      return commandReceipt(
        await postExplorerJson(
          fetcher,
          `${base}/delete`,
          { path: toRelativePath(command.item.file.path) },
          signal,
        ),
      )
    }
    if (command.kind === 'recordView') {
      return commandReceipt(
        await postExplorerJson(
          fetcher,
          `${base}/view`,
          { filePath: toRelativePath(command.item.file.path) },
          signal,
        ),
      )
    }
    if (command.kind === 'keepOffline' || command.kind === 'removeOffline') {
      requireGrantItemPath(command.item.file.path)
      return executeOfflineCommand(command.kind, command.item, options.offline, signal)
    }
    if (
      command.kind === 'favorite' ||
      command.kind === 'share' ||
      command.kind === 'setKnowledgeBase' ||
      command.kind === 'setAppearance' ||
      command.kind === 'setAppearanceExternal' ||
      command.kind === 'providerAction' ||
      command.kind === 'providerDirectoryAction' ||
      command.kind === 'revokeShare'
    ) {
      forbiddenAdapterCommand(`${command.kind} is unavailable to Grant explorers`)
    }
    forbiddenAdapterCommand('Command is unavailable to Grant explorers')
  }

  function plan(action: ExplorerActionPlan['kind'], item: ExplorerItem): ExplorerActionPlan {
    if (action === 'download' && item.capabilities.includes('download')) {
      const relative = toRelativePath(item.file.path)
      return {
        kind: 'download',
        href: `${base}/download?path=${encodeURIComponent(relative)}`,
        fileName: item.file.isDirectory ? `${item.file.name}.zip` : item.file.name,
      }
    }
    forbiddenAdapterCommand(`${action} is unavailable to Grant explorers`)
  }

  return {
    scope: {
      kind: 'grant',
      id:
        options.scopeId ??
        (grantOpenScope(options.token) as Readonly<{ kind: 'grant'; id: string }>).id,
    },
    browse,
    async prefetch(query, signal) {
      await browse(query, signal)
    },
    execute,
    plan,
    itemForPath,
    capabilitiesForPath: (path) => itemForPath(path).capabilities,
    provisionalPageCapabilitiesForPath: (path) =>
      validPagePath(path) ? pageCapabilities(options) : [],
    ...(subscribe ? { subscribe } : {}),
    ...(options.dispose ? { dispose: options.dispose } : {}),
  }
}

export function grantExplorerFullPath(rootPath: string, relative: string): string {
  return fullPath(rootPath, relative)
}
