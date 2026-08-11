import { describe, expect, test } from 'bun:test'

import {
  createExplorerModel,
  createMemoryExplorerStorage,
  ExplorerAdapterError,
  explorerError,
  explorerItemKey,
  type ExplorerBrowseQuery,
  type ExplorerActionPlan,
  type ExplorerCapability,
  type ExplorerCommand,
  type ExplorerCommandReceipt,
  type ExplorerHistoryAdapter,
  type ExplorerItem,
  type ExplorerOnlineAdapter,
  type ExplorerPage,
  type ExplorerResourceAdapter,
  type ExplorerScope,
} from '@/lib/explorer-model'
import type {
  ProviderOperation,
  ResourceKind,
  ResourcePresentation,
  ResourceSummary,
} from '@/lib/resource'
import { MediaType } from '@/lib/types'
import type { OpenContext, OpenIntent, OpenPlan, ResourceOpener } from '@/src/lib/open-resource'

type Deferred<T> = {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

type ItemOptions = {
  name?: string
  path?: string
  directory?: boolean
  size?: number
  kind?: ResourceKind
  presentation?: ResourcePresentation
  providerOperations?: ProviderOperation[]
  capabilities?: ExplorerCapability[]
}

function item(id: string, options: ItemOptions = {}): ExplorerItem {
  const directory = options.directory ?? false
  const name = options.name ?? `${id}.txt`
  const path = options.path ?? name
  const providerOperations =
    options.providerOperations ??
    (directory ? (['browse'] as const) : (['read', 'download'] as const))
  const resource: ResourceSummary = {
    ref: { libraryId: 'library-1', resourceId: id },
    locator: { sourceId: 'source-1', providerLocator: path },
    legacyLocator: path,
    version: `version-${id}`,
    name,
    kind: options.kind ?? (directory ? 'folder' : 'file'),
    presentation: options.presentation ?? (directory ? 'browse' : 'text'),
    mimeType: directory ? undefined : 'text/plain',
    size: options.size ?? 1,
    providerOperations: [...providerOperations],
    availability: 'present',
  }
  const file = {
    name,
    path,
    type: directory ? MediaType.FOLDER : MediaType.TEXT,
    size: options.size ?? 1,
    extension: directory ? '' : (name.split('.').pop() ?? ''),
    isDirectory: directory,
    resource,
  }
  return Object.freeze({
    key: explorerItemKey(resource.ref),
    file,
    resource,
    capabilities: Object.freeze([...(options.capabilities ?? providerOperations)]),
  })
}

function page(
  items: readonly ExplorerItem[],
  nextCursor?: string,
  total = items.length,
  capabilities: readonly ExplorerCapability[] = [],
): ExplorerPage {
  return { items, capabilities, ...(nextCursor ? { nextCursor } : {}), total }
}

type AdapterHarnessOptions = {
  scope?: ExplorerScope
  browse?: (query: ExplorerBrowseQuery, signal: AbortSignal) => Promise<ExplorerPage>
  execute?: (command: ExplorerCommand, signal: AbortSignal) => Promise<ExplorerCommandReceipt>
  plan?: (action: ExplorerActionPlan['kind'], item: ExplorerItem) => ExplorerActionPlan
  capabilitiesForPath?: (path: string) => readonly ExplorerCapability[]
  provisionalPageCapabilitiesForPath?: (path: string) => readonly ExplorerCapability[]
}

function adapterHarness(options: AdapterHarnessOptions = {}) {
  const browseCalls: Array<{ query: ExplorerBrowseQuery; signal: AbortSignal }> = []
  const executeCalls: Array<{ command: ExplorerCommand; signal: AbortSignal }> = []
  const subscribers = new Set<() => void>()
  let disposed = false
  const adapter: ExplorerResourceAdapter = {
    scope: options.scope ?? { kind: 'owner', id: 'owner-1' },
    browse(query, signal) {
      browseCalls.push({ query, signal })
      return options.browse?.(query, signal) ?? Promise.resolve(page([]))
    },
    execute(command, signal) {
      executeCalls.push({ command, signal })
      return options.execute?.(command, signal) ?? Promise.resolve({ commandId: 'receipt-1' })
    },
    ...(options.plan ? { plan: options.plan } : {}),
    ...(options.capabilitiesForPath ? { capabilitiesForPath: options.capabilitiesForPath } : {}),
    ...(options.provisionalPageCapabilitiesForPath
      ? { provisionalPageCapabilitiesForPath: options.provisionalPageCapabilitiesForPath }
      : {}),
    subscribe(listener) {
      subscribers.add(listener)
      return () => subscribers.delete(listener)
    },
    dispose() {
      disposed = true
    },
  }
  return {
    adapter,
    browseCalls,
    executeCalls,
    publish: () => {
      for (const subscriber of [...subscribers]) subscriber()
    },
    subscriberCount: () => subscribers.size,
    disposed: () => disposed,
  }
}

function historyHarness(initialPath = '') {
  const entries = [initialPath]
  let index = 0
  const subscribers = new Set<(path: string) => void>()
  const pushes: string[] = []
  const replacements: string[] = []
  let backCalls = 0
  let forwardCalls = 0
  const notify = () => {
    for (const subscriber of [...subscribers]) subscriber(entries[index] ?? '')
  }
  const adapter: ExplorerHistoryAdapter = {
    current: () => entries[index] ?? '',
    push(path) {
      entries.splice(index + 1, entries.length, path)
      index = entries.length - 1
      pushes.push(path)
      notify()
    },
    replace(path) {
      entries[index] = path
      replacements.push(path)
      notify()
    },
    back() {
      backCalls += 1
      if (index === 0) return
      index -= 1
      notify()
    },
    forward() {
      forwardCalls += 1
      if (index >= entries.length - 1) return
      index += 1
      notify()
    },
    subscribe(listener) {
      subscribers.add(listener)
      return () => subscribers.delete(listener)
    },
  }
  return {
    adapter,
    pushes,
    replacements,
    external(path: string) {
      entries.splice(index + 1, entries.length, path)
      index = entries.length - 1
      notify()
    },
    backCalls: () => backCalls,
    forwardCalls: () => forwardCalls,
    subscriberCount: () => subscribers.size,
  }
}

function onlineHarness(initial = true) {
  let value = initial
  const subscribers = new Set<() => void>()
  const adapter: ExplorerOnlineAdapter = {
    getSnapshot: () => value,
    subscribe(listener) {
      subscribers.add(listener)
      return () => subscribers.delete(listener)
    },
  }
  return {
    adapter,
    set(next: boolean) {
      value = next
      for (const subscriber of [...subscribers]) subscriber()
    },
    subscriberCount: () => subscribers.size,
  }
}

const defaultOpener: ResourceOpener = (resource) => ({
  kind: 'browse',
  resource: resource.ref,
  ...(resource.version ? { version: resource.version } : {}),
})

function modelHarness(options: {
  adapter: ExplorerResourceAdapter
  history?: ExplorerHistoryAdapter
  online?: ExplorerOnlineAdapter
  storage?: ReturnType<typeof createMemoryExplorerStorage>
  opener?: ResourceOpener
  pageSize?: number
  paginationMode?: 'visible' | 'all'
  clock?: { now(): number }
}) {
  return createExplorerModel({
    adapter: options.adapter,
    history: options.history ?? historyHarness().adapter,
    online: options.online ?? onlineHarness().adapter,
    storage: options.storage ?? createMemoryExplorerStorage(),
    opener: options.opener ?? defaultOpener,
    pageSize: options.pageSize,
    paginationMode: options.paginationMode,
    clock: options.clock ?? { now: () => 1_000 },
  })
}

describe('ExplorerModel', () => {
  test('transitions from idle through loading to a normalized ready snapshot', async () => {
    const folder = item('folder', {
      name: 'Videos',
      path: 'Media/Videos/Videos',
      directory: true,
    })
    const file = item('clip', { name: 'clip.mp4', path: 'Media/Videos/clip.mp4' })
    const browse = deferred<ExplorerPage>()
    const adapter = adapterHarness({ browse: () => browse.promise })
    const history = historyHarness('\\Media//Videos/')
    const online = onlineHarness(true)
    const model = modelHarness({
      adapter: adapter.adapter,
      history: history.adapter,
      online: online.adapter,
      pageSize: 25,
    })
    const transitions: Array<{ revision: number; status: string; stale: boolean }> = []
    model.subscribe(() => {
      const snapshot = model.getSnapshot()
      transitions.push({
        revision: snapshot.revision,
        status: snapshot.status,
        stale: snapshot.stale,
      })
    })

    expect(model.getSnapshot()).toMatchObject({
      revision: 0,
      path: 'Media/Videos',
      status: 'idle',
      online: true,
      viewMode: 'list',
      pagination: { total: 0, loadingMore: false },
    })
    const initialized = model.dispatch({ type: 'initialize' })
    expect(model.getSnapshot().status).toBe('loading')
    expect(adapter.browseCalls[0]?.query).toEqual({ path: 'Media/Videos', pageSize: 25 })
    browse.resolve(page([folder, file], 'next-page', 9))

    expect((await initialized).kind).toBe('state')
    expect(model.getSnapshot()).toMatchObject({
      path: 'Media/Videos',
      breadcrumbs: [
        { name: 'Library', path: '' },
        { name: 'Media', path: 'Media' },
        { name: 'Videos', path: 'Media/Videos' },
      ],
      items: [folder, file],
      status: 'ready',
      stale: false,
      pagination: { nextCursor: 'next-page', total: 9, loadingMore: false },
    })
    expect(transitions).toEqual([
      { revision: 1, status: 'loading', stale: false },
      { revision: 2, status: 'ready', stale: false },
    ])
    model.dispose()
  })

  test('projects Adapter path capabilities onto every breadcrumb', async () => {
    const adapter = adapterHarness({
      browse: async () => page([]),
      capabilitiesForPath: (path) => (path === 'Media/private' ? ['open'] : ['open', 'browse']),
    })
    const model = modelHarness({
      adapter: adapter.adapter,
      history: historyHarness('Media/private').adapter,
    })

    await model.dispatch({ type: 'initialize' })
    expect(model.getSnapshot().breadcrumbs).toEqual([
      { name: 'Library', path: '', capabilities: ['open', 'browse'] },
      { name: 'Media', path: 'Media', capabilities: ['open', 'browse'] },
      { name: 'private', path: 'Media/private', capabilities: ['open'] },
    ])
    model.dispose()
  })

  test('notifies listeners in subscription order and fully disposes owned subscriptions', async () => {
    const pending = deferred<ExplorerPage>()
    const adapter = adapterHarness({ browse: () => pending.promise })
    const history = historyHarness()
    const online = onlineHarness()
    const model = modelHarness({
      adapter: adapter.adapter,
      history: history.adapter,
      online: online.adapter,
    })
    const events: string[] = []
    const unsubscribeFirst = model.subscribe(() =>
      events.push(`first:${model.getSnapshot().revision}`),
    )
    model.subscribe(() => events.push(`second:${model.getSnapshot().revision}`))

    await model.dispatch({ type: 'viewMode', viewMode: 'grid' })
    expect(events).toEqual(['first:1', 'second:1'])
    unsubscribeFirst()
    await model.dispatch({ type: 'sort', field: 'name' })
    expect(events).toEqual(['first:1', 'second:1', 'second:2'])

    const initializing = model.dispatch({ type: 'initialize' })
    const signal = adapter.browseCalls.at(-1)?.signal
    expect(signal?.aborted).toBe(false)
    model.dispose()
    expect(signal?.aborted).toBe(true)
    expect(adapter.disposed()).toBe(true)
    expect(adapter.subscriberCount()).toBe(0)
    expect(history.subscriberCount()).toBe(0)
    expect(online.subscriberCount()).toBe(0)

    pending.resolve(page([item('late')]))
    expect((await initializing).kind).toBe('stale')
    expect((await model.dispatch({ type: 'refresh' })).kind).toBe('stale')
    expect(events).toEqual(['first:1', 'second:1', 'second:2', 'second:3'])
  })

  test('refreshes the current page when connectivity returns', async () => {
    const cached = item('cached')
    const recovered = item('recovered')
    let current = cached
    const adapter = adapterHarness({ browse: async () => page([current]) })
    const online = onlineHarness(false)
    const model = modelHarness({ adapter: adapter.adapter, online: online.adapter })
    await model.dispatch({ type: 'initialize' })
    current = recovered
    const refreshed = new Promise<void>((resolve) => {
      const unsubscribe = model.subscribe(() => {
        if (model.getSnapshot().items[0]?.key !== recovered.key) return
        unsubscribe()
        resolve()
      })
    })

    online.set(true)
    await refreshed

    expect(adapter.browseCalls).toHaveLength(2)
    expect(model.getSnapshot()).toMatchObject({ online: true, items: [recovered] })
    model.dispose()
  })

  test('coalesces Adapter refreshes behind a successful in-flight load', async () => {
    const first = deferred<ExplorerPage>()
    let call = 0
    const adapter = adapterHarness({
      browse: () => {
        call += 1
        return call === 1 ? first.promise : Promise.resolve(page([item('fresh')]))
      },
    })
    const model = modelHarness({ adapter: adapter.adapter })

    const loading = model.dispatch({ type: 'initialize' })
    adapter.publish()
    adapter.publish()
    expect(adapter.browseCalls).toHaveLength(1)

    first.resolve(page([item('stale')]))
    await loading
    expect(adapter.browseCalls).toHaveLength(2)
    expect(model.getSnapshot().items.map((entry) => entry.file.name)).toEqual(['fresh.txt'])
  })

  test('does not let an Adapter refresh mask an in-flight load error', async () => {
    const first = deferred<ExplorerPage>()
    const adapter = adapterHarness({ browse: () => first.promise })
    const model = modelHarness({ adapter: adapter.adapter })

    const loading = model.dispatch({ type: 'initialize' })
    adapter.publish()
    first.reject(new ExplorerAdapterError(explorerError('internal', 'test failure', true)))

    const outcome = await loading
    expect(outcome.kind).toBe('unavailable')
    adapter.publish()
    await Promise.resolve()
    expect(adapter.browseCalls).toHaveLength(1)
    expect(model.getSnapshot()).toMatchObject({
      status: 'error',
      error: { code: 'internal', message: 'test failure' },
    })
  })

  test('writes normalized history and follows real back, forward, and external changes', async () => {
    const listings: Record<string, ExplorerItem[]> = {
      '': [item('root')],
      'Music/Albums': [item('album')],
      Images: [item('image')],
      Documents: [item('document')],
    }
    const adapter = adapterHarness({
      browse: async (query) => page(listings[query.path] ?? []),
    })
    const history = historyHarness()
    const model = modelHarness({ adapter: adapter.adapter, history: history.adapter })
    await model.dispatch({ type: 'initialize' })

    await model.dispatch({ type: 'navigate', path: '/Music//Albums/' })
    expect(history.pushes).toEqual(['Music/Albums'])
    expect(model.getSnapshot().path).toBe('Music/Albums')
    await model.dispatch({ type: 'navigate', path: '\\Images\\', replace: true })
    expect(history.replacements).toEqual(['Images'])
    expect(model.getSnapshot().path).toBe('Images')

    await model.dispatch({ type: 'back' })
    await Promise.resolve()
    await Promise.resolve()
    expect(history.backCalls()).toBe(1)
    expect(model.getSnapshot().path).toBe('')
    expect(model.getSnapshot().items).toEqual(listings[''])

    await model.dispatch({ type: 'forward' })
    await Promise.resolve()
    await Promise.resolve()
    expect(history.forwardCalls()).toBe(1)
    expect(model.getSnapshot().path).toBe('Images')
    expect(model.getSnapshot().items).toEqual(listings.Images)

    history.external('/Documents/')
    await Promise.resolve()
    await Promise.resolve()
    expect(model.getSnapshot().path).toBe('Documents')
    expect(model.getSnapshot().items.map((entry) => entry.key)).toEqual([
      listings.Documents![0]!.key,
    ])
    expect(history.pushes).toEqual(['Music/Albums'])
    model.dispose()
  })

  test('persists selection per path and supports replace, toggle, range, and focus moves', async () => {
    const alpha = item('alpha')
    const beta = item('beta')
    const gamma = item('gamma')
    const other = item('other')
    const storage = createMemoryExplorerStorage()
    const history = historyHarness('A')
    const adapter = adapterHarness({
      browse: async ({ path }) => page(path === 'A' ? [alpha, beta, gamma] : [other]),
    })
    const model = modelHarness({
      adapter: adapter.adapter,
      history: history.adapter,
      storage,
    })
    await model.dispatch({ type: 'initialize' })

    await model.dispatch({ type: 'select', key: alpha.key })
    await model.dispatch({ type: 'select', key: gamma.key, mode: 'range' })
    expect(model.getSnapshot().selection).toEqual([alpha.key, beta.key, gamma.key])
    await model.dispatch({ type: 'select', key: beta.key, mode: 'toggle' })
    expect(model.getSnapshot().selection).toEqual([alpha.key, gamma.key])
    expect(model.getSnapshot().focusedKey).toBe(beta.key)
    await model.dispatch({ type: 'focusMove', delta: 1 })
    expect(model.getSnapshot().focusedKey).toBe(gamma.key)

    await model.dispatch({ type: 'navigate', path: 'B' })
    expect(model.getSnapshot().selection).toEqual([])
    await model.dispatch({ type: 'select', key: other.key })
    await model.dispatch({ type: 'navigate', path: 'A' })
    expect(model.getSnapshot().selection).toEqual([alpha.key, gamma.key])

    model.dispose()
    const restoredAdapter = adapterHarness({ browse: async () => page([alpha, beta, gamma]) })
    const restored = modelHarness({
      adapter: restoredAdapter.adapter,
      history: historyHarness('A').adapter,
      storage,
    })
    await restored.dispatch({ type: 'initialize' })
    expect(restored.getSnapshot().selection).toEqual([alpha.key, gamma.key])
    await restored.dispatch({ type: 'clearSelection' })
    expect(restored.getSnapshot().selection).toEqual([])
    restored.dispose()
  })

  test('sorts deterministically and restores sort and view mode from storage', async () => {
    const file10 = item('file-10', { name: 'file10.txt', size: 10 })
    const file2 = item('file-2', { name: 'file2.txt', size: 2 })
    const conversation = item('conversation', {
      name: 'chat.txt',
      kind: 'conversation',
      presentation: 'conversation',
      size: 20,
    })
    const sourceOrder = [file10, conversation, file2]
    const storage = createMemoryExplorerStorage()
    const adapter = adapterHarness({ browse: async () => page(sourceOrder) })
    const model = modelHarness({ adapter: adapter.adapter, storage })
    await model.dispatch({ type: 'initialize' })

    await model.dispatch({ type: 'sort', field: 'name', direction: 'ascending' })
    expect(model.getSnapshot().items.map((entry) => entry.file.name)).toEqual([
      'chat.txt',
      'file2.txt',
      'file10.txt',
    ])
    await model.dispatch({ type: 'sort', field: 'kind', direction: 'ascending' })
    expect(model.getSnapshot().items.map((entry) => entry.resource.kind)).toEqual([
      'conversation',
      'file',
      'file',
    ])
    await model.dispatch({ type: 'sort', field: 'size', direction: 'descending' })
    expect(model.getSnapshot().items.map((entry) => entry.file.size)).toEqual([20, 10, 2])
    await model.dispatch({ type: 'viewMode', viewMode: 'grid' })
    model.dispose()

    const restoredAdapter = adapterHarness({ browse: async () => page(sourceOrder) })
    const restored = modelHarness({ adapter: restoredAdapter.adapter, storage })
    await restored.dispatch({ type: 'initialize' })
    expect(restored.getSnapshot()).toMatchObject({
      sort: { field: 'size', direction: 'descending' },
      viewMode: 'grid',
    })
    expect(restored.getSnapshot().items.map((entry) => entry.file.size)).toEqual([20, 10, 2])
    await restored.dispatch({ type: 'sort', field: 'default' })
    expect(restored.getSnapshot().items).toEqual(sourceOrder)
    restored.dispose()
  })

  test('loads cursor pages, deduplicates keys, and exposes loading-more state', async () => {
    const alpha = item('alpha', { name: 'alpha.txt' })
    const beta = item('beta', { name: 'beta.txt' })
    const gamma = item('gamma', { name: 'gamma.txt' })
    const nextPage = deferred<ExplorerPage>()
    const adapter = adapterHarness({
      browse: ({ cursor }) =>
        cursor ? nextPage.promise : Promise.resolve(page([beta, alpha], 'cursor-2', 3)),
    })
    const model = modelHarness({ adapter: adapter.adapter, pageSize: 2 })
    await model.dispatch({ type: 'initialize' })
    await model.dispatch({ type: 'sort', field: 'name', direction: 'ascending' })

    const loadingStates: boolean[] = []
    model.subscribe(() => loadingStates.push(model.getSnapshot().pagination.loadingMore))
    const loading = model.dispatch({ type: 'loadMore' })
    expect(model.getSnapshot().pagination.loadingMore).toBe(true)
    expect(adapter.browseCalls[1]?.query).toEqual({
      path: '',
      cursor: 'cursor-2',
      pageSize: 2,
    })
    nextPage.resolve(page([beta, gamma], undefined, 3))
    await loading

    expect(model.getSnapshot().items.map((entry) => entry.key)).toEqual([
      alpha.key,
      beta.key,
      gamma.key,
    ])
    expect(model.getSnapshot().pagination).toEqual({ total: 3, loadingMore: false })
    expect(loadingStates).toEqual([true, false])
    await model.dispatch({ type: 'loadMore' })
    expect(adapter.browseCalls).toHaveLength(2)
    model.dispose()
  })

  test('can consume every cursor page through model-owned pagination policy', async () => {
    const alpha = item('alpha')
    const beta = item('beta')
    const gamma = item('gamma')
    const adapter = adapterHarness({
      browse: async ({ cursor }) => {
        if (cursor === 'second') return page([beta], 'third', 3)
        if (cursor === 'third') return page([gamma], undefined, 3)
        return page([alpha], 'second', 3)
      },
    })
    const model = modelHarness({
      adapter: adapter.adapter,
      pageSize: 1,
      paginationMode: 'all',
    })

    await model.dispatch({ type: 'initialize' })

    expect(adapter.browseCalls.map((call) => call.query.cursor)).toEqual([
      undefined,
      'second',
      'third',
    ])
    expect(model.getSnapshot().items).toEqual([alpha, beta, gamma])
    expect(model.getSnapshot().pagination).toEqual({ total: 3, loadingMore: false })
    model.dispose()
  })

  test('preserves paginated selection and focus through refresh until the final page', async () => {
    const first = item('first')
    const second = item('second')
    const adapter = adapterHarness({
      browse: async ({ cursor }) =>
        cursor ? page([second], undefined, 2) : page([first], 'next', 2),
    })
    const model = modelHarness({ adapter: adapter.adapter, pageSize: 1 })
    await model.dispatch({ type: 'initialize' })
    await model.dispatch({ type: 'loadMore' })
    await model.dispatch({ type: 'select', key: second.key })
    expect(model.getSnapshot()).toMatchObject({
      selection: [second.key],
      focusedKey: second.key,
    })

    await model.dispatch({ type: 'refresh' })
    expect(model.getSnapshot()).toMatchObject({
      items: [first],
      selection: [second.key],
      focusedKey: second.key,
      pagination: { nextCursor: 'next' },
    })

    await model.dispatch({ type: 'loadMore' })
    expect(model.getSnapshot()).toMatchObject({
      items: [first, second],
      selection: [second.key],
      focusedKey: second.key,
      pagination: { total: 2, loadingMore: false },
    })
    expect(model.getSnapshot().pagination.nextCursor).toBeUndefined()
    model.dispose()
  })

  test('range selection falls back to the target when retained focus is not loaded yet', async () => {
    const first = item('first')
    const middle = item('middle')
    const later = item('later')
    const adapter = adapterHarness({
      browse: async ({ cursor }) =>
        cursor ? page([later], undefined, 3) : page([first, middle], 'next', 3),
    })
    const model = modelHarness({ adapter: adapter.adapter, pageSize: 2 })
    await model.dispatch({ type: 'initialize' })
    await model.dispatch({ type: 'loadMore' })
    await model.dispatch({ type: 'select', key: later.key })
    await model.dispatch({ type: 'refresh' })

    await model.dispatch({ type: 'select', key: first.key, mode: 'range' })

    expect(model.getSnapshot()).toMatchObject({
      selection: [first.key],
      focusedKey: first.key,
    })
    model.dispose()
  })

  test('tracks visible range and requests the next page near its end', async () => {
    const first = item('first')
    const second = item('second')
    const adapter = adapterHarness({
      browse: async (query) =>
        query.cursor ? page([second], undefined, 2) : page([first], 'next', 2),
    })
    const model = modelHarness({ adapter: adapter.adapter, pageSize: 20 })
    await model.dispatch({ type: 'initialize' })

    await model.dispatch({
      type: 'visibleRange',
      range: { startIndex: 0, endIndex: 0 },
    })

    expect(adapter.browseCalls.map((call) => call.query.cursor)).toEqual([undefined, 'next'])
    expect(model.getSnapshot().items).toEqual([first, second])
    expect(model.getSnapshot().virtualization).toEqual({
      startIndex: 0,
      endIndex: 0,
      itemCount: 2,
    })
    model.dispose()
  })

  test('aborts superseded loads and ignores their stale responses', async () => {
    const first = deferred<ExplorerPage>()
    const second = deferred<ExplorerPage>()
    const adapter = adapterHarness({
      browse: ({ path }) => (path === 'A' ? first.promise : second.promise),
    })
    const history = historyHarness('A')
    const model = modelHarness({ adapter: adapter.adapter, history: history.adapter })

    const initialize = model.dispatch({ type: 'initialize' })
    const firstSignal = adapter.browseCalls[0]!.signal
    const navigate = model.dispatch({ type: 'navigate', path: 'B' })
    expect(firstSignal.aborted).toBe(true)
    second.resolve(page([item('fresh', { path: 'B/fresh.txt' })]))
    expect((await navigate).kind).toBe('state')
    first.resolve(page([item('stale', { path: 'A/stale.txt' })]))
    expect((await initialize).kind).toBe('stale')
    expect(model.getSnapshot().path).toBe('B')
    expect(model.getSnapshot().items.map((entry) => entry.file.path)).toEqual(['B/fresh.txt'])
    model.dispose()
  })

  test('uses provisional page capabilities during initial and path-changing loads', async () => {
    const next = deferred<ExplorerPage>()
    const prior = item('prior', { path: 'alpha/prior.txt' })
    const adapter = adapterHarness({
      browse: async (query) =>
        query.path === 'alpha' ? page([prior], undefined, 1, ['createFile']) : next.promise,
      provisionalPageCapabilitiesForPath: (path) =>
        path === 'alpha' ? ['upload'] : ['createFolder', 'upload'],
    })
    const history = historyHarness('alpha')
    const model = modelHarness({ adapter: adapter.adapter, history: history.adapter })

    expect(model.getSnapshot()).toMatchObject({
      path: 'alpha',
      status: 'idle',
      capabilities: ['upload'],
    })
    const initializing = model.dispatch({ type: 'initialize' })
    expect(model.getSnapshot()).toMatchObject({
      path: 'alpha',
      status: 'loading',
      capabilities: ['upload'],
    })
    await initializing
    expect(model.getSnapshot().capabilities).toEqual(['createFile'])

    const navigating = model.dispatch({ type: 'navigate', path: 'beta' })
    expect(model.getSnapshot()).toMatchObject({
      path: 'beta',
      status: 'loading',
      items: [],
      capabilities: ['createFolder', 'upload'],
      stale: false,
    })
    next.resolve(page([], undefined, 0, ['move']))
    await navigating
    expect(model.getSnapshot().capabilities).toEqual(['move'])
    model.dispose()
  })

  test('retains stale items across refresh errors and clears the error after retry', async () => {
    const existing = item('existing')
    let attempt = 0
    const adapter = adapterHarness({
      browse: async () => {
        attempt += 1
        if (attempt === 2) {
          throw new ExplorerAdapterError(explorerError('network', 'connection lost', true))
        }
        return page([existing])
      },
    })
    const model = modelHarness({ adapter: adapter.adapter })
    await model.dispatch({ type: 'initialize' })

    const failed = await model.dispatch({ type: 'refresh' })
    expect(failed).toMatchObject({
      kind: 'unavailable',
      error: { code: 'network', message: 'connection lost', retryable: true },
    })
    expect(model.getSnapshot()).toMatchObject({
      items: [existing],
      status: 'error',
      stale: true,
      error: { code: 'network' },
    })

    await model.dispatch({ type: 'refresh' })
    expect(model.getSnapshot()).toMatchObject({
      items: [existing],
      status: 'ready',
      stale: false,
      error: undefined,
    })
    model.dispose()
  })

  test('emits an OpenPlan with canonical item, intent, scope, and effective operations', async () => {
    const folder = item('folder', {
      directory: true,
      capabilities: ['open', 'browse', 'download', 'delete'],
      providerOperations: ['browse', 'download'],
    })
    const calls: Array<{
      resource: ResourceSummary
      intent: OpenIntent
      context: OpenContext
    }> = []
    const expectedPlan: OpenPlan = {
      kind: 'browse',
      resource: folder.resource.ref,
      version: folder.resource.version,
    }
    const opener: ResourceOpener = (resource, intent, context) => {
      calls.push({ resource, intent, context })
      return expectedPlan
    }
    const adapter = adapterHarness({
      scope: { kind: 'grant', id: 'grant-secret' },
      browse: async () => page([folder]),
    })
    const model = modelHarness({ adapter: adapter.adapter, opener })
    await model.dispatch({ type: 'initialize' })

    const outcome = await model.dispatch({
      type: 'open',
      key: folder.key,
      intent: 'browse',
      surface: 'share',
    })
    expect(outcome).toEqual({ kind: 'open', item: folder, plan: expectedPlan })
    expect(model.getSnapshot()).toMatchObject({
      selection: [folder.key],
      focusedKey: folder.key,
    })
    expect(calls).toEqual([
      {
        resource: folder.resource,
        intent: 'browse',
        context: {
          surface: 'share',
          scope: { kind: 'grant', id: 'grant-secret' },
          effectiveOperations: ['browse', 'download'],
        },
      },
    ])
    expect(await model.dispatch({ type: 'open', key: 'missing', surface: 'share' })).toMatchObject({
      kind: 'unavailable',
      error: { code: 'notFound' },
    })
    expect(calls).toHaveLength(1)

    const locked = item('locked', { capabilities: ['read'] })
    const lockedAdapter = adapterHarness({ browse: async () => page([locked]) })
    const lockedModel = modelHarness({ adapter: lockedAdapter.adapter, opener })
    await lockedModel.dispatch({ type: 'initialize' })
    expect(
      await lockedModel.dispatch({ type: 'open', key: locked.key, surface: 'library' }),
    ).toMatchObject({ kind: 'unavailable', error: { code: 'forbidden' } })
    expect(calls).toHaveLength(1)
    lockedModel.dispose()
    model.dispose()
  })

  test('denies commands missing canonical item capability, including crafted intent items', async () => {
    const canonical = item('locked', { capabilities: ['read'] })
    const forged: ExplorerItem = Object.freeze({
      ...canonical,
      capabilities: Object.freeze<ExplorerCapability[]>(['read', 'delete']),
    })
    const adapter = adapterHarness({ browse: async () => page([canonical]) })
    const model = modelHarness({ adapter: adapter.adapter })
    await model.dispatch({ type: 'initialize' })

    for (const commandItem of [canonical, forged]) {
      expect(
        await model.dispatch({ type: 'command', command: { kind: 'delete', item: commandItem } }),
      ).toMatchObject({
        kind: 'unavailable',
        error: { code: 'forbidden', retryable: false },
      })
    }
    expect(adapter.executeCalls).toHaveLength(0)
    expect(model.getSnapshot().items).toEqual([canonical])
    model.dispose()
  })

  test('authorizes provider directory actions from page capabilities', async () => {
    const adapter = adapterHarness({
      browse: async () => page([], undefined, 0, ['createFolder']),
    })
    const model = modelHarness({
      adapter: adapter.adapter,
      history: historyHarness('Hermes Sessions').adapter,
    })
    await model.dispatch({ type: 'initialize' })

    expect(
      await model.dispatch({
        type: 'command',
        command: {
          kind: 'providerDirectoryAction',
          path: 'Hermes Sessions',
          action: 'createFile',
        },
      }),
    ).toMatchObject({ kind: 'unavailable', error: { code: 'forbidden' } })
    expect(adapter.executeCalls).toHaveLength(0)

    expect(
      await model.dispatch({
        type: 'command',
        command: {
          kind: 'providerDirectoryAction',
          path: 'Other Provider',
          action: 'createFolder',
          value: { name: 'Project' },
        },
      }),
    ).toMatchObject({ kind: 'unavailable', error: { code: 'forbidden' } })
    expect(adapter.executeCalls).toHaveLength(0)

    expect(
      await model.dispatch({
        type: 'command',
        command: {
          kind: 'providerDirectoryAction',
          path: 'Hermes Sessions',
          action: 'createFolder',
          value: { name: 'Project' },
        },
      }),
    ).toMatchObject({ kind: 'command' })
    expect(adapter.executeCalls[0]?.command).toMatchObject({
      kind: 'providerDirectoryAction',
      action: 'createFolder',
    })
    model.dispose()
  })

  test('shows an optimistic rename then reconciles to the authoritative success page', async () => {
    const original = item('document', {
      name: 'draft.txt',
      path: 'Notes/draft.txt',
      capabilities: ['read', 'rename'],
    })
    const corrected = item('document', {
      name: 'Final.txt',
      path: 'Notes/Final.txt',
      capabilities: ['read', 'rename'],
    })
    const execution = deferred<ExplorerCommandReceipt>()
    let listing: readonly ExplorerItem[] = [original]
    const adapter = adapterHarness({
      browse: async () => page(listing),
      execute: () => execution.promise,
    })
    const model = modelHarness({ adapter: adapter.adapter, clock: { now: () => 500 } })
    await model.dispatch({ type: 'initialize' })

    const command = model.dispatch({
      type: 'command',
      command: { kind: 'rename', item: original, name: 'final.txt' },
    })
    expect(model.getSnapshot().items[0]?.file).toMatchObject({
      name: 'final.txt',
      path: 'Notes/final.txt',
    })
    expect(model.getSnapshot().pendingCommands).toEqual(['500-1'])

    listing = [corrected]
    execution.resolve({ commandId: 'server-command', affectedRefs: [original.resource.ref] })
    expect(await command).toMatchObject({
      kind: 'command',
      receipt: { commandId: 'server-command' },
    })
    expect(model.getSnapshot().items).toEqual([corrected])
    expect(model.getSnapshot().pendingCommands).toEqual([])
    expect(adapter.browseCalls).toHaveLength(2)
    model.dispose()
  })

  test('rolls an optimistic delete back when the adapter returns a typed failure', async () => {
    const target = item('target', { capabilities: ['read', 'delete'] })
    const execution = deferred<ExplorerCommandReceipt>()
    const adapter = adapterHarness({
      browse: async () => page([target]),
      execute: () => execution.promise,
    })
    const model = modelHarness({ adapter: adapter.adapter })
    await model.dispatch({ type: 'initialize' })

    const command = model.dispatch({
      type: 'command',
      command: { kind: 'delete', item: target },
    })
    expect(model.getSnapshot().items).toEqual([])
    expect(model.getSnapshot().pendingCommands).toHaveLength(1)
    execution.reject(new ExplorerAdapterError(explorerError('conflict', 'file changed')))

    expect(await command).toMatchObject({
      kind: 'unavailable',
      error: { code: 'conflict', message: 'file changed', retryable: false },
    })
    expect(model.getSnapshot()).toMatchObject({
      items: [target],
      pendingCommands: [],
      error: { code: 'conflict' },
    })
    model.dispose()
  })

  test('keeps an online resource visible while removing only its offline copy', async () => {
    const target = item('target', { capabilities: ['read', 'removeOffline'] })
    const execution = deferred<ExplorerCommandReceipt>()
    const adapter = adapterHarness({
      browse: async () => page([target]),
      execute: () => execution.promise,
    })
    const model = modelHarness({ adapter: adapter.adapter })
    await model.dispatch({ type: 'initialize' })

    const command = model.dispatch({
      type: 'command',
      command: { kind: 'removeOffline', item: target },
    })
    expect(model.getSnapshot().items).toEqual([target])

    execution.resolve({ affectedRefs: [target.resource.ref] })
    expect(await command).toMatchObject({ kind: 'command' })
    expect(model.getSnapshot().items).toEqual([target])
    model.dispose()
  })

  test('rebases a failed optimistic command over a concurrent authoritative refresh', async () => {
    const target = item('target', { capabilities: ['read', 'delete'] })
    const sibling = item('sibling', { capabilities: ['read', 'delete'] })
    const discovered = item('discovered', { capabilities: ['read'] })
    const execution = deferred<ExplorerCommandReceipt>()
    let listing: readonly ExplorerItem[] = [target, sibling]
    const adapter = adapterHarness({
      browse: async () => page(listing),
      execute: () => execution.promise,
    })
    const model = modelHarness({ adapter: adapter.adapter })
    await model.dispatch({ type: 'initialize' })

    const command = model.dispatch({
      type: 'command',
      command: { kind: 'delete', item: target },
    })
    listing = [target, sibling, discovered]
    await model.dispatch({ type: 'refresh' })
    expect(model.getSnapshot().items).toEqual([sibling, discovered])

    execution.reject(new ExplorerAdapterError(explorerError('conflict', 'Delete lost')))
    expect(await command).toMatchObject({ kind: 'unavailable', error: { code: 'conflict' } })
    expect(model.getSnapshot().items).toEqual([target, sibling, discovered])
    model.dispose()
  })

  test('rebases overlapping optimistic failures without clobbering newer commands', async () => {
    const alpha = item('alpha', { capabilities: ['read', 'delete'] })
    const beta = item('beta', { capabilities: ['read', 'delete'] })
    const stable = item('stable', { capabilities: ['read'] })
    const alphaExecution = deferred<ExplorerCommandReceipt>()
    const betaExecution = deferred<ExplorerCommandReceipt>()
    const adapter = adapterHarness({
      browse: async () => page([alpha, beta, stable]),
      execute: (command) =>
        command.kind === 'delete' && command.item.key === alpha.key
          ? alphaExecution.promise
          : betaExecution.promise,
    })
    const model = modelHarness({ adapter: adapter.adapter })
    await model.dispatch({ type: 'initialize' })

    const deletingAlpha = model.dispatch({
      type: 'command',
      command: { kind: 'delete', item: alpha },
    })
    const deletingBeta = model.dispatch({
      type: 'command',
      command: { kind: 'delete', item: beta },
    })
    expect(model.getSnapshot().items).toEqual([stable])

    alphaExecution.reject(new ExplorerAdapterError(explorerError('conflict', 'Alpha changed')))
    await deletingAlpha
    expect(model.getSnapshot().items).toEqual([alpha, stable])
    expect(model.getSnapshot().pendingCommands).toHaveLength(1)

    betaExecution.reject(new ExplorerAdapterError(explorerError('conflict', 'Beta changed')))
    await deletingBeta
    expect(model.getSnapshot().items).toEqual([alpha, beta, stable])
    expect(model.getSnapshot().pendingCommands).toEqual([])
    model.dispose()
  })

  test('does not roll a failed command from an old path into the current page', async () => {
    const command = deferred<ExplorerCommandReceipt>()
    const old = item('alpha-old', {
      path: 'alpha/old.txt',
      capabilities: ['open', 'read', 'delete'],
    })
    const current = item('beta-current', {
      path: 'beta/current.txt',
      capabilities: ['open', 'read'],
    })
    const adapter = adapterHarness({
      browse: async (query) => page(query.path === 'alpha' ? [old] : [current]),
      execute: () => command.promise,
    })
    const history = historyHarness('alpha')
    const model = modelHarness({ adapter: adapter.adapter, history: history.adapter })
    await model.dispatch({ type: 'initialize' })
    const pending = model.dispatch({
      type: 'command',
      command: { kind: 'delete', item: old },
    })

    await model.dispatch({ type: 'navigate', path: 'beta' })
    command.reject(new ExplorerAdapterError(explorerError('conflict', 'Delete lost')))
    const outcome = await pending

    expect(outcome.kind).toBe('unavailable')
    expect(model.getSnapshot().path).toBe('beta')
    expect(model.getSnapshot().items.map((candidate) => candidate.file.path)).toEqual([
      'beta/current.txt',
    ])
  })

  test('returns typed offline errors while allowing offline-vault removal', async () => {
    const target = item('offline-target', {
      capabilities: ['read', 'delete', 'removeOffline'],
    })
    const ownerAdapter = adapterHarness({ browse: async () => page([target]) })
    const offlineSignal = onlineHarness(false)
    const ownerModel = modelHarness({
      adapter: ownerAdapter.adapter,
      online: offlineSignal.adapter,
    })
    await ownerModel.dispatch({ type: 'initialize' })
    expect(
      await ownerModel.dispatch({
        type: 'command',
        command: { kind: 'delete', item: target },
      }),
    ).toMatchObject({ kind: 'unavailable', error: { code: 'offlineUnavailable' } })
    expect(ownerAdapter.executeCalls).toHaveLength(0)
    ownerModel.dispose()

    let offlineListing: readonly ExplorerItem[] = [target]
    const offlineAdapter = adapterHarness({
      scope: { kind: 'offline', id: 'owner-vault' },
      browse: async () => page(offlineListing),
      execute: async (command) => {
        if (command.kind !== 'removeOffline') {
          throw new ExplorerAdapterError(
            explorerError('offlineUnavailable', 'Offline catalog is read-only'),
          )
        }
        offlineListing = []
        return { commandId: 'local-remove' }
      },
    })
    const offlineModel = modelHarness({
      adapter: offlineAdapter.adapter,
      online: offlineSignal.adapter,
    })
    await offlineModel.dispatch({ type: 'initialize' })
    expect(
      await offlineModel.dispatch({
        type: 'command',
        command: { kind: 'delete', item: target },
      }),
    ).toMatchObject({ kind: 'unavailable', error: { code: 'offlineUnavailable' } })
    expect(offlineModel.getSnapshot().items).toEqual([target])

    expect(
      await offlineModel.dispatch({
        type: 'command',
        command: { kind: 'removeOffline', item: target },
      }),
    ).toMatchObject({ kind: 'command', receipt: { commandId: 'local-remove' } })
    expect(offlineModel.getSnapshot().items).toEqual([])
    offlineModel.dispose()
  })

  test('allows only explicitly capable external plans, vault actions, and appearance commands', async () => {
    const external = item('external-folder', {
      name: 'Folder',
      path: 'Shared/Folder',
      directory: true,
      capabilities: ['browse', 'download', 'removeOffline', 'delete'],
    })
    const adapter = adapterHarness({
      scope: { kind: 'grant', id: 'grant-1' },
      plan: (_action, target) => ({
        kind: 'download',
        href: `/grant/download/${target.file.path}`,
        fileName: `${target.file.name}.zip`,
      }),
    })
    const model = modelHarness({ adapter: adapter.adapter })
    await model.dispatch({ type: 'initialize' })

    expect(
      await model.dispatch({ type: 'actionExternal', action: 'download', item: external }),
    ).toMatchObject({
      kind: 'action',
      plan: { kind: 'download', href: '/grant/download/Shared/Folder' },
    })
    expect(
      await model.dispatch({
        type: 'command',
        command: { kind: 'removeOffline', item: external },
      }),
    ).toMatchObject({ kind: 'command' })
    expect(adapter.executeCalls).toHaveLength(1)
    const appearanceTarget = {
      ...external,
      capabilities: [...external.capabilities, 'setAppearance'] as ExplorerCapability[],
    }
    expect(
      await model.dispatch({
        type: 'command',
        command: {
          kind: 'setAppearanceExternal',
          target: appearanceTarget,
          iconName: 'folder-heart',
        },
      }),
    ).toMatchObject({ kind: 'command' })
    expect(adapter.executeCalls).toHaveLength(2)
    expect(
      await model.dispatch({
        type: 'command',
        command: { kind: 'delete', item: external },
      }),
    ).toMatchObject({ kind: 'unavailable', error: { code: 'notFound' } })
    expect(adapter.executeCalls).toHaveLength(2)
    model.dispose()
  })
})
