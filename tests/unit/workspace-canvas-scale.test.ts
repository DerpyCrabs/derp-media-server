import { describe, expect, test } from 'bun:test'
import { scaleSnappedWindowsBoundsForCanvasResize } from '@/lib/workspace-geometry'
import { MediaType } from '@/lib/types'

describe('scaleSnappedWindowsBoundsForCanvasResize', () => {
  test('updates fullscreen bounds when canvas changes', () => {
    const windows = [
      {
        id: 'a',
        type: 'browser' as const,
        title: '',
        iconName: null,
        iconPath: '',
        iconType: MediaType.FOLDER,
        iconIsVirtual: false,
        source: { kind: 'local' as const },
        initialState: {},
        layout: {
          fullscreen: true,
          snapZone: null,
          bounds: { x: 0, y: 0, width: 800, height: 600 },
          restoreBounds: { x: 20, y: 20, width: 500, height: 400 },
          minimized: false,
          zIndex: 1,
        },
      },
    ]

    const next = scaleSnappedWindowsBoundsForCanvasResize(
      windows,
      { width: 800, height: 600 },
      { width: 1000, height: 700 },
    )

    expect(next[0]!.layout!.bounds).toEqual({ x: 0, y: 0, width: 1000, height: 700 })
    expect(next[0]!.layout!.restoreBounds).toEqual({ x: 20, y: 20, width: 500, height: 400 })
  })

  test('scales snapped bounds when canvas grows', () => {
    const windows = [
      {
        id: 'a',
        type: 'browser' as const,
        title: '',
        iconName: null,
        iconPath: '',
        iconType: MediaType.FOLDER,
        iconIsVirtual: false,
        source: { kind: 'local' as const },
        initialState: {},
        layout: {
          snapZone: 'left' as const,
          bounds: { x: 0, y: 0, width: 400, height: 600 },
          fullscreen: false,
          minimized: false,
          zIndex: 1,
        },
      },
    ]
    const next = scaleSnappedWindowsBoundsForCanvasResize(
      windows,
      { width: 800, height: 600 },
      { width: 1000, height: 600 },
    )
    expect(next[0]!.layout!.bounds!.width).toBe(500)
  })
})
