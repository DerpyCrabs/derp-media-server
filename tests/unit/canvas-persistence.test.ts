import { describe, expect, test } from 'bun:test'
import {
  CANVAS_COLLECTION_STORAGE_KEY,
  CANVAS_COLLECTION_SOURCE_BACKUP_KEY,
  canvasSpaceRecoveryKey,
  canvasSpaceSessionKey,
  clearCanvasSpaceRecovery,
  compareCanvasRecords,
  inspectCanvasStorage,
  loadCanvasSpaceRecovery,
  inspectCanvasSpaceRecovery,
  loadCanvasSpaceSession,
  loadCanvasCollection,
  markCanvasSpaceRecoveryCopy,
  mergeCanvasRecords,
  parseCanvasRecords,
  persistCanvasSpaceRecovery,
  persistCanvasSpaceSession,
  preserveCanvasStorageSources,
  readCanvasStorageSources,
  type PersistedCanvas,
} from '@/lib/canvas-persistence'
import {
  CANVAS_STORAGE_KEY,
  createEmptyCanvasState,
  serializeInfiniteCanvasState,
} from '@/lib/infinite-canvas'

function storage(values: Record<string, string>) {
  return { getItem: (key: string) => values[key] ?? null }
}

function writableStorage(values: Record<string, string>) {
  return {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => {
      values[key] = value
    },
    removeItem: (key: string) => {
      delete values[key]
    },
  }
}

function record(overrides: Partial<PersistedCanvas> = {}): PersistedCanvas {
  return {
    id: 'canvas-1',
    name: 'Canvas',
    state: createEmptyCanvasState(),
    updatedAt: 1,
    writerId: 'writer-1',
    deleted: false,
    ...overrides,
  }
}

