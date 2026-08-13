import { describe, expect, test } from 'bun:test'
import {
  applyCanvasPathMutation,
  applyWorkspacePathMutation,
  parseWorkspacePathMutation,
  type WorkspacePathMutation,
} from '@/lib/workspace-path-mutation'
import { createEmptyCanvasState } from '@/lib/infinite-canvas'
import type { PersistedWorkspaceState, WorkspaceWindowDefinition } from '@/lib/use-workspace'

function window(
  id: string,
  type: WorkspaceWindowDefinition['type'],
  initialState: WorkspaceWindowDefinition['initialState'],
  iconPath: string,
  tabGroupId: string | null = null,
): WorkspaceWindowDefinition {
  return {
    id,
    type,
    title: id,
    iconPath,
    source: { kind: 'local' },
    initialState,
    tabGroupId,
  }
}

function state(windows: WorkspaceWindowDefinition[]): PersistedWorkspaceState {
  return {
    windows,
    activeWindowId: windows[0]?.id ?? null,
    activeTabMap: {},
    nextWindowId: windows.length + 1,
    pinnedTaskbarItems: [],
  }
}

describe('workspace path mutations', () => {
  test('accepts only complete path mutation events', () => {
    expect(
      parseWorkspacePathMutation({
        type: 'path-moved',
        oldPath: 'Old',
        newPath: 'New',
      }),
    ).toEqual({ type: 'path-moved', oldPath: 'Old', newPath: 'New' })
    expect(parseWorkspacePathMutation({ type: 'path-moved', oldPath: 'Old' })).toBeNull()
    expect(parseWorkspacePathMutation({ type: 'files-changed', path: 'Old' })).toBeNull()
  })

  test('moves live local paths and pins', () => {
    const local = window(
      'local',
      'viewer',
      { dir: 'Media/Old', viewing: 'Media/Old/movie.mp4' },
      'Media/Old/movie.mp4',
    )
    const before = {
      ...state([local]),
      pinnedTaskbarItems: [
        {
          id: 'pin',
          path: 'Media/Old/sub',
          isDirectory: true,
          title: 'Old',
          source: { kind: 'local' as const },
        },
      ],
    }
    const mutation: WorkspacePathMutation = {
      type: 'path-moved',
      oldPath: 'Media/Old',
      newPath: 'Archive/New',
    }

    const next = applyWorkspacePathMutation(before, mutation)

    expect(next.windows[0]?.initialState).toEqual({
      dir: 'Archive/New',
      viewing: 'Archive/New/movie.mp4',
    })
    expect(next.windows[0]?.iconPath).toBe('Archive/New/movie.mp4')
    expect(next.pinnedTaskbarItems[0]?.path).toBe('Archive/New/sub')
  })

  test('stale icon deletion does not remove viewer with another current file', () => {
    const viewer = window(
      'viewer',
      'viewer',
      { dir: 'Media', viewing: 'Media/current.jpg' },
      'Media/deleted.jpg',
    )

    const next = applyWorkspacePathMutation(state([viewer]), {
      type: 'path-removed',
      path: 'Media/deleted.jpg',
    })

    expect(next.windows).toHaveLength(1)
    expect(next.windows[0]?.initialState.viewing).toBe('Media/current.jpg')
    expect(next.windows[0]?.iconPath).toBeNull()
  })

  test('removes windows on deleted semantic paths and repairs group focus', () => {
    const deleted = window('deleted', 'browser', { dir: 'Media/Old' }, 'Media/Old', 'group')
    const retained = window(
      'retained',
      'viewer',
      { viewing: 'Media/current.jpg' },
      'Media/current.jpg',
      'group',
    )
    const before: PersistedWorkspaceState = {
      ...state([deleted, retained]),
      activeWindowId: 'deleted',
      activeTabMap: { group: 'deleted' },
      tabGroupSplits: { group: { leftTabId: 'deleted', leftPaneFraction: 0.5 } },
      pinnedTaskbarItems: [
        {
          id: 'pin',
          path: 'Media/Old',
          isDirectory: true,
          title: 'Old',
          source: { kind: 'local' },
        },
      ],
    }

    const next = applyWorkspacePathMutation(before, {
      type: 'path-removed',
      path: 'Media/Old',
    })

    expect(next.windows.map((item) => item.id)).toEqual(['retained'])
    expect(next.activeWindowId).toBe('retained')
    expect(next.activeTabMap).toEqual({ group: 'retained' })
    expect(next.tabGroupSplits).toBeUndefined()
    expect(next.pinnedTaskbarItems).toEqual([])
  })

  test('updates canvas definitions and clears removed maximized window', () => {
    const definition = window(
      'viewer',
      'viewer',
      { viewing: 'Media/Old/current.jpg' },
      'Media/Old/current.jpg',
    )
    const before = {
      ...createEmptyCanvasState(),
      windows: [
        {
          id: 'viewer',
          definition,
          bounds: { x: 0, y: 0, width: 320, height: 224 },
          zIndex: 1,
        },
      ],
      maximizedWindowId: 'viewer',
    }

    const moved = applyCanvasPathMutation(before, {
      type: 'path-moved',
      oldPath: 'Media/Old',
      newPath: 'Media/New',
    })
    expect(moved.windows[0]?.definition.initialState.viewing).toBe('Media/New/current.jpg')

    const removed = applyCanvasPathMutation(moved, {
      type: 'path-removed',
      path: 'Media/New',
    })
    expect(removed.windows).toEqual([])
    expect(removed.maximizedWindowId).toBeNull()
  })
})
