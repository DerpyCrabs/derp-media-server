import type { AssistGridSpan } from '@/workspace/model/workspace-assist-grid'
import type { AssistSlotPick } from '@/workspace/model/workspace-snap-pick'
import { setSplitLeftTabFromContextState, exitSplitViewState } from '@/workspace/tabs/tab-group-ops'
import type {
  PersistedWorkspaceState,
  TabGroupSplitState,
  WorkspaceSource,
  WorkspaceWindowDefinition,
} from '@/workspace/model/use-workspace'
import type { FileItem } from '@/lib/files/types'
import {
  getTabGroupSplit,
  resolveGroupVisibleTabId,
  tabsInGroup,
} from '@/workspace/tabs/tab-group-ops'
import { ApplicationWindowContent } from '@/features/panes/ApplicationWindowContent'
import {
  WorkspaceWindowChrome,
  type WorkspaceBounds,
} from '@/workspace/layout/WorkspaceWindowChrome'
import { WorkspaceSnapAssistBar } from '@/workspace/layout/WorkspaceSnapAssistBar'
import { WorkspaceTilingPicker } from '@/workspace/layout/WorkspaceTilingPicker'
import type { Accessor, Setter } from 'solid-js'
import { For, Show, createMemo } from 'solid-js'
import type { MergeTarget } from '@/workspace/layout/merge-target'
import type { FileDragData } from '@/lib/files/file-drag-data'
import type { FileIconContext } from '@/features/explorer/use-file-icon'
import type { VirtualOpenTarget } from '@/lib/files/virtual-directory'

export type WorkspacePageCanvasProps = {
  hasWorkspaceWindows: () => boolean
  onOpenBrowser: () => void
  bindSnapPreview: (el: HTMLDivElement | null) => void
  workspaceAreaNode: () => HTMLDivElement | null
  getWorkspaceAreaElement: () => HTMLDivElement | undefined
  snapAssistShown: () => boolean
  engageSnapAssistFromHandle: () => void
  disengageSnapAssistFromPanel: () => void
  assistHoverPick: () => AssistSlotPick | null
  bindSnapAssistRoot: (el: HTMLDivElement | null) => void
  renderedGroupIds: () => string[]
  workspace: () => PersistedWorkspaceState | null
  setWorkspace: Setter<PersistedWorkspaceState | null>
  mergeTargetPreview: () => MergeTarget | null
  dragSnapWindowId: () => string | null
  layoutPicker: () => { windowId: string; anchor: DOMRect } | null
  closeLayoutPicker: () => void
  onTilingPick: (windowId: string, span: AssistGridSpan) => void
  setTilingPickerHoverPreview: (span: AssistGridSpan | null) => void
  openLayoutPicker: (windowId: string, anchor: DOMRect) => void
  editableFolders: () => string[]
  knowledgeBases: () => string[]
  workspaceFileIconContext: () => FileIconContext
  focusWindow: (windowId: string) => void
  closeWindow: (windowId: string) => void
  setWindowMinimized: (windowId: string, minimized: boolean) => void
  toggleFullscreenWindow: (windowId: string) => void
  restoreDrag: (windowId: string, clientX: number, clientY: number) => WorkspaceBounds | undefined
  handleDragPointerMove: (windowId: string, clientX: number, clientY: number) => void
  onDragPointerEnd: (
    windowId: string,
    bounds: WorkspaceBounds,
    clientX: number,
    clientY: number,
  ) => void
  updateWindowBounds: (windowId: string, bounds: WorkspaceBounds) => void
  resizeSnappedWindowBounds: (windowId: string, bounds: WorkspaceBounds, direction: string) => void
  setActiveTab: (groupId: string, tabId: string) => void
  closeTab: (tabId: string, opts?: { ignoreTabPinForListenOnlyDismiss?: boolean }) => void
  toggleTabPinned: (tabId: string) => void
  handleTabPullStart: (groupId: string, tabId: string, e: PointerEvent) => void
  dropFileToTabBar: (targetLeaderWindowId: string, data: FileDragData, insertIndex?: number) => void
  startSplitPaneDrag: (groupId: string, e: PointerEvent) => void
  navigateDir: (windowId: string, dir: string) => void
  openViewerFromBrowser: (windowId: string, file: FileItem) => void
  openReaderFromBrowser: (windowId: string, file: FileItem) => void
  openHermesFromBrowser: (windowId: string, file: FileItem, target: VirtualOpenTarget) => void
  bindHermesSession: (windowId: string, sessionId: string) => void
  openHermesBranch: (windowId: string, sessionId: string, title: string) => void
  renameHermesWindow: (windowId: string, title: string) => void
  addPinnedItem: (file: FileItem) => void
  openInNewTabInSameWindow: (
    sourceWindowId: string,
    file: { path: string; isDirectory: boolean; isVirtual?: boolean },
    currentPath: string,
    insertIndex?: number,
    sourceOverride?: WorkspaceSource,
  ) => void
  openInSplitViewFromBrowserPane: (windowId: string, file: FileItem) => void
  requestPlay: (source: WorkspaceSource, path: string, dir?: string) => void
  updateWindowViewing: (windowId: string, viewing: string) => void
  resizeViewerWindowForVideoMetadata: (
    windowId: string,
    videoWidth: number,
    videoHeight: number,
  ) => void
  onAudioActivate?: (windowId: string) => void
  onBeginFileOpenTargetPick: (browserWindowId: string) => void
  openFileInNewFloatingWindow: (windowId: string, file: FileItem) => void
}

