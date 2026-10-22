import { view, list, collection } from 'effectweb'
import { cn } from '@/lib/ui/cn'
import { windowIcon } from '@/features/explorer/file-icon'
import { ApplicationWindowContent } from '@/workspace/shared/ApplicationWindowContent'
import { WorkspaceWindowTitlebar } from '@/workspace/shared/WorkspaceWindowTitlebar'
import { WorkspaceDocumentCommands } from '@/workspace/model/workspace-document-commands'
import { canvasWindowVisualBounds, type CanvasWindow } from './model/infinite-canvas'
import {
  LIVE_ZOOM,
  FAR_ZOOM,
  EMPTY_CANVAS_BOUNDS,
  canvasWindowDetails,
  type ResizeDirection,
  type createCanvasController,
} from './canvas-workspace-controller'

type CanvasModel = ReturnType<ReturnType<typeof createCanvasController>['source']['model']>
type GroupProps = CanvasModel['windowGroups'][number]
const ResizeHandles = view<{ onStart: (direction: ResizeDirection, event: PointerEvent) => void }>(
  (props) => {
    const handles: Array<{ direction: ResizeDirection; class: string }> = [
      { direction: 'n', class: 'top-[-5px] left-2 right-2 h-2 cursor-n-resize' },
      { direction: 's', class: 'bottom-[-5px] left-2 right-2 h-2 cursor-s-resize' },
      { direction: 'e', class: 'right-[-5px] top-2 bottom-2 w-2 cursor-e-resize' },
      { direction: 'w', class: 'left-[-5px] top-2 bottom-2 w-2 cursor-w-resize' },
      { direction: 'ne', class: 'right-[-6px] top-[-6px] size-3 cursor-ne-resize' },
      { direction: 'nw', class: 'left-[-6px] top-[-6px] size-3 cursor-nw-resize' },
      { direction: 'se', class: 'right-[-6px] bottom-[-6px] size-3 cursor-se-resize' },
      { direction: 'sw', class: 'left-[-6px] bottom-[-6px] size-3 cursor-sw-resize' },
    ]
    return list(resizeHandles.from(handles), (handle) => (
      <div
        class={`absolute z-30 ${handle.class}`}
        data-canvas-resize={handle.direction}
        onPointerDown={(event) => {
          props.onStart(handle.direction, event)
        }}
      />
    ))
  },
)
export const CanvasWindowGroup = view<GroupProps>((model) => {
  const { groupId, readOnlyMode, viewportSize, editableFolders, knowledgeBases, windowActions } =
    model
  const {
    selectWindow,
    selectCanvasTab,
    activateWindow,
    closeWindow,
    toggleCanvasTabPinned,
    startCanvasTabPull,
    updateCanvasWorkspace,
    startWindowMove,
    setMaximizedWindowId,
    maximizeWindow,
    closeWindowGroup,
    startCanvasSplitPaneDrag,
    startWindowResize,
  } = model.commands
  const state = () => ({ camera: model.camera })
  const fileIconContext = () => model.fileIconContext
  const definitionFor = (window: CanvasWindow) => {
    const definition = model.definitions.find((definition) => definition.id === window.id)
    if (!definition) throw new Error('Missing workspace window ' + window.id)
    return definition
  }
  const members = () => model.members
  const item = () => model.item
  const split = () => model.split
  const memberIds = () => members().map((member) => member.id)
  const worldBounds = () => members()[0]?.bounds ?? item()?.bounds ?? EMPTY_CANVAS_BOUNDS
  const maximized = () => {
    const active = item()
    return active ? model.maximized : false
  }
  const visualBounds = () => {
    if (!maximized()) return canvasWindowVisualBounds(worldBounds())
    const zoom = state().camera.zoom
    return {
      x: -state().camera.x / zoom,
      y: -state().camera.y / zoom,
      width: viewportSize.width,
      height: viewportSize.height,
    }
  }
  const selected = () => model.selected
  const details = () => {
    const active = item()
    return active ? canvasWindowDetails(definitionFor(active)) : { kind: '', path: null }
  }
  const liveWindowChrome = () => state().camera.zoom >= LIVE_ZOOM || maximized()
  const titlebarHeight = () =>
    liveWindowChrome() ? 32 : Math.min(72, Math.max(44, 32 / state().camera.zoom))
  const actionIconScale = () =>
    liveWindowChrome() ? 1 : Math.min(1.6, Math.max(1, 14 / 20 / state().camera.zoom))
  const summaryMetrics = () => {
    const zoom = state().camera.zoom
    const screenWidth = visualBounds().width * zoom
    const screenHeight = (visualBounds().height - titlebarHeight()) * zoom
    const icon = Math.min(28, Math.max(14, screenHeight * 0.22))
    const title = Math.min(20, Math.max(12, screenHeight * 0.17, screenWidth / 24))
    const kind = Math.min(14, Math.max(10, screenHeight * 0.12))
    const path = Math.min(12, Math.max(9, screenHeight * 0.1))
    const gap = Math.min(8, Math.max(3, screenHeight * 0.045))
    const padding = Math.min(16, Math.max(7, Math.min(screenWidth, screenHeight) * 0.07))
    return {
      iconScale: icon / 20 / zoom,
      title: title / zoom,
      kind: kind / zoom,
      path: path / zoom,
      gap: gap / zoom,
      padding: padding / zoom,
      screenWidth,
      screenHeight,
    }
  }
  const showSummaryPath = () => {
    const active = item()
    return (
      Boolean(active && details().path && details().path !== definitionFor(active).title) &&
      summaryMetrics().screenWidth >= 180 &&
      summaryMetrics().screenHeight >= 145
    )
  }
  const windowShadow = () => {
    const zoom = state().camera.zoom
    const lift = 4 / zoom
    const blur = 14 / zoom
    const focusGlow = selected() ? `, 0 0 ${6 / zoom}px rgba(59, 130, 246, 0.42)` : ''
    return `0 ${lift}px ${blur}px rgba(0, 0, 0, 0.55)${focusGlow}`
  }
  return item() ? (
    <div
      data-testid='canvas-window'
      data-window-id={item()!.id}
      data-canvas-group-id={groupId}
      class={cn('absolute overflow-visible bg-background', {
        'rounded-lg': !maximized(),
        'border border-border shadow-2xl outline outline-1 -outline-offset-1 outline-border':
          liveWindowChrome(),
        'border-border shadow-black/20': liveWindowChrome() && selected(),
        'invisible pointer-events-none': state().camera.zoom < FAR_ZOOM && !maximized(),
      })}
      style={{
        left: `${visualBounds().x}px`,
        top: `${visualBounds().y}px`,
        width: `${visualBounds().width}px`,
        height: `${visualBounds().height}px`,
        transform: maximized() ? `scale(${1 / state().camera.zoom})` : undefined,
        'transform-origin': 'top left',
        'box-shadow': liveWindowChrome() ? undefined : windowShadow(),
        opacity: model.mergeOpacity ? 0.55 : undefined,
        'z-index': maximized() ? 2000000 : selected() ? 1000000 + item()!.zIndex : item()!.zIndex,
      }}
      onPointerDown={(event) => {
        selectWindow(item()!.id, event.ctrlKey || event.metaKey || event.shiftKey)
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
    >
      <WorkspaceWindowTitlebar
        groupId={groupId}
        tabs={() => model.definitions}
        visibleTabId={() => item()!.id}
        active={selected()}
        fileIconContext={fileIconContext}
        maximized={maximized}
        rootTestId='canvas-window-titlebar'
        height={titlebarHeight}
        actionSize={titlebarHeight}
        actionIconScale={actionIconScale}
        rounded={() => !maximized()}
        showTabs={liveWindowChrome}
        mergeHighlightInsertIndex={() => model.mergeInsertIndex}
        splitLeftTabId={() => split()?.leftTabId}
        onActivateTab={selectCanvasTab}
        onFocusWindow={activateWindow}
        onCloseTab={(windowId) => closeWindow(windowId)}
        onToggleTabPinned={toggleCanvasTabPinned}
        onTabPullStart={startCanvasTabPull}
        onExitSplitView={() =>
          updateCanvasWorkspace((current) => WorkspaceDocumentCommands.exitSplit(current, groupId))
        }
        onUseAsSplitLeftTab={(tabId) =>
          updateCanvasWorkspace((current) => WorkspaceDocumentCommands.setSplitLeft(current, tabId))
        }
        onPointerDown={(event) => {
          if (maximized()) return
          const target = event.target as HTMLElement
          const tab = target.closest('[data-workspace-tab-id]')
          if (!tab || members().length === 1) startWindowMove(item()!.id, event)
        }}
        onToggleMaximize={() =>
          maximized() ? setMaximizedWindowId(null) : maximizeWindow(item()!.id)
        }
        onClose={readOnlyMode ? undefined : () => closeWindowGroup(groupId)}
      />
      <div
        data-canvas-window-content
        class={cn(
          'absolute right-0 bottom-0 left-0 overflow-hidden text-sm text-muted-foreground',
          { 'rounded-b-lg': !maximized() },
        )}
        style={{ top: `${titlebarHeight()}px` }}
        onContextMenu={(event) => {
          event.stopPropagation()
        }}
      >
        <div
          class={cn('flex h-full', {
            'invisible pointer-events-none': state().camera.zoom < LIVE_ZOOM && !maximized(),
          })}
        >
          {list(canvasStrings.from(memberIds()), (paneId, index) => {
            const definition = model.definitions.find((definition) => definition.id === paneId)
            const paneVisible = () => paneId === item()!.id || paneId === split()?.leftTabId
            return (
              <>
                {split() && paneId === item()!.id && paneId !== split()?.leftTabId ? (
                  <div
                    data-testid='workspace-split-divider'
                    data-no-window-drag
                    class='w-1.5 shrink-0 cursor-col-resize border-border bg-muted/40 hover:bg-primary/25'
                    style={{ 'border-left-width': '1px', 'border-right-width': '1px', order: 1 }}
                    onPointerDown={(event) => {
                      startCanvasSplitPaneDrag(groupId, event)
                    }}
                  />
                ) : null}
                <div
                  data-canvas-pane-id={paneId}
                  class={`h-full min-w-0 border-r border-border last:border-r-0 ${paneVisible() ? '' : 'hidden'}`}
                  aria-hidden={paneVisible() ? 'false' : 'true'}
                  style={{
                    width: !split()
                      ? '100%'
                      : paneId === split()?.leftTabId
                        ? `${(split()?.leftPaneFraction ?? 0.5) * 100}%`
                        : `${(1 - (split()?.leftPaneFraction ?? 0.5)) * 100}%`,
                    order: split() ? (paneId === split()?.leftTabId ? 0 : 2) : index,
                  }}
                >
                  <ApplicationWindowContent
                    windowId={paneId}
                    definition={definition}
                    visible={paneVisible()}
                    active={
                      (definition?.type === 'browser' ? model.activeBrowserId : model.focusedId) ===
                      paneId
                    }
                    editableFolders={readOnlyMode ? [] : editableFolders}
                    knowledgeBases={knowledgeBases}
                    fileIconContext={fileIconContext()}
                    actions={windowActions}
                    autoPlayVideo={false}
                  />
                </div>
              </>
            )
          })}
        </div>
        {state().camera.zoom < LIVE_ZOOM ? (
          <div
            class='absolute inset-0 flex flex-col items-center justify-center overflow-hidden bg-muted/40 text-center'
            style={{ gap: `${summaryMetrics().gap}px`, padding: `${summaryMetrics().padding}px` }}
          >
            <span
              data-testid='canvas-window-zoom-icon'
              class='inline-flex items-center justify-center'
              style={{ transform: `scale(${summaryMetrics().iconScale})` }}
            >
              {windowIcon(definitionFor(item()!), fileIconContext(), 'md')}
            </span>
            <p
              data-testid='canvas-window-zoom-title'
              class='max-w-full truncate font-semibold leading-[1.15]'
              style={{ 'font-size': `${summaryMetrics().title}px` }}
            >
              {definitionFor(item()!).title}
              {members().length > 1 ? <> · {members().length} tabs</> : null}
            </p>
            <p
              data-testid='canvas-window-zoom-kind'
              class='max-w-full truncate font-semibold leading-[1.15] text-foreground/80'
              style={{ 'font-size': `${summaryMetrics().kind}px` }}
            >
              {details().kind}
            </p>
            {showSummaryPath() ? (
              <p
                data-testid='canvas-window-zoom-path'
                class='max-w-full truncate leading-[1.15] text-muted-foreground'
                style={{ 'font-size': `${summaryMetrics().path}px` }}
              >
                {details().path}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
      {selected() && !readOnlyMode && !maximized() ? (
        <ResizeHandles
          onStart={(direction, event) => startWindowResize(item()!.id, direction, event)}
        />
      ) : null}
    </div>
  ) : null
})
const canvasStrings = collection<string>((value) => value)
const resizeHandles = collection<{ direction: ResizeDirection; class: string }>(
  (handle) => handle.direction,
)
