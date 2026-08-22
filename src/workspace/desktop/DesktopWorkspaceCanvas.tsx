import type { AssistGridSpan } from '@/workspace/model/workspace-assist-grid'
import { WorkspaceDocumentCommands } from '@/workspace/model/workspace-document-commands'
import type { PersistedWorkspaceState } from '@/workspace/model/use-workspace'
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
import type { Accessor, Setter } from 'solid-js'
import { For, Show, createMemo } from 'solid-js'
import type { FileDragData } from '@/lib/files/file-drag-data'
import type { FileIconContext } from '@/features/explorer/use-file-icon'
import type { WorkspaceWindowActions } from '@/workspace/shared/workspace-window-actions'
import type { WorkspaceSnapDragModel } from '@/workspace/desktop/layout/create-workspace-snap-drag-model'

export type DesktopWorkspaceCanvasProps = {
  empty: { hasWindows: () => boolean; openBrowser: () => void }
  document: {
    state: () => PersistedWorkspaceState | null
    set: Setter<PersistedWorkspaceState | null>
    groupIds: () => string[]
  }
  snap: {
    model: WorkspaceSnapDragModel
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
    editableFolders: () => string[]
    knowledgeBases: () => string[]
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

export function DesktopWorkspaceCanvas(props: DesktopWorkspaceCanvasProps) {
  const snap = () => props.snap.model
  const renderWindowContent = (
    windowId: string | Accessor<string>,
    definition: Accessor<WorkspaceWindowDefinition | undefined>,
    visible: Accessor<boolean>,
  ) => {
    const id = () => (typeof windowId === 'function' ? windowId() : windowId)
    return (
      <ApplicationWindowContent
        windowId={id}
        definition={definition}
        windowState={props.document.state}
        visible={visible}
        active={() => props.document.state()?.activeWindowId === id()}
        editableFolders={props.content.editableFolders}
        knowledgeBases={props.content.knowledgeBases}
        fileIconContext={props.content.fileIconContext}
        actions={props.content.windowActions}
        autoPlayVideo
      />
    )
  }

  return (
    <Show
      when={props.empty.hasWindows()}
      fallback={
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
      }
    >
      <div
        ref={(el) => {
          snap().bindSnapPreview(el ?? null)
        }}
        data-snap-preview
        class='pointer-events-none absolute border-2 border-blue-400/50 bg-blue-500/15 transition-all duration-150'
        style={{ display: 'none', 'z-index': 9000 }}
      />
      <Show when={snap().workspaceAreaNode()}>
        {(_area) => (
          <WorkspaceSnapAssistBar
            visible={snap().snapAssistShown()}
            dragging={snap().dragSnapWindowId() != null}
            onHandleEnter={snap().engageSnapAssistFromHandle}
            onPanelLeave={snap().disengageSnapAssistFromPanel}
            hoverPick={snap().assistHoverPick()}
            rootRef={(el) => {
              snap().bindSnapAssistRoot(el ?? null)
            }}
          />
        )}
      </Show>
      <For each={props.document.groupIds()}>
        {(gid) => {
          const tabs = () => tabsInGroup(props.document.state()?.windows ?? [], gid)
          const leader = () => tabs()[0]
          const visibleTabId = () => {
            const wk = props.document.state()
            if (!wk) return ''
            return resolveGroupVisibleTabId(wk, gid)
          }
          const tabList = () => tabs()
          const tabIds = createMemo(() => tabs().map((w) => w.id))
          const splitState = createMemo(() => {
            const w = props.document.state()
            return w ? getTabGroupSplit(w, gid) : undefined
          })
          return (
            <Show when={leader()}>
              <WorkspaceWindowChrome
                window={{
                  leaderId: leader()!.id,
                  groupId: gid,
                  tabs: tabList,
                  visibleTabId,
                  workspace: props.document.state,
                  isActive: visibleTabId() === props.document.state()?.activeWindowId,
                }}
                environment={{
                  fileIconContext: props.content.fileIconContext,
                  container: snap().getWorkspaceAreaElement,
                  mergeTarget: snap().mergeTargetPreview,
                  draggingWindowId: snap().dragSnapWindowId,
                }}
                commands={{
                  focus: props.windows.focus,
                  close: props.windows.close,
                  minimize: (id) => props.windows.minimize(id, true),
                  toggleFullscreen: props.windows.toggleFullscreen,
                  openLayoutPicker: props.picker.open,
                  restoreDrag: (id, x, y) =>
                    props.snap.canMutate() ? snap().restoreDrag(id, x, y) : undefined,
                  moveDrag: props.snap.moveDrag,
                  endDrag: props.snap.endDrag,
                  updateDuringDrag: (id, bounds) =>
                    props.snap.canMutate() && snap().updateWindowBounds(id, bounds),
                  resizeSnapped: (id, bounds, direction) =>
                    props.snap.canMutate() &&
                    snap().resizeSnappedWindowBounds(id, bounds, direction),
                  updateBounds: (id, bounds) =>
                    props.snap.canMutate() && snap().updateWindowBounds(id, bounds),
                  beginPointerGesture: props.windows.beginPointerGesture,
                }}
                tabs={{
                  activate: props.tabs.activate,
                  close: props.tabs.close,
                  togglePinned: props.tabs.togglePinned,
                  pull: props.tabs.pull,
                  splitLeftId: () => splitState()?.leftTabId,
                  exitSplit: () =>
                    props.document.set((p) =>
                      p ? WorkspaceDocumentCommands.exitSplit(p, gid) : p,
                    ),
                  useAsSplitLeft: (tabId) =>
                    props.document.set((p) =>
                      p ? WorkspaceDocumentCommands.setSplitLeft(p, tabId) : p,
                    ),
                  dropFile: (data, insertIndex) =>
                    props.tabs.dropFile(leader()!.id, data, insertIndex),
                }}
              >
                <Show
                  when={splitState()}
                  fallback={
                    <For each={tabIds()}>
                      {(tabId) => {
                        const windowDef = createMemo(() => tabs().find((w) => w.id === tabId))
                        return (
                          <div
                            data-testid={
                              tabId === visibleTabId()
                                ? 'workspace-window-visible-content'
                                : undefined
                            }
                            class={`workspace-window-content relative h-full min-h-0 flex-1 overflow-hidden text-sm text-muted-foreground ${
                              tabId === visibleTabId() ? '' : 'hidden'
                            }`}
                            aria-hidden={tabId !== visibleTabId() ? 'true' : 'false'}
                          >
                            {renderWindowContent(tabId, windowDef, () => tabId === visibleTabId())}
                          </div>
                        )
                      }}
                    </For>
                  }
                >
                  {(split) => {
                    const leftTabId = () => split().leftTabId
                    const leftWindowDef = createMemo(() => tabs().find((w) => w.id === leftTabId()))
                    const rightWindowDef = createMemo(() =>
                      tabs().find((w) => w.id === visibleTabId()),
                    )
                    return (
                      <div class='flex h-full min-h-0 min-w-0 flex-1 flex-row'>
                        <div
                          data-testid='workspace-split-left-pane'
                          class='workspace-window-content relative min-h-0 min-w-0 flex flex-col overflow-hidden text-sm text-muted-foreground'
                          style={{
                            width: `${split().leftPaneFraction * 100}%`,
                          }}
                        >
                          {renderWindowContent(leftTabId, leftWindowDef, () => true)}
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
                          <div
                            data-testid='workspace-window-visible-content'
                            class='h-full min-h-0'
                          >
                            {renderWindowContent(visibleTabId, rightWindowDef, () => true)}
                          </div>
                        </div>
                      </div>
                    )
                  }}
                </Show>
              </WorkspaceWindowChrome>
            </Show>
          )
        }}
      </For>
      <Show when={props.picker.state()}>
        {(get) => {
          const p = get()
          const c = snap().getWorkspaceAreaElement()
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
        }}
      </Show>
    </Show>
  )
}
