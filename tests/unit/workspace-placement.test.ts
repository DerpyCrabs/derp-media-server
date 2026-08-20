import { describe, expect, test } from 'bun:test'
import {
  cascadeWorkspaceBounds,
  clampWorkspaceBoundsToViewport,
} from '@/workspace/model/workspace-placement'

describe('workspace placement', () => {
  test('cascades bounds inside viewport', () => {
    expect(cascadeWorkspaceBounds(2, { width: 800, height: 600 })).toEqual({
      x: 48,
      y: 48,
      width: 720,
      height: 520,
    })
  })

  test('clamps oversized bounds to a small viewport', () => {
    expect(
      clampWorkspaceBoundsToViewport(
        { x: -20, y: 60, width: 900, height: 700 },
        { width: 280, height: 190 },
      ),
    ).toEqual({ x: 0, y: 0, width: 280, height: 190 })
  })
})
