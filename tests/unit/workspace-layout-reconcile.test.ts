import { describe, expect, test } from 'bun:test'
import { reconcileLayoutBoundsFromSnapZones } from '@/lib/workspace-geometry'
import type { WorkspaceWindowDefinition } from '@/lib/use-workspace'

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
