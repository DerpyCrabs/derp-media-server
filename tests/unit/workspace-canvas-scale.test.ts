import { describe, expect, test } from 'bun:test'
import {
  adaptFloatingBoundsForCanvasResize,
  scaleSnappedWindowsBoundsForCanvasResize,
} from '@/lib/workspace-geometry'
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
    expect(next[0]!.layout!.restoreBounds).toEqual({ x: 25, y: 23, width: 625, height: 500 })
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

  test('scales floating position by each canvas axis and size by canvas width', () => {
    expect(
      adaptFloatingBoundsForCanvasResize(
        { x: 100, y: 80, width: 400, height: 300 },
        { width: 1000, height: 800 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ x: 80, y: 60, width: 320, height: 240 })
  })

  test('preserves aspect ratio and clamps scaled position inside the canvas', () => {
    const next = adaptFloatingBoundsForCanvasResize(
      { x: 700, y: 400, width: 600, height: 400 },
      { width: 1200, height: 800 },
      { width: 700, height: 300 },
    )

    expect(next).toEqual({ x: 350, y: 67, width: 350, height: 233 })
    expect(next.width / next.height).toBeCloseTo(1.5, 2)
  })

  test('caps width-driven growth when window height would exceed the canvas', () => {
    const next = adaptFloatingBoundsForCanvasResize(
      { x: 100, y: 100, width: 400, height: 500 },
      { width: 800, height: 800 },
      { width: 1200, height: 600 },
    )

    expect(next).toEqual({ x: 150, y: 0, width: 480, height: 600 })
    expect(next.width / next.height).toBe(0.8)
  })
})
