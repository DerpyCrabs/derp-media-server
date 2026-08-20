import { describe, expect, test } from 'bun:test'
import { applyWorkspacePathMutation } from '@/workspace/model/workspace-path-mutation'
import { parsePathMutation, type PathMutation } from '@/lib/files/path-mutation'
import type { PersistedWorkspaceState } from '@/workspace/model/use-workspace'
import type { WindowDefinition as WorkspaceWindowDefinition } from '@/lib/models/window-model'

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
    workspaceType: 'desktop',
    windows,
    activeWindowId: windows[0]?.id ?? null,
    activeTabMap: {},
    nextWindowId: windows.length + 1,
  }
}

describe('workspace path mutations', () => {
  test('accepts only complete path mutation events', () => {
    expect(
      parsePathMutation({
        type: 'path-moved',
        oldPath: 'Old',
        newPath: 'New',
      }),
    ).toEqual({ type: 'path-moved', oldPath: 'Old', newPath: 'New' })
    expect(parsePathMutation({ type: 'path-moved', oldPath: 'Old' })).toBeNull()
    expect(parsePathMutation({ type: 'files-changed', path: 'Old' })).toBeNull()
  })

  test('moves live local paths', () => {
    const local = window(
      'local',
      'viewer',
      { dir: 'Media/Old', viewing: 'Media/Old/movie.mp4' },
      'Media/Old/movie.mp4',
    )
    const before = state([local])
    const mutation: PathMutation = {
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
      workspaceType: 'canvas',
      activeWindowId: 'deleted',
      activeTabMap: { group: 'deleted' },
      tabGroupSplits: { group: { leftTabId: 'deleted', leftPaneFraction: 0.5 } },
      canvas: {
        camera: { x: 0, y: 0, zoom: 1 },
        maximizedWindowId: 'deleted',
        windowSizeByType: {},
        nextZIndex: 3,
      },
    }

    const next = applyWorkspacePathMutation(before, {
      type: 'path-removed',
      path: 'Media/Old',
    })

    expect(next.windows.map((item) => item.id)).toEqual(['retained'])
    expect(next.windows[0]?.tabGroupId).toBeNull()
    expect(next.activeWindowId).toBe('retained')
    expect(next.activeTabMap).toEqual({})
    expect(next.tabGroupSplits).toBeUndefined()
    expect(next.canvas?.maximizedWindowId).toBeNull()
  })
})
