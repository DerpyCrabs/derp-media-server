import { describe, expect, test } from 'bun:test'
import {
  CANVAS_COLLECTION_STORAGE_KEY,
  compareCanvasRecords,
  loadCanvasCollection,
  mergeCanvasRecords,
  parseCanvasRecords,
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
})
