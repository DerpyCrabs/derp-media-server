import { describe, expect, test } from 'bun:test'
import { createRoot, createSignal } from 'solid-js'
import type { PersistedWorkspaceState } from '@/workspace/model/use-workspace'
import type {
  WorkspaceOpenResult,
  WorkspaceRecord,
  WorkspaceRegistry,
} from '@/workspace/model/workspace-registry'
import {
  useWorkspaceRegistry,
  type WorkspaceRegistryHttp,
} from '@/workspace/shared/use-workspace-registry'
import { ApiError } from '@/lib/api/client'
import { WorkspaceDocumentCommands } from '@/workspace/model/workspace-document-commands'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

function workspace(title: string): PersistedWorkspaceState {
  return {
    workspaceType: 'desktop',
    windows: [
      {
        id: 'browser',
        type: 'browser',
        title,
        source: { kind: 'local', rootPath: null },
        initialState: { dir: 'Books', viewing: 'Books/old.md' },
        layout: { bounds: { x: 10, y: 20, width: 600, height: 500 }, zIndex: 1 },
      },
    ],
    activeWindowId: 'browser',
    activeTabMap: { browser: 'browser' },
    nextWindowId: 2,
  }
}

function record(id: string, snapshot: PersistedWorkspaceState, revision: number): WorkspaceRecord {
  return {
    id,
    snapshot: structuredClone(snapshot),
    revision,
    updatedAt: revision,
    lastOpenedAt: revision,
  }
}

function registry(records: Record<string, WorkspaceRecord>): WorkspaceRegistry {
  return {
    version: 1,
    order: Object.keys(records),
    records: structuredClone(records),
  }
}

function createHarness(input: {
  id: string
  records: Record<string, WorkspaceRecord>
  savingBlocked?: () => boolean
  waitUntilSavingUnblocked?: () => Promise<void>
  api?: () => Promise<WorkspaceRegistry>
  post: (url: string, body: Record<string, unknown>) => Promise<unknown>
}) {
  let dispose = () => {}
  const harness = createRoot((rootDispose) => {
    dispose = rootDispose
    const [id, setId] = createSignal(input.id)
    const http = {
      api: input.api ?? (async () => registry(input.records)),
      post: input.post,
    } as unknown as WorkspaceRegistryHttp
    const session = useWorkspaceRegistry({
      workspaceId: id,
      clientId: 'test-client',
      http,
      savingBlocked: input.savingBlocked,
      waitUntilSavingUnblocked: input.waitUntilSavingUnblocked,
    })
    return { id, setId, session }
  })
  return { ...harness, dispose }
}

