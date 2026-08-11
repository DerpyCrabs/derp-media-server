import type { ProviderOperation, ResourceRef, ResourceSummary } from './resource'
import type { FileItem } from './types'
import type { VirtualCapability, VirtualDirectory, VirtualEntry } from './virtual-directory'
import type {
  OpenContext,
  OpenIntent,
  OpenPlan,
  OpenSurface,
  ResourceOpener,
} from '@/src/lib/open-resource'

export type ExplorerScope =
  | { kind: 'owner'; id: string }
  | { kind: 'grant'; id: string }
  | { kind: 'offline'; id: string }

export type ExplorerViewMode = 'list' | 'grid'
export type ExplorerSortField = 'default' | 'name' | 'size' | 'kind'
export type ExplorerSortDirection = 'ascending' | 'descending'

export type ExplorerCapability =
  | ProviderOperation
  | VirtualCapability
  | 'createFile'
  | 'createFolder'
  | 'upload'
  | 'replace'
  | 'rename'
  | 'move'
  | 'copy'
  | 'delete'
  | 'favorite'
  | 'share'
  | 'setKnowledgeBase'
  | 'setAppearance'
  | 'keepOffline'
  | 'removeOffline'
  | 'revokeShare'
  | 'copyShareLink'

export type ExplorerErrorCode =
  | 'invalidIntent'
  | 'forbidden'
  | 'notFound'
  | 'conflict'
  | 'versionMismatch'
  | 'quotaExceeded'
  | 'offlineUnavailable'
  | 'cancelled'
  | 'network'
  | 'internal'

export type ExplorerError = Readonly<{
  code: ExplorerErrorCode
  message: string
  retryable: boolean
}>

export type ExplorerItem = Readonly<{
  key: string
  file: FileItem
  resource: ResourceSummary
  capabilities: readonly ExplorerCapability[]
  virtualEntry?: VirtualEntry
}>

export type ExplorerBreadcrumb = Readonly<{
  name: string
  path: string
  capabilities: readonly ExplorerCapability[]
  item?: ExplorerItem
}>

export type ExplorerVisibleRange = Readonly<{
  startIndex: number
  endIndex: number
}>

export type ExplorerPage = Readonly<{
  items: readonly ExplorerItem[]
  capabilities: readonly ExplorerCapability[]
  virtualDirectory?: VirtualDirectory
  nextCursor?: string
  total: number
}>

export type ExplorerBrowseQuery = Readonly<{
  path: string
  cursor?: string
  pageSize: number
}>

export type ExplorerCommand =
  | Readonly<{
      kind: 'createFile'
      parentPath: string
      name: string
      content?: string
      base64Content?: string
    }>
  | Readonly<{ kind: 'createFolder'; parentPath: string; name: string }>
  | Readonly<{ kind: 'upload'; parentPath: string; files: readonly File[] }>
  | Readonly<{
      kind: 'replace'
      item: ExplorerItem
      content?: string
      base64Content?: string
      expectedVersion?: number
    }>
  | Readonly<{ kind: 'rename'; item: ExplorerItem; name: string }>
  | Readonly<{ kind: 'move'; item: ExplorerItem; destinationPath: string }>
  | Readonly<{ kind: 'moveExternal'; source: ExplorerItem; destinationPath: string }>
  | Readonly<{ kind: 'copy'; item: ExplorerItem; destinationPath: string }>
  | Readonly<{ kind: 'delete'; item: ExplorerItem }>
  | Readonly<{ kind: 'favorite'; item: ExplorerItem }>
  | Readonly<{ kind: 'share'; item: ExplorerItem }>
  | Readonly<{ kind: 'setKnowledgeBase'; item: ExplorerItem }>
  | Readonly<{ kind: 'setAppearance'; item: ExplorerItem; iconName: string | null }>
  | Readonly<{
      kind: 'setAppearanceExternal'
      target: ExplorerItem
      iconName: string | null
    }>
  | Readonly<{ kind: 'keepOffline'; item: ExplorerItem }>
  | Readonly<{ kind: 'removeOffline'; item: ExplorerItem }>
  | Readonly<{
      kind: 'providerAction'
      item: ExplorerItem
      action: VirtualCapability
      value?: unknown
    }>
  | Readonly<{
      kind: 'providerDirectoryAction'
      path: string
      action: VirtualCapability
      value?: unknown
    }>
  | Readonly<{ kind: 'recordView'; item: ExplorerItem }>
  | Readonly<{ kind: 'revokeShare'; item: ExplorerItem }>

export type ExplorerCommandReceipt = Readonly<{
  commandId?: string
  affectedRefs?: readonly ResourceRef[]
  data?: unknown
}>

