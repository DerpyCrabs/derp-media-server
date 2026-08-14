import { type ResourceError, type ResourceKey, type ResourceSummary } from '@/lib/domain/resource'
import type {
  ExplorerActionDescriptor,
  ExplorerCommand,
  ExplorerController,
  ExplorerDataSource,
  ExplorerDispatchResult,
  ExplorerEvent,
  ExplorerHistory,
  ExplorerItem,
  ExplorerLocation,
  ExplorerOptimisticUpdater,
  ExplorerPage,
  ExplorerSnapshot,
  ExplorerSortDirection,
  ExplorerSortField,
  ExplorerStorage,
  ExplorerStoredState,
} from './types'

const DEFAULT_SORT = { field: 'default', direction: 'ascending' } as const

export function explorerResourceKey(key: ResourceKey): string {
  return JSON.stringify([key.provider, key.id])
}

function locationKey(location: ExplorerLocation): string {
  return explorerResourceKey(location.key)
}

function unavailable(error: unknown, resource?: ResourceKey): ResourceError {
  if (
    typeof error === 'object' &&
    error !== null &&
    (error as { schemaVersion?: unknown }).schemaVersion === 1 &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return error as ResourceError
  }
  return {
    schemaVersion: 1,
    code: 'unavailable',
    message: error instanceof Error ? error.message : 'Explorer operation failed',
    ...(resource ? { resource } : {}),
    retryable: true,
  }
}

function validStoredState(
  value: ExplorerStoredState | undefined,
): Required<Pick<ExplorerStoredState, 'viewMode' | 'sort' | 'selection'>> &
  Pick<ExplorerStoredState, 'focusedKey'> {
  const viewMode = value?.viewMode === 'grid' ? 'grid' : 'list'
  const field: ExplorerSortField = ['default', 'name', 'kind', 'size'].includes(
    value?.sort?.field ?? '',
  )
    ? value!.sort!.field
    : 'default'
  const direction: ExplorerSortDirection =
    value?.sort?.direction === 'descending' ? 'descending' : 'ascending'
  return {
    viewMode,
    sort: { field, direction },
    selection: [...new Set(value?.selection ?? [])],
    ...(value?.focusedKey ? { focusedKey: value.focusedKey } : {}),
  }
}

export function createMemoryExplorerStorage(): ExplorerStorage {
  const values = new Map<string, ExplorerStoredState>()
  return {
    read(key) {
      const value = values.get(key)
      return value
        ? {
            ...value,
            sort: value.sort ? { ...value.sort } : undefined,
            selection: value.selection ? [...value.selection] : undefined,
          }
        : undefined
    },
    write(key, value) {
      values.set(key, {
        ...value,
        sort: value.sort ? { ...value.sort } : undefined,
        selection: value.selection ? [...value.selection] : undefined,
      })
    },
  }
}

export function createBrowserExplorerStorage(key = 'shared-explorer-state-v1'): ExplorerStorage {
  function readAll(): Record<string, ExplorerStoredState> {
    if (typeof localStorage === 'undefined') return {}
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? '{}')
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, ExplorerStoredState>)
        : {}
    } catch {
      return {}
    }
  }
  return {
    read(location) {
      return readAll()[location]
    },
    write(location, state) {
      if (typeof localStorage === 'undefined') return
      try {
        localStorage.setItem(key, JSON.stringify({ ...readAll(), [location]: state }))
      } catch {}
    },
  }
}