describe('workspace session authority', () => {
  test('workspace save failure stays visible and retryable without allowing offline edits', async () => {
    const server = record('a', workspace('Server'), 1)
    let saveAttempts = 0
    let savedTitle = ''
    const harness = createHarness({
      id: 'a',
      records: { a: server },
      post: async (url, body) => {
        if (url === '/api/workspaces/open') {
          return { record: server, editable: true, leaseDurationMs: 10_000 }
        }
        if (url === '/api/workspaces/save') {
          saveAttempts += 1
          if (saveAttempts === 1) throw new ApiError(503, 'Unavailable')
          savedTitle = (body.snapshot as PersistedWorkspaceState).windows[0]?.title ?? ''
          return { revision: 2 }
        }
        throw new Error(`Unexpected request: ${url}`)
      },
    })

    try {
      await harness.session.activate('a', server.snapshot)
      harness.session.update((current) => {
        const next = structuredClone(current!)
        next.windows[0]!.title = 'Unsaved'
        return next
      })

      let saveFailure: unknown
      try {
        await harness.session.flush()
      } catch (error) {
        saveFailure = error
      }
      expect(saveFailure).toBeInstanceOf(ApiError)
      expect((saveFailure as Error).message).toBe('Unavailable')
      expect(harness.session.saveError()).toEqual({
        workspaceId: 'a',
        message: 'Unavailable',
        retryable: true,
        takeover: false,
      })
      expect(harness.session.editable()).toBe(false)

      await harness.session.retrySave()

      expect(saveAttempts).toBe(2)
      expect(savedTitle).toBe('Unsaved')
      expect(harness.session.saveError()).toBeNull()
      expect(harness.session.editable()).toBe(true)
    } finally {
      harness.dispose()
    }
  })

  test('takeover keeps and retries the pending snapshot after a stale self lease', async () => {
    const base = record('a', workspace('Base'), 1)
    const records = { a: base }
    let saves = 0
    let takeovers = 0
    const harness = createHarness({
      id: 'a',
      records,
      post: async (url, body) => {
        if (url === '/api/workspaces/open') {
          if (body.takeover === true) takeovers += 1
          return { record: base, editable: true, leaseDurationMs: 10_000 }
        }
        if (url === '/api/workspaces/save') {
          saves += 1
          if (saves === 1) throw new ApiError(409, 'Workspace is open elsewhere')
          return { revision: 2 }
        }
        throw new Error(`Unexpected request: ${url}`)
      },
    })

    try {
      await harness.session.activate('a', base.snapshot)
      harness.session.update((current) => {
        const next = structuredClone(current!)
        next.windows[0]!.title = 'Pending after restart'
        return next
      })
      let failure: unknown
      try {
        await harness.session.flush()
      } catch (error) {
        failure = error
      }
      expect((failure as Error).message).toBe('Workspace is open elsewhere')

      expect(harness.session.saveError()).toEqual({
        workspaceId: 'a',
        message: 'Workspace is open elsewhere',
        retryable: false,
        takeover: true,
      })
      expect(harness.session.document()?.windows[0]?.title).toBe('Pending after restart')

      await harness.session.takeControl()

      expect(takeovers).toBe(1)
      expect(saves).toBe(2)
      expect(harness.session.saveError()).toBeNull()
      expect(harness.session.editable()).toBe(true)
      expect(harness.session.document()?.windows[0]?.title).toBe('Pending after restart')
      expect(harness.session.revision()).toBe(2)
    } finally {
      harness.dispose()
    }
  })

  test('HTTP open failure never creates an editable ghost and reconnect retries open', async () => {
    const server = record('a', workspace('Server'), 4)
    const records = { a: server }
    let rejectOpen = true
    const harness = createHarness({
      id: 'a',
      records,
      post: async (url) => {
        if (url === '/api/workspaces/open') {
          if (rejectOpen) throw new ApiError(404, 'Workspace not found')
          return { record: server, editable: true, leaseDurationMs: 10_000 }
        }
        throw new Error(`Unexpected request: ${url}`)
      },
    })

    try {
      await harness.session.activate('a', workspace('Local'))

      expect(harness.session.active()).toMatchObject({
        id: 'a',
        phase: 'failed',
        editable: false,
      })
      expect(harness.session.document()).toBeNull()

      rejectOpen = false
      await harness.session.reconcileRemoteChange()

      expect(harness.session.active()).toMatchObject({
        id: 'a',
        phase: 'open',
        editable: true,
      })
      expect(harness.session.document()?.windows[0].title).toBe('Server')
    } finally {
      harness.dispose()
    }
  })

  test('route activation never exposes previous workspace document or permissions under next id', async () => {
    const a = record('a', workspace('A'), 1)
    const b = record('b', workspace('B'), 9)
    b.locked = true
    const records = { a, b }
    const openB = deferred<WorkspaceOpenResult>()
    const openBStarted = deferred<void>()
    const harness = createHarness({
      id: 'a',
      records,
      post: async (url, body) => {
        if (url === '/api/workspaces/open') {
          const id = String(body.id)
          if (id === 'b') {
            openBStarted.resolve()
            return openB.promise
          }
          return { record: records.a, editable: true, leaseDurationMs: 10_000 }
        }
        if (url === '/api/workspaces/release') return {}
        throw new Error(`Unexpected request: ${url}`)
      },
    })

    try {
      await harness.session.activate('a', a.snapshot)
      expect(harness.session.document()?.windows[0].title).toBe('A')
      expect(harness.session.revision()).toBe(1)
      expect(harness.session.editable()).toBe(true)

      harness.setId('b')
      const opening = harness.session.activate('b', b.snapshot)
      await openBStarted.promise

      expect(harness.session.active()).toMatchObject({
        id: 'b',
        phase: 'opening',
        document: null,
        revision: 9,
        editable: false,
      })
      expect(harness.session.document()).toBeNull()
      expect(harness.session.revision()).toBe(9)
      expect(harness.session.editable()).toBe(false)

      openB.resolve({ record: b, editable: false, leaseDurationMs: 10_000 })
      await opening
      expect(harness.session.document()?.windows[0].title).toBe('B')
      expect(harness.session.editable()).toBe(false)
      expect(harness.session.registry().records.b?.locked).toBe(true)
    } finally {
      harness.dispose()
    }
  })

  test('server events refresh a clean document without echoing it back as a save', async () => {
    const base = record('a', workspace('Base'), 1)
    const records: Record<string, WorkspaceRecord> = { a: base }
    let saves = 0
    const harness = createHarness({
      id: 'a',
      records,
      post: async (url) => {
        if (url === '/api/workspaces/open') {
          return { record: records.a, editable: true, leaseDurationMs: 10_000 }
        }
        if (url === '/api/workspaces/save') {
          saves += 1
          return { revision: 3 }
        }
        throw new Error(`Unexpected request: ${url}`)
      },
    })

    try {
      await harness.session.activate('a', base.snapshot)
      records.a = record('a', workspace('Remote'), 2)

      await harness.session.reconcileRemoteChange()

      expect(harness.session.document()?.windows[0].title).toBe('Remote')
      expect(harness.session.revision()).toBe(2)
      expect(saves).toBe(0)
    } finally {
      harness.dispose()
    }
  })

  test('transition freezes the departing session before its final flush and release', async () => {
    const base = record('a', workspace('Base'), 1)
    const records = { a: base }
    const release = deferred<Record<string, never>>()
    const releaseStarted = deferred<void>()
    const saves: PersistedWorkspaceState[] = []
    const harness = createHarness({
      id: 'a',
      records,
      post: async (url, body) => {
        if (url === '/api/workspaces/open') {
          return { record: base, editable: true, leaseDurationMs: 10_000 }
        }
        if (url === '/api/workspaces/save') {
          saves.push(structuredClone(body.snapshot as PersistedWorkspaceState))
          return { revision: Number(body.revision) + 1 }
        }
        if (url === '/api/workspaces/release') {
          releaseStarted.resolve()
          return release.promise
        }
        throw new Error(`Unexpected request: ${url}`)
      },
    })

    try {
      await harness.session.activate('a', base.snapshot)
      harness.session.update((current) => {
        const next = structuredClone(current!)
        next.windows[0].title = 'Final edit'
        return next
      })

      let transitioned = false
      const transition = harness.session.transition(() => {
        transitioned = true
      })
      await releaseStarted.promise

      expect(harness.session.editable()).toBe(false)
      harness.session.update((current) => {
        const next = structuredClone(current!)
        next.windows[0].title = 'Too late'
        return next
      })
      release.resolve({})
      await transition
      await new Promise((resolve) => setTimeout(resolve, 1))

      expect(transitioned).toBe(true)
      expect(saves.map((snapshot) => snapshot.windows[0].title)).toEqual(['Final edit'])
      expect(harness.session.active().phase).toBe('idle')
    } finally {
      harness.dispose()
    }
  })

  test('transition waits for blocked geometry and saves its final document before release', async () => {
    const base = record('a', workspace('Base'), 1)
    const records = { a: base }
    const [blocked, setBlocked] = createSignal(true)
    const unblocked = deferred<void>()
    const events: string[] = []
    const harness = createHarness({
      id: 'a',
      records,
      savingBlocked: blocked,
      waitUntilSavingUnblocked: () => unblocked.promise,
      post: async (url, body) => {
        if (url === '/api/workspaces/open') {
          return { record: base, editable: true, leaseDurationMs: 10_000 }
        }
        if (url === '/api/workspaces/save') {
          events.push(`save:${(body.snapshot as PersistedWorkspaceState).windows[0].title}`)
          return { revision: 2 }
        }
        if (url === '/api/workspaces/release') {
          events.push('release')
          return {}
        }
        throw new Error(`Unexpected request: ${url}`)
      },
    })

    try {
      await harness.session.activate('a', base.snapshot)
      harness.session.update((current) => {
        const next = structuredClone(current!)
        next.windows[0].title = 'Final geometry'
        return next
      })

      const transition = harness.session.transition(() => events.push('navigate'))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(events).toEqual([])

      setBlocked(false)
      unblocked.resolve()
      await transition

      expect(events).toEqual(['save:Final geometry', 'release', 'navigate'])
    } finally {
      harness.dispose()
    }
  })

  test('stale registry refresh cannot erase metadata from the revisioned save queue', async () => {
    const base = record('a', workspace('Base'), 1)
    const records: Record<string, WorkspaceRecord> = { a: base }
    const firstSave = deferred<void>()
    const firstSaveStarted = deferred<void>()
    const saves: Array<{
      revision: number
      snapshot: PersistedWorkspaceState
      metadata: { name: string | null }
    }> = []
    let serverRecord = structuredClone(base)
    const harness = createHarness({
      id: 'a',
      records,
      post: async (url, body) => {
        if (url === '/api/workspaces/open') {
          return { record: serverRecord, editable: true, leaseDurationMs: 10_000 }
        }
        if (url === '/api/workspaces/save') {
          const snapshot = structuredClone(body.snapshot as PersistedWorkspaceState)
          const revision = Number(body.revision)
          const metadata = body.metadata as { name: string | null }
          saves.push({ revision, snapshot, metadata })
          if (saves.length === 1) {
            firstSaveStarted.resolve()
            await firstSave.promise
          }
          serverRecord = record('a', snapshot, revision + 1)
          if (metadata.name) serverRecord.name = metadata.name
          records.a = serverRecord
          return { revision: serverRecord.revision }
        }
        if (url === '/api/workspaces/heartbeat') return {}
        throw new Error(`Unexpected request: ${url}`)
      },
    })

    try {
      await harness.session.activate('a', base.snapshot)
      harness.session.update((current) => {
        const next = structuredClone(current!)
        next.windows[0].title = 'Before metadata'
        return next
      })
      await firstSaveStarted.promise
      const metadataWrite = harness.session.updateMetadataFor('a', { name: 'Renamed' })
      await harness.session.refresh()

      harness.session.update((current) => {
        const next = structuredClone(current!)
        next.windows[0].title = 'During metadata'
        return next
      })
      firstSave.resolve()

      await metadataWrite
      await harness.session.flush()

      expect(
        saves.map((save) => [save.revision, save.snapshot.windows[0].title, save.metadata.name]),
      ).toEqual([
        [1, 'Before metadata', null],
        [2, 'During metadata', 'Renamed'],
      ])
      expect(harness.session.document()?.windows[0].title).toBe('During metadata')
      expect(harness.session.revision()).toBe(3)
    } finally {
      harness.dispose()
    }
  })

  test('save acknowledgement and SSE preserve a blocked tab-pull document', async () => {
    const grouped = workspace('Left')
    grouped.windows[0].tabGroupId = 'group'
    grouped.windows.push({
      ...structuredClone(grouped.windows[0]),
      id: 'right',
      title: 'Right',
      tabGroupId: 'group',
    })
    grouped.activeWindowId = 'right'
    grouped.activeTabMap = { group: 'right' }
    const base = record('a', grouped, 1)
    const records: Record<string, WorkspaceRecord> = { a: base }
    const save = deferred<{ revision: number }>()
    const saveStarted = deferred<void>()
    const [blocked, setBlocked] = createSignal(false)
    const harness = createHarness({
      id: 'a',
      records,
      savingBlocked: blocked,
      post: async (url, body) => {
        if (url === '/api/workspaces/open') {
          return { record: records.a, editable: true, leaseDurationMs: 10_000 }
        }
        if (url === '/api/workspaces/save') {
          saveStarted.resolve()
          records.a = record('a', body.snapshot as PersistedWorkspaceState, 2)
          return save.promise
        }
        throw new Error(`Unexpected request: ${url}`)
      },
    })

    try {
      await harness.session.activate('a', grouped)
      harness.session.update((current) => {
        const next = structuredClone(current!)
        next.windows[0].title = 'Prior save'
        return next
      })
      const flushing = harness.session.flush()
      await saveStarted.promise

      setBlocked(true)
      harness.session.update((current) =>
        WorkspaceDocumentCommands.splitWindowFromGroup(current!, 'right'),
      )
      expect(harness.session.document()?.windows.map((window) => window.tabGroupId)).toEqual([
        null,
        null,
      ])

      save.resolve({ revision: 2 })
      await flushing
      expect(harness.session.document()?.windows.map((window) => window.tabGroupId)).toEqual([
        null,
        null,
      ])
      await harness.session.reconcileRemoteChange()

      expect(harness.session.document()?.windows.map((window) => window.tabGroupId)).toEqual([
        null,
        null,
      ])
    } finally {
      harness.dispose()
    }
  })

  test('transfer never pairs a stale snapshot with a newer observed revision', async () => {
    const sourceV1 = record('a', workspace('Source v1'), 1)
    const destination = record('destination', workspace('Destination'), 4)
    const records = { a: sourceV1, destination }
    let moveBody: Record<string, unknown> | null = null
    const harness = createHarness({
      id: 'a',
      records,
      post: async (url, body) => {
        if (url === '/api/workspaces/open') {
          return { record: records.a, editable: true, leaseDurationMs: 10_000 }
        }
        if (url === '/api/workspaces/move') {
          moveBody = body
          return { sourceRevision: 3, destinationRevision: 5 }
        }
        throw new Error(`Unexpected request: ${url}`)
      },
    })

    try {
      await harness.session.activate('a', sourceV1.snapshot)
      records.a = record('a', workspace('Remote v2'), 2)
      await harness.session.refresh()

      await harness.session.moveWorkspaces({
        sourceId: 'a',
        destinationId: 'destination',
        sourceRevision: 1,
        destinationRevision: 4,
        sourceSnapshot: sourceV1.snapshot,
        destinationSnapshot: destination.snapshot,
        deleteSource: false,
      })

      expect(moveBody).toMatchObject({ sourceRevision: 1, destinationRevision: 4 })
    } finally {
      harness.dispose()
    }
  })

  test('delete tombstones before draining an in-flight save', async () => {
    const base = record('a', workspace('Base'), 1)
    const records: Record<string, WorkspaceRecord> = { a: base }
    const save = deferred<{ revision: number }>()
    const saveStarted = deferred<void>()
    let deleteStarted = false
    let openCount = 0
    const harness = createHarness({
      id: 'a',
      records,
      post: async (url) => {
        if (url === '/api/workspaces/open') {
          openCount += 1
          return { record: base, editable: true, leaseDurationMs: 10_000 }
        }
        if (url === '/api/workspaces/save') {
          saveStarted.resolve()
          return save.promise
        }
        if (url === '/api/workspaces/delete') {
          deleteStarted = true
          delete records.a
          return {}
        }
        throw new Error(`Unexpected request: ${url}`)
      },
    })

    try {
      await harness.session.activate('a', base.snapshot)
      harness.session.update((current) => {
        const next = structuredClone(current!)
        next.windows[0].title = 'Dirty'
        return next
      })
      const flushing = harness.session.flush()
      await saveStarted.promise
      const deleting = harness.session.deleteWorkspace('a')

      await Promise.resolve()
      expect(harness.session.deleted('a')).toBe(true)
      expect(deleteStarted).toBe(false)
      save.resolve({ revision: 2 })
      await Promise.all([flushing, deleting])

      expect(deleteStarted).toBe(true)
      expect(harness.session.document()).toBeNull()
      await harness.session.activate('a', workspace('Recreated'))
      expect(openCount).toBe(1)
      expect(harness.session.document()).toBeNull()
    } finally {
      harness.dispose()
    }
  })
})
