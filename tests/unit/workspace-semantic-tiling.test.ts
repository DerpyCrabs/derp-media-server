import { describe, expect, test } from 'bun:test'
import {
  applyAssistCustomSnapToWindows,
  assistGridSpanToBounds,
  type AssistGridSpan,
} from '@/lib/workspace-assist-grid'
import {
  defaultWorkspaceGridLines,
  scaleSnappedWindowsBoundsForCanvasResize,
  tilingPlacementToBounds,
} from '@/lib/workspace-geometry'
import { computeSnappedResizeWindows } from '@/lib/workspace-session-store'
import { MediaType } from '@/lib/types'
import type { WorkspaceWindowDefinition } from '@/lib/use-workspace'

const CANVAS = { width: 1280, height: 688 }

function tiledWindow(
  id: string,
  colStart: number,
  colEnd: number,
  colLines = defaultWorkspaceGridLines(3),
): WorkspaceWindowDefinition {
  const tiling = {
    cols: 3,
    rows: 1,
    colStart,
    colEnd,
    rowStart: 0,
    rowEnd: 1,
    colLines,
    rowLines: [0, 1],
  }
  return {
    id,
    type: 'browser',
    title: id,
    iconType: MediaType.FOLDER,
    source: { kind: 'local' },
    initialState: {},
    layout: {
      snapZone: null,
      bounds: tilingPlacementToBounds(tiling, CANVAS),
      tiling,
    },
  }
}

function assertExactAbutment(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
  axis: 'x' | 'y',
) {
  if (axis === 'x') {
    expect(a.x + a.width).toBe(b.x)
  } else {
    expect(a.y + a.height).toBe(b.y)
  }
}

