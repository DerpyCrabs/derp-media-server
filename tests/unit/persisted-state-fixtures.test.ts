import { describe, expect, test } from 'bun:test'
import {
  CANVAS_COLLECTION_STORAGE_KEY,
  loadCanvasCollection,
  parseCanvasRecords,
  serializeCanvasCollection,
} from '@/lib/canvas-persistence'
import {
  normalizePersistedWorkspaceState,
  serializeWorkspacePersistedState,
} from '@/lib/use-workspace'
import canvasFixture from '../fixtures/persisted-state/reference/canvas-collection.json'
import settingsFixture from '../fixtures/persisted-state/reference/settings.json'
import workspaceFixture from '../fixtures/persisted-state/reference/workspace-layout.json'

function storage(values: Record<string, string>) {
  return { getItem: (key: string) => values[key] ?? null }
}

const currentExplorerContent = {
  schemaVersion: 1 as const,
  codec: 'filesystem.content',
  codecVersion: 1,
  payload: {
    kind: 'explorer',
    id: 'current-browser',
    address: { rootId: 'configured-default', path: 'Notes' },
  },
}

describe('current persisted content schema', () => {
  test('restores and writes only authoritative workspace content envelopes', () => {
    const futureContent = {
      schemaVersion: 1 as const,
      codec: 'future.content',
      codecVersion: 9,
      payload: { opaque: true },
    }
    const raw = {
      windows: [
        {
          id: 'current-browser',
          title: 'Notes',
          content: currentExplorerContent,
          layout: { bounds: { x: 0, y: 0, width: 480, height: 320 } },
        },
        {
          id: 'future-pane',
          title: 'Future pane',
          content: futureContent,
          layout: { bounds: { x: 480, y: 0, width: 480, height: 320 } },
        },
      ],
      activeWindowId: 'future-pane',
      activeTabMap: {},
      nextWindowId: 3,
      pinnedTaskbarItems: [],
    }

    const restored = normalizePersistedWorkspaceState(raw, { reconcileSnapZones: false })

    expect(restored?.windows).toHaveLength(2)
    expect(restored?.windows[0]?.initialState.dir).toBe('Notes')
    expect(restored?.windows[1]).toMatchObject({
      id: 'future-pane',
      contentRecoveryReason: 'Unknown content codec: future.content',
    })
    const encoded = JSON.parse(serializeWorkspacePersistedState(restored!)) as {
      windows: Record<string, unknown>[]
    }
    expect(encoded.windows.every((window) => 'content' in window)).toBe(true)
    expect(encoded.windows.every((window) => !('type' in window))).toBe(true)
    expect(encoded.windows.every((window) => !('source' in window))).toBe(true)
    expect(encoded.windows.every((window) => !('initialState' in window))).toBe(true)
  })

  test('restores and rewrites a current canvas collection', () => {
    const collection = {
      version: 1 as const,
      activeId: 'canvas-1',
      writerId: 'writer-1',
      lastTimestamp: 1,
      canvases: [
        {
          id: 'canvas-1',
          name: 'Canvas',
          updatedAt: 1,
          writerId: 'writer-1',
          deleted: false,
          state: {
            version: 1 as const,
            windows: [
              {
                id: 'current-browser',
                definition: {
                  id: 'current-browser',
                  title: 'Notes',
                  content: currentExplorerContent,
                },
                bounds: { x: 0, y: 0, width: 480, height: 320 },
                zIndex: 1,
              },
            ],
            maximizedWindowId: null,
            camera: { x: 0, y: 0, zoom: 1 },
            windowSizeByType: {},
            nextItemId: 2,
            nextZIndex: 2,
          },
        },
      ],
    }

    expect(parseCanvasRecords(collection.canvases)).toHaveLength(1)
    const restored = loadCanvasCollection(
      storage({ [CANVAS_COLLECTION_STORAGE_KEY]: JSON.stringify(collection) }),
    )
    expect(restored.canvases[0]?.state?.windows[0]?.definition.initialState.dir).toBe('Notes')
    const encoded = serializeCanvasCollection(restored)
    const encodedDefinition = JSON.parse(encoded).canvases[0].state.windows[0].definition as Record<
      string,
      unknown
    >
    expect(encodedDefinition.content).toEqual(currentExplorerContent)
    expect(encodedDefinition).not.toHaveProperty('type')
    expect(encodedDefinition).not.toHaveProperty('source')
    expect(encodedDefinition).not.toHaveProperty('initialState')
    const second = loadCanvasCollection(storage({ [CANVAS_COLLECTION_STORAGE_KEY]: encoded }))
    expect(serializeCanvasCollection(second)).toBe(encoded)
  })
})

describe('retired persisted window fixtures', () => {
  test('keeps unrelated settings data but drops old named-layout panes', () => {
    const settings = settingsFixture['reference-library']

    expect(settings.viewModes).toEqual({ '': 'grid', Notes: 'list', Pictures: 'grid' })
    expect(settings.favorites).toEqual(['Pictures/cover.jpg', 'Notes'])
    expect(settings.knowledgeBases).toEqual(['Notes'])
    expect(settings.workspaceLayoutPresets).toHaveLength(1)
    expect(
      normalizePersistedWorkspaceState(settings.workspaceLayoutPresets[0]?.snapshot),
    ).toBeNull()
  })

  test('rejects old workspace panes without content envelopes', () => {
    expect(normalizePersistedWorkspaceState(workspaceFixture)).toBeNull()
  })

  test('rejects persisted windows that mix content and runtime-only fields', () => {
    const dual = {
      windows: [
        {
          id: 'current-browser',
          title: 'Notes',
          content: currentExplorerContent,
          type: 'browser',
          source: { kind: 'local' },
          initialState: { dir: 'Notes' },
        },
      ],
      activeWindowId: 'current-browser',
      activeTabMap: {},
      nextWindowId: 2,
      pinnedTaskbarItems: [],
    }
    expect(normalizePersistedWorkspaceState(dual)).toBeNull()

    const canvas = {
      id: 'canvas-1',
      name: 'Canvas',
      updatedAt: 1,
      writerId: 'writer-1',
      deleted: false,
      state: {
        version: 1,
        windows: [
          {
            id: 'current-browser',
            definition: dual.windows[0],
            bounds: { x: 0, y: 0, width: 480, height: 320 },
            zIndex: 1,
          },
        ],
        camera: { x: 0, y: 0, zoom: 1 },
      },
    }
    expect(parseCanvasRecords([canvas])[0]?.state?.windows).toEqual([])
  })

  test('drops old canvas panes instead of migrating them', () => {
    expect(parseCanvasRecords(canvasFixture.canvases)[0]?.state?.windows).toEqual([])
    const loaded = loadCanvasCollection(
      storage({ [CANVAS_COLLECTION_STORAGE_KEY]: JSON.stringify(canvasFixture) }),
    )
    expect(loaded.activeId).toBe('reference-canvas')
    expect(loaded.canvases[0]?.state?.windows).toEqual([])
  })
})
