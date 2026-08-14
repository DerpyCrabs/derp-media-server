import type { AssistGridSpan } from '@/lib/workspace-assist-grid'
import type { AssistSlotPick } from '@/lib/workspace-snap-pick'
import { setSplitLeftTabFromContextState, exitSplitViewState } from '@/src/workspace/tab-group-ops'
import type {
  PersistedWorkspaceState,
  TabGroupSplitState,
  WorkspaceSource,
  WorkspaceWindowDefinition,
} from '@/lib/use-workspace'
import type { FileItem } from '@/lib/types'
import {
  getTabGroupSplit,
  resolveGroupVisibleTabId,
  tabsInGroup,
} from '@/src/workspace/tab-group-ops'
import { WorkspaceBrowserPane } from '@/src/workspace/WorkspaceBrowserPane'
import { ResourceViewerContent } from '@/src/features/viewer/ResourceViewerContent'
import { WorkspaceWindowChrome, type WorkspaceBounds } from '@/src/workspace/WorkspaceWindowChrome'
import { WorkspaceSnapAssistBar } from '@/src/workspace/WorkspaceSnapAssistBar'
import { WorkspaceTilingPicker } from '@/src/workspace/WorkspaceTilingPicker'
import type { Accessor, Setter } from 'solid-js'
import { For, Show, createMemo } from 'solid-js'
import type { MergeTarget } from '@/src/workspace/merge-target'
import type { FileDragData } from '@/lib/file-drag-data'
import type { FileIconContext } from '@/src/lib/use-file-icon'
import type { ContentInstance } from '@/lib/domain/content'
import type { ResourceSummary } from '@/lib/domain/resource'
import type { ExplorerLocation } from '@/src/features/explorer/types'
import { ContentRuntimeView } from '@/src/features/content/ContentRuntimeView'
import { ContentRecoveryView } from '@/src/features/content/ContentRecoveryView'
import { contentInstanceFromCurrentWindow } from '@/src/integrations/current-window-content'
import { applicationContentRuntime } from '@/src/integrations/registry'

export type WorkspacePageCanvasProps = {
  emptyState: Readonly<{
    hasWindows: () => boolean
    openBrowser: () => void
  }>
  snapAssist: Readonly<{
    bindPreview: (el: HTMLDivElement | null) => void
    areaNode: () => HTMLDivElement | null
    getAreaElement: () => HTMLDivElement | undefined
    shown: () => boolean
    engageFromHandle: () => void
    disengageFromPanel: () => void
    hoverPick: () => AssistSlotPick | null
    bindRoot: (el: HTMLDivElement | null) => void
    renderedGroupIds: () => string[]
    mergeTargetPreview: () => MergeTarget | null
    dragWindowId: () => string | null
  }>
  state: Readonly<{
    workspace: () => PersistedWorkspaceState | null
    setWorkspace: Setter<PersistedWorkspaceState | null>
  }>
  layoutPicker: Readonly<{
    current: () => { windowId: string; anchor: DOMRect } | null
    close: () => void
    pick: (windowId: string, span: AssistGridSpan) => void
    setHoverPreview: (span: AssistGridSpan | null) => void
    open: (windowId: string, anchor: DOMRect) => void
  }>
  resources: Readonly<{
    editableFolders: () => string[]
    knowledgeBases: () => string[]
    fileIconContext: () => FileIconContext
  }>
  windows: Readonly<{
    focus: (windowId: string) => void
    close: (windowId: string) => void | Promise<void>
    setMinimized: (windowId: string, minimized: boolean) => void
    toggleFullscreen: (windowId: string) => void
    restoreDrag: (windowId: string, clientX: number, clientY: number) => WorkspaceBounds | undefined
    moveDrag: (windowId: string, clientX: number, clientY: number) => void
    endDrag: (windowId: string, bounds: WorkspaceBounds, clientX: number, clientY: number) => void
    updateBounds: (windowId: string, bounds: WorkspaceBounds) => void
    resizeSnapped: (windowId: string, bounds: WorkspaceBounds, direction: string) => void
  }>
  tabs: Readonly<{
    setActive: (groupId: string, tabId: string) => void
    close: (
      tabId: string,
      opts?: { ignoreTabPinForListenOnlyDismiss?: boolean },
    ) => void | Promise<void>
    togglePinned: (tabId: string) => void
    startPull: (groupId: string, tabId: string, e: PointerEvent) => void
    dropFile: (targetLeaderWindowId: string, data: FileDragData, insertIndex?: number) => void
    startSplitDrag: (groupId: string, e: PointerEvent) => void
  }>
  contentHost: Readonly<{
    navigateExplorer(windowId: string, location: ExplorerLocation): void
    openViewer(windowId: string, file: FileItem): void
    openReader(windowId: string, file: FileItem): void
    open(
      windowId: string,
      content: ContentInstance,
      resource?: ResourceSummary,
      forceTab?: boolean,
    ): void
    replace(windowId: string, content: ContentInstance): void
    navigateResource(windowId: string, viewing: string): void
  }>
  files: Readonly<{
    addPinned: (file: FileItem) => void
    openInNewTab: (
      sourceWindowId: string,
      file: { path: string; isDirectory: boolean; isVirtual?: boolean },
      currentPath: string,
      insertIndex?: number,
      sourceOverride?: WorkspaceSource,
    ) => void
    openInSplit: (windowId: string, file: FileItem) => void
    requestPlay: (source: WorkspaceSource, path: string, dir?: string) => void
    resizeViewerForVideo: (windowId: string, videoWidth: number, videoHeight: number) => void
    beginOpenTargetPick: (browserWindowId: string) => void
    openFloating: (windowId: string, file: FileItem) => void
  }>
}

