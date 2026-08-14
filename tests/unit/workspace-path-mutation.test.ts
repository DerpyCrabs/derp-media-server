import { describe, expect, test } from 'bun:test'
import {
  applyCanvasPathMutation,
  applyWorkspacePathMutation,
  parseWorkspacePathMutation,
  type WorkspacePathMutation,
} from '@/lib/workspace-path-mutation'
import { createEmptyCanvasState } from '@/lib/infinite-canvas'
import type { PersistedWorkspaceState, WorkspaceWindowDefinition } from '@/lib/use-workspace'
import {
  FILESYSTEM_APPLICATION_COLLECTION_ROOT_ID,
  filesystemResourceAddress,
  filesystemResourceKey,
} from '@/lib/domain/resource'

function explorerWindow(
  id: string,
  path: string,
  tabGroupId: string | null = null,
): WorkspaceWindowDefinition {
  return {
    id,
    title: id,
    contentInstance: {
      id,
      type: 'explorer',
      location: filesystemResourceKey('configured-default', path),
    },
    tabGroupId,
  }
}

function resourceWindow(
  id: string,
  path: string,
  context?: string,
  tabGroupId: string | null = null,
): WorkspaceWindowDefinition {
  return {
    id,
    title: id,
    contentInstance: {
      id,
      type: 'resource',
      resource: filesystemResourceKey('configured-default', path),
      renderer: 'image-viewer',
      ...(context ? { context: filesystemResourceKey('configured-default', context) } : {}),
    },
    tabGroupId,
  }
}

function resourcePath(window: WorkspaceWindowDefinition | undefined): string | null {
  const content = window?.contentInstance
  return content?.type === 'resource'
    ? (filesystemResourceAddress(content.resource)?.path ?? null)
    : null
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

  test('moves authoritative resource, context, and pin keys', () => {
    const local = resourceWindow('local', 'Media/Old/movie.mp4', 'Media/Old')
    const before = {
      ...state([local]),
      pinnedTaskbarItems: [
        {
          id: 'pin',
          resource: filesystemResourceKey('configured-default', 'Media/Old/sub'),
          title: 'Old',
        },
      ],
    }
    const mutation: WorkspacePathMutation = {
      type: 'path-moved',
      oldPath: 'Media/Old',
      newPath: 'Archive/New',
    }

    const next = applyWorkspacePathMutation(before, mutation)
    const content = next.windows[0]?.contentInstance

    expect(resourcePath(next.windows[0])).toBe('Archive/New/movie.mp4')
    expect(
      content?.type === 'resource' && content.context
        ? filesystemResourceAddress(content.context)?.path
        : null,
    ).toBe('Archive/New')
    expect(filesystemResourceAddress(next.pinnedTaskbarItems[0]!.resource)?.path).toBe(
      'Archive/New/sub',
    )
  })

  test('clears a removed context without removing a resource outside it', () => {
    const viewer = resourceWindow('viewer', 'Media/current.jpg', 'Media/deleted')
    const next = applyWorkspacePathMutation(state([viewer]), {
      type: 'path-removed',
      path: 'Media/deleted',
    })

    expect(next.windows).toHaveLength(1)
    expect(resourcePath(next.windows[0])).toBe('Media/current.jpg')
    expect(next.windows[0]?.contentInstance).not.toHaveProperty('context')
  })

  test('removes windows on deleted resource paths and repairs group focus', () => {
    const deleted = explorerWindow('deleted', 'Media/Old', 'group')
    const retained = resourceWindow('retained', 'Media/current.jpg', undefined, 'group')
    const before: PersistedWorkspaceState = {
      ...state([deleted, retained]),
      activeWindowId: 'deleted',
      activeTabMap: { group: 'deleted' },
      tabGroupSplits: { group: { leftTabId: 'deleted', leftPaneFraction: 0.5 } },
      pinnedTaskbarItems: [
        {
          id: 'pin',
          resource: filesystemResourceKey('configured-default', 'Media/Old'),
          title: 'Old',
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

  test('updates canvas content keys and clears a removed maximized window', () => {
    const definition = resourceWindow('viewer', 'Media/Old/current.jpg')
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
    expect(resourcePath(moved.windows[0]?.definition)).toBe('Media/New/current.jpg')

    const removed = applyCanvasPathMutation(moved, {
      type: 'path-removed',
      path: 'Media/New',
    })
    expect(removed.windows).toEqual([])
    expect(removed.maximizedWindowId).toBeNull()
  })

  test('preserves resource roots and ignores virtual collection path collisions', () => {
    const physical = resourceWindow('physical', 'favorites/current.jpg')
    physical.contentInstance = {
      id: physical.id,
      type: 'resource',
      resource: filesystemResourceKey('secondary', 'favorites/current.jpg'),
      renderer: 'image-viewer',
    }
    const favorites: WorkspaceWindowDefinition = {
      id: 'favorites',
      title: 'Favorites',
      contentInstance: {
        id: 'favorites',
        type: 'explorer',
        location: filesystemResourceKey(FILESYSTEM_APPLICATION_COLLECTION_ROOT_ID, 'favorites'),
      },
    }
    const before = {
      ...state([physical, favorites]),
      pinnedTaskbarItems: [
        {
          id: 'favorites-pin',
          resource: filesystemResourceKey(FILESYSTEM_APPLICATION_COLLECTION_ROOT_ID, 'favorites'),
          title: 'Favorites',
        },
      ],
    }

    const moved = applyWorkspacePathMutation(before, {
      type: 'path-moved',
      oldPath: 'favorites',
      newPath: 'Archive/favorites',
    })
    const movedContent = moved.windows[0]?.contentInstance
    expect(
      movedContent?.type === 'resource' ? filesystemResourceAddress(movedContent.resource) : null,
    ).toEqual({ rootId: 'secondary', path: 'Archive/favorites/current.jpg' })
    expect(moved.windows[1]).toBe(favorites)
    expect(moved.pinnedTaskbarItems).toEqual(before.pinnedTaskbarItems)

    const removed = applyWorkspacePathMutation(moved, {
      type: 'path-removed',
      path: 'favorites',
    })
    expect(removed.windows.some((window) => window.id === 'favorites')).toBe(true)
    expect(removed.pinnedTaskbarItems).toEqual(before.pinnedTaskbarItems)
  })
})
