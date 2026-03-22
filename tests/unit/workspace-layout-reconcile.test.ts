import { describe, expect, test } from 'bun:test'
import { reconcileLayoutBoundsFromSnapZones } from '@/lib/workspace-geometry'
import type { WorkspaceWindowDefinition } from '@/lib/use-workspace'
import { workspaceTabIconColorKeyToHex } from '@/lib/workspace-tab-icon-colors'
import {
  normalizePersistedWorkspaceState,
  serializeWorkspaceLayoutState,
  serializeWorkspacePersistedState,
} from '@/lib/use-workspace'

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

  test('browser tab title and icon parse and serialize', () => {
    const raw = {
      windows: [
        {
          id: 'a',
          type: 'browser',
          title: 'a',
          source: { kind: 'local', rootPath: null },
          initialState: {},
          layout: {
            snapZone: null,
            bounds: { x: 0, y: 0, width: 400, height: 300 },
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
      browserTabTitle: '  Review  ',
      browserTabIcon: 'LayoutDashboard',
    }
    const n = normalizePersistedWorkspaceState(raw, { reconcileSnapZones: false })
    expect(n?.browserTabTitle).toBe('Review')
    expect(n?.browserTabIcon).toBe('LayoutDashboard')
    expect(serializeWorkspacePersistedState(n!)).toContain('browserTabTitle')
    expect(serializeWorkspaceLayoutState(n!)).not.toContain('browserTabTitle')
  })

  test('invalid browser tab icon is dropped', () => {
    const raw = {
      windows: [
        {
          id: 'a',
          type: 'browser',
          title: 'a',
          source: { kind: 'local', rootPath: null },
          initialState: {},
          layout: {
            snapZone: null,
            bounds: { x: 0, y: 0, width: 400, height: 300 },
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
      browserTabIcon: 'not-valid!',
    }
    const n = normalizePersistedWorkspaceState(raw, { reconcileSnapZones: false })
    expect(n?.browserTabIcon).toBeUndefined()
  })

  test('browser tab icon color tailwind key', () => {
    const raw = {
      windows: [
        {
          id: 'a',
          type: 'browser',
          title: 'a',
          source: { kind: 'local', rootPath: null },
          initialState: {},
          layout: {
            snapZone: null,
            bounds: { x: 0, y: 0, width: 400, height: 300 },
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
      browserTabIconColor: 'blue-500',
    }
    const n = normalizePersistedWorkspaceState(raw, { reconcileSnapZones: false })
    expect(n?.browserTabIconColor).toBe('blue-500')
    expect(workspaceTabIconColorKeyToHex('blue-500')).toBe('#3b82f6')
  })

  test('legacy hex tab icon color is dropped', () => {
    const raw = {
      windows: [
        {
          id: 'a',
          type: 'browser',
          title: 'a',
          source: { kind: 'local', rootPath: null },
          initialState: {},
          layout: {
            snapZone: null,
            bounds: { x: 0, y: 0, width: 400, height: 300 },
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
      browserTabIconColor: '#ff0000',
    }
    const n = normalizePersistedWorkspaceState(raw, { reconcileSnapZones: false })
    expect(n?.browserTabIconColor).toBeUndefined()
  })
})
