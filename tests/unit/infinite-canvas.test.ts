import { describe, expect, test } from 'bun:test'
import {
  CANVAS_GRID_SIZE,
  canvasWindowVisualBounds,
  canvasWindowWorldBounds,
  createEmptyCanvasState,
  findNearestFreeCanvasRect,
  framesOverlap,
  parseInfiniteCanvasState,
  reconcileFrameMembership,
  snapCanvasRect,
  withCanvasWindowWorldBounds,
  type CanvasFrame,
  type CanvasWindow,
} from '@/lib/infinite-canvas'
import { MediaType } from '@/lib/types'

const frame: CanvasFrame = {
  id: 'frame-1',
  name: 'Project',
  color: '#6366f1',
  bounds: { x: 320, y: 640, width: 960, height: 640 },
}

function canvasWindow(id: string, bounds: CanvasWindow['bounds']): CanvasWindow {
  return {
    id,
    bounds,
    frameId: null,
    zIndex: 1,
    definition: {
      id,
      type: 'viewer',
      title: `${id}.md`,
      iconType: MediaType.TEXT,
      source: { kind: 'local' },
      initialState: { viewing: `${id}.md` },
    },
  }
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

  test('stores frame children relatively without changing world bounds', () => {
    const topLevel = canvasWindow('note', { x: 416, y: 736, width: 320, height: 224 })
    const child = withCanvasWindowWorldBounds(topLevel, topLevel.bounds, frame.id, [frame])
    expect(child.frameId).toBe(frame.id)
    expect(child.bounds.x).toBe(96)
    expect(child.bounds.y).toBe(96)
    expect(canvasWindowWorldBounds(child, [frame])).toEqual(topLevel.bounds)
  })

  test('renders eight pixels between logically adjacent windows', () => {
    const left = canvasWindowVisualBounds({ x: 0, y: 0, width: 640, height: 480 })
    const right = canvasWindowVisualBounds({ x: 640, y: 0, width: 640, height: 480 })
    expect(right.x - (left.x + left.width)).toBe(8)
  })

  test('captures fully enclosed top-level windows and releases excluded children', () => {
    const enclosed = canvasWindow('inside', { x: 416, y: 736, width: 320, height: 224 })
    const outside = withCanvasWindowWorldBounds(
      canvasWindow('outside', { x: 1440, y: 736, width: 320, height: 224 }),
      { x: 1440, y: 736, width: 320, height: 224 },
      frame.id,
      [frame],
    )
    const state = {
      ...createEmptyCanvasState(),
      frames: [frame],
      windows: [enclosed, outside],
    }
    const next = reconcileFrameMembership(state, frame.id)
    expect(next.windows.find((window) => window.id === 'inside')?.frameId).toBe(frame.id)
    expect(next.windows.find((window) => window.id === 'outside')?.frameId).toBeNull()
    expect(canvasWindowWorldBounds(next.windows[1]!, next.frames).x).toBe(1440)
  })

  test('finds nearest free grid location without moving obstacles', () => {
    const obstacle = { x: 0, y: 0, width: 640, height: 480 }
    const placed = findNearestFreeCanvasRect(obstacle, [obstacle])
    expect(placed).not.toEqual(obstacle)
    expect(Math.abs(placed.x % CANVAS_GRID_SIZE)).toBe(0)
    expect(Math.abs(placed.y % CANVAS_GRID_SIZE)).toBe(0)
  })

  test('detects frame overlap while excluding changed frame itself', () => {
    const other = { ...frame, id: 'frame-2', bounds: { ...frame.bounds, x: 1600 } }
    expect(framesOverlap([frame, other], frame.id, frame.bounds)).toBe(false)
    expect(framesOverlap([frame, other], frame.id, { ...frame.bounds, x: 1500 })).toBe(true)
  })
})

describe('infinite canvas persistence', () => {
  test('rejects unknown versions and sanitizes camera zoom', () => {
    expect(parseInfiniteCanvasState({ version: 2, frames: [], windows: [] })).toBeNull()
    const parsed = parseInfiniteCanvasState({
      ...createEmptyCanvasState(),
      camera: { x: 2, y: 3, zoom: 100 },
    })
    expect(parsed?.camera).toEqual({ x: 2, y: 3, zoom: 1 })
  })

  test('drops invalid frame references on load', () => {
    const parsed = parseInfiniteCanvasState({
      ...createEmptyCanvasState(),
      windows: [
        { ...canvasWindow('note', { x: 0, y: 0, width: 320, height: 224 }), frameId: 'missing' },
      ],
    })
    expect(parsed?.windows[0]?.frameId).toBeNull()
  })

  test('restores snapped window sizes by type', () => {
    const parsed = parseInfiniteCanvasState({
      ...createEmptyCanvasState(),
      windowSizeByType: {
        browser: { width: 707, height: 515 },
        viewer: { width: 511, height: 333 },
      },
    })
    expect(parsed?.windowSizeByType).toEqual({
      browser: { width: 704, height: 512 },
      viewer: { width: 512, height: 320 },
    })
  })

  test('deduplicates item ids and advances stale counters', () => {
    const first = canvasWindow('canvas-window-7', { x: 0, y: 0, width: 320, height: 224 })
    const duplicate = canvasWindow('canvas-window-7', {
      x: 320,
      y: 0,
      width: 320,
      height: 224,
    })
    const parsed = parseInfiniteCanvasState({
      ...createEmptyCanvasState(),
      windows: [{ ...first, zIndex: 12 }, duplicate],
      nextItemId: 1,
      nextZIndex: 1,
    })
    expect(parsed?.windows).toHaveLength(1)
    expect(parsed?.nextItemId).toBe(8)
    expect(parsed?.nextZIndex).toBe(13)
  })

  test('normalizes unsafe persisted window definitions', () => {
    const persisted = {
      ...canvasWindow('canvas-window-1', { x: 0, y: 0, width: 320, height: 224 }),
      definition: {
        id: 'canvas-window-1',
        type: 'browser',
        source: { kind: 'share', token: 'unexpected' },
        initialState: { dir: 42, viewing: 'safe.md' },
      },
    } as unknown as CanvasWindow
    const parsed = parseInfiniteCanvasState({
      ...createEmptyCanvasState(),
      windows: [persisted],
    })
    expect(parsed?.windows[0]?.definition).toMatchObject({
      title: persisted.id,
      source: { kind: 'local' },
      initialState: { viewing: 'safe.md' },
      tabGroupId: null,
    })
  })
})
