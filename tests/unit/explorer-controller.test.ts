import { describe, expect, test } from 'bun:test'
import { resourceKey, type ResourceSummary } from '@/lib/domain/resource'
import {
  createExplorerController,
  createMemoryExplorerStorage,
  explorerResourceKey,
} from '@/src/features/explorer/controller'
import type {
  ExplorerActionDescriptor,
  ExplorerBrowseRequest,
  ExplorerCommand,
  ExplorerCommandReceipt,
  ExplorerDataSource,
  ExplorerHistory,
  ExplorerItem,
  ExplorerLocation,
  ExplorerPage,
} from '@/src/features/explorer/types'

type Payload = { locator: string }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, reject, resolve }
}

function location(id: string): ExplorerLocation {
  return { key: resourceKey('fixture', id) }
}

const renameAction: ExplorerActionDescriptor = {
  id: 'rename',
  operation: 'rename',
  label: 'Rename',
  capability: 'rename',
  scope: 'resource',
  optimisticEffect: 'rename',
  interaction: 'name',
}

const deleteAction: ExplorerActionDescriptor = {
  id: 'delete',
  operation: 'delete',
  label: 'Delete',
  capability: 'delete',
  scope: 'resource',
  optimisticEffect: 'delete',
  destructive: true,
  interaction: 'immediate',
}

function item(
  id: string,
  overrides: Partial<ResourceSummary> & {
    actions?: readonly ExplorerActionDescriptor[]
  } = {},
): ExplorerItem<Payload> {
  const actions = overrides.actions ?? []
  const summary: ResourceSummary = {
    key: resourceKey('fixture', id),
    name: `${id}.txt`,
    kind: 'file',
    capabilities: actions.map((action) => action.capability),
    presentation: 'text',
    size: 1,
    ...overrides,
  }
  return {
    key: explorerResourceKey(summary.key),
    resource: summary,
    actions,
    payload: { locator: summary.name },
  }
}

function page(
  at: ExplorerLocation,
  items: readonly ExplorerItem<Payload>[],
  nextCursor?: string,
  total = items.length,
): ExplorerPage<Payload> {
  return {
    location: at,
    breadcrumbs: [],
    items,
    actions: [],
    nextCursor,
    total,
  }
}

