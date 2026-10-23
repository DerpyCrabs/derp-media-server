import { describe, expect, test } from 'bun:test'
import {
  adaptFloatingBoundsForCanvasResize,
  scaleSnappedWindowsBoundsForCanvasResize,
} from '@/workspace/model/workspace-geometry'
import type { WindowDefinition } from '@/lib/models/window-model'
import { MediaType } from '@/lib/files/types'

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

  test('keeps fitting floating geometry unchanged', () => {
    expect(
      adaptFloatingBoundsForCanvasResize(
        { x: 100, y: 80, width: 400, height: 300 },
        { width: 1000, height: 800 },
        { width: 800, height: 600 },
      ),
    ).toEqual({ x: 100, y: 80, width: 400, height: 300 })
  })

  test('moves before shrinking and only constrains the overflowing dimension', () => {
    expect(
      adaptFloatingBoundsForCanvasResize(
        { x: 700, y: 400, width: 600, height: 400 },
        { width: 1400, height: 900 },
        { width: 700, height: 300 },
      ),
    ).toEqual({ x: 100, y: 0, width: 600, height: 300 })
  })

  test('does not grow when more space becomes available', () => {
    expect(
      adaptFloatingBoundsForCanvasResize(
        { x: 100, y: 100, width: 400, height: 500 },
        { width: 800, height: 800 },
        { width: 1200, height: 600 },
      ),
    ).toEqual({ x: 100, y: 100, width: 400, height: 500 })
  })

  test('restores preferred size and position after repeated rotations and tiny viewports', () => {
    const original = { x: 800, y: 350, width: 600, height: 500 }
    let bounds = original
    let canvas = { width: 1600, height: 1000 }
    for (let cycle = 0; cycle < 10; cycle++) {
      for (const next of [
        { width: 420, height: 1900 },
        { width: 320, height: 200 },
        { width: 900, height: 600 },
        { width: 1600, height: 1000 },
      ]) {
        bounds = adaptFloatingBoundsForCanvasResize(bounds, canvas, next)
        expect(bounds.width).toBe(Math.min(600, next.width))
        expect(bounds.height).toBe(Math.min(500, next.height))
        expect(bounds.x).toBeGreaterThanOrEqual(0)
        expect(bounds.y).toBeGreaterThanOrEqual(0)
        expect(bounds.x + bounds.width).toBeLessThanOrEqual(next.width)
        expect(bounds.y + bounds.height).toBeLessThanOrEqual(next.height)
        canvas = next
      }
      expect(bounds).toEqual(original)
    }
  })

  test('explicit user geometry replaces the preference', () => {
    const small = adaptFloatingBoundsForCanvasResize(
      { x: 800, y: 350, width: 600, height: 500 },
      { width: 1600, height: 1000 },
      { width: 420, height: 900 },
    )
    const edited = { ...small, x: 10, width: 380, height: 300 }
    expect(
      adaptFloatingBoundsForCanvasResize(
        edited,
        { width: 420, height: 900 },
        { width: 1600, height: 1000 },
      ),
    ).toEqual(edited)
  })

  test('repairs undersized windows but lets tiny viewports override minimums', () => {
    const original = { x: -30, y: -20, width: 100, height: 80 }
    const canvas = { width: 1600, height: 1000 }
    const minimum = { width: 480, height: 320 }
    const small = adaptFloatingBoundsForCanvasResize(
      original,
      canvas,
      { width: 200, height: 150 },
      minimum,
    )
    expect(small).toEqual({ x: 0, y: 0, width: 200, height: 150 })
    expect(
      adaptFloatingBoundsForCanvasResize(small, { width: 200, height: 150 }, canvas, minimum),
    ).toEqual({ x: 0, y: 0, width: 480, height: 320 })
  })

  test('mixed tab groups share minimums, including minimized windows', () => {
    const windows: WindowDefinition[] = ['viewer', 'hermes', 'browser'].map((type, i) => ({
      id: String(i),
      type: type as WindowDefinition['type'],
      title: '',
      source: { kind: 'local' },
      initialState: {},
      tabGroupId: i < 2 ? 'group' : null,
      layout: { bounds: { x: 10, y: 10, width: 120, height: 100 }, minimized: true },
    }))
    const next = scaleSnappedWindowsBoundsForCanvasResize(
      windows,
      { width: 1600, height: 1000 },
      { width: 800, height: 1200 },
    )
    expect(next.map((w) => w.layout?.bounds)).toEqual([
      { x: 10, y: 10, width: 480, height: 320 },
      { x: 10, y: 10, width: 480, height: 320 },
      { x: 10, y: 10, width: 420, height: 300 },
    ])
    expect(next.every((w) => w.layout?.minimized)).toBe(true)
  })

  test('fullscreen fits tiny canvases and its restore bounds recover', () => {
    const original = { x: 600, y: 200, width: 700, height: 500 }
    const windows: WindowDefinition[] = [
      {
        id: 'a',
        type: 'viewer',
        title: '',
        source: { kind: 'local' },
        initialState: {},
        layout: {
          fullscreen: true,
          bounds: { x: 0, y: 0, width: 1600, height: 1000 },
          restoreBounds: original,
        },
      },
    ]
    const small = scaleSnappedWindowsBoundsForCanvasResize(
      windows,
      { width: 1600, height: 1000 },
      { width: 200, height: 150 },
    )
    expect(small[0]?.layout?.bounds).toEqual({ x: 0, y: 0, width: 200, height: 150 })
    expect(small[0]?.layout?.restoreBounds).toEqual({ x: 0, y: 0, width: 200, height: 150 })
    const restored = scaleSnappedWindowsBoundsForCanvasResize(
      small,
      { width: 200, height: 150 },
      { width: 1600, height: 1000 },
    )
    expect(restored[0]?.layout?.restoreBounds).toEqual(original)
  })

  test('ignores zero-sized intermediate canvases', () => {
    const bounds = { x: 100, y: 80, width: 400, height: 300 }
    expect(
      adaptFloatingBoundsForCanvasResize(
        bounds,
        { width: 1000, height: 800 },
        { width: 0, height: 0 },
      ),
    ).toBe(bounds)
  })
})