describe('canvas persistence', () => {
  test('migrates legacy single canvas state', () => {
    const state = { ...createEmptyCanvasState(), camera: { x: 10, y: 20, zoom: 0.5 } }
    const collection = loadCanvasCollection(
      storage({ [CANVAS_STORAGE_KEY]: serializeInfiniteCanvasState(state) }),
    )

    expect(collection.canvases).toHaveLength(1)
    expect(collection.canvases[0]?.state?.camera).toEqual(state.camera)
    expect(collection.activeId).toBe(collection.canvases[0]?.id)
  })

  test('loads valid collection instead of legacy state', () => {
    const saved = {
      version: 1,
      activeId: 'canvas-1',
      writerId: 'writer-1',
      lastTimestamp: 4,
      canvases: [record({ name: 'Saved', updatedAt: 4 })],
    }
    const collection = loadCanvasCollection(
      storage({
        [CANVAS_COLLECTION_STORAGE_KEY]: JSON.stringify(saved),
        [CANVAS_STORAGE_KEY]: serializeInfiniteCanvasState(createEmptyCanvasState()),
      }),
    )
    expect(collection.canvases[0]?.name).toBe('Saved')
  })

  test('newer tombstone wins merge and prevents resurrection', () => {
    const live = record({ updatedAt: 5 })
    const deleted = record({ updatedAt: 6, state: null, deleted: true, writerId: 'writer-2' })
    const merged = mergeCanvasRecords([live], [deleted])

    expect(merged).toEqual([deleted])
  })

  test('same-time records converge using writer id', () => {
    const first = record({ writerId: 'writer-a' })
    const second = record({ name: 'Second', writerId: 'writer-b' })

    expect(compareCanvasRecords(second, first)).toBeGreaterThan(0)
    expect(parseCanvasRecords([first, second])).toEqual([second])
  })

  test('preserves exact source bytes once before Canvas normalization', () => {
    const raw = '{\n  "version": 1, "custom": "kept byte-for-byte"\n}'
    const values: Record<string, string> = { [CANVAS_COLLECTION_STORAGE_KEY]: raw }
    const browserStorage = writableStorage(values)
    const sources = readCanvasStorageSources(browserStorage)

    preserveCanvasStorageSources(browserStorage, sources)
    expect(values[CANVAS_COLLECTION_SOURCE_BACKUP_KEY]).toBe(raw)

    values[CANVAS_COLLECTION_STORAGE_KEY] = '{"changed":true}'
    preserveCanvasStorageSources(browserStorage)
    expect(values[CANVAS_COLLECTION_SOURCE_BACKUP_KEY]).toBe(raw)
  })

  test('reports corrupt collection without silently replacing it with a blank Canvas', () => {
    const raw = '{not valid canvas JSON'
    const browserStorage = storage({ [CANVAS_COLLECTION_STORAGE_KEY]: raw })
    const inspection = inspectCanvasStorage(browserStorage)

    expect(inspection).toMatchObject({
      kind: 'unexpected',
      hasRecoverableCanvas: false,
    })
    expect(browserStorage.getItem(CANVAS_COLLECTION_STORAGE_KEY)).toBe(raw)
  })

  test('requires confirmation when one collection record would be discarded', () => {
    const saved = {
      version: 1,
      activeId: 'canvas-1',
      writerId: 'writer-1',
      lastTimestamp: 4,
      canvases: [record({ updatedAt: 4 }), { id: 'unreadable-record' }],
    }
    const inspection = inspectCanvasStorage(
      storage({ [CANVAS_COLLECTION_STORAGE_KEY]: JSON.stringify(saved) }),
    )

    expect(inspection).toMatchObject({
      kind: 'unexpected',
      hasRecoverableCanvas: true,
      recovery: { canvases: [{ id: 'canvas-1' }] },
    })
  })

  test('keeps Space-backed Canvas session and durable recovery under opaque per-Space keys', () => {
    const values: Record<string, string> = {}
    const browserStorage = writableStorage(values)
    const state = {
      ...createEmptyCanvasState(),
      camera: { x: 14, y: -8, zoom: 0.75 },
      maximizedWindowId: 'canvas-window-8',
      nextItemId: 9,
      nextZIndex: 12,
    }
    const sessionKey = canvasSpaceSessionKey('family/desk\\phone')
    const recoveryKey = canvasSpaceRecoveryKey('family/desk\\phone')

    persistCanvasSpaceSession(browserStorage, sessionKey, state)
    persistCanvasSpaceRecovery(browserStorage, recoveryKey, {
      baseRevision: 7,
      name: 'Desk',
      state,
    })

    expect(sessionKey).toBe('space-session-canvas-family%2Fdesk%5Cphone')
    expect(loadCanvasSpaceSession(browserStorage, sessionKey)).toMatchObject({
      camera: state.camera,
      maximizedWindowId: 'canvas-window-8',
    })
    expect(loadCanvasSpaceRecovery(browserStorage, recoveryKey)).toMatchObject({
      baseRevision: 7,
      name: 'Desk',
      state: { camera: state.camera, nextItemId: 9, nextZIndex: 12 },
    })
    markCanvasSpaceRecoveryCopy(browserStorage, recoveryKey, 'recovered-space')
    expect(loadCanvasSpaceRecovery(browserStorage, recoveryKey)?.recoveredSpaceId).toBe(
      'recovered-space',
    )
    clearCanvasSpaceRecovery(browserStorage, recoveryKey)
    expect(loadCanvasSpaceRecovery(browserStorage, recoveryKey)).toBeNull()
  })

  test('quarantines malformed Space recovery without changing its exact bytes', () => {
    const values = {
      recovery: JSON.stringify({
        version: 1,
        baseRevision: 4,
        name: 'Damaged',
        raw: JSON.stringify({
          ...createEmptyCanvasState(),
          windows: [
            {
              id: 'canvas-window-1',
              bounds: { x: 0, y: 0, width: 320, height: 200 },
              zIndex: 1,
              definition: { type: 'unknown' },
            },
          ],
        }),
      }),
    }
    const browserStorage = writableStorage(values)

    expect(inspectCanvasSpaceRecovery(browserStorage, 'recovery')).toEqual({
      kind: 'corrupt',
      raw: values.recovery,
    })
    expect(loadCanvasSpaceRecovery(browserStorage, 'recovery')).toBeNull()
    expect(browserStorage.getItem('recovery')).toBe(values.recovery)
  })
})
