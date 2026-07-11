import { describe, expect, test } from 'bun:test'
import { assistGridSpanToBounds } from '@/lib/workspace-assist-grid'
import { defaultWorkspaceGridLines, scaleSnappedWindowsBoundsForCanvasResize } from '@/lib/workspace-geometry'
import { computeSnappedResizeWindows } from '@/lib/workspace-session-store'
import { MediaType } from '@/lib/types'
import type { WorkspaceWindowDefinition } from '@/lib/use-workspace'

function tiledWindow(id: string, colStart: number, colEnd: number): WorkspaceWindowDefinition {
  const colLines = defaultWorkspaceGridLines(3)
  return {
    id,
    type: 'browser',
    title: id,
    iconType: MediaType.FOLDER,
    source: { kind: 'local' },
    initialState: {},
    layout: {
      snapZone: 'assist-custom',
      bounds: {
        x: Math.round((1280 * colStart) / 3),
        y: 0,
        width: Math.round((1280 * (colEnd - colStart)) / 3),
        height: 688,
      },
      tiling: {
        cols: 3,
        rows: 1,
        colStart,
        colEnd,
        rowStart: 0,
        rowEnd: 1,
        colLines,
        rowLines: [0, 1],
      },
    },
  }
}

describe('semantic workspace tiling', () => {
  test('adjacent spans use the exact same rounded boundary', () => {
    const left = assistGridSpanToBounds(
      { width: 1280, height: 688 },
      { gridCols: 3, gridRows: 1, gc0: 0, gc1: 0, gr0: 0, gr1: 0 },
    )
    const middle = assistGridSpanToBounds(
      { width: 1280, height: 688 },
      { gridCols: 3, gridRows: 1, gc0: 1, gc1: 1, gr0: 0, gr1: 0 },
    )
    expect(left.x + left.width).toBe(middle.x)
  })

  test('canvas resize derives every tile from shared normalized lines', () => {
    const next = scaleSnappedWindowsBoundsForCanvasResize(
      [tiledWindow('left', 0, 1), tiledWindow('middle', 1, 2)],
      { width: 1280, height: 688 },
      { width: 1001, height: 701 },
    )
    expect(next[0]!.layout!.bounds!.x + next[0]!.layout!.bounds!.width).toBe(next[1]!.layout!.bounds!.x)
  })

  test('resizing a semantic grid line updates every window sharing it', () => {
    const windows = [tiledWindow('left', 0, 1), tiledWindow('middle', 1, 2)]
    const resized = computeSnappedResizeWindows(windows, 'left', { x: 0, y: 0, width: 500, height: 688 }, 'right')
    expect(resized[0]!.layout!.bounds!.x + resized[0]!.layout!.bounds!.width).toBe(resized[1]!.layout!.bounds!.x)
    expect(resized[0]!.layout!.tiling!.colLines).toEqual(resized[1]!.layout!.tiling!.colLines)
  })
})
