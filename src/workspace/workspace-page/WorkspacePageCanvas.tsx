import type { AssistGridSpan } from '@/lib/workspace-assist-grid'
import type { AssistSlotPick } from '@/lib/workspace-snap-pick'
import { setSplitLeftTabFromContextState, exitSplitViewState } from '@/src/workspace/tab-group-ops'
import type {
  PersistedWorkspaceState,
  TabGroupSplitState,
  WorkspaceWindowDefinition,
} from '@/lib/use-workspace'
import {
  getTabGroupSplit,
  resolveGroupVisibleTabId,
  tabsInGroup,
} from '@/src/workspace/tab-group-ops'
import { WorkspaceBrowserPane } from '@/src/workspace/WorkspaceBrowserPane'
import { WorkspaceWindowChrome, type WorkspaceBounds } from '@/src/workspace/WorkspaceWindowChrome'
import { WorkspaceSnapAssistBar } from '@/src/workspace/WorkspaceSnapAssistBar'
import { WorkspaceTilingPicker } from '@/src/workspace/WorkspaceTilingPicker'
import type { Accessor, Setter } from 'solid-js'
import { For, Show, createMemo } from 'solid-js'
import type { MergeTarget } from '@/src/workspace/merge-target'
import type { ResourceDragData } from '@/lib/resource-drag-data'
import type { FileIconContext } from '@/src/lib/use-file-icon'
import type { ContentInstance } from '@/lib/domain/content'
import type { ResourceKey, ResourceSummary } from '@/lib/domain/resource'
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
    dropFile: (targetLeaderWindowId: string, data: ResourceDragData, insertIndex?: number) => void
    startSplitDrag: (groupId: string, e: PointerEvent) => void
  }>
  contentHost: Readonly<{
    navigateExplorer(windowId: string, location: ExplorerLocation): void
    openViewer(windowId: string, resource: ResourceSummary): void
    openReader(windowId: string, resource: ResourceSummary): void
    open(
      windowId: string,
      content: ContentInstance,
      resource?: ResourceSummary,
      forceTab?: boolean,
    ): void
    replace(windowId: string, content: ContentInstance): void
    navigateResource(windowId: string, resource: ResourceKey): void
  }>
  files: Readonly<{
    addPinned: (resource: ResourceSummary) => void
    openInNewTab: (sourceWindowId: string, resource: ResourceSummary, insertIndex?: number) => void
    openInSplit: (windowId: string, resource: ResourceSummary) => void
    requestPlay: (resource: ResourceSummary, context?: ResourceKey) => void
    resizeViewerForVideo: (windowId: string, videoWidth: number, videoHeight: number) => void
    beginOpenTargetPick: (browserWindowId: string) => void
    openFloating: (windowId: string, resource: ResourceSummary) => void
  }>
}

function WorkspaceWindowContent(props: {
  canvas: WorkspacePageCanvasProps
  windowId: Accessor<string>
  definition: Accessor<WorkspaceWindowDefinition | undefined>
  visible: Accessor<boolean>
}) {
  const content = createMemo(() => {
    const definition = props.definition()
    return definition ? contentInstanceFromCurrentWindow(definition) : null
  })
  const explorer = createMemo(() => {
    const instance = content()
    return instance?.type === 'explorer' ? instance : null
  })
  const surfaceContent = createMemo(() => {
    const instance = content()
    return instance && instance.type !== 'explorer' ? instance : null
  })
  const active = () => props.canvas.state.workspace()?.activeWindowId === props.windowId()
  const location = (): ExplorerLocation => {
    const instance = explorer()
    if (!instance) throw new Error('Window does not contain Explorer content')
    return { key: instance.location }
  }

  return (
    <>
      <Show when={props.definition()?.contentRecoveryReason} keyed>
        {(reason) => <ContentRecoveryView reason={reason} />}
      </Show>
      <Show when={!props.definition()?.contentRecoveryReason && explorer()}>
        <WorkspaceBrowserPane
          windowId={props.windowId()}
          location={location}
          active={active}
          resourceOpenContext={() => ({
            surface: 'workspace',
            disposition: 'window',
          })}
          editableFolders={props.canvas.resources.editableFolders()}
          fileIconContext={props.canvas.resources.fileIconContext}
          onNavigate={props.canvas.contentHost.navigateExplorer}
          onOpenResource={props.canvas.contentHost.openViewer}
          onOpenReader={props.canvas.contentHost.openReader}
          onOpenContent={props.canvas.contentHost.open}
          onAddToTaskbar={props.canvas.files.addPinned}
          onOpenInNewTab={props.canvas.files.openInNewTab}
          onOpenInSplitView={props.canvas.files.openInSplit}
          onRequestPlay={props.canvas.files.requestPlay}
          onBeginFileOpenTargetPick={() => props.canvas.files.beginOpenTargetPick(props.windowId())}
          onOpenFileInNewFloatingWindow={props.canvas.files.openFloating}
        />
      </Show>
      <Show when={!props.definition()?.contentRecoveryReason && surfaceContent()}>
        <ContentRuntimeView
          runtime={applicationContentRuntime}
          instance={surfaceContent}
          visible={props.visible}
          active={active}
          onNavigate={(resource) =>
            props.canvas.contentHost.navigateResource(props.windowId(), resource)
          }
          onReplace={(instance) => props.canvas.contentHost.replace(props.windowId(), instance)}
          onOpen={(instance) =>
            props.canvas.contentHost.open(props.windowId(), instance, undefined, true)
          }
          onClose={() => void props.canvas.tabs.close(props.windowId())}
          onResize={(width, height) =>
            props.canvas.files.resizeViewerForVideo(props.windowId(), width, height)
          }
          onDetach={() =>
            void props.canvas.tabs.close(props.windowId(), {
              ignoreTabPinForListenOnlyDismiss: true,
            })
          }
          onActivate={() => props.canvas.windows.focus(props.windowId())}
        />
      </Show>
    </>
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
                            <WorkspaceWindowContent
                              canvas={props}
                              windowId={() => tabId}
                              definition={windowDef}
                              visible={() => tabId === visibleTabId()}
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
                          <WorkspaceWindowContent
                            canvas={props}
                            windowId={leftTabId}
                            definition={leftWindowDef}
                            visible={() => true}
                          />
                        </div>
                        <div
                          data-testid='workspace-split-divider'
                          data-no-window-drag
                          class='w-1.5 shrink-0 cursor-col-resize border-border bg-muted/40 hover:bg-primary/25'
                          style={{
                            'border-left-width': '1px',
                            'border-right-width': '1px',
                          }}
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
                            <WorkspaceWindowContent
                              canvas={props}
                              windowId={visibleTabId}
                              definition={rightWindowDef}
                              visible={() => true}
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