export type ExplorerActionPlan =
  | Readonly<{ kind: 'download'; href: string; fileName: string }>
  | Readonly<{ kind: 'share'; item: ExplorerItem }>

export interface ExplorerResourceAdapter {
  readonly scope: ExplorerScope
  browse(query: ExplorerBrowseQuery, signal: AbortSignal): Promise<ExplorerPage>
  prefetch?(query: ExplorerBrowseQuery, signal: AbortSignal): Promise<void>
  execute(command: ExplorerCommand, signal: AbortSignal): Promise<ExplorerCommandReceipt>
  plan?(action: ExplorerActionPlan['kind'], item: ExplorerItem): ExplorerActionPlan
  itemForPath?(path: string): ExplorerItem | undefined
  capabilitiesForPath?(path: string): readonly ExplorerCapability[]
  provisionalPageCapabilitiesForPath?(path: string): readonly ExplorerCapability[]
  subscribe?(listener: () => void): () => void
  persistViewMode?(path: string, viewMode: ExplorerViewMode, signal: AbortSignal): Promise<void>
  dispose?(): void
}

export interface ExplorerHistoryAdapter {
  current(): string
  push(path: string): void
  replace(path: string): void
  back(): void
  forward(): void
  subscribe(listener: (path: string) => void): () => void
}

export interface ExplorerStorageAdapter {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export interface ExplorerOnlineAdapter {
  getSnapshot(): boolean
  subscribe(listener: () => void): () => void
}

export type ExplorerSnapshot = Readonly<{
  revision: number
  scope: ExplorerScope
  path: string
  breadcrumbs: readonly ExplorerBreadcrumb[]
  items: readonly ExplorerItem[]
  capabilities: readonly ExplorerCapability[]
  virtualDirectory?: VirtualDirectory
  status: 'idle' | 'loading' | 'ready' | 'error'
  error?: ExplorerError
  stale: boolean
  online: boolean
  selection: readonly string[]
  focusedKey?: string
  sort: Readonly<{ field: ExplorerSortField; direction: ExplorerSortDirection }>
  viewMode: ExplorerViewMode
  pagination: Readonly<{
    nextCursor?: string
    total: number
    loadingMore: boolean
  }>
  virtualization: ExplorerVisibleRange & Readonly<{ itemCount: number }>
  pendingCommands: readonly string[]
}>

export type ExplorerIntent =
  | Readonly<{ type: 'initialize' }>
  | Readonly<{ type: 'navigate'; path: string; replace?: boolean }>
  | Readonly<{ type: 'syncHistory'; path: string }>
  | Readonly<{ type: 'back' }>
  | Readonly<{ type: 'forward' }>
  | Readonly<{ type: 'refresh' }>
  | Readonly<{ type: 'loadMore' }>
  | Readonly<{ type: 'visibleRange'; range: ExplorerVisibleRange }>
  | Readonly<{ type: 'prefetch'; path: string }>
  | Readonly<{
      type: 'sort'
      field: ExplorerSortField
      direction?: ExplorerSortDirection
    }>
  | Readonly<{ type: 'viewMode'; viewMode: ExplorerViewMode }>
  | Readonly<{
      type: 'select'
      key: string
      mode?: 'replace' | 'toggle' | 'range'
    }>
  | Readonly<{ type: 'clearSelection' }>
  | Readonly<{ type: 'focus'; key?: string }>
  | Readonly<{ type: 'focusMove'; delta: -1 | 1 }>
  | Readonly<{
      type: 'open'
      key: string
      intent?: OpenIntent
      surface: OpenSurface
    }>
  | Readonly<{ type: 'command'; command: ExplorerCommand }>
  | Readonly<{ type: 'action'; action: ExplorerActionPlan['kind']; key: string }>
  | Readonly<{
      type: 'actionExternal'
      action: ExplorerActionPlan['kind']
      item: ExplorerItem
    }>

export type ExplorerOutcome =
  | Readonly<{ kind: 'state'; snapshot: ExplorerSnapshot }>
  | Readonly<{ kind: 'open'; item: ExplorerItem; plan: OpenPlan }>
  | Readonly<{ kind: 'command'; receipt: ExplorerCommandReceipt; snapshot: ExplorerSnapshot }>
  | Readonly<{ kind: 'action'; plan: ExplorerActionPlan; snapshot: ExplorerSnapshot }>
  | Readonly<{ kind: 'stale'; snapshot: ExplorerSnapshot }>
  | Readonly<{ kind: 'unavailable'; error: ExplorerError; snapshot: ExplorerSnapshot }>

export interface ExplorerModel {
  getSnapshot(): ExplorerSnapshot
  subscribe(listener: () => void): () => void
  dispatch(intent: ExplorerIntent): Promise<ExplorerOutcome>
  dispose(): void
}

export type ExplorerModelDependencies = Readonly<{
  adapter: ExplorerResourceAdapter
  opener: ResourceOpener
  history: ExplorerHistoryAdapter
  storage: ExplorerStorageAdapter
  clock: { now(): number }
  online: ExplorerOnlineAdapter
  pageSize?: number
  paginationMode?: 'visible' | 'all'
  storageKey?: string
  rootLabel?: string
  initialViewMode?: ExplorerViewMode
}>

const COMMAND_CAPABILITY: Record<
  Exclude<ExplorerCommand['kind'], 'providerAction' | 'providerDirectoryAction' | 'recordView'>,
  ExplorerCapability
> = {
  createFile: 'createFile',
  createFolder: 'createFolder',
  upload: 'upload',
  replace: 'replace',
  rename: 'rename',
  move: 'move',
  moveExternal: 'move',
  copy: 'copy',
  delete: 'delete',
  favorite: 'favorite',
  share: 'share',
  setKnowledgeBase: 'setKnowledgeBase',
  setAppearance: 'setAppearance',
  setAppearanceExternal: 'setAppearance',
  keepOffline: 'keepOffline',
  removeOffline: 'removeOffline',
  revokeShare: 'revokeShare',
}

export function explorerItemKey(resource: ResourceRef): string {
  return `${resource.libraryId}:${resource.resourceId}`
}

export function explorerItemCapability(
  item: ExplorerItem | undefined,
  capability: ExplorerCapability,
): boolean {
  return item?.capabilities.includes(capability) ?? false
}

export function explorerCommandCapability(command: ExplorerCommand): ExplorerCapability {
  if (command.kind === 'providerAction' || command.kind === 'providerDirectoryAction') {
    return command.action
  }
  if (command.kind === 'recordView') return 'read'
  return COMMAND_CAPABILITY[command.kind]
}

export function explorerError(
  code: ExplorerErrorCode,
  message: string,
  retryable = false,
): ExplorerError {
  return Object.freeze({ code, message, retryable })
}

export class ExplorerAdapterError extends Error {
  readonly explorerError: ExplorerError

