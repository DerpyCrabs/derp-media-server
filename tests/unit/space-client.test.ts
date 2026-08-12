import { describe, expect, test } from 'bun:test'
import {
  SpaceTransportError,
  createOptimisticSpaceClient,
  type ApplySpaceCommandRequest,
  type SpaceHistoryEntry,
  type SpaceImportRecord,
  type SpaceTransport,
  type WorkspaceSpaceImport,
} from '@/lib/space-client'
import { parseSpaceOrThrow, type Space, type SpaceSummary } from '@/lib/space'

const instant = Date.parse('2026-08-12T12:00:00.000Z')
const nextInstant = Date.parse('2026-08-12T12:00:01.000Z')

function makeSpace(overrides: Partial<Space> = {}): Space {
  return parseSpaceOrThrow({
    schemaVersion: 1,
    id: 'space-1',
    name: 'Space',
    revision: 3,
    origin: 'canvas',
    panes: { alpha: { kind: 'viewer', state: { title: 'Alpha' } } },
    arrangements: {
      spatial: {
        placements: {
          alpha: { bounds: { x: 0, y: 0, width: 320, height: 240 }, zIndex: 1 },
        },
      },
    },
    createdAt: instant,
    updatedAt: instant,
    ...overrides,
  })
}

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

class FakeTransport implements SpaceTransport {
  readonly requests: ApplySpaceCommandRequest[] = []

  constructor(
    private readonly applyCommand: (request: ApplySpaceCommandRequest) => Promise<Space>,
    private readonly loaded = makeSpace(),
    private readonly loadSpace?: () => Promise<Space>,
  ) {}

  async list(): Promise<SpaceSummary[]> {
    return []
  }

  async load(): Promise<Space> {
    if (this.loadSpace) return this.loadSpace()
    return structuredClone(this.loaded)
  }

  async history(): Promise<SpaceHistoryEntry[]> {
    return []
  }

  async loadRevision(): Promise<Space> {
    return structuredClone(this.loaded)
  }

  async listImports(): Promise<SpaceImportRecord[]> {
    return []
  }

  async importCanvases(): Promise<{ spaces: Space[]; imports: SpaceImportRecord[] }> {
    return { spaces: [], imports: [] }
  }

  async importWorkspace(
    workspace: WorkspaceSpaceImport,
  ): Promise<{ space: Space; import: SpaceImportRecord }> {
    return {
      space: makeSpace({ id: workspace.id, name: workspace.name, origin: 'workspace' }),
      import: {
        sourceKind: 'workspace',
        sourceKey: workspace.sourceKey,
        sourceDigest: 'digest',
        spaceId: workspace.id,
        status: 'imported',
        importedAt: instant,
        raw: workspace.raw,
      },
    }
  }

