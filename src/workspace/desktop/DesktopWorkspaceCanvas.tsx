import { view, list, domBinding, type Snapshot } from 'effectweb'
import type { AssistGridSpan } from '@/workspace/model/workspace-assist-grid'
import { WorkspaceDocumentCommands } from '@/workspace/model/workspace-document-commands'
import type { PersistedWorkspaceState } from '@/workspace/model/workspace'
import type { WindowDefinition as WorkspaceWindowDefinition } from '@/lib/models/window-model'
import {
  getTabGroupSplit,
  resolveGroupVisibleTabId,
  tabsInGroup,
} from '@/workspace/tabs/tab-group-ops'
import { ApplicationWindowContent } from '@/workspace/shared/ApplicationWindowContent'
import {
  WorkspaceWindowChrome,
  type WorkspaceBounds,
  type WorkspacePointerGesture,
} from '@/workspace/desktop/layout/WorkspaceWindowChrome'
import { WorkspaceSnapAssistBar } from '@/workspace/desktop/layout/WorkspaceSnapAssistBar'
import { WorkspaceTilingPicker } from '@/workspace/desktop/layout/WorkspaceTilingPicker'
type Setter<T> = (value: T | ((current: T) => T)) => unknown

import type { FileDragData } from '@/lib/files/file-drag-data'
import type { FileIconContext } from '@/features/explorer/file-icon'
import type { WorkspaceWindowActions } from '@/workspace/shared/workspace-window-actions'
import type { WorkspaceSnapDragModel } from '@/workspace/desktop/layout/create-workspace-snap-drag-model'
export type DesktopWorkspaceCanvasProps = {
  empty: { hasWindows: () => boolean; openBrowser: () => void }
  document: {
    state: () => PersistedWorkspaceState | null
    onSet: Setter<PersistedWorkspaceState | null>
    groupIds: () => readonly string[]
  }
  snap: {
    model: ReturnType<WorkspaceSnapDragModel['source']['model']> & {
      actions: Pick<
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
    }
    canMutate: () => boolean
    moveDrag: (windowId: string, clientX: number, clientY: number) => void
    endDrag: (windowId: string, bounds: WorkspaceBounds, clientX: number, clientY: number) => void
  }
  picker: {
    state: () => { windowId: string; anchor: DOMRect } | null
    close: () => void
    pick: (windowId: string, span: AssistGridSpan) => void
    setHover: (span: AssistGridSpan | null) => void
    open: (windowId: string, anchor: DOMRect) => void
  }
  content: {
    editableFolders: () => readonly string[]
    knowledgeBases: () => readonly string[]
    fileIconContext: () => FileIconContext
    windowActions: WorkspaceWindowActions
  }
  windows: {
    focus: (windowId: string) => void
    close: (windowId: string) => void
    minimize: (windowId: string, minimized: boolean) => void
    toggleFullscreen: (windowId: string) => void
    beginPointerGesture: () => WorkspacePointerGesture
  }
  tabs: {
    activate: (groupId: string, tabId: string) => void
    close: (tabId: string, opts?: { ignoreTabPinForListenOnlyDismiss?: boolean }) => void
    togglePinned: (tabId: string) => void
    pull: (groupId: string, tabId: string, e: PointerEvent) => void
    dropFile: (targetLeaderWindowId: string, data: FileDragData, insertIndex?: number) => void
    startSplitDrag: (groupId: string, e: PointerEvent) => void
  }
}
export const DesktopWorkspaceCanvas = view<DesktopWorkspaceCanvasProps>((props) => {
  const snap = () => props.snap.model
  const renderWindowContent = (
    windowId: string,
    definition: Snapshot<WorkspaceWindowDefinition> | undefined,
    visible: boolean,
  ) => {
    return (
      <ApplicationWindowContent
        windowId={windowId}
        definition={definition}
        visible={visible}
        active={props.document.state()?.activeWindowId === windowId}
        editableFolders={props.content.editableFolders()}
        knowledgeBases={props.content.knowledgeBases()}
        fileIconContext={props.content.fileIconContext()}
        actions={props.content.windowActions}
        autoPlayVideo
      />
    )
  }
  return props.empty.hasWindows() ? (
    <>
      <div
        use={domBinding(snap().actions.bindSnapPreview, previewBinding)}
        data-snap-preview
        class='pointer-events-none absolute border-2 border-blue-400/50 bg-blue-500/15 transition-all duration-150'
      />
      {((_area) =>
        _area ? (
          <WorkspaceSnapAssistBar
            visible={snap().snapAssistShown}
            dragging={snap().dragSnapWindowId != null}
            onHandleEnter={snap().actions.engageSnapAssistFromHandle}
            onPanelLeave={snap().actions.disengageSnapAssistFromPanel}
            hoverPick={snap().assistHoverPick}
            rootRef={(el) => {
              snap().actions.bindSnapAssistRoot(el ?? null)
            }}
          />
        ) : null)(snap().workspaceAreaNode)}
      {list(
        props.document.groupIds(),
        (id) => id,
        (gid) => {
          const state = props.document.state()
          const groupTabs = tabsInGroup(state?.windows ?? [], gid)
          const tabs = () => groupTabs
          const leader = () => tabs()[0]
          const activeTabId = state ? resolveGroupVisibleTabId(state, gid) : ''
          const visibleTabId = () => activeTabId
          const tabList = () => tabs()
          const tabIds = () => tabs().map((w) => w.id)
          const split = state ? getTabGroupSplit(state, gid) : undefined
          const splitState = () => split
          return leader() ? (
            <WorkspaceWindowChrome
              window={{
                leaderId: leader()?.id ?? '',
                groupId: gid,
                tabs: tabList,
                visibleTabId,
                workspace: props.document.state,
                isActive: visibleTabId() === props.document.state()?.activeWindowId,
              }}
              environment={{
                fileIconContext: props.content.fileIconContext,
                container: () => snap().workspaceAreaNode ?? undefined,
                mergeTarget: () => snap().mergeTargetPreview,
                draggingWindowId: () => snap().dragSnapWindowId,
              }}
              commands={{
                focus: props.windows.focus,
                close: props.windows.close,
                minimize: (id) => props.windows.minimize(id, true),
                toggleFullscreen: props.windows.toggleFullscreen,
                openLayoutPicker: props.picker.open,
                restoreDrag: (id, x, y) =>
                  props.snap.canMutate() ? snap().actions.restoreDrag(id, x, y) : undefined,
                moveDrag: props.snap.moveDrag,
                endDrag: props.snap.endDrag,
                updateDuringDrag: (id, bounds) =>
                  props.snap.canMutate() && snap().actions.updateWindowBounds(id, bounds),
                resizeSnapped: (id, bounds, direction) =>
                  props.snap.canMutate() &&
                  snap().actions.resizeSnappedWindowBounds(id, bounds, direction),
                updateBounds: (id, bounds) =>
                  props.snap.canMutate() && snap().actions.updateWindowBounds(id, bounds),
                beginPointerGesture: props.windows.beginPointerGesture,
              }}
              tabs={{
                activate: props.tabs.activate,
                close: props.tabs.close,
                togglePinned: props.tabs.togglePinned,
                pull: props.tabs.pull,
                splitLeftId: () => splitState()?.leftTabId,
                exitSplit: () =>
                  props.document.onSet((p) =>
                    p ? WorkspaceDocumentCommands.exitSplit(p, gid) : p,
                  ),
                useAsSplitLeft: (tabId) =>
                  props.document.onSet((p) =>
                    p ? WorkspaceDocumentCommands.setSplitLeft(p, tabId) : p,
                  ),
                dropFile: (data, insertIndex) => {
                  const currentLeader = leader()
                  if (currentLeader) props.tabs.dropFile(currentLeader.id, data, insertIndex)
                },
              }}
            >
              {((split) => {
                if (!split)
                  return list(
                    tabIds(),
                    (id) => id,
                    (tabId) => {
                      const windowDef = () => tabs().find((w) => w.id === tabId)
                      return (
                        <div
                          data-testid={
                            tabId === visibleTabId()
                              ? 'workspace-window-visible-content'
                              : undefined
                          }
                          class={`workspace-window-content relative h-full min-h-0 flex-1 overflow-hidden text-sm text-muted-foreground ${tabId === visibleTabId() ? '' : 'hidden'}`}
                          aria-hidden={tabId !== visibleTabId() ? 'true' : 'false'}
                        >
                          {renderWindowContent(tabId, windowDef(), tabId === visibleTabId())}
                        </div>
                      )
                    },
                  )

                const leftTabId = () => split.leftTabId
                const leftWindowDef = () => tabs().find((w) => w.id === leftTabId())
                const rightWindowDef = () => tabs().find((w) => w.id === visibleTabId())
                return (
                  <div class='flex h-full min-h-0 min-w-0 flex-1 flex-row'>
                    <div
                      data-testid='workspace-split-left-pane'
                      class='workspace-window-content relative min-h-0 min-w-0 flex flex-col overflow-hidden text-sm text-muted-foreground'
                      style={{ width: `${split.leftPaneFraction * 100}%` }}
                    >
                      {renderWindowContent(leftTabId(), leftWindowDef(), true)}
                    </div>
                    <div
                      data-testid='workspace-split-divider'
                      data-no-window-drag
                      class='w-1.5 shrink-0 cursor-col-resize border-border bg-muted/40 hover:bg-primary/25'
                      style={{ 'border-left-width': '1px', 'border-right-width': '1px' }}
                      onPointerDown={(e) => props.tabs.startSplitDrag(gid, e)}
                    />
                    <div
                      data-testid='workspace-split-right-pane'
                      class='workspace-window-content relative h-full min-h-0 min-w-0 flex-1 overflow-hidden text-sm text-muted-foreground'
                    >
                      <div data-testid='workspace-window-visible-content' class='h-full min-h-0'>
                        {renderWindowContent(visibleTabId(), rightWindowDef(), true)}
                      </div>
                    </div>
                  </div>
                )
              })(splitState())}
            </WorkspaceWindowChrome>
          ) : null
        },
      )}
      {((p) => {
        if (!p) return null

        const c = snap().workspaceAreaNode
        if (!c) return null
        return (
          <WorkspaceTilingPicker
            anchorRect={p.anchor}
            container={c}
            onSelectSpan={(span) => props.picker.pick(p.windowId, span)}
            onClose={props.picker.close}
            onHoverSpanChange={props.picker.setHover}
          />
        )
      })(props.picker.state())}
    </>
  ) : (
    <div class='flex h-full items-center justify-center p-6'>
      <div class='w-full max-w-md rounded-xl border border-border bg-card/95 p-8 text-center shadow-2xl backdrop-blur'>
        <div class='space-y-3'>
          <div class='text-lg font-medium'>No windows are open</div>
          <div class='text-sm text-muted-foreground'>
            Start a browser window to build your workspace.
          </div>
          <button
            type='button'
            class='inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90'
            onClick={props.empty.openBrowser}
          >
            Open Browser
          </button>
        </div>
      </div>
    </div>
  )
})

const previewBinding = (
  element: HTMLDivElement,
  current: () => (element: HTMLDivElement | null) => void,
) => {
  element.style.display = 'none'
  element.style.zIndex = '9000'
  current()(element)
  return () => current()(null)
}
