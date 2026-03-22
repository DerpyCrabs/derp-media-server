import { describe, expect, test } from 'bun:test'
import { reconcileLayoutBoundsFromSnapZones } from '@/lib/workspace-geometry'
import type { WorkspaceWindowDefinition } from '@/lib/use-workspace'
import { normalizePersistedWorkspaceState } from '@/lib/use-workspace'

function win(
  id: string,
  snapZone: NonNullable<WorkspaceWindowDefinition['layout']>['snapZone'],
  bounds: NonNullable<WorkspaceWindowDefinition['layout']>['bounds'],
): WorkspaceWindowDefinition {
  return {
    id,
    type: 'browser',
    title: id,
    source: { kind: 'local', rootPath: null },
    initialState: {},
    layout: {
      snapZone,
      bounds,
      fullscreen: false,
      minimized: false,
      zIndex: 1,
    },
  }
}

describe('reconcileLayoutBoundsFromSnapZones', () => {
  test('left + stacked right: fixes wrong x on restored preset (SSR default viewport)', () => {
    const halfW = 640
    const halfH = 360
    const vh = 720
    const vw = 1280
    const windows = [
      win('a', 'left', { x: 0, y: 0, width: halfW, height: vh }),
      win('b', 'top-right', { x: 900, y: 0, width: 50, height: halfH }),
      win('c', 'bottom-right', { x: 900, y: 500, width: 50, height: 100 }),
    ]
    const next = reconcileLayoutBoundsFromSnapZones(windows)
    const tb = next.find((w) => w.id === 'b')?.layout?.bounds
    const bb = next.find((w) => w.id === 'c')?.layout?.bounds
    expect(tb?.x).toBe(halfW)
    expect(tb?.width).toBe(vw - halfW)
    expect(bb?.x).toBe(halfW)
    expect(bb?.width).toBe(vw - halfW)
    expect(bb?.y).toBe(halfH)
  })
})

describe('normalizePersistedWorkspaceState', () => {
  test('session draft (reconcileSnapZones false) keeps saved snapped bounds', () => {
    const raw = {
      windows: [
        {
          id: 'a',
          type: 'browser',
          title: 'a',
          source: { kind: 'local', rootPath: null },
          initialState: {},
          layout: {
            snapZone: 'top-right',
            bounds: { x: 900, y: 10, width: 220, height: 240 },
            fullscreen: false,
            minimized: false,
            zIndex: 1,
          },
        },
      ],
      activeWindowId: 'a',
      activeTabMap: {},
      nextWindowId: 2,
      pinnedTaskbarItems: [],
    }
    const draft = normalizePersistedWorkspaceState(raw, { reconcileSnapZones: false })
    const presetStyle = normalizePersistedWorkspaceState(raw, { reconcileSnapZones: true })
    expect(draft?.windows[0]?.layout?.bounds).toEqual({
      x: 900,
      y: 10,
      width: 220,
      height: 240,
    })
    expect(presetStyle?.windows[0]?.layout?.bounds?.width).toBe(640)
    expect(presetStyle?.windows[0]?.layout?.bounds?.x).toBe(640)
  })
})