function historyHarness(initial: ExplorerLocation) {
  const stack = [initial]
  let index = 0
  const listeners = new Set<(value: ExplorerLocation) => void>()
  const pushes: ExplorerLocation[] = []
  const replacements: ExplorerLocation[] = []
  const history: ExplorerHistory = {
    current: () => stack[index]!,
    push(value) {
      pushes.push(value)
      stack.splice(index + 1)
      stack.push(value)
      index = stack.length - 1
    },
    replace(value) {
      replacements.push(value)
      stack[index] = value
    },
    back() {
      if (index === 0) return
      index -= 1
      for (const listener of listeners) listener(stack[index]!)
    },
    forward() {
      if (index >= stack.length - 1) return
      index += 1
      for (const listener of listeners) listener(stack[index]!)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return {
    history,
    pushes,
    replacements,
    external(value: ExplorerLocation) {
      stack.splice(index + 1)
      stack.push(value)
      index = stack.length - 1
      for (const listener of listeners) listener(value)
    },
  }
}

function dataSourceHarness(options: {
  browse: (request: ExplorerBrowseRequest) => Promise<ExplorerPage<Payload>>
  execute?: (command: ExplorerCommand<Payload>) => Promise<ExplorerCommandReceipt>
}) {
  const browseCalls: ExplorerBrowseRequest[] = []
  const executeCalls: ExplorerCommand<Payload>[] = []
  const listeners = new Set<() => void>()
  const dataSource: ExplorerDataSource<Payload> = {
    async browse(request) {
      browseCalls.push(request)
      return options.browse(request)
    },
    async execute(command) {
      executeCalls.push(command)
      return options.execute?.(command) ?? {}
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return {
    browseCalls,
    dataSource,
    executeCalls,
    notify() {
      for (const listener of listeners) listener()
    },
  }
}

async function settleHistory() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('Explorer controller', () => {
  test('follows push, replace, back, forward, and external history changes', async () => {
    const root = location('root')
    const albums = location('Music/Albums')
    const images = location('Images')
    const documents = location('Documents')
    const listings = new Map([
      [explorerResourceKey(root.key), [item('root')]],
      [explorerResourceKey(albums.key), [item('album')]],
      [explorerResourceKey(images.key), [item('image')]],
      [explorerResourceKey(documents.key), [item('document')]],
    ])
    const history = historyHarness(root)
    const source = dataSourceHarness({
      browse: async ({ location: current }) =>
        page(current, listings.get(explorerResourceKey(current.key)) ?? []),
    })
    const controller = createExplorerController({
      dataSource: source.dataSource,
      history: history.history,
      initialLocation: root,
    })

    await controller.dispatch({ type: 'initialize' })
    await controller.dispatch({ type: 'navigate', location: albums })
    await controller.dispatch({ type: 'navigate', location: images, replace: true })
    expect(history.pushes).toEqual([albums])
    expect(history.replacements).toEqual([images])
    expect(controller.getSnapshot().location).toEqual(images)

    await controller.dispatch({ type: 'back' })
    await settleHistory()
    expect(controller.getSnapshot().location).toEqual(root)
    expect(controller.getSnapshot().items).toEqual(listings.get(explorerResourceKey(root.key))!)

    await controller.dispatch({ type: 'forward' })
    await settleHistory()
    expect(controller.getSnapshot().location).toEqual(images)

    history.external(documents)
    await settleHistory()
    expect(controller.getSnapshot().location).toEqual(documents)
    expect(controller.getSnapshot().items).toEqual(
      listings.get(explorerResourceKey(documents.key))!,
    )
    controller.dispose()
  })

  test('persists selection per location and supports replace, toggle, range, and focus moves', async () => {
    const a = location('A')
    const b = location('B')
    const alpha = item('alpha')
    const beta = item('beta')
    const gamma = item('gamma')
    const other = item('other')
    const storage = createMemoryExplorerStorage()
    const source = dataSourceHarness({
      browse: async ({ location: current }) =>
        page(current, current.key.id === 'A' ? [alpha, beta, gamma] : [other]),
    })
    const controller = createExplorerController({
      dataSource: source.dataSource,
      history: historyHarness(a).history,
      initialLocation: a,
      storage,
    })
    await controller.dispatch({ type: 'initialize' })

    await controller.dispatch({ type: 'select', key: alpha.key })
    await controller.dispatch({ type: 'select', key: gamma.key, mode: 'range' })
    expect(controller.getSnapshot().selection).toEqual([alpha.key, beta.key, gamma.key])
    await controller.dispatch({ type: 'select', key: beta.key, mode: 'toggle' })
    expect(controller.getSnapshot().selection).toEqual([alpha.key, gamma.key])
    expect(controller.getSnapshot().focusedKey).toBe(beta.key)
    await controller.dispatch({ type: 'focusMove', delta: 1 })
    expect(controller.getSnapshot().focusedKey).toBe(gamma.key)

    await controller.dispatch({ type: 'navigate', location: b })
    expect(controller.getSnapshot().selection).toEqual([])
    await controller.dispatch({ type: 'select', key: other.key })
    await controller.dispatch({ type: 'navigate', location: a })
    expect(controller.getSnapshot().selection).toEqual([alpha.key, gamma.key])

    controller.dispose()
    const restored = createExplorerController({
      dataSource: source.dataSource,
      history: historyHarness(a).history,
      initialLocation: a,
      storage,
    })
    await restored.dispatch({ type: 'initialize' })
    expect(restored.getSnapshot().selection).toEqual([alpha.key, gamma.key])
    await restored.dispatch({ type: 'clearSelection' })
    expect(restored.getSnapshot().selection).toEqual([])
    restored.dispose()
  })

  test('sorts deterministically and restores sort and view mode from storage', async () => {
    const at = location('sort')
    const file10 = item('file-10', { name: 'file10.txt', size: 10 })
    const file2 = item('file-2', { name: 'file2.txt', size: 2 })
    const conversation = item('conversation', {
      name: 'chat.txt',
      kind: 'conversation',
      size: 20,
    })
    const sourceOrder = [file10, conversation, file2]
    const storage = createMemoryExplorerStorage()
    const source = dataSourceHarness({ browse: async () => page(at, sourceOrder) })
    const controller = createExplorerController({
      dataSource: source.dataSource,
      history: historyHarness(at).history,
      initialLocation: at,
      storage,
    })
    await controller.dispatch({ type: 'initialize' })

    await controller.dispatch({ type: 'sort', field: 'name', direction: 'ascending' })
    expect(controller.getSnapshot().items.map((entry) => entry.resource.name)).toEqual([
      'chat.txt',
      'file2.txt',
      'file10.txt',
    ])
    await controller.dispatch({ type: 'sort', field: 'kind', direction: 'ascending' })
    expect(controller.getSnapshot().items.map((entry) => entry.resource.kind)).toEqual([
      'conversation',
      'file',
      'file',
    ])
    await controller.dispatch({ type: 'sort', field: 'size', direction: 'descending' })
    expect(controller.getSnapshot().items.map((entry) => entry.resource.size)).toEqual([20, 10, 2])
    await controller.dispatch({ type: 'viewMode', viewMode: 'grid' })
    const gridRevision = controller.getSnapshot().revision
    await controller.dispatch({ type: 'viewMode', viewMode: 'grid' })
    expect(controller.getSnapshot().revision).toBe(gridRevision)
    controller.dispose()

    const restored = createExplorerController({
      dataSource: source.dataSource,
      history: historyHarness(at).history,
      initialLocation: at,
      storage,
    })
    await restored.dispatch({ type: 'initialize' })
    expect(restored.getSnapshot()).toMatchObject({
      sort: { field: 'size', direction: 'descending' },
      viewMode: 'grid',
    })
    expect(restored.getSnapshot().items.map((entry) => entry.resource.size)).toEqual([20, 10, 2])
    await restored.dispatch({ type: 'sort', field: 'default' })
    expect(restored.getSnapshot().items).toEqual(sourceOrder)
    restored.dispose()
  })

  test('loads cursor pages, deduplicates keys, and preserves paginated selection', async () => {
    const at = location('pages')
    const alpha = item('alpha')
    const beta = item('beta')
    const gamma = item('gamma')
    let refresh = false
    const source = dataSourceHarness({
      browse: async ({ cursor, reason }) => {
        if (reason === 'refresh') refresh = true
        if (cursor === 'next') return page(at, [beta, gamma], undefined, 3)
        return page(at, [alpha, beta], 'next', 3)
      },
    })
    const controller = createExplorerController({
      dataSource: source.dataSource,
      history: historyHarness(at).history,
      initialLocation: at,
      pageSize: 2,
    })
    await controller.dispatch({ type: 'initialize' })
    await controller.dispatch({ type: 'loadMore' })
    expect(controller.getSnapshot().items).toEqual([alpha, beta, gamma])
    expect(controller.getSnapshot().pagination).toEqual({ total: 3, loadingMore: false })

    await controller.dispatch({ type: 'select', key: gamma.key })
    await controller.dispatch({ type: 'refresh' })
    expect(refresh).toBe(true)
    expect(controller.getSnapshot()).toMatchObject({
      selection: [gamma.key],
      focusedKey: gamma.key,
      pagination: { nextCursor: 'next' },
    })
    await controller.dispatch({ type: 'loadMore' })
    expect(controller.getSnapshot()).toMatchObject({
      selection: [gamma.key],
      focusedKey: gamma.key,
      pagination: { total: 3, loadingMore: false },
    })
    expect(source.browseCalls[1]?.cursor).toBe('next')
    expect(source.browseCalls[0]?.pageSize).toBe(2)
    controller.dispose()
  })

  test('loads the next page when visible range reaches the current end', async () => {
    const at = location('visible')
    const first = item('first')
    const second = item('second')
    const source = dataSourceHarness({
      browse: async ({ cursor }) =>
        cursor ? page(at, [second], undefined, 2) : page(at, [first], 'next', 2),
    })
    const controller = createExplorerController({
      dataSource: source.dataSource,
      history: historyHarness(at).history,
      initialLocation: at,
    })
    await controller.dispatch({ type: 'initialize' })
    await controller.dispatch({
      type: 'visibleRange',
      range: { startIndex: 0, endIndex: 0 },
    })

    expect(source.browseCalls.map((call) => call.cursor)).toEqual([undefined, 'next'])
    expect(controller.getSnapshot().items).toEqual([first, second])
    expect(controller.getSnapshot().visibleRange).toEqual({ startIndex: 0, endIndex: 0 })
    controller.dispose()
  })

  test('aborts superseded loads and ignores stale responses', async () => {
    const a = location('A')
    const b = location('B')
    const first = deferred<ExplorerPage<Payload>>()
    const second = deferred<ExplorerPage<Payload>>()
    const source = dataSourceHarness({
      browse: ({ location: current }) => (current.key.id === 'A' ? first.promise : second.promise),
    })
    const controller = createExplorerController({
      dataSource: source.dataSource,
      history: historyHarness(a).history,
      initialLocation: a,
    })

    const initializing = controller.dispatch({ type: 'initialize' })
    const firstSignal = source.browseCalls[0]!.signal
    const navigating = controller.dispatch({ type: 'navigate', location: b })
    expect(firstSignal.aborted).toBe(true)
    second.resolve(page(b, [item('fresh')]))
    expect((await navigating).kind).toBe('state')
    first.resolve(page(a, [item('stale')]))
    expect((await initializing).kind).toBe('stale')
    expect(controller.getSnapshot().location).toEqual(b)
    expect(controller.getSnapshot().items.map((entry) => entry.resource.name)).toEqual([
      'fresh.txt',
    ])
    controller.dispose()
  })

  test('retains stale items across refresh errors and clears error after retry', async () => {
    const at = location('refresh')
    const existing = item('existing')
    let attempt = 0
    const source = dataSourceHarness({
      browse: async () => {
        attempt += 1
        if (attempt === 2) throw new Error('connection lost')
        return page(at, [existing])
      },
    })
    const controller = createExplorerController({
      dataSource: source.dataSource,
      history: historyHarness(at).history,
      initialLocation: at,
    })
    await controller.dispatch({ type: 'initialize' })

    expect(await controller.dispatch({ type: 'refresh' })).toMatchObject({
      kind: 'unavailable',
      error: { message: 'connection lost' },
    })
    expect(controller.getSnapshot()).toMatchObject({
      items: [existing],
      status: 'error',
      stale: true,
      error: { message: 'connection lost' },
    })

    await controller.dispatch({ type: 'refresh' })
    expect(controller.getSnapshot()).toMatchObject({
      items: [existing],
      status: 'ready',
      stale: false,
      error: undefined,
    })
    controller.dispose()
  })

  test('does not let source notifications supersede an active load or erase its error', async () => {
    const at = location('source-events')
    const pending = deferred<ExplorerPage<Payload>>()
    let attempt = 0
    const source = dataSourceHarness({
      browse: async () => {
        attempt += 1
        if (attempt === 1) return page(at, [item('existing')])
        if (attempt === 2) return pending.promise
        return page(at, [item('recovered')])
      },
    })
    const controller = createExplorerController({
      dataSource: source.dataSource,
      history: historyHarness(at).history,
      initialLocation: at,
    })
    await controller.dispatch({ type: 'initialize' })

    const refreshing = controller.dispatch({ type: 'refresh' })
    source.notify()
    await settleHistory()
    expect(source.browseCalls).toHaveLength(2)

    pending.reject(new Error('load failed'))
    expect((await refreshing).kind).toBe('unavailable')
    source.notify()
    await settleHistory()
    expect(source.browseCalls).toHaveLength(2)
    expect(controller.getSnapshot()).toMatchObject({
      status: 'error',
      error: { message: 'load failed' },
    })

    await controller.dispatch({ type: 'refresh' })
    expect(source.browseCalls).toHaveLength(3)
    expect(controller.getSnapshot().status).toBe('ready')
    controller.dispose()
  })

  test('shows optimistic rename then reconciles to authoritative success', async () => {
    const at = location('rename')
    const original = item('document', { name: 'draft.txt', actions: [renameAction] })
    const corrected = item('document', { name: 'Final.txt', actions: [renameAction] })
    const execution = deferred<ExplorerCommandReceipt>()
    let listing: readonly ExplorerItem<Payload>[] = [original]
    const source = dataSourceHarness({
      browse: async () => page(at, listing),
      execute: () => execution.promise,
    })
    const controller = createExplorerController({
      dataSource: source.dataSource,
      history: historyHarness(at).history,
      initialLocation: at,
      clock: { now: () => 500 },
    })
    await controller.dispatch({ type: 'initialize' })

    const command = controller.dispatch({
      type: 'command',
      command: { actionId: 'rename', itemKey: original.key, input: { name: 'final.txt' } },
    })
    expect(controller.getSnapshot().items[0]?.resource.name).toBe('final.txt')
    expect(controller.getSnapshot().pendingCommands).toEqual(['500-1'])

    listing = [corrected]
    execution.resolve({ commandId: 'server-command' })
    expect(await command).toMatchObject({
      kind: 'command',
      receipt: { commandId: 'server-command' },
    })
    expect(controller.getSnapshot().items).toEqual([corrected])
    expect(controller.getSnapshot().pendingCommands).toEqual([])
    expect(source.browseCalls).toHaveLength(2)
    controller.dispose()
  })

  test('executes location actions through the same capability-checked command seam', async () => {
    const at = location('actions')
    const createAction: ExplorerActionDescriptor = {
      id: 'fixture.create',
      operation: 'createFile',
      label: 'Create',
      capability: 'fixture.create',
      scope: 'location',
      interaction: 'name',
    }
    const locationItem = item('actions-location', { actions: [createAction] })
    const source = dataSourceHarness({
      browse: async () => ({
        ...page(at, []),
        locationItem,
        actions: [createAction],
      }),
      execute: async (command) => ({ commandId: command.id, outcome: { created: true } }),
    })
    const controller = createExplorerController({
      dataSource: source.dataSource,
      history: historyHarness(at).history,
      initialLocation: at,
      clock: { now: () => 700 },
    })
    await controller.dispatch({ type: 'initialize' })

    expect(
      await controller.dispatch({
        type: 'command',
        command: { actionId: createAction.id, input: { name: 'Draft' } },
      }),
    ).toEqual({
      kind: 'command',
      receipt: { commandId: '700-1', outcome: { created: true } },
    })
    expect(source.executeCalls[0]?.item).toEqual(locationItem)
    controller.dispose()
  })

  test('rolls failed optimistic delete back over a concurrent authoritative refresh', async () => {
    const at = location('delete')
    const target = item('target', { actions: [deleteAction] })
    const sibling = item('sibling', { actions: [deleteAction] })
    const discovered = item('discovered')
    const execution = deferred<ExplorerCommandReceipt>()
    let listing: readonly ExplorerItem<Payload>[] = [target, sibling]
    const source = dataSourceHarness({
      browse: async () => page(at, listing),
      execute: () => execution.promise,
    })
    const controller = createExplorerController({
      dataSource: source.dataSource,
      history: historyHarness(at).history,
      initialLocation: at,
    })
    await controller.dispatch({ type: 'initialize' })

    const deleting = controller.dispatch({
      type: 'command',
      command: { actionId: 'delete', itemKey: target.key },
    })
    expect(controller.getSnapshot().items).toEqual([sibling])
    listing = [target, sibling, discovered]
    await controller.dispatch({ type: 'refresh' })
    expect(controller.getSnapshot().items).toEqual([sibling, discovered])

    execution.reject(new Error('file changed'))
    expect(await deleting).toMatchObject({
      kind: 'unavailable',
      error: { message: 'file changed' },
    })
    expect(controller.getSnapshot().items).toEqual([target, sibling, discovered])
    controller.dispose()
  })

  test('rebases overlapping failures and never rolls an old-location command into current items', async () => {
    const a = location('A')
    const b = location('B')
    const alpha = item('alpha', { actions: [deleteAction] })
    const beta = item('beta', { actions: [deleteAction] })
    const current = item('current')
    const alphaExecution = deferred<ExplorerCommandReceipt>()
    const betaExecution = deferred<ExplorerCommandReceipt>()
    const source = dataSourceHarness({
      browse: async ({ location: currentLocation }) =>
        currentLocation.key.id === 'A' ? page(a, [alpha, beta]) : page(b, [current]),
      execute: (command) =>
        command.item.key === alpha.key ? alphaExecution.promise : betaExecution.promise,
    })
    const controller = createExplorerController({
      dataSource: source.dataSource,
      history: historyHarness(a).history,
      initialLocation: a,
    })
    await controller.dispatch({ type: 'initialize' })

    const deletingAlpha = controller.dispatch({
      type: 'command',
      command: { actionId: 'delete', itemKey: alpha.key },
    })
    const deletingBeta = controller.dispatch({
      type: 'command',
      command: { actionId: 'delete', itemKey: beta.key },
    })
    expect(controller.getSnapshot().items).toEqual([])

    alphaExecution.reject(new Error('alpha changed'))
    await deletingAlpha
    expect(controller.getSnapshot().items).toEqual([alpha])
    expect(controller.getSnapshot().pendingCommands).toHaveLength(1)

    await controller.dispatch({ type: 'navigate', location: b })
    betaExecution.reject(new Error('beta changed'))
    await deletingBeta
    expect(controller.getSnapshot().location).toEqual(b)
    expect(controller.getSnapshot().items).toEqual([current])
    controller.dispose()
  })
})