  constructor(error: ExplorerError) {
    super(error.message)
    this.explorerError = error
  }
}

function normalizePath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/{2,}/g, '/')
}

function breadcrumbs(
  path: string,
  rootLabel: string,
  itemForPath?: (path: string) => ExplorerItem | undefined,
  capabilitiesForPath?: (path: string) => readonly ExplorerCapability[],
): ExplorerBreadcrumb[] {
  const parts = normalizePath(path).split('/').filter(Boolean)
  const values = [
    { name: rootLabel, path: '' },
    ...parts.map((name, index) => ({ name, path: parts.slice(0, index + 1).join('/') })),
  ]
  return values.map((value) => {
    try {
      const item = itemForPath?.(value.path)
      return {
        ...value,
        capabilities: Object.freeze([
          ...(item?.capabilities ?? capabilitiesForPath?.(value.path) ?? []),
        ]),
        ...(item ? { item } : {}),
      }
    } catch {
      return { ...value, capabilities: Object.freeze([]) }
    }
  })
}

function parentPath(path: string): string {
  const parts = normalizePath(path).split('/').filter(Boolean)
  return parts.slice(0, -1).join('/')
}

function resourceOperations(item: ExplorerItem): ProviderOperation[] {
  return item.capabilities.filter((capability): capability is ProviderOperation =>
    ['browse', 'read', 'stream', 'download', 'export'].includes(capability),
  )
}

