import type { AssistGridSpan } from '@/lib/workspace-assist-grid'
import type { AssistSlotPick } from '@/lib/workspace-snap-pick'
import { setSplitLeftTabFromContextState, exitSplitViewState } from '@/src/workspace/tab-group-ops'
import type {
  PersistedWorkspaceState,
  TabGroupSplitState,
  WorkspaceSource,
} from '@/lib/use-workspace'
import type { FileItem } from '@/lib/types'
import {
  getTabGroupSplit,
  resolveGroupVisibleTabId,
  tabsInGroup,
} from '@/src/workspace/tab-group-ops'
import { WorkspaceBrowserPane } from '@/src/workspace/WorkspaceBrowserPane'
import {
  WorkspaceViewerPane,
  type WorkspaceVideoListenOnlyDetail,
} from '@/src/workspace/WorkspaceViewerPane'
import { WorkspaceWindowChrome, type WorkspaceBounds } from '@/src/workspace/WorkspaceWindowChrome'
import { WorkspaceSnapAssistBar } from '@/src/workspace/WorkspaceSnapAssistBar'
import { WorkspaceTilingPicker } from '@/src/workspace/WorkspaceTilingPicker'
import type { Setter } from 'solid-js'
import { For, Show, createMemo } from 'solid-js'
import type { MergeTarget } from '@/src/workspace/merge-target'
import type { FileDragData } from '@/lib/file-drag-data'
import type { WorkspaceShareConfig } from '@/src/workspace/WorkspaceBrowserPane'
import type { WorkspacePageProps } from './workspace-page-types'
import type { FileIconContext } from '@/src/lib/use-file-icon'

export type WorkspacePageCanvasProps = {
  hasWorkspaceWindows: () => boolean
  onOpenBrowser: () => void
  bindSnapPreview: (el: HTMLDivElement | null) => void
  workspaceAreaNode: () => HTMLDivElement | null
  getWorkspaceAreaElement: () => HTMLDivElement | undefined
  snapAssistShown: () => boolean
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
  pageProps: WorkspacePageProps
  sharePanel: () => WorkspaceShareConfig | null
  editableFolders: () => string[]
  knowledgeBases: () => string[]
  storageKey: () => string
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
  listenOnlyHandoff: (tabId: string, detail: WorkspaceVideoListenOnlyDetail) => void
}

