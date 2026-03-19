import { describe, expect, test } from 'bun:test'
import { computeSnappedResizeWindows } from '@/lib/workspace-session-store'
import {
  SNAP_SIBLING_MAP,
  type SnapZone,
  type WorkspaceWindowDefinition,
} from '@/lib/use-workspace'

/**
 * Pure function that computes new sibling bounds when a neighbor is resized.
 * Mirrors the logic in resizeSnappedWindow for unit testing.
 */
function computeSiblingBounds(
  targetZone: SnapZone,
  targetOldBounds: { x: number; y: number; width: number; height: number },
  targetNewBounds: { x: number; y: number; width: number; height: number },
  direction: string,
  siblingZone: SnapZone,
  siblingBounds: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const siblings = SNAP_SIBLING_MAP[targetZone] ?? {}
  const wb = { ...siblingBounds }

  if (
    direction.includes('right') &&
    targetNewBounds.x + targetNewBounds.width !== targetOldBounds.x + targetOldBounds.width
  ) {
    const delta =
      targetNewBounds.x + targetNewBounds.width - (targetOldBounds.x + targetOldBounds.width)
    if (siblings.right?.includes(siblingZone)) {
      wb.x += delta
      wb.width -= delta
    }
  }
  if (direction.includes('left') && targetNewBounds.x !== targetOldBounds.x) {
    const delta = targetNewBounds.x - targetOldBounds.x
    if (siblings.left?.includes(siblingZone)) {
      wb.width += delta
    }
  }
  if (
    direction.includes('bottom') &&
    targetNewBounds.y + targetNewBounds.height !== targetOldBounds.y + targetOldBounds.height
  ) {
    const delta =
      targetNewBounds.y + targetNewBounds.height - (targetOldBounds.y + targetOldBounds.height)
    if (siblings.bottom?.includes(siblingZone)) {
      wb.y += delta
      wb.height -= delta
    }
  }
  if (direction.includes('top') && targetNewBounds.y !== targetOldBounds.y) {
    const delta = targetNewBounds.y - targetOldBounds.y
    if (siblings.top?.includes(siblingZone)) {
      wb.height += delta
    }
  }

  return wb
}

describe('SNAP_SIBLING_MAP for third zones', () => {
  test('top-left-third has right sibling top-center-third and bottom sibling bottom-left-third', () => {
    const map = SNAP_SIBLING_MAP['top-left-third']
    expect(map.right).toContain('top-center-third')
    expect(map.bottom).toContain('bottom-left-third')
  })

  test('top-center-third has left, right, and bottom siblings', () => {
    const map = SNAP_SIBLING_MAP['top-center-third']
    expect(map.left).toContain('top-left-third')
    expect(map.right).toContain('top-right-third')
    expect(map.bottom).toContain('bottom-center-third')
  })

  test('left-third has right sibling center-third', () => {
    const map = SNAP_SIBLING_MAP['left-third']
    expect(map.right).toContain('center-third')
    expect(map.right).toContain('right-two-thirds')
  })
})

describe('computeSnappedResizeWindows (extracted from session store)', () => {
  test('matches sibling resize for top-left-third / top-center-third pair', () => {
    const viewportWidth = 1200
    const viewportHeight = 800
    const thirdW = Math.round(viewportWidth / 3)
    const halfH = Math.round(viewportHeight / 2)
    const delta = 80

    const wA: WorkspaceWindowDefinition = {
      id: 'a',
      type: 'browser',
      title: 'A',
      source: { kind: 'local', rootPath: null },
      initialState: {},
      layout: {
        snapZone: 'top-left-third',
        bounds: { x: 0, y: 0, width: thirdW, height: halfH },
      },
    }
    const wB: WorkspaceWindowDefinition = {
      id: 'b',
      type: 'browser',
      title: 'B',
      source: { kind: 'local', rootPath: null },
      initialState: {},
      layout: {
        snapZone: 'top-center-third',
        bounds: { x: thirdW, y: 0, width: thirdW, height: halfH },
      },
    }

    const targetNew = { x: 0, y: 0, width: thirdW + delta, height: halfH }
    const next = computeSnappedResizeWindows([wA, wB], 'a', targetNew, 'right')
    const nb = next.find((w) => w.id === 'b')?.layout?.bounds
    expect(nb?.x).toBe(thirdW + delta)
    expect(nb?.width).toBe(thirdW - delta)
    expect(nb?.y).toBe(0)
    expect(nb?.height).toBe(halfH)
  })
})

describe('computeSiblingBounds for third layout resize', () => {
  test('resizing top-left-third right edge right shrinks top-center-third and moves it right', () => {
    const viewportWidth = 1200
    const viewportHeight = 800
    const thirdW = Math.round(viewportWidth / 3)
    const halfH = Math.round(viewportHeight / 2)

    const targetOld = { x: 0, y: 0, width: thirdW, height: halfH }
    const delta = 80
    const targetNew = { x: 0, y: 0, width: thirdW + delta, height: halfH }
    const siblingOld = { x: thirdW, y: 0, width: thirdW, height: halfH }

    const result = computeSiblingBounds(
      'top-left-third',
      targetOld,
      targetNew,
      'right',
      'top-center-third',
      siblingOld,
    )

    expect(result.x).toBe(thirdW + delta)
    expect(result.width).toBe(thirdW - delta)
    expect(result.y).toBe(0)
    expect(result.height).toBe(halfH)
  })

  test('resizing top-left-third bottom edge down shrinks bottom-left-third and moves it down', () => {
    const viewportWidth = 1200
    const viewportHeight = 800
    const thirdW = Math.round(viewportWidth / 3)
    const halfH = Math.round(viewportHeight / 2)

    const targetOld = { x: 0, y: 0, width: thirdW, height: halfH }
    const delta = 60
    const targetNew = { x: 0, y: 0, width: thirdW, height: halfH + delta }
    const siblingOld = { x: 0, y: halfH, width: thirdW, height: halfH }

    const result = computeSiblingBounds(
      'top-left-third',
      targetOld,
      targetNew,
      'bottom',
      'bottom-left-third',
      siblingOld,
    )

    expect(result.y).toBe(halfH + delta)
    expect(result.height).toBe(halfH - delta)
    expect(result.x).toBe(0)
    expect(result.width).toBe(thirdW)
  })
})