function compareItems(field: ExplorerSortField, left: ExplorerItem, right: ExplorerItem): number {
  if (field === 'default') return 0
  if (left.file.isDirectory !== right.file.isDirectory) return left.file.isDirectory ? -1 : 1
  if (field === 'size') return left.file.size - right.file.size
  if (field === 'kind') {
    const kind = left.resource.kind.localeCompare(right.resource.kind, undefined, {
      sensitivity: 'base',
    })
    if (kind !== 0) return kind
  }
  return left.file.name.localeCompare(right.file.name, undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

function sortedItems(
  items: readonly ExplorerItem[],
  field: ExplorerSortField,
  direction: ExplorerSortDirection,
): readonly ExplorerItem[] {
  if (field === 'default') return [...items]
  const multiplier = direction === 'ascending' ? 1 : -1
  return [...items].sort((left, right) => multiplier * compareItems(field, left, right))
}

function errorFromUnknown(error: unknown): ExplorerError {
  if (error instanceof ExplorerAdapterError) return error.explorerError
  if (error instanceof DOMException && error.name === 'AbortError') {
    return explorerError('cancelled', 'Explorer request was cancelled', true)
  }
  if (error instanceof TypeError) {
    return explorerError('network', error.message || 'Explorer request failed', true)
  }
  return explorerError(
    'internal',
    error instanceof Error ? error.message : 'Explorer request failed',
    true,
  )
}

function cloneFile(file: FileItem): FileItem {
  return { ...file, ...(file.resource ? { resource: { ...file.resource } } : {}) }
}

function itemWithFile(item: ExplorerItem, file: FileItem): ExplorerItem {
  const resource = file.resource ?? item.resource
  return Object.freeze({
    ...item,
    file: cloneFile(file),
    resource,
    key: explorerItemKey(resource.ref),
  })
}

function optimisticItems(
  items: readonly ExplorerItem[],
  command: ExplorerCommand,
  currentPath: string,
  scope: ExplorerScope,
): readonly ExplorerItem[] {
  if (command.kind === 'delete' || (command.kind === 'removeOffline' && scope.kind === 'offline')) {
    return items.filter((item) => item.key !== command.item.key)
  }
  if (command.kind === 'rename') {
    return items.map((item) => {
      if (item.key !== command.item.key) return item
      const nextPath = [parentPath(item.file.path), command.name].filter(Boolean).join('/')
      return itemWithFile(item, { ...item.file, name: command.name, path: nextPath })
    })
  }
  if (command.kind === 'move') {
    if (normalizePath(command.destinationPath) !== normalizePath(currentPath)) {
      return items.filter((item) => item.key !== command.item.key)
    }
    const nextPath = [normalizePath(command.destinationPath), command.item.file.name]
      .filter(Boolean)
      .join('/')
    return items.map((item) =>
      item.key === command.item.key ? itemWithFile(item, { ...item.file, path: nextPath }) : item,
    )
  }
  return items
}

function storageJson<T>(storage: ExplorerStorageAdapter, key: string): T | undefined {
  try {
    const value = storage.getItem(key)
    return value === null ? undefined : (JSON.parse(value) as T)
  } catch {
    return undefined
  }
}

export function createMemoryExplorerHistory(initialPath = ''): ExplorerHistoryAdapter {
  const entries = [normalizePath(initialPath)]
  let index = 0
  const listeners = new Set<(path: string) => void>()
  const notify = () => {
    for (const listener of [...listeners]) listener(entries[index] ?? '')
  }
  return {
    current: () => entries[index] ?? '',
    push(path) {
      entries.splice(index + 1, entries.length, normalizePath(path))
      index = entries.length - 1
      notify()
    },
    replace(path) {
      entries[index] = normalizePath(path)
      notify()
    },
    back() {
      if (index === 0) return
      index -= 1
      notify()
    },
    forward() {
      if (index >= entries.length - 1) return
      index += 1
      notify()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export function createMemoryExplorerStorage(): ExplorerStorageAdapter {
  const values = new Map<string, string>()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  }
}

export function createStaticOnlineAdapter(online = true): ExplorerOnlineAdapter {
  return { getSnapshot: () => online, subscribe: () => () => undefined }
}

export function createExplorerModel(dependencies: ExplorerModelDependencies): ExplorerModel {
  const {
    adapter,
    opener,
    history,
    storage,
    clock,
    online,
    pageSize = 200,
    paginationMode = 'visible',
    storageKey = `explorer:${adapter.scope.kind}:${adapter.scope.id}`,
    rootLabel = adapter.scope.kind === 'offline' ? 'Offline' : 'Library',
    initialViewMode = 'list',
  } = dependencies
  const stored = storageJson<{
    viewMode?: ExplorerViewMode
    viewModes?: Record<string, ExplorerViewMode>
    sort?: { field?: ExplorerSortField; direction?: ExplorerSortDirection }
    selections?: Record<string, string[]>
  }>(storage, storageKey)
  const initialPath = normalizePath(history.current())
  const viewModes = {
    ...(stored?.viewMode ? { [initialPath]: stored.viewMode } : {}),
    ...(stored?.viewModes ?? {}),
  }
  const selections = { ...(stored?.selections ?? {}) }
  let revision = 0
  let disposed = false
  let requestSequence = 0
  let mutationSequence = 0
  let adapterRefreshPending = false
  let loadController: AbortController | undefined
  const viewModeControllers = new Set<AbortController>()
  const prefetchControllers = new Map<string, AbortController>()
  const commandControllers = new Map<string, AbortController>()
  const authoritativeItems = new Map<string, readonly ExplorerItem[]>()
  const pendingCommandStates = new Map<
    string,
    Readonly<{ path: string; command: ExplorerCommand }>
  >()
  const listeners = new Set<() => void>()
  let suppressHistoryPath: string | undefined
  let snapshot: ExplorerSnapshot = Object.freeze({
    revision,
    scope: adapter.scope,
    path: initialPath,
    breadcrumbs: breadcrumbs(
      history.current(),
      rootLabel,
      adapter.itemForPath,
      adapter.capabilitiesForPath,
    ),
    items: [],
    capabilities: Object.freeze([
      ...(adapter.provisionalPageCapabilitiesForPath?.(initialPath) ?? []),
    ]),
    status: 'idle',
    stale: false,
    online: online.getSnapshot(),
    selection: selections[initialPath] ?? [],
    sort: {
      field: stored?.sort?.field ?? 'default',
      direction: stored?.sort?.direction ?? 'ascending',
    },
    viewMode: viewModes[initialPath] ?? initialViewMode,
    pagination: { total: 0, loadingMore: false },
    virtualization: { startIndex: 0, endIndex: -1, itemCount: 0 },
    pendingCommands: [],
  })

  function persist() {
    storage.setItem(storageKey, JSON.stringify({ viewModes, sort: snapshot.sort, selections }))
  }

  function emit(next: Omit<ExplorerSnapshot, 'revision'>) {
    if (disposed) return
    revision += 1
    snapshot = Object.freeze({ ...next, revision })
    for (const listener of [...listeners]) listener()
  }

  function patch(next: Partial<Omit<ExplorerSnapshot, 'revision'>>) {
    emit({ ...snapshot, ...next })
  }

  function stateOutcome(): ExplorerOutcome {
    return { kind: 'state', snapshot }
  }

  function saveSelection(selection: readonly string[]) {
    selections[snapshot.path] = [...selection]
    patch({ selection })
    persist()
  }

  function projectedItems(path: string): readonly ExplorerItem[] {
    const normalized = normalizePath(path)
    let items = authoritativeItems.get(normalized) ?? []
    for (const pending of pendingCommandStates.values()) {
      if (pending.path === normalized) {
        items = optimisticItems(items, pending.command, normalized, adapter.scope)
      }
    }
    return sortedItems(items, snapshot.sort.field, snapshot.sort.direction)
  }

  async function load(path: string, append = false): Promise<ExplorerOutcome> {
    if (disposed) return { kind: 'stale', snapshot }
    const normalized = normalizePath(path)
    const pathChanged = normalized !== snapshot.path
    loadController?.abort()
    const controller = new AbortController()
    loadController = controller
    const sequence = ++requestSequence
    const cursor = append ? snapshot.pagination.nextCursor : undefined
    if (append && !cursor) return stateOutcome()
    patch({
      path: normalized,
      breadcrumbs: breadcrumbs(
        normalized,
        rootLabel,
        adapter.itemForPath,
        adapter.capabilitiesForPath,
      ),
      status: append ? snapshot.status : 'loading',
      error: undefined,
      stale: append ? snapshot.stale : !pathChanged && snapshot.items.length > 0,
      ...(pathChanged
        ? {
            items: [],
            capabilities: Object.freeze([
              ...(adapter.provisionalPageCapabilitiesForPath?.(normalized) ?? []),
            ]),
            virtualDirectory: undefined,
            focusedKey: undefined,
            virtualization: { startIndex: 0, endIndex: -1, itemCount: 0 },
          }
        : {}),
      selection: append ? snapshot.selection : (selections[normalized] ?? []),
      viewMode: append ? snapshot.viewMode : (viewModes[normalized] ?? initialViewMode),
      pagination: {
        ...snapshot.pagination,
        ...(append ? { loadingMore: true } : { nextCursor: undefined, total: 0 }),
      },
    })
    try {
      const page = await adapter.browse(
        { path: normalized, ...(cursor ? { cursor } : {}), pageSize },
        controller.signal,
      )
      if (disposed || sequence !== requestSequence) return { kind: 'stale', snapshot }
      const currentAuthoritative = authoritativeItems.get(normalized) ?? []
      const combined = append
        ? [
            ...currentAuthoritative,
            ...page.items.filter(
              (candidate) => !currentAuthoritative.some((item) => item.key === candidate.key),
            ),
          ]
        : [...page.items]
      authoritativeItems.set(normalized, combined)
      const projected = projectedItems(normalized)
      const keys = new Set(projected.map((item) => item.key))
      const listingComplete = page.nextCursor === undefined
      const selection = listingComplete
        ? snapshot.selection.filter((key) => keys.has(key))
        : snapshot.selection
      selections[normalized] = [...selection]
      patch({
        path: normalized,
        breadcrumbs: breadcrumbs(
          normalized,
          rootLabel,
          adapter.itemForPath,
          adapter.capabilitiesForPath,
        ),
        items: projected,
        capabilities: page.capabilities,
        virtualDirectory: page.virtualDirectory,
        status: 'ready',
        error: undefined,
        stale: false,
        selection,
        focusedKey:
          snapshot.focusedKey && (!listingComplete || keys.has(snapshot.focusedKey))
            ? snapshot.focusedKey
            : undefined,
        pagination: {
          ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
          total: page.total,
          loadingMore: false,
        },
        virtualization: {
          ...snapshot.virtualization,
          itemCount: projected.length,
          endIndex: Math.min(snapshot.virtualization.endIndex, projected.length - 1),
        },
      })
      persist()
      if (paginationMode === 'all' && page.nextCursor) return load(normalized, true)
      if (adapterRefreshPending) {
        adapterRefreshPending = false
        return load(normalized)
      }
      return stateOutcome()
    } catch (error) {
      if (disposed || sequence !== requestSequence) return { kind: 'stale', snapshot }
      const typed = errorFromUnknown(error)
      if (typed.code === 'cancelled') return { kind: 'stale', snapshot }
      adapterRefreshPending = false
      patch({
        status: 'error',
        error: typed,
        stale: snapshot.items.length > 0,
        pagination: { ...snapshot.pagination, loadingMore: false },
      })
      return { kind: 'unavailable', error: typed, snapshot }
    }
  }

  function itemForCommand(command: ExplorerCommand): ExplorerItem | undefined {
    if ('item' in command) return command.item
    return command.kind === 'setAppearanceExternal' ? command.target : undefined
  }

  async function executeCommand(command: ExplorerCommand): Promise<ExplorerOutcome> {
    const requestedItem = itemForCommand(command)
    const canonicalItem = requestedItem
      ? snapshot.items.find((item) => item.key === requestedItem.key)
      : undefined
    const externalVaultItem =
      requestedItem &&
      !canonicalItem &&
      (command.kind === 'keepOffline' || command.kind === 'removeOffline') &&
      explorerItemCapability(requestedItem, explorerCommandCapability(command))
    const externalAppearanceItem =
      requestedItem &&
      !canonicalItem &&
      command.kind === 'setAppearanceExternal' &&
      explorerItemCapability(requestedItem, 'setAppearance')
    if (requestedItem && !canonicalItem && !externalVaultItem && !externalAppearanceItem) {
      const error = explorerError('notFound', 'Resource is not in current Explorer page')
      return { kind: 'unavailable', error, snapshot }
    }
    const safeCommand = canonicalItem
      ? command.kind === 'setAppearanceExternal'
        ? ({ ...command, target: canonicalItem } as ExplorerCommand)
        : ({ ...command, item: canonicalItem } as ExplorerCommand)
      : command
    if (
      safeCommand.kind === 'providerDirectoryAction' &&
      normalizePath(safeCommand.path) !== snapshot.path
    ) {
      const error = explorerError(
        'forbidden',
        'Provider action path is not the current Explorer page',
      )
      return { kind: 'unavailable', error, snapshot }
    }
    const capability = explorerCommandCapability(safeCommand)
    const item = itemForCommand(safeCommand)
    const parentCapability = snapshot.capabilities.includes(capability)
    if (item ? !explorerItemCapability(item, capability) : !parentCapability) {
      const error =
        adapter.scope.kind === 'offline'
          ? explorerError('offlineUnavailable', `Capability ${capability} is unavailable offline`)
          : explorerError('forbidden', `Capability ${capability} is unavailable`)
      return { kind: 'unavailable', error, snapshot }
    }
    if (!snapshot.online && adapter.scope.kind !== 'offline' && capability !== 'removeOffline') {
      const error = explorerError('offlineUnavailable', 'Action is unavailable while offline')
      return { kind: 'unavailable', error, snapshot }
    }
    const commandId = `${clock.now()}-${++mutationSequence}`
    const commandPath = snapshot.path
    const controller = new AbortController()
    commandControllers.set(commandId, controller)
    if (!authoritativeItems.has(commandPath)) authoritativeItems.set(commandPath, snapshot.items)
    pendingCommandStates.set(commandId, { path: commandPath, command: safeCommand })
    const nextItems = projectedItems(commandPath)
    patch({
      items: nextItems,
      virtualization: {
        ...snapshot.virtualization,
        itemCount: nextItems.length,
        endIndex: Math.min(snapshot.virtualization.endIndex, nextItems.length - 1),
      },
      pendingCommands: [...snapshot.pendingCommands, commandId],
    })
    try {
      const receipt = await adapter.execute(safeCommand, controller.signal)
      if (disposed) return { kind: 'stale', snapshot }
      commandControllers.delete(commandId)
      pendingCommandStates.delete(commandId)
      patch({ pendingCommands: snapshot.pendingCommands.filter((id) => id !== commandId) })
      if (snapshot.path === commandPath) await load(commandPath)
      return { kind: 'command', receipt, snapshot }
    } catch (error) {
      commandControllers.delete(commandId)
      if (disposed) return { kind: 'stale', snapshot }
      const typed = errorFromUnknown(error)
      pendingCommandStates.delete(commandId)
      const nextItems = snapshot.path === commandPath ? projectedItems(commandPath) : snapshot.items
      patch({
        ...(snapshot.path === commandPath
          ? {
              items: nextItems,
              virtualization: {
                ...snapshot.virtualization,
                itemCount: nextItems.length,
                endIndex: Math.min(snapshot.virtualization.endIndex, nextItems.length - 1),
              },
            }
          : {}),
        pendingCommands: snapshot.pendingCommands.filter((id) => id !== commandId),
        error: typed,
      })
      return { kind: 'unavailable', error: typed, snapshot }
    }
  }

  const unsubscribeHistory = history.subscribe((path) => {
    const normalized = normalizePath(path)
    if (suppressHistoryPath === normalized) {
      suppressHistoryPath = undefined
      return
    }
    if (normalized !== snapshot.path) void load(normalized)
  })
  const unsubscribeOnline = online.subscribe(() => {
    const wasOnline = snapshot.online
    const nextOnline = online.getSnapshot()
    patch({ online: nextOnline })
    if (!wasOnline && nextOnline && snapshot.status !== 'idle') void load(snapshot.path)
  })
  const unsubscribeAdapter = adapter.subscribe?.(() => {
    if (snapshot.status === 'error') return
    if (snapshot.status === 'loading' || snapshot.pagination.loadingMore) {
      adapterRefreshPending = true
      return
    }
    void load(snapshot.path)
  })

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (disposed) return () => undefined
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async dispatch(intent) {
      if (disposed) return { kind: 'stale', snapshot }
      if (intent.type === 'initialize' || intent.type === 'refresh') {
        return load(snapshot.path)
      }
      if (intent.type === 'navigate') {
        const path = normalizePath(intent.path)
        if (path === snapshot.path && !intent.replace) return stateOutcome()
        suppressHistoryPath = path
        if (intent.replace) history.replace(path)
        else history.push(path)
        return load(path)
      }
      if (intent.type === 'syncHistory') return load(intent.path)
      if (intent.type === 'back') {
        history.back()
        return stateOutcome()
      }
      if (intent.type === 'forward') {
        history.forward()
        return stateOutcome()
      }
      if (intent.type === 'loadMore') return load(snapshot.path, true)
      if (intent.type === 'visibleRange') {
        const itemCount = snapshot.items.length
        const startIndex = Math.max(0, Math.min(itemCount, intent.range.startIndex))
        const endIndex = Math.max(-1, Math.min(itemCount - 1, intent.range.endIndex))
        const range = { startIndex, endIndex, itemCount }
        if (
          snapshot.virtualization.startIndex !== startIndex ||
          snapshot.virtualization.endIndex !== endIndex ||
          snapshot.virtualization.itemCount !== itemCount
        ) {
          patch({ virtualization: range })
        }
        const loadThreshold = Math.max(10, Math.floor(pageSize / 4))
        if (
          paginationMode === 'visible' &&
          snapshot.pagination.nextCursor &&
          !snapshot.pagination.loadingMore &&
          endIndex >= itemCount - loadThreshold
        ) {
          return load(snapshot.path, true)
        }
        return stateOutcome()
      }
      if (intent.type === 'prefetch') {
        if (!adapter.prefetch) return stateOutcome()
        const path = normalizePath(intent.path)
        prefetchControllers.get(path)?.abort()
        const controller = new AbortController()
        prefetchControllers.set(path, controller)
        try {
          await adapter.prefetch({ path, pageSize }, controller.signal)
        } catch (error) {
          const typed = errorFromUnknown(error)
          if (typed.code !== 'cancelled') return { kind: 'unavailable', error: typed, snapshot }
        } finally {
          if (prefetchControllers.get(path) === controller) prefetchControllers.delete(path)
        }
        return stateOutcome()
      }
      if (intent.type === 'sort') {
        const direction = intent.direction ?? snapshot.sort.direction
        if (intent.field === 'default' && snapshot.sort.field !== 'default') {
          patch({ sort: { field: intent.field, direction } })
          persist()
          return load(snapshot.path)
        }
        patch({
          sort: { field: intent.field, direction },
          items: sortedItems(snapshot.items, intent.field, direction),
        })
        persist()
        return stateOutcome()
      }
      if (intent.type === 'viewMode') {
        viewModes[snapshot.path] = intent.viewMode
        patch({ viewMode: intent.viewMode })
        persist()
        if (adapter.persistViewMode) {
          const controller = new AbortController()
          viewModeControllers.add(controller)
          try {
            await adapter.persistViewMode(snapshot.path, intent.viewMode, controller.signal)
          } catch (error) {
            const typed = errorFromUnknown(error)
            patch({ error: typed })
            return { kind: 'unavailable', error: typed, snapshot }
          } finally {
            viewModeControllers.delete(controller)
          }
        }
        return stateOutcome()
      }
      if (intent.type === 'clearSelection') {
        saveSelection([])
        return stateOutcome()
      }
      if (intent.type === 'select') {
        if (!snapshot.items.some((item) => item.key === intent.key)) return stateOutcome()
        if (intent.mode === 'toggle') {
          saveSelection(
            snapshot.selection.includes(intent.key)
              ? snapshot.selection.filter((key) => key !== intent.key)
              : [...snapshot.selection, intent.key],
          )
        } else if (intent.mode === 'range' && snapshot.focusedKey) {
          const start = snapshot.items.findIndex((item) => item.key === snapshot.focusedKey)
          const end = snapshot.items.findIndex((item) => item.key === intent.key)
          if (start < 0 || end < 0) {
            saveSelection([intent.key])
          } else {
            const [from, to] = start < end ? [start, end] : [end, start]
            saveSelection(snapshot.items.slice(from, to + 1).map((item) => item.key))
          }
        } else {
          saveSelection([intent.key])
        }
        patch({ focusedKey: intent.key })
        return stateOutcome()
      }
      if (intent.type === 'focus') {
        patch({
          focusedKey:
            intent.key && snapshot.items.some((item) => item.key === intent.key)
              ? intent.key
              : undefined,
        })
        return stateOutcome()
      }
      if (intent.type === 'focusMove') {
        if (snapshot.items.length === 0) return stateOutcome()
        const current = snapshot.items.findIndex((item) => item.key === snapshot.focusedKey)
        const next = Math.max(0, Math.min(snapshot.items.length - 1, current + intent.delta))
        const focusedKey = snapshot.items[next]?.key
        patch({ focusedKey })
        return stateOutcome()
      }
      if (intent.type === 'open') {
        const item = snapshot.items.find((candidate) => candidate.key === intent.key)
        if (!item) {
          const error = explorerError('notFound', 'Resource is not in current Explorer page')
          return { kind: 'unavailable', error, snapshot }
        }
        if (!explorerItemCapability(item, 'open')) {
          const error = explorerError('forbidden', 'Capability open is unavailable')
          return { kind: 'unavailable', error, snapshot }
        }
        selections[snapshot.path] = [item.key]
        patch({ selection: [item.key], focusedKey: item.key })
        persist()
        const scope: OpenContext['scope'] =
          adapter.scope.kind === 'grant'
            ? { kind: 'grant', id: adapter.scope.id }
            : { kind: 'owner', id: adapter.scope.id }
        return {
          kind: 'open',
          item,
          plan: opener(item.resource, intent.intent ?? 'default', {
            surface: intent.surface,
            scope,
            effectiveOperations: resourceOperations(item),
          }),
        }
      }
      if (intent.type === 'action' || intent.type === 'actionExternal') {
        const item =
          intent.type === 'actionExternal'
            ? intent.item
            : snapshot.items.find((candidate) => candidate.key === intent.key)
        if (!item) {
          const error = explorerError('notFound', 'Resource is not in current Explorer page')
          return { kind: 'unavailable', error, snapshot }
        }
        if (!explorerItemCapability(item, intent.action)) {
          const error = explorerError('forbidden', `Capability ${intent.action} is unavailable`)
          return { kind: 'unavailable', error, snapshot }
        }
        try {
          const plan = adapter.plan?.(intent.action, item)
          if (!plan) {
            const error = explorerError('invalidIntent', `Action ${intent.action} has no plan`)
            return { kind: 'unavailable', error, snapshot }
          }
          return { kind: 'action', plan, snapshot }
        } catch (error) {
          const typed = errorFromUnknown(error)
          return { kind: 'unavailable', error: typed, snapshot }
        }
      }
      return executeCommand(intent.command)
    },
    dispose() {
      if (disposed) return
      disposed = true
      requestSequence += 1
      loadController?.abort()
      for (const controller of viewModeControllers) controller.abort()
      viewModeControllers.clear()
      for (const controller of prefetchControllers.values()) controller.abort()
      prefetchControllers.clear()
      for (const controller of commandControllers.values()) controller.abort()
      commandControllers.clear()
      unsubscribeHistory()
      unsubscribeOnline()
      unsubscribeAdapter?.()
      adapter.dispose?.()
      listeners.clear()
    },
  }
}