describe('semantic workspace tiling', () => {
  test('adjacent equal spans use the exact same rounded boundary', () => {
    const left = assistGridSpanToBounds(CANVAS, {
      gridCols: 3,
      gridRows: 1,
      gc0: 0,
      gc1: 0,
      gr0: 0,
      gr1: 0,
    })
    const middle = assistGridSpanToBounds(CANVAS, {
      gridCols: 3,
      gridRows: 1,
      gc0: 1,
      gc1: 1,
      gr0: 0,
      gr1: 0,
    })
    assertExactAbutment(left, middle, 'x')
  })

  test('canvas resize derives every tile from shared normalized lines', () => {
    const next = scaleSnappedWindowsBoundsForCanvasResize(
      [tiledWindow('left', 0, 1), tiledWindow('middle', 1, 2)],
      CANVAS,
      { width: 1001, height: 701 },
    )
    assertExactAbutment(next[0]!.layout!.bounds!, next[1]!.layout!.bounds!, 'x')
  })

  test('resizing a semantic grid line updates every window sharing it with exact abutment', () => {
    const windows = [tiledWindow('left', 0, 1), tiledWindow('middle', 1, 2)]
    const resized = computeSnappedResizeWindows(
      windows,
      'left',
      { x: 0, y: 0, width: 480, height: 688 },
      'right',
      CANVAS,
    )
    assertExactAbutment(resized[0]!.layout!.bounds!, resized[1]!.layout!.bounds!, 'x')
    expect(resized[0]!.layout!.tiling!.colLines).toEqual(resized[1]!.layout!.tiling!.colLines)
    expect(resized[0]!.layout!.bounds!.width).toBeGreaterThan(
      tiledWindow('left', 0, 1).layout!.bounds!.width,
    )
  })

  test('snapping into a resized grid uses custom lines, not equal divisions', () => {
    // Move the line between middle and right so the right column is narrower than 1/3.
    const resizedLines = [0, 1 / 3, 0.8, 1]
    const left = tiledWindow('left', 0, 1, resizedLines)
    const rightSpan: AssistGridSpan = {
      gridCols: 3,
      gridRows: 1,
      gc0: 2,
      gc1: 2,
      gr0: 0,
      gr1: 0,
    }

    const equalRight = assistGridSpanToBounds(CANVAS, rightSpan)
    const next = applyAssistCustomSnapToWindows(
      [left, tiledWindow('right', 2, 3)],
      'right',
      rightSpan,
      CANVAS,
    )
    const right = next.find((w) => w.id === 'right')!
    const rightBounds = right.layout!.bounds!

    expect(right.layout!.tiling!.colLines).toEqual(resizedLines)
    expect(rightBounds.x).toBe(Math.round(0.8 * CANVAS.width))
    expect(rightBounds.width).toBe(CANVAS.width - Math.round(0.8 * CANVAS.width))
    expect(rightBounds.x).toBeGreaterThan(equalRight.x)
    expect(rightBounds.width).toBeLessThan(equalRight.width)
    expect(rightBounds).toEqual(tilingPlacementToBounds(right.layout!.tiling!, CANVAS))
  })

  test('resize then snap second window into remaining slot abuts with no gap', () => {
    const leftSpan: AssistGridSpan = {
      gridCols: 2,
      gridRows: 1,
      gc0: 0,
      gc1: 0,
      gr0: 0,
      gr1: 0,
    }
    const rightSpan: AssistGridSpan = {
      gridCols: 2,
      gridRows: 1,
      gc0: 1,
      gc1: 1,
      gr0: 0,
      gr1: 0,
    }
    const floating: WorkspaceWindowDefinition = {
      id: 'right',
      type: 'browser',
      title: 'right',
      iconType: MediaType.FOLDER,
      source: { kind: 'local' },
      initialState: {},
      layout: {
        bounds: { x: 40, y: 40, width: 400, height: 300 },
      },
    }

    let windows = applyAssistCustomSnapToWindows(
      [
        {
          id: 'left',
          type: 'browser',
          title: 'left',
          iconType: MediaType.FOLDER,
          source: { kind: 'local' },
          initialState: {},
          layout: { bounds: { x: 20, y: 20, width: 400, height: 300 } },
        },
        floating,
      ],
      'left',
      leftSpan,
      CANVAS,
    )

    windows = computeSnappedResizeWindows(
      windows,
      'left',
      { x: 0, y: 0, width: 400, height: CANVAS.height },
      'right',
      CANVAS,
    )

    windows = applyAssistCustomSnapToWindows(windows, 'right', rightSpan, CANVAS)

    const left = windows.find((w) => w.id === 'left')!.layout!.bounds!
    const right = windows.find((w) => w.id === 'right')!.layout!.bounds!
    assertExactAbutment(left, right, 'x')
    expect(left.width).toBe(400)
    expect(right.x + right.width).toBe(CANVAS.width)
    expect(windows[0]!.layout!.tiling!.colLines).toEqual(windows[1]!.layout!.tiling!.colLines)
  })

  test('three-column resize keeps all shared edges flush', () => {
    let windows = [
      tiledWindow('left', 0, 1),
      tiledWindow('middle', 1, 2),
      tiledWindow('right', 2, 3),
    ]
    windows = computeSnappedResizeWindows(
      windows,
      'left',
      { x: 0, y: 0, width: 520, height: CANVAS.height },
      'right',
      CANVAS,
    )
    windows = computeSnappedResizeWindows(
      windows,
      'middle',
      {
        x: windows[1]!.layout!.bounds!.x,
        y: 0,
        width: 300,
        height: CANVAS.height,
      },
      'right',
      CANVAS,
    )

    const [left, middle, right] = windows.map((w) => w.layout!.bounds!)
    assertExactAbutment(left!, middle!, 'x')
    assertExactAbutment(middle!, right!, 'x')
    expect(right!.x + right!.width).toBe(CANVAS.width)
    expect(new Set(windows.map((w) => JSON.stringify(w.layout!.tiling!.colLines))).size).toBe(1)
  })
})
