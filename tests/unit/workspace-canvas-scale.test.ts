import { describe, expect, test } from 'bun:test'
import { scaleSnappedWindowsBoundsForCanvasResize } from '@/lib/workspace-geometry'
import { MediaType } from '@/lib/types'

describe('scaleSnappedWindowsBoundsForCanvasResize', () => {
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
