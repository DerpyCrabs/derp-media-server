import { describe, expect, test } from 'bun:test'
import { convertWorkspaceSnapshot } from '@/workspace/model/workspace-conversion'
import type { PersistedWorkspaceState } from '@/workspace/model/use-workspace'

function canvasWorkspace(): PersistedWorkspaceState {
  return {
    workspaceType: 'canvas',
    windows: [
      {
        id: 'one',
        type: 'browser',
        title: 'One',
        source: { kind: 'local', rootPath: null },
        initialState: {},
        tabGroupId: 'one',
        layout: {
          bounds: { x: 5_000, y: 4_000, width: 600, height: 500 },
          zIndex: 4,
          minimized: true,
        },
      },
      {
        id: 'two',
        type: 'viewer',
        title: 'Two',
        source: { kind: 'local', rootPath: null },
        initialState: { viewing: 'Documents/sample.pdf' },
        tabGroupId: 'one',
        layout: { bounds: { x: 5_000, y: 4_000, width: 600, height: 500 }, zIndex: 4 },
      },
    ],
    activeWindowId: 'two',
    activeTabMap: { one: 'two' },
    nextWindowId: 3,
    canvas: {
      camera: { x: -2_000, y: -1_000, zoom: 0.5 },
      maximizedWindowId: 'one',
      windowSizeByType: {},
      nextZIndex: 5,
    },
  }
}

describe('workspace conversion', () => {
  test('keeps tabs and clamps canvas groups into the desktop viewport', () => {
    const converted = convertWorkspaceSnapshot(canvasWorkspace(), 'desktop', {
      width: 1_000,
      height: 700,
    })

    expect(converted.workspaceType).toBe('desktop')
    expect(converted.canvas).toBeUndefined()
    expect(converted.windows.map((window) => window.id)).toEqual(['one', 'two'])
    expect(converted.windows[0]?.layout?.bounds).toEqual({
      x: 400,
      y: 200,
      width: 600,
      height: 500,
    })
    expect(converted.windows[1]?.layout?.bounds).toEqual(converted.windows[0]?.layout?.bounds)
    expect(converted.windows[0]?.layout?.minimized).toBe(false)
  })

  test('adds canonical canvas state when converting a desktop workspace', () => {
    const desktop = convertWorkspaceSnapshot(canvasWorkspace(), 'desktop', {
      width: 1_000,
      height: 700,
    })
    const converted = convertWorkspaceSnapshot(desktop, 'canvas')

    expect(converted.workspaceType).toBe('canvas')
    expect(converted.canvas).toEqual({
      camera: { x: 0, y: 0, zoom: 1 },
      maximizedWindowId: null,
      windowSizeByType: {},
      nextZIndex: 5,
    })
    expect(converted.windows.map((window) => window.id)).toEqual(['one', 'two'])
  })
})