export function WorkspacePageCanvas(props: WorkspacePageCanvasProps) {
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
        class='pointer-events-none absolute rounded-sm border-2 border-blue-400/50 bg-blue-500/15 transition-all duration-150'
        style={{ display: 'none', 'z-index': 99999 }}
      />
      <Show when={props.workspaceAreaNode()}>
        {(area) => (
          <WorkspaceSnapAssistBar
            container={area()}
            visible={props.snapAssistShown()}
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
                            <Show when={windowDef()?.type === 'browser'}>
                              <WorkspaceBrowserPane
                                windowId={tabId}
                                workspace={props.workspace}
                                sharePanel={props.sharePanel}
                                shareAllowUpload={props.pageProps.shareAllowUpload ?? false}
                                shareCanEdit={
                                  props.pageProps.shareConfig
                                    ? (props.pageProps.shareCanEdit ?? false)
                                    : false
                                }
                                shareCanDelete={
                                  props.pageProps.shareConfig
                                    ? (props.pageProps.shareCanDelete ?? false)
                                    : false
                                }
                                shareIsKnowledgeBase={props.pageProps.shareIsKnowledgeBase ?? false}
                                editableFolders={props.editableFolders()}
                                fileIconContext={props.workspaceFileIconContext}
                                onNavigateDir={props.navigateDir}
                                onOpenViewer={props.openViewerFromBrowser}
                                onAddToTaskbar={props.addPinnedItem}
                                onOpenInNewTab={(wid, file, path) =>
                                  props.openInNewTabInSameWindow(wid, file, path)
                                }
                                onOpenInSplitView={props.openInSplitViewFromBrowserPane}
                                onRequestPlay={props.requestPlay}
                              />
                            </Show>
                            <Show when={windowDef()?.type === 'viewer'}>
                              <WorkspaceViewerPane
                                windowId={tabId}
                                storageKey={props.storageKey()}
                                contentVisible={() => tabId === visibleTabId()}
                                workspace={props.workspace}
                                sharePanel={props.sharePanel}
                                editableFolders={props.editableFolders()}
                                knowledgeBases={props.knowledgeBases()}
                                shareCanEdit={
                                  props.pageProps.shareConfig
                                    ? (props.pageProps.shareCanEdit ?? false)
                                    : false
                                }
                                onUpdateViewing={props.updateWindowViewing}
                                onVideoMetadataLoaded={(vw, vh) =>
                                  props.resizeViewerWindowForVideoMetadata(tabId, vw, vh)
                                }
                                onListenOnlyHandoff={(d) => props.listenOnlyHandoff(tabId, d)}
                                onListenOnlyDismissViewer={() =>
                                  props.closeTab(tabId, { ignoreTabPinForListenOnlyDismiss: true })
                                }
                              />
                            </Show>
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
                          <Show when={leftWindowDef()?.type === 'browser'}>
                            <WorkspaceBrowserPane
                              windowId={leftTabId()}
                              workspace={props.workspace}
                              sharePanel={props.sharePanel}
                              shareAllowUpload={props.pageProps.shareAllowUpload ?? false}
                              shareCanEdit={
                                props.pageProps.shareConfig
                                  ? (props.pageProps.shareCanEdit ?? false)
                                  : false
                              }
                              shareCanDelete={
                                props.pageProps.shareConfig
                                  ? (props.pageProps.shareCanDelete ?? false)
                                  : false
                              }
                              shareIsKnowledgeBase={props.pageProps.shareIsKnowledgeBase ?? false}
                              editableFolders={props.editableFolders()}
                              fileIconContext={props.workspaceFileIconContext}
                              onNavigateDir={props.navigateDir}
                              onOpenViewer={props.openViewerFromBrowser}
                              onAddToTaskbar={props.addPinnedItem}
                              onOpenInNewTab={(wid, file, path) =>
                                props.openInNewTabInSameWindow(wid, file, path)
                              }
                              onOpenInSplitView={props.openInSplitViewFromBrowserPane}
                              onRequestPlay={props.requestPlay}
                            />
                          </Show>
                          <Show when={leftWindowDef()?.type === 'viewer'}>
                            <WorkspaceViewerPane
                              windowId={leftTabId()}
                              storageKey={props.storageKey()}
                              contentVisible={() => true}
                              workspace={props.workspace}
                              sharePanel={props.sharePanel}
                              editableFolders={props.editableFolders()}
                              knowledgeBases={props.knowledgeBases()}
                              shareCanEdit={
                                props.pageProps.shareConfig
                                  ? (props.pageProps.shareCanEdit ?? false)
                                  : false
                              }
                              onUpdateViewing={props.updateWindowViewing}
                              onVideoMetadataLoaded={(vw, vh) =>
                                props.resizeViewerWindowForVideoMetadata(leftTabId(), vw, vh)
                              }
                              onListenOnlyHandoff={(d) => props.listenOnlyHandoff(leftTabId(), d)}
                              onListenOnlyDismissViewer={() =>
                                props.closeTab(leftTabId(), {
                                  ignoreTabPinForListenOnlyDismiss: true,
                                })
                              }
                            />
                          </Show>
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
                            <Show when={rightWindowDef()?.type === 'browser'}>
                              <WorkspaceBrowserPane
                                windowId={visibleTabId()}
                                workspace={props.workspace}
                                sharePanel={props.sharePanel}
                                shareAllowUpload={props.pageProps.shareAllowUpload ?? false}
                                shareCanEdit={
                                  props.pageProps.shareConfig
                                    ? (props.pageProps.shareCanEdit ?? false)
                                    : false
                                }
                                shareCanDelete={
                                  props.pageProps.shareConfig
                                    ? (props.pageProps.shareCanDelete ?? false)
                                    : false
                                }
                                shareIsKnowledgeBase={props.pageProps.shareIsKnowledgeBase ?? false}
                                editableFolders={props.editableFolders()}
                                fileIconContext={props.workspaceFileIconContext}
                                onNavigateDir={props.navigateDir}
                                onOpenViewer={props.openViewerFromBrowser}
                                onAddToTaskbar={props.addPinnedItem}
                                onOpenInNewTab={(wid, file, path) =>
                                  props.openInNewTabInSameWindow(wid, file, path)
                                }
                                onOpenInSplitView={props.openInSplitViewFromBrowserPane}
                                onRequestPlay={props.requestPlay}
                              />
                            </Show>
                            <Show when={rightWindowDef()?.type === 'viewer'}>
                              <WorkspaceViewerPane
                                windowId={visibleTabId()}
                                storageKey={props.storageKey()}
                                contentVisible={() => true}
                                workspace={props.workspace}
                                sharePanel={props.sharePanel}
                                editableFolders={props.editableFolders()}
                                knowledgeBases={props.knowledgeBases()}
                                shareCanEdit={
                                  props.pageProps.shareConfig
                                    ? (props.pageProps.shareCanEdit ?? false)
                                    : false
                                }
                                onUpdateViewing={props.updateWindowViewing}
                                onVideoMetadataLoaded={(vw, vh) =>
                                  props.resizeViewerWindowForVideoMetadata(visibleTabId(), vw, vh)
                                }
                                onListenOnlyHandoff={(d) =>
                                  props.listenOnlyHandoff(visibleTabId(), d)
                                }
                                onListenOnlyDismissViewer={() =>
                                  props.closeTab(visibleTabId(), {
                                    ignoreTabPinForListenOnlyDismiss: true,
                                  })
                                }
                              />
                            </Show>
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
