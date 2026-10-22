import type { PersistedWorkspaceState } from '@/workspace/model/workspace'
import type { WindowDefinition, TabGroupSplitState } from '@/lib/models/window-model'
import { resolveGroupVisibleTabId } from '@/workspace/tabs/tab-group-ops'
import { workspaceWindowsByGroupId } from './layout/merge-target'
import type { WorkspaceWindowChromeProps } from './layout/WorkspaceWindowChrome'
import type { WorkspaceSnapDragModel } from './layout/create-workspace-snap-drag-model'
import type { WorkspaceWindowActions } from '@/workspace/shared/workspace-window-actions'
import type { FileIconContext } from '@/features/explorer/file-icon'
import type { FileDragData } from '@/lib/files/file-drag-data'
export type DesktopSnapActions = Pick<
  WorkspaceSnapDragModel,
  | 'bindWorkspaceAreaRoot'
  | 'bindSnapPreview'
  | 'bindSnapAssistRoot'
  | 'engageSnapAssistFromHandle'
  | 'disengageSnapAssistFromPanel'
  | 'restoreDrag'
  | 'updateWindowBounds'
  | 'resizeSnappedWindowBounds'
  | 'setTilingPickerHoverPreview'
>

export type DesktopGroupEnvironment = {
  editable: boolean
  onSet: (
    value:
      | PersistedWorkspaceState
      | null
      | ((current: PersistedWorkspaceState | null) => PersistedWorkspaceState | null),
  ) => unknown
  content: {
    editableFolders: readonly string[]
    knowledgeBases: readonly string[]
    fileIconContext: FileIconContext
    windowActions: WorkspaceWindowActions
  }
  windows: Pick<
    WorkspaceWindowChromeProps['commands'],
    'focus' | 'close' | 'toggleFullscreen' | 'beginPointerGesture'
  > & { minimize: (id: string, minimized: boolean) => void }
  tabs: Required<
    Pick<WorkspaceWindowChromeProps['tabs'], 'activate' | 'close' | 'togglePinned' | 'pull'>
  > & {
    dropFile: (targetLeaderWindowId: string, data: FileDragData, insertIndex?: number) => void
    startSplitDrag: (groupId: string, event: PointerEvent) => void
  }
  picker: { open: WorkspaceWindowChromeProps['commands']['openLayoutPicker'] }
  snap: {
    model: Pick<
      ReturnType<WorkspaceSnapDragModel['source']['model']> & { actions: DesktopSnapActions },
      'workspaceAreaNode' | 'mergeTargetPreview' | 'dragSnapWindowId' | 'actions'
    >
    moveDrag: WorkspaceWindowChromeProps['commands']['moveDrag']
    endDrag: WorkspaceWindowChromeProps['commands']['endDrag']
  }
}
export type DesktopWindowGroupModel = DesktopGroupEnvironment & {
  groupId: string
  members: readonly WindowDefinition[]
  visibleTabId: string
  activeWindowId: string | null
  split: TabGroupSplitState | undefined
}

export function desktopWindowGroups(
  document: PersistedWorkspaceState | null,
  environment: DesktopGroupEnvironment,
  previous: readonly DesktopWindowGroupModel[] = [],
): readonly DesktopWindowGroupModel[] {
  if (!document) return previous.length ? [] : previous
  const prior = new Map(previous.map((group) => [group.groupId, group]))
  const groups = [...workspaceWindowsByGroupId(document.windows)].map(([groupId, members]) => {
    const old = prior.get(groupId)
    const sameMembers =
      old?.members.length === members.length &&
      members.every((member, index) => member === old.members[index])
    const activeWindowId = members.some((window) => window.id === document.activeWindowId)
      ? document.activeWindowId
      : null
    const visibleTabId = resolveGroupVisibleTabId({ ...document, windows: members }, groupId)
    const split = document.tabGroupSplits?.[groupId]
    // Merge hints affect only their destination and the dragged group, not every window.
    const merge = environment.snap.model.mergeTargetPreview
    const dragging = members.some((window) => window.id === environment.snap.model.dragSnapWindowId)
    const relevantMerge = merge && (merge.groupId === groupId || dragging) ? merge : null
    const draggingId = dragging ? environment.snap.model.dragSnapWindowId : null
    if (
      old &&
      sameMembers &&
      old.activeWindowId === activeWindowId &&
      old.visibleTabId === visibleTabId &&
      old.split === split &&
      old.editable === environment.editable &&
      old.onSet === environment.onSet &&
      old.content === environment.content &&
      old.windows === environment.windows &&
      old.tabs === environment.tabs &&
      old.picker === environment.picker &&
      old.snap.model.workspaceAreaNode === environment.snap.model.workspaceAreaNode &&
      old.snap.model.actions === environment.snap.model.actions &&
      old.snap.model.mergeTargetPreview === relevantMerge &&
      old.snap.model.dragSnapWindowId === draggingId &&
      old.snap.moveDrag === environment.snap.moveDrag &&
      old.snap.endDrag === environment.snap.endDrag
    )
      return old
    return {
      ...environment,
      groupId,
      members: sameMembers ? old.members : members,
      activeWindowId,
      visibleTabId,
      split,
      snap: {
        ...environment.snap,
        model: {
          ...environment.snap.model,
          mergeTargetPreview: relevantMerge,
          dragSnapWindowId: draggingId,
        },
      },
    }
  })
  return groups.length === previous.length &&
    groups.every((group, index) => group === previous[index])
    ? previous
    : groups
}