function defaultHistory(initial: ExplorerLocation): ExplorerHistory {
  let current = initial
  const listeners = new Set<(location: ExplorerLocation) => void>()
  return {
    current: () => current,
    push(location) {
      current = location
    },
    replace(location) {
      current = location
    },
    back() {},
    forward() {},
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

function sortedItems<TPayload>(
  items: readonly ExplorerItem<TPayload>[],
  sort: ExplorerSnapshot<TPayload>['sort'],
): readonly ExplorerItem<TPayload>[] {
  if (sort.field === 'default') return items
  const direction = sort.direction === 'descending' ? -1 : 1
  return [...items].sort((left, right) => {
    let compared = 0
    if (sort.field === 'name') {
      compared = compareText(left.resource.name, right.resource.name)
    } else if (sort.field === 'kind') {
      compared = compareText(left.resource.kind, right.resource.kind)
    } else {
      compared = (left.resource.size ?? 0) - (right.resource.size ?? 0)
    }
    if (compared === 0) compared = compareText(left.key, right.key)
    return compared * direction
  })
}

function defaultOptimisticUpdate<TPayload>(
  items: readonly ExplorerItem<TPayload>[],
  command: ExplorerCommand<TPayload>,
): readonly ExplorerItem<TPayload>[] {
  if (command.action.optimisticEffect === 'delete') {
    return items.filter((item) => item.key !== command.item.key)
  }
  if (command.action.optimisticEffect !== 'rename') return items
  const name =
    typeof command.input === 'object' &&
    command.input !== null &&
    typeof (command.input as { name?: unknown }).name === 'string'
      ? (command.input as { name: string }).name.trim()
      : ''
  if (!name) return items
  return items.map((item) =>
    item.key === command.item.key
      ? { ...item, resource: { ...item.resource, name } satisfies ResourceSummary }
      : item,
  )
}

type PendingCommand<TPayload> = {
  locationKey: string
  command: ExplorerCommand<TPayload>
  abort: AbortController
}

export function createExplorerController<TPayload>(options: {
  dataSource: ExplorerDataSource<TPayload>
  history?: ExplorerHistory
  initialLocation: ExplorerLocation
  storage?: ExplorerStorage
  optimisticUpdate?: ExplorerOptimisticUpdater<TPayload>
  pageSize?: number
  loadMoreThreshold?: number
  clock?: { now(): number }
}): ExplorerController<TPayload> {
  const initialLocation = options.initialLocation
  const history = options.history ?? defaultHistory(initialLocation)
  const storage = options.storage ?? createMemoryExplorerStorage()
  const clock = options.clock ?? { now: () => Date.now() }
  const optimisticUpdate =
    options.optimisticUpdate ?? options.dataSource.optimisticUpdate ?? defaultOptimisticUpdate
  const listeners = new Set<() => void>()
  const pending: PendingCommand<TPayload>[] = []
  const commandAborts = new Set<AbortController>()
  let baseItems: readonly ExplorerItem<TPayload>[] = []
  let disposed = false
  let initialized = false
  let revision = 0
  let loadSequence = 0
  let commandSequence = 0
  let activeLoad: AbortController | undefined
  let suppressHistory = false
  let refreshQueued = false
  const initialStored = validStoredState(storage.read(locationKey(initialLocation)))
  let snapshot: ExplorerSnapshot<TPayload> = {
    revision,
    location: initialLocation,
    breadcrumbs: [],
    items: [],
    actions: [],
    status: 'idle',
    stale: false,
    viewMode: initialStored.viewMode,
    sort: initialStored.sort,
    selection: initialStored.selection,
    ...(initialStored.focusedKey ? { focusedKey: initialStored.focusedKey } : {}),
    pagination: { total: 0, loadingMore: false },
    pendingCommands: [],
    recentItems: [],
  }

  function emit(next: Omit<ExplorerSnapshot<TPayload>, 'revision'>) {
    revision += 1
    snapshot = { ...next, revision }
    for (const listener of listeners) listener()
  }

  function stateResult(): ExplorerDispatchResult<TPayload> {
    return { kind: 'state', snapshot }
  }

  function storedSnapshot(): ExplorerStoredState {
    return {
      viewMode: snapshot.viewMode,
      sort: snapshot.sort,
      selection: snapshot.selection,
      ...(snapshot.focusedKey ? { focusedKey: snapshot.focusedKey } : {}),
    }
  }

  function persist() {
    const state = storedSnapshot()
    storage.write(locationKey(snapshot.location), state)
    void options.dataSource.persistState?.(snapshot.location, state)
  }

  function pendingForCurrent(): PendingCommand<TPayload>[] {
    const key = locationKey(snapshot.location)
    return pending.filter((entry) => entry.locationKey === key)
  }

  function projectedItems(): readonly ExplorerItem<TPayload>[] {
    const projected = pendingForCurrent().reduce<readonly ExplorerItem<TPayload>[]>(
      (items, entry) => optimisticUpdate(items, entry.command),
      baseItems,
    )
    return sortedItems(projected, snapshot.sort)
  }

  function emitProjected(
    overrides: Partial<Omit<ExplorerSnapshot<TPayload>, 'revision' | 'items'>> = {},
  ) {
    emit({
      ...snapshot,
      ...overrides,
      items: projectedItems(),
      pendingCommands: pendingForCurrent().map((entry) => entry.command.id),
    })
  }

  function restoreLocationState(location: ExplorerLocation) {
    const stored = validStoredState(storage.read(locationKey(location)))
    return {
      viewMode: stored.viewMode,
      sort: stored.sort,
      selection: stored.selection,
      focusedKey: stored.focusedKey,
    }
  }

  function removePending(target: PendingCommand<TPayload>) {
    const index = pending.indexOf(target)
    if (index !== -1) pending.splice(index, 1)
    commandAborts.delete(target.abort)
  }

  function applyCompletedPage(page: ExplorerPage<TPayload>, append: boolean) {
    if (append) {
      const merged = [...baseItems]
      const indices = new Map(merged.map((item, index) => [item.key, index]))
      for (const item of page.items) {
        const index = indices.get(item.key)
        if (index === undefined) {
          indices.set(item.key, merged.length)
          merged.push(item)
        } else {
          merged[index] = item
        }
      }
      baseItems = merged
    } else {
      baseItems = [...page.items]
    }

    let selection = snapshot.selection
    let focusedKey = snapshot.focusedKey
    if (!page.nextCursor) {
      const available = new Set(baseItems.map((item) => item.key))
      selection = selection.filter((key) => available.has(key))
      if (focusedKey && !available.has(focusedKey)) focusedKey = undefined
    }

    const canonicalChanged = locationKey(page.location) !== locationKey(snapshot.location)
    if (canonicalChanged) {
      const restored = restoreLocationState(page.location)
      selection = restored.selection
      focusedKey = restored.focusedKey
    }

    snapshot = {
      ...snapshot,
      location: page.location,
      ...(page.locationItem ? { locationItem: page.locationItem } : { locationItem: undefined }),
      breadcrumbs: page.breadcrumbs,
      actions: page.actions,
      selection,
      viewMode: page.preferredViewMode ?? snapshot.viewMode,
      ...(focusedKey ? { focusedKey } : { focusedKey: undefined }),
      pagination: {
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
        total: page.total,
        loadingMore: false,
      },
      ...(page.refreshIntervalMs ? { refreshIntervalMs: page.refreshIntervalMs } : {}),
      ...(page.defaultFileExtension
        ? { defaultFileExtension: page.defaultFileExtension }
        : { defaultFileExtension: undefined }),
      ...(page.contentSearch
        ? { contentSearch: page.contentSearch }
        : { contentSearch: undefined }),
      recentItems: page.recentItems ?? [],
    }
    persist()
  }

  async function load(
    location: ExplorerLocation,
    reason: 'initialize' | 'navigate' | 'refresh' | 'loadMore' | 'reconcile',
    cursor?: string,
  ): Promise<ExplorerDispatchResult<TPayload>> {
    if (disposed) return { kind: 'stale' }
    const append = reason === 'loadMore'
    activeLoad?.abort()
    const abort = new AbortController()
    activeLoad = abort
    const sequence = ++loadSequence

    if (append) {
      emitProjected({
        pagination: { ...snapshot.pagination, loadingMore: true },
      })
    } else if (reason === 'navigate') {
      baseItems = []
      const stored = restoreLocationState(location)
      emit({
        ...snapshot,
        location,
        locationItem: undefined,
        breadcrumbs: [],
        items: [],
        actions: [],
        status: 'loading',
        stale: false,
        error: undefined,
        viewMode: stored.viewMode,
        sort: stored.sort,
        selection: stored.selection,
        ...(stored.focusedKey ? { focusedKey: stored.focusedKey } : { focusedKey: undefined }),
        pagination: { total: 0, loadingMore: false },
        pendingCommands: pending
          .filter((entry) => entry.locationKey === locationKey(location))
          .map((entry) => entry.command.id),
        refreshIntervalMs: undefined,
        contentSearch: undefined,
        recentItems: [],
      })
    } else {
      emitProjected({
        status: baseItems.length === 0 ? 'loading' : snapshot.status,
        error: undefined,
      })
    }

    try {
      const page = await options.dataSource.browse({
        location,
        ...(cursor ? { cursor } : {}),
        ...(options.pageSize ? { pageSize: options.pageSize } : {}),
        signal: abort.signal,
        reason,
      })
      if (disposed || abort.signal.aborted || sequence !== loadSequence) return { kind: 'stale' }
      applyCompletedPage(page, append)
      emitProjected({ status: 'ready', stale: false, error: undefined })
      return stateResult()
    } catch (error) {
      if (disposed || abort.signal.aborted || sequence !== loadSequence) return { kind: 'stale' }
      const normalized = unavailable(error, location.key)
      emitProjected({
        status: 'error',
        stale: baseItems.length > 0,
        error: normalized,
        pagination: { ...snapshot.pagination, loadingMore: false },
      })
      return { kind: 'unavailable', error: normalized }
    } finally {
      if (activeLoad === abort) activeLoad = undefined
    }
  }

  async function navigate(location: ExplorerLocation, replace = false) {
    suppressHistory = true
    try {
      if (replace) history.replace(location)
      else history.push(location)
    } finally {
      suppressHistory = false
    }
    return load(location, 'navigate')
  }

  async function select(key: string, mode: 'replace' | 'toggle' | 'range' = 'replace') {
    const ordered = snapshot.items.map((item) => item.key)
    if (!ordered.includes(key)) return stateResult()
    let selection: readonly string[]
    if (mode === 'toggle') {
      selection = snapshot.selection.includes(key)
        ? snapshot.selection.filter((candidate) => candidate !== key)
        : [...snapshot.selection, key]
    } else if (mode === 'range') {
      const focusIndex = snapshot.focusedKey ? ordered.indexOf(snapshot.focusedKey) : -1
      const targetIndex = ordered.indexOf(key)
      if (focusIndex === -1) selection = [key]
      else {
        const start = Math.min(focusIndex, targetIndex)
        const end = Math.max(focusIndex, targetIndex)
        selection = ordered.slice(start, end + 1)
      }
    } else {
      selection = [key]
    }
    emitProjected({ selection, focusedKey: key })
    persist()
    return stateResult()
  }

  async function runCommand(
    request: Extract<ExplorerEvent, { type: 'command' }>['command'],
  ): Promise<ExplorerDispatchResult<TPayload>> {
    const canonical = request.itemKey
      ? baseItems.find((item) => item.key === request.itemKey)
      : snapshot.locationItem
    const action = (request.itemKey ? canonical?.actions : snapshot.actions)?.find(
      (candidate) => candidate.id === request.actionId,
    )
    if (!canonical || !action || !canonical.resource.capabilities.includes(action.capability)) {
      return {
        kind: 'unavailable',
        error: {
          schemaVersion: 1,
          code: canonical ? 'unsupported' : 'notFound',
          message: canonical ? 'Resource action is unavailable' : 'Explorer item was not found',
          ...(canonical ? { resource: canonical.resource.key } : {}),
          retryable: false,
        },
      }
    }

    commandSequence += 1
    const abort = new AbortController()
    commandAborts.add(abort)
    const command: ExplorerCommand<TPayload> = {
      id: `${clock.now()}-${commandSequence}`,
      action,
      item: canonical,
      ...(request.input === undefined ? {} : { input: request.input }),
    }
    const entry: PendingCommand<TPayload> = {
      locationKey: locationKey(snapshot.location),
      command,
      abort,
    }
    pending.push(entry)
    emitProjected({ error: undefined })

    try {
      const receipt = await options.dataSource.execute(command, abort.signal)
      if (disposed || abort.signal.aborted) {
        removePending(entry)
        return { kind: 'stale' }
      }
      if (entry.locationKey === locationKey(snapshot.location)) {
        await load(snapshot.location, 'reconcile')
      }
      removePending(entry)
      if (entry.locationKey === locationKey(snapshot.location)) emitProjected()
      return { kind: 'command', receipt }
    } catch (error) {
      removePending(entry)
      if (disposed || abort.signal.aborted) return { kind: 'stale' }
      const normalized = unavailable(error, canonical.resource.key)
      if (entry.locationKey === locationKey(snapshot.location)) {
        emitProjected({ error: normalized })
      }
      return { kind: 'unavailable', error: normalized }
    }
  }

  async function dispatch(event: ExplorerEvent): Promise<ExplorerDispatchResult<TPayload>> {
    if (disposed) return { kind: 'stale' }
    switch (event.type) {
      case 'initialize':
        initialized = true
        return load(snapshot.location, 'initialize')
      case 'refresh':
        return load(snapshot.location, 'refresh')
      case 'navigate':
        return navigate(event.location, event.replace)
      case 'back':
        history.back()
        return stateResult()
      case 'forward':
        history.forward()
        return stateResult()
      case 'loadMore': {
        const cursor = snapshot.pagination.nextCursor
        if (!cursor || snapshot.pagination.loadingMore) return stateResult()
        return load(snapshot.location, 'loadMore', cursor)
      }
      case 'visibleRange': {
        emitProjected({ visibleRange: event.range })
        const threshold = options.loadMoreThreshold ?? 10
        if (
          snapshot.pagination.nextCursor &&
          event.range.endIndex >= Math.max(0, snapshot.items.length - 1 - threshold)
        ) {
          return dispatch({ type: 'loadMore' })
        }
        return stateResult()
      }
      case 'select':
        return select(event.key, event.mode)
      case 'clearSelection':
        emitProjected({ selection: [], focusedKey: undefined })
        persist()
        return stateResult()
      case 'focusMove': {
        if (snapshot.items.length === 0 || event.delta === 0) return stateResult()
        const current = snapshot.focusedKey
          ? snapshot.items.findIndex((item) => item.key === snapshot.focusedKey)
          : -1
        const start = current === -1 ? (event.delta > 0 ? -1 : snapshot.items.length) : current
        const index = Math.max(0, Math.min(snapshot.items.length - 1, start + event.delta))
        emitProjected({ focusedKey: snapshot.items[index]?.key })
        persist()
        return stateResult()
      }
      case 'sort': {
        const sort = {
          field: event.field,
          direction: event.direction ?? DEFAULT_SORT.direction,
        }
        snapshot = { ...snapshot, sort }
        emitProjected({ sort })
        persist()
        return stateResult()
      }
      case 'viewMode':
        if (snapshot.viewMode === event.viewMode) return stateResult()
        emitProjected({ viewMode: event.viewMode })
        persist()
        return stateResult()
      case 'command':
        return runCommand(event.command)
    }
  }

  const unsubscribeHistory = history.subscribe((location) => {
    if (disposed || suppressHistory) return
    if (locationKey(location) === locationKey(snapshot.location)) return
    void load(location, 'navigate')
  })
  const unsubscribeDataSource = options.dataSource.subscribe?.(() => {
    if (
      disposed ||
      !initialized ||
      refreshQueued ||
      activeLoad !== undefined ||
      snapshot.status === 'error'
    )
      return
    refreshQueued = true
    queueMicrotask(() => {
      refreshQueued = false
      if (!disposed) void dispatch({ type: 'refresh' })
    })
  })

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispatch,
    dispose() {
      if (disposed) return
      disposed = true
      loadSequence += 1
      activeLoad?.abort()
      for (const abort of commandAborts) abort.abort()
      commandAborts.clear()
      pending.length = 0
      unsubscribeHistory()
      unsubscribeDataSource?.()
      options.dataSource.dispose?.()
      listeners.clear()
    },
  }
}