function RuntimeWindowContent(props: {
  definition: Accessor<WorkspaceWindowDefinition | undefined>
  active: Accessor<boolean>
  onReplace: (content: ContentInstance) => void
  onOpen: (content: ContentInstance) => void
  onClose: () => void
}) {
  const content = createMemo(() => {
    const definition = props.definition()
    if (!definition) return null
    const instance = contentInstanceFromCurrentWindow(definition)
    return instance?.type === 'integration' ? instance : null
  })

  return (
    <ContentRuntimeView
      runtime={applicationContentRuntime}
      instance={content}
      active={props.active}
      onReplace={props.onReplace}
      onOpen={props.onOpen}
      onClose={props.onClose}
    />
  )
}

function resourceWindowContent(definition: WorkspaceWindowDefinition | undefined) {
  if (!definition) return null
  const instance = contentInstanceFromCurrentWindow(definition)
  return instance?.type === 'resource' ? instance : null
}

function explorerWindowLocation(
  definition: WorkspaceWindowDefinition | undefined,
): ExplorerLocation {
  if (!definition) throw new Error('Explorer window definition unavailable')
  const instance = contentInstanceFromCurrentWindow(definition)
  if (instance?.type !== 'explorer') throw new Error('Window does not contain Explorer content')
  return { key: instance.location }
}

function WindowContentRecovery(props: {
  definition: Accessor<WorkspaceWindowDefinition | undefined>
}) {
  return (
    <Show when={props.definition()?.contentRecoveryReason} keyed>
      {(reason) => <ContentRecoveryView reason={reason} />}
    </Show>
  )
}

