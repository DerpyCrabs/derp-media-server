import { view, list } from 'effectweb'
import { WorkspaceDocumentCommands } from '@/workspace/model/workspace-document-commands'
import type { WindowDefinition as WorkspaceWindowDefinition } from '@/lib/models/window-model'
import { ApplicationWindowContent } from '@/workspace/shared/ApplicationWindowContent'
import { WorkspaceWindowChrome } from './layout/WorkspaceWindowChrome'
import type { DesktopWindowGroupModel } from './desktop-window-groups'

export const DesktopWindowGroup = view<DesktopWindowGroupModel>((props) => {
  const gid = props.groupId
  const snap = () => props.snap.model
  const tabs = () => props.members
  const leader = () => tabs()[0]
  const visibleTabId = () => props.visibleTabId
  const tabList = tabs
  const tabIds = () => tabs().map((window) => window.id)
  const splitState = () => props.split
  const renderWindowContent = (
    windowId: string,
    definition: WorkspaceWindowDefinition | undefined,
    visible: boolean,
  ) => {
    return (
      <ApplicationWindowContent
        windowId={windowId}
        definition={definition}
        visible={visible}
        active={props.activeWindowId === windowId}
        editableFolders={props.content.editableFolders}
        knowledgeBases={props.content.knowledgeBases}
        fileIconContext={props.content.fileIconContext}
        actions={props.content.windowActions}
        autoPlayVideo
      />
    )
  }
  return leader() ? (
    <WorkspaceWindowChrome
      window={{
        leaderId: leader()?.id ?? '',
        groupId: gid,
        tabs: tabList,
        visibleTabId,
        isActive: visibleTabId() === props.activeWindowId,
      }}
      environment={{
        fileIconContext: () => props.content.fileIconContext,
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
          props.editable ? snap().actions.restoreDrag(id, x, y) : undefined,
        moveDrag: props.snap.moveDrag,
        endDrag: props.snap.endDrag,
        updateDuringDrag: (id, bounds) =>
          props.editable && snap().actions.updateWindowBounds(id, bounds),
        resizeSnapped: (id, bounds, direction) =>
          props.editable && snap().actions.resizeSnappedWindowBounds(id, bounds, direction),
        updateBounds: (id, bounds) =>
          props.editable && snap().actions.updateWindowBounds(id, bounds),
        beginPointerGesture: props.windows.beginPointerGesture,
      }}
      tabs={{
        activate: props.tabs.activate,
        close: props.tabs.close,
        togglePinned: props.tabs.togglePinned,
        pull: props.tabs.pull,
        splitLeftId: () => splitState()?.leftTabId,
        exitSplit: () => props.onSet((p) => (p ? WorkspaceDocumentCommands.exitSplit(p, gid) : p)),
        useAsSplitLeft: (tabId) =>
          props.onSet((p) => (p ? WorkspaceDocumentCommands.setSplitLeft(p, tabId) : p)),
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
                    tabId === visibleTabId() ? 'workspace-window-visible-content' : undefined
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
})