export function WorkspacePageCanvas(props: WorkspacePageCanvasProps) {
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
        windowState={props.workspace}
        visible={visible}
        active={() => props.workspace()?.activeWindowId === id()}
        editableFolders={() => props.editableFolders()}
        knowledgeBases={() => props.knowledgeBases()}
        fileIconContext={props.workspaceFileIconContext}
        onNavigateDir={props.navigateDir}
        onOpenViewer={props.openViewerFromBrowser}
        onOpenReader={props.openReaderFromBrowser}
        onOpenVirtualTarget={props.openHermesFromBrowser}
        onAddToTaskbar={props.addPinnedItem}
        onOpenInNewTab={(wid, file, path) => props.openInNewTabInSameWindow(wid, file, path)}
        onOpenInSplitView={props.openInSplitViewFromBrowserPane}
        onRequestPlay={props.requestPlay}
        autoPlayVideo
        onBeginFileOpenTargetPick={props.onBeginFileOpenTargetPick}
        onOpenFileInNewFloatingWindow={props.openFileInNewFloatingWindow}
        onUpdateViewing={props.updateWindowViewing}
        onVideoMetadataLoaded={(wid, width, height) =>
          props.resizeViewerWindowForVideoMetadata(wid, width, height)
        }
        onAudioActivate={props.onAudioActivate}
        onListenOnlyDismissViewer={(id) =>
          props.closeTab(id, { ignoreTabPinForListenOnlyDismiss: true })
        }
        onHermesSessionCreated={props.bindHermesSession}
        onHermesBranchCreated={props.openHermesBranch}
        onHermesTitleChanged={props.renameHermesWindow}
      />
    )
  }

  return (
    <Show
      when={props.hasWorkspaceWindows()}
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
                onClick={() => props.onOpenBrowser()}
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
          props.bindSnapPreview(el ?? null)
        }}
        data-snap-preview
        class='pointer-events-none absolute border-2 border-blue-400/50 bg-blue-500/15 transition-all duration-150'
        style={{ display: 'none', 'z-index': 9000 }}
      />
      <Show when={props.workspaceAreaNode()}>
        {(area) => (
          <WorkspaceSnapAssistBar
            visible={props.snapAssistShown()}
            dragging={props.dragSnapWindowId() != null}
            onHandleEnter={props.engageSnapAssistFromHandle}
            onPanelLeave={props.disengageSnapAssistFromPanel}
            hoverPick={props.assistHoverPick()}
            rootRef={(el) => {
              props.bindSnapAssistRoot(el ?? null)
            }}
          />
        )}
      </Show>
      <For each={props.renderedGroupIds()}>
        {(gid) => {
          const tabs = () => tabsInGroup(props.workspace()?.windows ?? [], gid)
          const leader = () => tabs()[0]
          const visibleTabId = () => {
            const wk = props.workspace()
            if (!wk) return ''
            return resolveGroupVisibleTabId(wk, gid)
          }
          const tabList = () => tabs()
          const tabIds = createMemo(() => tabs().map((w) => w.id))
          const splitState = createMemo(() => {
            const w = props.workspace()
            return w ? getTabGroupSplit(w, gid) : undefined
          })
          return (
            <Show when={leader()}>
              <WorkspaceWindowChrome
                leaderWindowId={leader()!.id}
                groupId={gid}
                tabWindows={tabList}
                visibleTabId={visibleTabId}
                workspace={props.workspace}
                fileIconContext={props.workspaceFileIconContext}
                isActive={visibleTabId() === props.workspace()?.activeWindowId}
                containerEl={props.getWorkspaceAreaElement}
                onFocusWindow={props.focusWindow}
                onClose={props.closeWindow}
                onMinimize={(id) => props.setWindowMinimized(id, true)}
                onToggleFullscreen={props.toggleFullscreenWindow}
                onOpenLayoutPicker={props.openLayoutPicker}
                onRestoreDrag={props.restoreDrag}
                onDragPointerMove={props.handleDragPointerMove}
                onDragPointerEnd={props.onDragPointerEnd}
                onDragDuringMove={props.updateWindowBounds}
                onResizeSnapped={props.resizeSnappedWindowBounds}
                onUpdateBounds={props.updateWindowBounds}
                onSelectTab={props.setActiveTab}
                onCloseTab={props.closeTab}
                onToggleTabPinned={props.toggleTabPinned}
                onTabPullStart={props.handleTabPullStart}
                mergeTargetPreview={props.mergeTargetPreview}
                draggingWindowId={props.dragSnapWindowId}
                splitLeftTabId={() => splitState()?.leftTabId}
                onExitSplitView={() =>
                  props.setWorkspace((p) => (p ? exitSplitViewState(p, gid) : p))
                }
                onUseAsSplitLeftTab={(tabId) =>
                  props.setWorkspace((p) => (p ? setSplitLeftTabFromContextState(p, tabId) : p))
                }
                onDropFileToTabBar={(data, insertIndex) =>
                  props.dropFileToTabBar(leader()!.id, data, insertIndex)
                }
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
                            aria-hidden={tabId !== visibleTabId()}
                          >
                            {renderWindowContent(tabId, windowDef, () => tabId === visibleTabId())}
                          </div>
                        )
                      }}
                    </For>
                  }
                >
                  {(split) => {
                    const splitSnap = () =>
                      (split as unknown as () => TabGroupSplitState | undefined)()
                    const leftTabId = () => splitSnap()?.leftTabId ?? ''
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
                            width: `${(splitSnap()?.leftPaneFraction ?? 0.5) * 100}%`,
                          }}
                        >
                          {renderWindowContent(leftTabId, leftWindowDef, () => true)}
                        </div>
                        <div
                          data-testid='workspace-split-divider'
                          data-no-window-drag
                          class='w-1.5 shrink-0 cursor-col-resize border-border bg-muted/40 hover:bg-primary/25'
                          style={{ 'border-left-width': '1px', 'border-right-width': '1px' }}
                          onPointerDown={(e) => props.startSplitPaneDrag(gid, e)}
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
      <Show when={props.layoutPicker()}>
        {(get) => {
          const p = get()
          const c = props.getWorkspaceAreaElement()
          if (!c) return null
          return (
            <WorkspaceTilingPicker
              anchorRect={p.anchor}
              container={c}
              onSelectSpan={(span) => props.onTilingPick(p.windowId, span)}
              onClose={props.closeLayoutPicker}
              onHoverSpanChange={props.setTilingPickerHoverPreview}
            />
          )
        }}
      </Show>
    </Show>
  )
}
