import { describe, expect, test } from 'bun:test'
import { currentContentWindowPersistence } from '@/src/integrations/current-window-content'
import {
  CANVAS_GRID_SIZE,
  canvasWindowVisualBounds,
  cloneInfiniteCanvasState,
  createEmptyCanvasState,
  findNearestFreeCanvasRect,
  parseInfiniteCanvasState,
  reconcileInfiniteCanvasState,
  serializeInfiniteCanvasState,
  snapCanvasRect,
  type CanvasWindow,
  type InfiniteCanvasState,
} from '@/lib/infinite-canvas'
import { filesystemResourceKey } from '@/lib/domain/resource'
import { deletedHermesSessionIds } from '@/src/integrations/hermes/runtime-state'

function integrationDefinition(id: string, state: Record<string, unknown>) {
  return {
    id,
    title: 'Hermes',
    contentInstance: {
      id,
      type: 'integration' as const,
      integration: 'hermes',
      view: 'chat',
      state,
    },
  }
}

function integrationState(window: CanvasWindow | undefined) {
  const content = window?.definition.contentInstance
  return content?.type === 'integration' && typeof content.state === 'object'
    ? (content.state as Record<string, unknown>)
    : undefined
}

function canvasWindow(id: string, bounds: CanvasWindow['bounds']): CanvasWindow {
  return {
    id,
    bounds,
    zIndex: 1,
    definition: {
      id,
      title: `${id}.md`,
      contentInstance: {
        id,
        type: 'resource',
        resource: filesystemResourceKey('configured-default', `${id}.md`),
        renderer: 'text-viewer',
      },
    },
  }
}

function currentPersistedState(state: InfiniteCanvasState): unknown {
  return JSON.parse(serializeInfiniteCanvasState(state, currentContentWindowPersistence))
}

describe('infinite canvas geometry', () => {
  test('quantizes position and dimensions to shared grid', () => {
    expect(snapCanvasRect({ x: 17, y: 47, width: 641, height: 479 })).toEqual({
      x: CANVAS_GRID_SIZE,
      y: CANVAS_GRID_SIZE,
      width: 640,
      height: 480,
    })
  })

  test('renders eight pixels between logically adjacent windows', () => {
    const left = canvasWindowVisualBounds({ x: 0, y: 0, width: 640, height: 480 })
    const right = canvasWindowVisualBounds({ x: 640, y: 0, width: 640, height: 480 })
    expect(right.x - (left.x + left.width)).toBe(8)
  })

  test('finds nearest free grid location without moving obstacles', () => {
    const obstacle = { x: 0, y: 0, width: 640, height: 480 }
    const placed = findNearestFreeCanvasRect(obstacle, [obstacle])
    expect(placed).not.toEqual(obstacle)
    expect(Math.abs(placed.x % CANVAS_GRID_SIZE)).toBe(0)
    expect(Math.abs(placed.y % CANVAS_GRID_SIZE)).toBe(0)
  })
})

