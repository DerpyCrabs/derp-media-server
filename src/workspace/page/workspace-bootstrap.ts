import { isVirtualFolderPath } from '@/lib/files/constants'
import { MediaType } from '@/lib/files/types'
import type { PersistedWorkspaceState, WorkspaceSource } from '@/workspace/model/use-workspace'
import { createDefaultBounds, createWindowLayout } from '@/workspace/model/workspace-geometry'

export function buildWorkspaceFromDirParam(
  dirParam: string,
  source: WorkspaceSource,
): PersistedWorkspaceState {
  return {
    windows: [
      {
        id: 'workspace-window-1',
        type: 'browser',
        title: dirParam.split(/[/\\]/).filter(Boolean).pop() ?? 'Browser 1',
        iconName: null,
        iconPath: dirParam,
        iconType: MediaType.FOLDER,
        iconIsVirtual: isVirtualFolderPath(dirParam),
        source,
        initialState: { dir: dirParam },
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
