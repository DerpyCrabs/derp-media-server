import { describe, expect, test } from 'bun:test'
import {
  createLinkedWorkspaceSnapshot,
  parseWorkspaceCreationLink,
} from '@/workspace/model/workspace-creation-link'

describe('workspace creation links', () => {
  test('parses the requested type and trimmed optional name', () => {
    expect(parseWorkspaceCreationLink(new URLSearchParams('new=canvas&name=%20Studio%20'))).toEqual(
      {
        type: 'canvas',
        name: 'Studio',
      },
    )
    expect(parseWorkspaceCreationLink(new URLSearchParams('new=desktop'))).toEqual({
      type: 'desktop',
    })
    expect(parseWorkspaceCreationLink(new URLSearchParams('new=other&name=Ignored'))).toBeNull()
  })

  test('creates canonical desktop and canvas snapshots', () => {
    const desktop = createLinkedWorkspaceSnapshot('desktop')
    expect(desktop.workspaceType).toBe('desktop')
    expect(desktop.canvas).toBeUndefined()

    const canvas = createLinkedWorkspaceSnapshot('canvas')
    expect(canvas.workspaceType).toBe('canvas')
    expect(canvas.canvas).toEqual({
      camera: { x: 0, y: 0, zoom: 1 },
      maximizedWindowId: null,
      windowSizeByType: {},
      nextZIndex: 2,
    })
  })
})