describe('infinite canvas persistence', () => {
  test('clones live Hermes drafts without applying persistence filtering', () => {
    const state = createEmptyCanvasState()
    state.windows = [
      {
        id: 'canvas-window-1',
        definition: integrationDefinition('canvas-window-1', {
          draftId: 'draft-1',
          cwd: 'C:/repo',
        }),
        bounds: { x: 0, y: 0, width: 640, height: 480 },
        zIndex: 1,
      },
    ]

    const cloned = cloneInfiniteCanvasState(state)

    expect(cloned).not.toBe(state)
    expect(cloned.windows[0]).not.toBe(state.windows[0])
    expect(integrationState(cloned.windows[0])).toEqual({
      draftId: 'draft-1',
      cwd: 'C:/repo',
    })
    expect(
      JSON.parse(serializeInfiniteCanvasState(cloned, currentContentWindowPersistence)).windows,
    ).toEqual([])
  })

  test('keeps live Hermes drafts while reconciling persisted state', () => {
    const current = createEmptyCanvasState()
    const draft: CanvasWindow = {
      id: 'draft',
      definition: integrationDefinition('draft', {
        draftId: 'draft-1',
        cwd: 'C:/repo',
      }),
      bounds: { x: 0, y: 0, width: 640, height: 480 },
      zIndex: 1,
    }
    const durable: CanvasWindow = {
      ...draft,
      id: 'durable',
      definition: {
        ...integrationDefinition('durable', {
          sessionId: 'session-1',
          cwd: 'C:/repo',
        }),
      },
      bounds: { x: 640, y: 0, width: 640, height: 480 },
      zIndex: 2,
    }
    current.windows = [draft, durable]
    const incoming = parseInfiniteCanvasState(
      JSON.parse(serializeInfiniteCanvasState(current, currentContentWindowPersistence)),
      currentContentWindowPersistence,
    )
    expect(incoming).not.toBeNull()

    const reconciled = reconcileInfiniteCanvasState(
      current,
      incoming!,
      currentContentWindowPersistence,
    )

    expect(reconciled.windows.find((window) => window.id === 'draft')).toBe(draft)
    expect(integrationState(reconciled.windows.find((window) => window.id === 'draft'))).toEqual({
      draftId: 'draft-1',
      cwd: 'C:/repo',
    })
    expect(integrationState(reconciled.windows.find((window) => window.id === 'durable'))).toEqual({
      sessionId: 'session-1',
      cwd: 'C:/repo',
    })
  })

  test('does not serialize or reconcile a deleted durable integration window', () => {
    const current = createEmptyCanvasState()
    current.windows = [
      {
        id: 'deleted',
        definition: integrationDefinition('deleted', { sessionId: 'deleted-session' }),
        bounds: { x: 0, y: 0, width: 640, height: 480 },
        zIndex: 1,
      },
    ]
    deletedHermesSessionIds.add('deleted-session')
    try {
      expect(
        JSON.parse(serializeInfiniteCanvasState(current, currentContentWindowPersistence)).windows,
      ).toEqual([])
      expect(
        reconcileInfiniteCanvasState(
          current,
          createEmptyCanvasState(),
          currentContentWindowPersistence,
        ).windows,
      ).toEqual([])
    } finally {
      deletedHermesSessionIds.delete('deleted-session')
    }
  })

  test('reconciles remote state without replacing unchanged canvas branches', () => {
    const current = createEmptyCanvasState()
    const stable = canvasWindow('canvas-window-1', { x: 0, y: 0, width: 320, height: 224 })
    const moved = canvasWindow('canvas-window-2', { x: 320, y: 0, width: 320, height: 224 })
    current.windows = [stable, moved]
    const incoming = structuredClone(current)
    incoming.windows[1]!.bounds.x = 640
    incoming.nextZIndex = 3

    const reconciled = reconcileInfiniteCanvasState(
      current,
      incoming,
      currentContentWindowPersistence,
    )
    expect(reconciled).not.toBe(current)
    expect(reconciled.windows[0]).toBe(stable)
    expect(reconciled.windows[1]).not.toBe(moved)
    expect(reconciled.windows[1]!.definition).toBe(moved.definition)
    expect(reconciled.camera).toBe(current.camera)
    expect(
      reconcileInfiniteCanvasState(
        current,
        structuredClone(current),
        currentContentWindowPersistence,
      ),
    ).toBe(current)
  })

  test('rejects unknown versions and sanitizes camera zoom', () => {
    expect(
      parseInfiniteCanvasState({ version: 2, windows: [] }, currentContentWindowPersistence),
    ).toBeNull()
    const parsed = parseInfiniteCanvasState(
      {
        ...createEmptyCanvasState(),
        camera: { x: 2, y: 3, zoom: 100 },
      },
      currentContentWindowPersistence,
    )
    expect(parsed?.camera).toEqual({ x: 2, y: 3, zoom: 1 })
  })

  test('restores snapped window sizes by type', () => {
    const parsed = parseInfiniteCanvasState(
      {
        ...createEmptyCanvasState(),
        windowSizeByType: {
          browser: { width: 707, height: 515 },
          viewer: { width: 511, height: 333 },
          'viewer-audio': { width: 481, height: 225 },
          'viewer-video': { width: 799, height: 479 },
        },
      },
      currentContentWindowPersistence,
    )
    expect(parsed?.windowSizeByType).toEqual({
      browser: { width: 704, height: 512 },
      viewer: { width: 512, height: 320 },
      'viewer-audio': { width: 480, height: 224 },
      'viewer-video': { width: 800, height: 480 },
    })
  })

  test('restores only a valid maximized window id', () => {
    const window = canvasWindow('canvas-window-1', { x: 0, y: 0, width: 320, height: 224 })
    const saved = {
      ...createEmptyCanvasState(),
      windows: [window],
      maximizedWindowId: window.id,
    }

    const persisted = currentPersistedState(saved) as InfiniteCanvasState
    expect(parseInfiniteCanvasState(persisted, currentContentWindowPersistence)).toMatchObject({
      maximizedWindowId: window.id,
    })
    expect(
      parseInfiniteCanvasState(
        { ...persisted, maximizedWindowId: 'missing' },
        currentContentWindowPersistence,
      ),
    ).toMatchObject({ maximizedWindowId: null })
  })

  test('deduplicates item ids and advances stale counters', () => {
    const first = canvasWindow('canvas-window-7', { x: 0, y: 0, width: 320, height: 224 })
    const duplicate = canvasWindow('canvas-window-7', {
      x: 320,
      y: 0,
      width: 320,
      height: 224,
    })
    const parsed = parseInfiniteCanvasState(
      currentPersistedState({
        ...createEmptyCanvasState(),
        windows: [{ ...first, zIndex: 12 }, duplicate],
        nextItemId: 1,
        nextZIndex: 1,
      }),
      currentContentWindowPersistence,
    )
    expect(parsed?.windows).toHaveLength(1)
    expect(parsed?.nextItemId).toBe(8)
    expect(parsed?.nextZIndex).toBe(13)
  })

  test('drops persisted panes without an authoritative content envelope', () => {
    const persisted = {
      ...canvasWindow('canvas-window-1', { x: 0, y: 0, width: 320, height: 224 }),
      definition: {
        id: 'canvas-window-1',
        title: 'Missing content',
      },
    } as unknown as CanvasWindow
    const parsed = parseInfiniteCanvasState(
      {
        ...createEmptyCanvasState(),
        windows: [persisted],
      },
      currentContentWindowPersistence,
    )
    expect(parsed?.windows).toEqual([])
  })

  test('preserves reader renderer identity for persisted resource windows', () => {
    const persisted = canvasWindow('canvas-window-1', {
      x: 0,
      y: 0,
      width: 320,
      height: 224,
    })
    persisted.definition.contentInstance = {
      id: 'canvas-window-1',
      type: 'resource',
      resource: filesystemResourceKey('configured-default', 'Images'),
      renderer: 'folder-reader',
    }
    const parsed = parseInfiniteCanvasState(
      currentPersistedState({
        ...createEmptyCanvasState(),
        windows: [persisted],
      }),
      currentContentWindowPersistence,
    )
    expect(parsed?.windows[0]?.definition.contentInstance).toMatchObject({
      resource: filesystemResourceKey('configured-default', 'Images'),
      renderer: 'folder-reader',
    })
  })
})