export function WorkspacePageCanvas(props: WorkspacePageCanvasProps) {
  return (
    <Show
      when={props.emptyState.hasWindows()}
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
                onClick={() => props.emptyState.openBrowser()}
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
          props.snapAssist.bindPreview(el ?? null)
        }}
        data-snap-preview
        class='pointer-events-none absolute border-2 border-blue-400/50 bg-blue-500/15 transition-all duration-150'
        style={{ display: 'none', 'z-index': 9000 }}
      />
      <Show when={props.snapAssist.areaNode()}>
        {(area) => (
          <WorkspaceSnapAssistBar
            visible={props.snapAssist.shown()}
            dragging={props.snapAssist.dragWindowId() != null}
            onHandleEnter={props.snapAssist.engageFromHandle}
            onPanelLeave={props.snapAssist.disengageFromPanel}
            hoverPick={props.snapAssist.hoverPick()}
            rootRef={(el) => {
              props.snapAssist.bindRoot(el ?? null)
            }}
          />
        )}
      </Show>
      <For each={props.snapAssist.renderedGroupIds()}>
        {(gid) => {
          const tabs = () => tabsInGroup(props.state.workspace()?.windows ?? [], gid)
          const leader = () => tabs()[0]
          const visibleTabId = () => {
            const wk = props.state.workspace()
            if (!wk) return ''
            return resolveGroupVisibleTabId(wk, gid)
          }
          const tabList = () => tabs()
          const tabIds = createMemo(() => tabs().map((w) => w.id))
          const splitState = createMemo(() => {
            const w = props.state.workspace()
            return w ? getTabGroupSplit(w, gid) : undefined
          })
          return (
            <Show when={leader()}>
              <WorkspaceWindowChrome
                leaderWindowId={leader()!.id}
                groupId={gid}
                tabWindows={tabList}
                visibleTabId={visibleTabId}
                workspace={props.state.workspace}
                fileIconContext={props.resources.fileIconContext}
                isActive={visibleTabId() === props.state.workspace()?.activeWindowId}
                containerEl={props.snapAssist.getAreaElement}
                onFocusWindow={props.windows.focus}
                onClose={props.windows.close}
                onMinimize={(id) => props.windows.setMinimized(id, true)}
                onToggleFullscreen={props.windows.toggleFullscreen}
                onOpenLayoutPicker={props.layoutPicker.open}
                onRestoreDrag={props.windows.restoreDrag}
                onDragPointerMove={props.windows.moveDrag}
                onDragPointerEnd={props.windows.endDrag}
                onDragDuringMove={props.windows.updateBounds}
                onResizeSnapped={props.windows.resizeSnapped}
                onUpdateBounds={props.windows.updateBounds}
                onSelectTab={props.tabs.setActive}
                onCloseTab={props.tabs.close}
                onToggleTabPinned={props.tabs.togglePinned}
                onTabPullStart={props.tabs.startPull}
                mergeTargetPreview={props.snapAssist.mergeTargetPreview}
                draggingWindowId={props.snapAssist.dragWindowId}
                splitLeftTabId={() => splitState()?.leftTabId}
                onExitSplitView={() =>
                  props.state.setWorkspace((p) => (p ? exitSplitViewState(p, gid) : p))
                }
                onUseAsSplitLeftTab={(tabId) =>
                  props.state.setWorkspace((p) =>
                    p ? setSplitLeftTabFromContextState(p, tabId) : p,
                  )
                }
                onDropFileToTabBar={(data, insertIndex) =>
                  props.tabs.dropFile(leader()!.id, data, insertIndex)
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
                            <WindowContentRecovery definition={windowDef} />
                            <Show
                              when={
                                !windowDef()?.contentRecoveryReason &&
                                windowDef()?.type === 'browser'
                              }
                            >
                              <WorkspaceBrowserPane
                                windowId={tabId}
                                location={() => explorerWindowLocation(windowDef())}
                                active={() => props.state.workspace()?.activeWindowId === tabId}
                                source={() => windowDef()!.source}
                                resourceOpenContext={() => ({
                                  surface: 'workspace',
                                  disposition: 'window',
                                })}
                                editableFolders={props.resources.editableFolders()}
                                fileIconContext={props.resources.fileIconContext}
                                onNavigate={props.contentHost.navigateExplorer}
                                onOpenViewer={props.contentHost.openViewer}
                                onOpenReader={props.contentHost.openReader}
                                onOpenContent={props.contentHost.open}
                                onAddToTaskbar={props.files.addPinned}
                                onOpenInNewTab={(wid, file, path) =>
                                  props.files.openInNewTab(wid, file, path)
                                }
                                onOpenInSplitView={props.files.openInSplit}
                                onRequestPlay={props.files.requestPlay}
                                onBeginFileOpenTargetPick={() =>
                                  props.files.beginOpenTargetPick(tabId)
                                }
                                onOpenFileInNewFloatingWindow={props.files.openFloating}
                              />
                            </Show>
                            <Show
                              when={
                                !windowDef()?.contentRecoveryReason &&
                                windowDef()?.type === 'viewer'
                              }
                            >
                              <ResourceViewerContent
                                runtime={applicationContentRuntime}
                                contentInstance={() => resourceWindowContent(windowDef())}
                                contentVisible={() => tabId === visibleTabId()}
                                viewingPath={() => windowDef()?.initialState.viewing ?? ''}
                                readerKind={() => windowDef()?.initialState.readerKind ?? null}
                                directory={() => windowDef()?.initialState.dir ?? ''}
                                active={() => props.state.workspace()?.activeWindowId === tabId}
                                onNavigateViewing={(path) =>
                                  props.contentHost.navigateResource(tabId, path)
                                }
                                onReplaceContent={(content) =>
                                  props.contentHost.replace(tabId, content)
                                }
                                onVideoMetadataLoaded={(vw, vh) =>
                                  props.files.resizeViewerForVideo(tabId, vw, vh)
                                }
                                onListenOnlyDismissViewer={() =>
                                  props.tabs.close(tabId, {
                                    ignoreTabPinForListenOnlyDismiss: true,
                                  })
                                }
                              />
                            </Show>
                            <RuntimeWindowContent
                              definition={windowDef}
                              active={() => props.state.workspace()?.activeWindowId === tabId}
                              onReplace={(content) => props.contentHost.replace(tabId, content)}
                              onOpen={(content) =>
                                props.contentHost.open(tabId, content, undefined, true)
                              }
                              onClose={() => void props.tabs.close(tabId)}
                            />
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
                          <WindowContentRecovery definition={leftWindowDef} />
                          <Show
                            when={
                              !leftWindowDef()?.contentRecoveryReason &&
                              leftWindowDef()?.type === 'browser'
                            }
                          >
                            <WorkspaceBrowserPane
                              windowId={leftTabId()}
                              location={() => explorerWindowLocation(leftWindowDef())}
                              active={() => props.state.workspace()?.activeWindowId === leftTabId()}
                              source={() => leftWindowDef()!.source}
                              resourceOpenContext={() => ({
                                surface: 'workspace',
                                disposition: 'window',
                              })}
                              editableFolders={props.resources.editableFolders()}
                              fileIconContext={props.resources.fileIconContext}
                              onNavigate={props.contentHost.navigateExplorer}
                              onOpenViewer={props.contentHost.openViewer}
                              onOpenReader={props.contentHost.openReader}
                              onOpenContent={props.contentHost.open}
                              onAddToTaskbar={props.files.addPinned}
                              onOpenInNewTab={(wid, file, path) =>
                                props.files.openInNewTab(wid, file, path)
                              }
                              onOpenInSplitView={props.files.openInSplit}
                              onRequestPlay={props.files.requestPlay}
                              onBeginFileOpenTargetPick={() =>
                                props.files.beginOpenTargetPick(leftTabId())
                              }
                              onOpenFileInNewFloatingWindow={props.files.openFloating}
                            />
                          </Show>
                          <Show
                            when={
                              !leftWindowDef()?.contentRecoveryReason &&
                              leftWindowDef()?.type === 'viewer'
                            }
                          >
                            <ResourceViewerContent
                              runtime={applicationContentRuntime}
                              contentInstance={() => resourceWindowContent(leftWindowDef())}
                              contentVisible={() => true}
                              viewingPath={() => leftWindowDef()?.initialState.viewing ?? ''}
                              readerKind={() => leftWindowDef()?.initialState.readerKind ?? null}
                              directory={() => leftWindowDef()?.initialState.dir ?? ''}
                              active={() => props.state.workspace()?.activeWindowId === leftTabId()}
                              onNavigateViewing={(path) =>
                                props.contentHost.navigateResource(leftTabId(), path)
                              }
                              onReplaceContent={(content) =>
                                props.contentHost.replace(leftTabId(), content)
                              }
                              onVideoMetadataLoaded={(vw, vh) =>
                                props.files.resizeViewerForVideo(leftTabId(), vw, vh)
                              }
                              onListenOnlyDismissViewer={() =>
                                props.tabs.close(leftTabId(), {
                                  ignoreTabPinForListenOnlyDismiss: true,
                                })
                              }
                            />
                          </Show>
                          <RuntimeWindowContent
                            definition={leftWindowDef}
                            active={() => props.state.workspace()?.activeWindowId === leftTabId()}
                            onReplace={(content) => props.contentHost.replace(leftTabId(), content)}
                            onOpen={(content) =>
                              props.contentHost.open(leftTabId(), content, undefined, true)
                            }
                            onClose={() => void props.tabs.close(leftTabId())}
                          />
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
                            <WindowContentRecovery definition={rightWindowDef} />
                            <Show
                              when={
                                !rightWindowDef()?.contentRecoveryReason &&
                                rightWindowDef()?.type === 'browser'
                              }
                            >
                              <WorkspaceBrowserPane
                                windowId={visibleTabId()}
                                location={() => explorerWindowLocation(rightWindowDef())}
                                active={() =>
                                  props.state.workspace()?.activeWindowId === visibleTabId()
                                }
                                source={() => rightWindowDef()!.source}
                                resourceOpenContext={() => ({
                                  surface: 'workspace',
                                  disposition: 'window',
                                })}
                                editableFolders={props.resources.editableFolders()}
                                fileIconContext={props.resources.fileIconContext}
                                onNavigate={props.contentHost.navigateExplorer}
                                onOpenViewer={props.contentHost.openViewer}
                                onOpenReader={props.contentHost.openReader}
                                onOpenContent={props.contentHost.open}
                                onAddToTaskbar={props.files.addPinned}
                                onOpenInNewTab={(wid, file, path) =>
                                  props.files.openInNewTab(wid, file, path)
                                }
                                onOpenInSplitView={props.files.openInSplit}
                                onRequestPlay={props.files.requestPlay}
                                onBeginFileOpenTargetPick={() =>
                                  props.files.beginOpenTargetPick(visibleTabId())
                                }
                                onOpenFileInNewFloatingWindow={props.files.openFloating}
                              />
                            </Show>
                            <Show
                              when={
                                !rightWindowDef()?.contentRecoveryReason &&
                                rightWindowDef()?.type === 'viewer'
                              }
                            >
                              <ResourceViewerContent
                                runtime={applicationContentRuntime}
                                contentInstance={() => resourceWindowContent(rightWindowDef())}
                                contentVisible={() => true}
                                viewingPath={() => rightWindowDef()?.initialState.viewing ?? ''}
                                readerKind={() => rightWindowDef()?.initialState.readerKind ?? null}
                                directory={() => rightWindowDef()?.initialState.dir ?? ''}
                                active={() =>
                                  props.state.workspace()?.activeWindowId === visibleTabId()
                                }
                                onNavigateViewing={(path) =>
                                  props.contentHost.navigateResource(visibleTabId(), path)
                                }
                                onReplaceContent={(content) =>
                                  props.contentHost.replace(visibleTabId(), content)
                                }
                                onVideoMetadataLoaded={(vw, vh) =>
                                  props.files.resizeViewerForVideo(visibleTabId(), vw, vh)
                                }
                                onListenOnlyDismissViewer={() =>
                                  props.tabs.close(visibleTabId(), {
                                    ignoreTabPinForListenOnlyDismiss: true,
                                  })
                                }
                              />
                            </Show>
                            <RuntimeWindowContent
                              definition={rightWindowDef}
                              active={() =>
                                props.state.workspace()?.activeWindowId === visibleTabId()
                              }
                              onReplace={(content) =>
                                props.contentHost.replace(visibleTabId(), content)
                              }
                              onOpen={(content) =>
                                props.contentHost.open(visibleTabId(), content, undefined, true)
                              }
                              onClose={() => void props.tabs.close(visibleTabId())}
                            />
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
      <Show when={props.layoutPicker.current()}>
        {(get) => {
          const p = get()
          const c = props.snapAssist.getAreaElement()
          if (!c) return null
          return (
            <WorkspaceTilingPicker
              anchorRect={p.anchor}
              container={c}
              onSelectSpan={(span) => props.layoutPicker.pick(p.windowId, span)}
              onClose={props.layoutPicker.close}
              onHoverSpanChange={props.layoutPicker.setHoverPreview}
            />
          )
        }}
      </Show>
    </Show>
  )
}
