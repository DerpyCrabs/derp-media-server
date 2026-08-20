import type { WindowSource as WorkspaceSource } from '@/lib/models/window-model'
import type { PersistedWorkspaceState } from '@/workspace/model/use-workspace'
import { createDefaultBounds, createWindowLayout } from '@/workspace/model/workspace-geometry'
import { createWorkspaceWindowDefinition } from '@/workspace/model/workspace-window-open'

export function buildWorkspaceFromDirParam(
  dirParam: string,
  source: WorkspaceSource,
): PersistedWorkspaceState {
  const definition = createWorkspaceWindowDefinition({
    id: 'workspace-window-1',
    intent: { kind: 'browser', dir: dirParam, source },
    layout: createWindowLayout(undefined, createDefaultBounds(0, 'browser'), 1),
  })
  return {
    workspaceType: 'desktop',
    windows: [definition],
    activeWindowId: 'workspace-window-1',
    activeTabMap: {},
    nextWindowId: 2,
  }
}