  apply(request: ApplySpaceCommandRequest): Promise<Space> {
    this.requests.push(structuredClone(request))
    return this.applyCommand(request)
  }
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('optimistic Space client', () => {
  test('publishes optimistic state immediately and confirms it with the expected revision', async () => {
    const pending = deferred<Space>()
    const transport = new FakeTransport(() => pending.promise)
    const client = createOptimisticSpaceClient({ transport, initialSpace: makeSpace() })
    let notifications = 0
    client.subscribe(() => notifications++)

    const saving = client.dispatch({ type: 'rename', name: 'Renamed' })

    expect(client.getSnapshot()).toMatchObject({
      space: { name: 'Renamed', revision: 4 },
      status: 'saving',
      pending: 1,
    })
    expect(transport.requests).toEqual([
      expect.objectContaining({
        commandId: expect.any(String),
        spaceId: 'space-1',
        expectedRevision: 3,
        command: { type: 'rename', name: 'Renamed' },
      }),
    ])

    pending.resolve(makeSpace({ name: 'Renamed', revision: 4, updatedAt: nextInstant }))
    await expect(saving).resolves.toMatchObject({ name: 'Renamed', revision: 4 })
    expect(client.getSnapshot()).toMatchObject({ status: 'saved', pending: 0 })
    expect(notifications).toBeGreaterThanOrEqual(2)
  })

  test('sends queued commands in order against each confirmed revision', async () => {
    const first = deferred<Space>()
    const second = deferred<Space>()
    const outcomes = [first, second]
    const transport = new FakeTransport(() => outcomes.shift()!.promise)
    const client = createOptimisticSpaceClient({ transport, initialSpace: makeSpace() })

    const renameA = client.dispatch({ type: 'rename', name: 'A' })
    const renameB = client.dispatch({ type: 'rename', name: 'B' })
    expect(client.getSnapshot().space).toMatchObject({ name: 'B', revision: 5 })
    expect(transport.requests).toHaveLength(1)

    first.resolve(makeSpace({ name: 'A', revision: 4, updatedAt: nextInstant }))
    await settle()
    expect(transport.requests).toHaveLength(2)
    expect(transport.requests[1]).toMatchObject({
      spaceId: 'space-1',
      expectedRevision: 4,
      command: { type: 'rename', name: 'B' },
    })
    second.resolve(makeSpace({ name: 'B', revision: 5, updatedAt: nextInstant }))

    await Promise.all([renameA, renameB])
    expect(client.getSnapshot()).toMatchObject({
      space: { name: 'B', revision: 5 },
      status: 'saved',
      pending: 0,
    })
  })

  test('reports command boundaries and waits until every queued save is confirmed', async () => {
    const first = deferred<Space>()
    const second = deferred<Space>()
    const outcomes = [first, second]
    const transport = new FakeTransport(() => outcomes.shift()!.promise)
    const client = createOptimisticSpaceClient({ transport, initialSpace: makeSpace() })
    const events: { type: string; beforeRevision: number }[] = []
    client.subscribeCommands(({ command, beforeRevision }) =>
      events.push({ type: command.type, beforeRevision }),
    )

    const renameA = client.dispatch({ type: 'rename', name: 'A' })
    const renameB = client.dispatch({ type: 'rename', name: 'B' })
    let idle = false
    const waiting = client.waitForIdle().then(() => {
      idle = true
    })
    expect(events).toEqual([])
    expect(client.getPendingCommands().map((entry) => entry.command)).toEqual([
      { type: 'rename', name: 'A' },
      { type: 'rename', name: 'B' },
    ])

    first.resolve(makeSpace({ name: 'A', revision: 4 }))
    await renameA
    expect(idle).toBe(false)
    expect(events).toEqual([{ type: 'rename', beforeRevision: 3 }])
    second.resolve(makeSpace({ name: 'B', revision: 5 }))
    await Promise.all([renameB, waiting])
    expect(idle).toBe(true)
    expect(events).toEqual([
      { type: 'rename', beforeRevision: 3 },
      { type: 'rename', beforeRevision: 4 },
    ])
    expect(client.getPendingCommands()).toEqual([])
  })

  test('refuses an idle handoff while offline edits remain queued', async () => {
    const client = createOptimisticSpaceClient({
      transport: new FakeTransport(async () => makeSpace()),
      initialSpace: makeSpace(),
      online: () => false,
    })
    void client.dispatch({ type: 'rename', name: 'Offline' })
    await expect(client.waitForIdle()).rejects.toMatchObject({ code: 'offline' })
  })

  test('retains offline edits and drains them after reconnect', async () => {
    let connected = false
    const transport = new FakeTransport(async () =>
      makeSpace({ name: 'Offline edit', revision: 4, updatedAt: nextInstant }),
    )
    const client = createOptimisticSpaceClient({
      transport,
      initialSpace: makeSpace(),
      online: () => connected,
    })

    const saving = client.dispatch({ type: 'rename', name: 'Offline edit' })
    expect(client.getSnapshot()).toMatchObject({ status: 'offline', pending: 1 })
    expect(transport.requests).toHaveLength(0)

    connected = true
    client.setOnline(true)
    await saving
    expect(transport.requests).toHaveLength(1)
    expect(client.getSnapshot()).toMatchObject({ status: 'saved', pending: 0 })
  })

  test('rebases once on the server conflict snapshot and retries cleanly', async () => {
    const remote = makeSpace({ name: 'Remote', revision: 4, updatedAt: nextInstant })
    let attempt = 0
    const transport = new FakeTransport(async () => {
      attempt += 1
      if (attempt === 1) {
        throw new SpaceTransportError('conflict', 'Space changed on another device', {
          expectedRevision: 3,
          currentRevision: 4,
          current: remote,
        })
      }
      return makeSpace({ name: 'Local', revision: 5, updatedAt: nextInstant })
    })
    const client = createOptimisticSpaceClient({ transport, initialSpace: makeSpace() })
    const boundaries: number[] = []
    client.subscribeCommands(({ beforeRevision }) => boundaries.push(beforeRevision))

    await expect(client.dispatch({ type: 'rename', name: 'Local' })).resolves.toMatchObject({
      name: 'Local',
      revision: 5,
    })
    expect(transport.requests).toHaveLength(2)
    expect(transport.requests[1]).toMatchObject({ expectedRevision: 4 })
    expect(client.getSnapshot()).toMatchObject({
      space: { name: 'Local', revision: 5 },
      status: 'saved',
      recoveredCopy: null,
    })
    expect(boundaries).toEqual([4])
  })

  test('accepts an already-applied replay without duplicating or recovering it', async () => {
    const alreadyApplied = makeSpace({
      revision: 4,
      panes: {
        ...makeSpace().panes,
        beta: { kind: 'viewer', state: { title: 'Beta' } },
      },
      updatedAt: nextInstant,
    })
    const transport = new FakeTransport(async () => {
      throw new SpaceTransportError('conflict', 'Space changed on another device', {
        expectedRevision: 3,
        currentRevision: 4,
        current: alreadyApplied,
      })
    })
    const client = createOptimisticSpaceClient({ transport, initialSpace: makeSpace() })
    const boundaries: number[] = []
    client.subscribeCommands(({ beforeRevision }) => boundaries.push(beforeRevision))

    await expect(
      client.dispatch({
        type: 'addPane',
        paneId: 'beta',
        pane: { kind: 'viewer', state: { title: 'Beta' } },
      }),
    ).resolves.toMatchObject({ revision: 4, panes: { beta: { state: { title: 'Beta' } } } })

    expect(transport.requests).toHaveLength(1)
    expect(client.getSnapshot()).toMatchObject({
      status: 'saved',
      pending: 0,
      recoveredCopy: null,
    })
    expect(boundaries).toEqual([])
  })

  test('recovers all pending edits when a later queued command cannot replay after conflict', async () => {
    const remote = makeSpace({
      revision: 4,
      panes: {},
      arrangements: { spatial: { placements: {} } },
      updatedAt: nextInstant,
    })
    const recovered = makeSpace({ id: 'recovered-queue', name: 'Space (recovered)', revision: 1 })
    let attempt = 0
    const transport = new FakeTransport(async () => {
      attempt += 1
      if (attempt === 1) {
        throw new SpaceTransportError('conflict', 'Space changed on another device', {
          expectedRevision: 3,
          currentRevision: 4,
          current: remote,
        })
      }
      return recovered
    })
    const client = createOptimisticSpaceClient({
      transport,
      initialSpace: makeSpace(),
      id: () => 'recovered-queue',
    })

    const rename = client.dispatch({ type: 'rename', name: 'Local name' })
    const remove = client.dispatch({ type: 'removePane', paneId: 'alpha' })
    const settled = await Promise.allSettled([rename, remove])
    expect(settled).toEqual([
      expect.objectContaining({
        status: 'rejected',
        reason: expect.objectContaining({ code: 'conflict' }),
      }),
      expect.objectContaining({
        status: 'rejected',
        reason: expect.objectContaining({ code: 'conflict' }),
      }),
    ])
    expect(client.getSnapshot()).toMatchObject({
      status: 'conflict',
      pending: 0,
      recoveredCopy: { id: 'recovered-queue' },
    })
  })

  test('creates a named recovered copy when a conflict cannot be rebased', async () => {
    const changedPane = { kind: 'viewer' as const, state: { title: 'Changed locally' } }
    const remote = makeSpace({
      name: 'Remote',
      revision: 4,
      panes: {},
      arrangements: { spatial: { placements: {} } },
      updatedAt: nextInstant,
    })
    const recovered = makeSpace({
      id: 'recovered-1',
      name: 'Space (recovered)',
      revision: 1,
      panes: { alpha: changedPane },
      arrangements: { spatial: { placements: {} } },
      createdAt: nextInstant,
      updatedAt: nextInstant,
    })
    let attempt = 0
    const transport = new FakeTransport(async () => {
      attempt += 1
      if (attempt === 1) {
        throw new SpaceTransportError('conflict', 'Space changed on another device', {
          expectedRevision: 3,
          currentRevision: 4,
          current: remote,
        })
      }
      return recovered
    })
    const client = createOptimisticSpaceClient({
      transport,
      initialSpace: makeSpace(),
      id: () => 'recovered-1',
      now: () => nextInstant,
    })

    await expect(
      client.dispatch({ type: 'updatePane', paneId: 'alpha', pane: changedPane }),
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(transport.requests[1]).toMatchObject({
      command: {
        type: 'create',
        id: 'recovered-1',
        name: 'Space (recovered)',
        panes: { alpha: changedPane },
      },
    })
    expect(client.getSnapshot()).toMatchObject({
      status: 'conflict',
      pending: 0,
      recoveredCopy: { id: 'recovered-1', name: 'Space (recovered)' },
    })
  })

  test('keeps the recovered suffix inside the Space name limit', async () => {
    const changedPane = { kind: 'viewer' as const, state: { title: 'Changed locally' } }
    const remote = makeSpace({
      name: 'Remote',
      revision: 4,
      panes: {},
      arrangements: { spatial: { placements: {} } },
    })
    let createdName = ''
    const transport = new FakeTransport(async (request) => {
      if (request.command.type === 'create') {
        createdName = request.command.name
        return makeSpace({
          id: 'recovered-long',
          name: createdName,
          revision: 1,
          panes: { alpha: changedPane },
        })
      }
      throw new SpaceTransportError('conflict', 'Conflict', {
        expectedRevision: 3,
        currentRevision: 4,
        current: remote,
      })
    })
    const client = createOptimisticSpaceClient({
      transport,
      initialSpace: makeSpace({ name: 'x'.repeat(120) }),
      id: () => 'recovered-long',
    })
    await Promise.allSettled([
      client.dispatch({ type: 'updatePane', paneId: 'alpha', pane: changedPane }),
    ])
    expect(createdName.length).toBeLessThanOrEqual(120)
    expect(createdName.endsWith(' (recovered)')).toBe(true)
  })

  test('does not expose an unsaved recovered copy and retries its create', async () => {
    const changedPane = { kind: 'viewer' as const, state: { title: 'Changed locally' } }
    const remote = makeSpace({
      revision: 4,
      panes: {},
      arrangements: { spatial: { placements: {} } },
    })
    let attempt = 0
    const transport = new FakeTransport(async (request) => {
      attempt += 1
      if (attempt === 1) {
        throw new SpaceTransportError('conflict', 'Space changed on another device', {
          expectedRevision: 3,
          currentRevision: 4,
          current: remote,
        })
      }
      if (attempt === 2) throw new Error('recovery store unavailable')
      return makeSpace({
        id: 'recovered-retry',
        name: 'Space (recovered)',
        revision: 1,
        panes: { alpha: changedPane },
        arrangements: { spatial: { placements: {} } },
      })
    })
    const client = createOptimisticSpaceClient({
      transport,
      initialSpace: makeSpace(),
      id: () => 'recovered-retry',
    })

    await expect(
      client.dispatch({ type: 'updatePane', paneId: 'alpha', pane: changedPane }),
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(client.getSnapshot()).toMatchObject({ status: 'failed', recoveredCopy: null })

    await client.retry()
    expect(transport.requests[2]).toMatchObject({
      command: { type: 'create', id: 'recovered-retry' },
    })
    expect(client.getSnapshot()).toMatchObject({
      status: 'conflict',
      recoveredCopy: { id: 'recovered-retry' },
    })
  })

  test('keeps failed commands retryable and resolves restore from the server', async () => {
    let attempt = 0
    const transport = new FakeTransport(async (request) => {
      attempt += 1
      if (attempt === 1) throw new Error('temporary failure')
      if (request.command.type === 'rename') {
        return makeSpace({ name: 'Retry me', revision: 4, updatedAt: nextInstant })
      }
      return makeSpace({ name: 'Historical name', revision: 5, updatedAt: nextInstant })
    })
    const client = createOptimisticSpaceClient({ transport, initialSpace: makeSpace() })

    const rename = client.dispatch({ type: 'rename', name: 'Retry me' })
    await settle()
    expect(client.getSnapshot()).toMatchObject({ status: 'failed', pending: 1 })
    await client.retry()
    await rename
    expect(client.getSnapshot()).toMatchObject({ status: 'saved', pending: 0 })

    const restore = client.dispatch({ type: 'restoreRevision', revision: 1 })
    expect(client.getSnapshot()).toMatchObject({
      space: { name: 'Retry me', revision: 4 },
      status: 'saving',
    })
    await restore
    expect(client.getSnapshot()).toMatchObject({
      space: { name: 'Historical name', revision: 5 },
      status: 'saved',
    })
  })

  test('does not let an older overlapping load replace the newest Space', async () => {
    const first = deferred<Space>()
    const second = deferred<Space>()
    const loads = [first, second]
    const transport = new FakeTransport(
      async () => makeSpace(),
      makeSpace(),
      () => loads.shift()!.promise,
    )
    const client = createOptimisticSpaceClient({ transport, initialSpace: makeSpace() })

    const olderLoad = client.load('older')
    const newerLoad = client.load('newer')
    second.resolve(makeSpace({ id: 'newer', name: 'Newer response' }))
    await newerLoad
    first.resolve(makeSpace({ id: 'older', name: 'Older response' }))
    await olderLoad

    expect(client.getSnapshot()).toMatchObject({
      space: { id: 'newer', name: 'Newer response' },
      status: 'saved',
    })
  })
})
