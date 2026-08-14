import { DEFAULT_FILESYSTEM_ROOT_ID, filesystemResourceKey } from './domain/resource'
import type { PersistedWorkspaceState } from './use-workspace'
import { createDefaultBounds, createWindowLayout } from './workspace-geometry'

export function defaultInitialBrowserTitle(): string {
  return 'Browser 1'
}

export function defaultPersistedState(): PersistedWorkspaceState {
  return {
    windows: [
      {
        id: 'workspace-window-1',
        title: defaultInitialBrowserTitle(),
        iconName: null,
        contentInstance: {
          id: 'workspace-window-1',
          type: 'explorer',
          location: filesystemResourceKey(DEFAULT_FILESYSTEM_ROOT_ID, ''),
        },
        tabGroupId: null,
        layout: createWindowLayout(undefined, createDefaultBounds(0, 'browser'), 1),
      },
    ],
    activeWindowId: 'workspace-window-1',
    activeTabMap: {},
    nextWindowId: 2,
    pinnedTaskbarItems: [],
  }
}
