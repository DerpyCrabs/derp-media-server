import { cn } from '@/lib/ui/cn'
import { view, domBinding, list, collection, controllerView } from 'effectweb'
import { randomId } from '@/lib/random-id'
import { getFileDragData, hasFileDragData } from '@/lib/files/file-drag-data'
import { fileSearchResultToFileItem } from '@/lib/files/file-search'
import {
  CANVAS_GRID_SIZE,
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  canvasWindowVisualBounds,
  type CanvasWindow,
} from '@/workspace/canvas/model/infinite-canvas'
import { getMediaTypeFromPath } from '@/lib/media/media-utils'
import { isHermesOpenTarget } from '@/features/hermes/hermes-open-target'
import FileText from '@effectweb/lucide/icons/file-text'
import FolderOpen from '@effectweb/lucide/icons/folder-open'
import Maximize2 from '@effectweb/lucide/icons/maximize-2'
import MessageSquare from '@effectweb/lucide/icons/message-square'
import PanelLeft from '@effectweb/lucide/icons/panel-left'
import PanelsTopLeft from '@effectweb/lucide/icons/panels-top-left'
import Volume2 from '@effectweb/lucide/icons/volume-2'
import X from '@effectweb/lucide/icons/x'
import { windowIcon } from '@/features/explorer/file-icon'
import { ApplicationWindowContent } from '@/workspace/shared/ApplicationWindowContent'
import { navigateSearchParams } from '@/lib/browser/browser-history'
import {
  type CanvasContextMenuState,
  type CanvasDialogState,
} from '@/workspace/canvas/model/canvas-overlay-state'
import { WorkspaceSwitcher } from '@/workspace/shared/WorkspaceSwitcher'
import { WorkspaceTaskbarAudio } from '@/workspace/taskbar/WorkspaceTaskbarAudio'
import { WorkspaceTaskbarSettings } from '@/workspace/taskbar/WorkspaceTaskbarSettings'
import { WorkspaceSaveStatus } from '@/workspace/shared/WorkspaceSaveStatus'
import {
  WorkspaceTaskbar,
  WorkspaceTaskbarPins,
  WORKSPACE_TASKBAR_END_CLASS,
  WORKSPACE_TASKBAR_ICON_BUTTON_CLASS,
} from '@/workspace/shared/WorkspaceTaskbar'
import { FileSearchButton } from '@/features/explorer/FileSearchPalette'
import { WorkspaceWindowTitlebar } from '@/workspace/shared/WorkspaceWindowTitlebar'
import { FloatingContextMenu } from '@/features/explorer/FloatingContextMenu'
import { FLOATING_Z_PIN_MENU } from '@/lib/ui/floating-z-index'
import { modalFocus } from '@/lib/ui/modal-focus'
import { WorkspaceDocumentCommands } from '@/workspace/model/workspace-document-commands'
import {
  LIVE_ZOOM,
  FAR_ZOOM,
  ResizeDirection,
  EMPTY_CANVAS_BOUNDS,
  canvasWindowDetails,
  fileItemFromDrag,
  mediaWindowSizeKey,
  createCanvasController,
} from './canvas-workspace-controller'
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
const MenuButton = view<{
  children: unknown
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}>((props) => {
  return (
    <button
      type='button'
      disabled={props.disabled}
      class={`flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-sm disabled:opacity-40 ${props.danger ? 'text-destructive hover:bg-destructive/10' : 'hover:bg-muted'}`}
      onClick={() => {
        props.onClick()
      }}
    >
      {props.children as never}
    </button>
  )
})
function canvasDialogLabel(dialog: CanvasDialogState): string {
  switch (dialog.kind) {
    case 'new-note':
      return 'New document'
  }
  throw new Error('Unhandled canvas dialog')
}
const mountCanvasElement = (
  element: HTMLDivElement,
  current: () => (element: HTMLDivElement | undefined) => void,
) => {
  current()(element)
  return () => current()(undefined)
}
export const CanvasWorkspace = controllerView(
  { controller: createCanvasController },
  view((model) => {
    const {
      setOutlineOpen,
      toggleWorkspacePanel,
      selectCanvasPinned,
      focusWindow,
      setZoomFromControl,
      zoomBy,
      fitAllWindows,
      setSearchOpen,
      addFileWindow,
      viewportCenterWorld,
      playbackSession,
      removePinnedItem,
      clearCanvasCrossWorkspaceHover,
      setWorkspacePanelOpen,
      lifecycle,
      setFileDropPreview,
      clearSelection,
      zoomAt,
      onCanvasContextMenu,
      screenToWorld,
      fileWindowPlacement,
      addHermesWindow,
      openNoteComposer,
      addBlankHermesWindow,
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
      windowActions,
      startWindowResize,
      createDocumentFromComposer,
      session,
      registryCommands,
      setWorkspaceTransition,
      overlayCommands,
    } = model
    const state = () => ({ ...model.state, windows: [...model.state.windows] })
    const fileIconContext = () => model.fileIconContext
    const selectedWindow = () => model.selectedWindow
    const maximizedWindowId = () => model.maximizedWindowId
    const lastAudioWindow = () => model.lastAudioWindow
    const searchOpen = () => model.searchOpen
    const workspacePanelOpen = () => model.workspacePanelOpen
    const workspaceId = () => model.workspaceId
    const outlineOpen = () => model.outlineOpen
    const spaceHeld = () => model.spaceHeld
    const geometryActive = () => model.geometryActive
    const fileDropPreview = () => model.fileDropPreview
    const readOnlyMode = () => model.readOnlyMode
    const cameraAnimating = () => model.cameraAnimating
    const canvasGroupIds = () => model.canvasGroupIds
    const workspaceSnapshot = () => model.workspaceSnapshot
    const viewportSize = () => model.viewportSize
    const selectedIds = () => model.selectedIds
    const canvasMergeDrag = () => model.canvasMergeDrag
    const editableFolders = () => model.editableFolders
    const knowledgeBases = () => model.knowledgeBases
    const fileDropVisualBounds = () => model.fileDropVisualBounds
    const writableDirectories = () => model.writableDirectories
    const definitionFor = (window: CanvasWindow) => {
      const definition = model.workspace.windows.find((item) => item.id === window.id)
      if (!definition) throw new Error('Missing workspace window ' + window.id)
      return definition
    }
    const groupWindows = (groupId: string) =>
      model.state.windows.filter(
        (window) => (definitionFor(window).tabGroupId ?? window.id) === groupId,
      )
    const activeWindowForGroup = (groupId: string) => {
      const group = groupWindows(groupId)
      const activeId = model.workspaceSnapshot?.activeTabMap[groupId]
      return group.find((window) => window.id === activeId) ?? group[0]
    }
    return (
      <div
        use={domBinding(model.start, startCanvas)}
        data-workspace-opened={model.opened ? '' : undefined}
        class={`canvas-layout fixed inset-0 flex select-none flex-col overflow-hidden bg-background text-foreground ${model.opened ? 'pointer-events-auto' : 'pointer-events-none'}`}
      >
        {!model.editable ? (
          <div class='fixed left-1/2 top-2 z-[100002] -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-1.5 text-xs shadow-lg'>
            Read only — workspace is open elsewhere
          </div>
        ) : null}
        <WorkspaceTaskbar fixed scrollable class='canvas-taskbar'>
          <button
            type='button'
            title='Canvas outline'
            aria-label='Canvas outline'
            class={WORKSPACE_TASKBAR_ICON_BUTTON_CLASS}
            onClick={() => {
              setOutlineOpen((open) => !open)
            }}
          >
            <PanelLeft class='h-5 w-5' stroke-width={1.75} />
          </button>
          <button
            type='button'
            title='Workspaces'
            aria-label='Open workspaces'
            data-testid='workspace-taskbar-workspaces'
            data-workspace-toggle
            class={WORKSPACE_TASKBAR_ICON_BUTTON_CLASS}
            onClick={toggleWorkspacePanel}
          >
            <PanelsTopLeft class='h-5 w-5' stroke-width={1.75} />
          </button>
          <div class='flex min-w-0 flex-1 items-center'>
            {model.serverPins.length > 0 ? (
              <WorkspaceTaskbarPins
                items={model.serverPins}
                customIcons={model.settings?.customIcons ?? {}}
                fileIconContext={fileIconContext()}
                onSelect={selectCanvasPinned}
                onContextMenu={(pin, event) => {
                  event.preventDefault()
                  overlayCommands.openPinMenu({ x: event.clientX, y: event.clientY, pinId: pin.id })
                }}
              />
            ) : null}
            {model.serverPins.length > 0 && selectedWindow() ? (
              <div class='w-2 shrink-0' aria-hidden='true' />
            ) : null}
            <div class='flex min-w-0 flex-1 items-center' data-testid='canvas-navigation'>
              {((item) =>
                item ? (
                  <button
                    type='button'
                    data-testid='canvas-window-breadcrumb'
                    class='min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-sm hover:bg-muted'
                    onClick={() => {
                      focusWindow(item.id)
                    }}
                  >
                    {definitionFor(item).title}
                  </button>
                ) : null)(selectedWindow())}
            </div>
          </div>
          <div class={WORKSPACE_TASKBAR_END_CLASS}>
            <WorkspaceSaveStatus session={session} />
            <div data-testid='canvas-create-tools' class='flex items-center gap-1'>
              {!maximizedWindowId() ? (
                <div
                  data-testid='canvas-zoom-control'
                  class='flex h-7 shrink-0 items-center gap-1 border-r border-border pr-1'
                  onWheel={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    const direction = Math.sign(event.deltaY || event.deltaX)
                    if (direction !== 0) {
                      setZoomFromControl(state().camera.zoom - direction * 0.05)
                    }
                  }}
                >
                  <input
                    type='range'
                    title='Canvas zoom'
                    aria-label='Canvas zoom'
                    aria-valuetext={`${Math.round(state().camera.zoom * 100)} percent`}
                    min={Math.round(CANVAS_MIN_ZOOM * 100)}
                    max={Math.round(CANVAS_MAX_ZOOM * 100)}
                    step='1'
                    value={Math.round(state().camera.zoom * 100)}
                    class='[&::-webkit-slider-thumb]:bg-primary h-1 w-16 cursor-pointer appearance-none rounded-full bg-secondary [&::-webkit-slider-thumb]:size-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full'
                    onInput={(event) => {
                      setZoomFromControl(event.currentTarget.valueAsNumber / 100)
                    }}
                  />
                  <button
                    type='button'
                    title='Reset zoom'
                    aria-label={`Reset canvas zoom, currently ${Math.round(state().camera.zoom * 100)} percent`}
                    class='h-7 min-w-9 px-1 text-[11px] tabular-nums hover:bg-muted'
                    onClick={() => {
                      zoomBy(1 / state().camera.zoom)
                    }}
                  >
                    {Math.round(state().camera.zoom * 100)}%
                  </button>
                </div>
              ) : null}
              <button
                type='button'
                class={WORKSPACE_TASKBAR_ICON_BUTTON_CLASS}
                title='Fit all canvas cards'
                aria-label='Fit all canvas cards'
                onClick={fitAllWindows}
              >
                <Maximize2 class='size-3.5' />
              </button>
              {((item) =>
                item ? (
                  <button
                    type='button'
                    data-testid='canvas-playing-audio-focus'
                    aria-label={`Focus audio player: ${definitionFor(item).title}`}
                    title={`Focus audio player: ${definitionFor(item).title}`}
                    class='inline-flex size-7 items-center justify-center text-primary hover:bg-primary/10'
                    onClick={() => {
                      focusWindow(item.id)
                    }}
                  >
                    <Volume2 class='size-4' />
                  </button>
                ) : null)(lastAudioWindow())}
              <FileSearchButton
                title='Search library and open a new canvas window'
                testId='canvas-search-trigger'
                class={WORKSPACE_TASKBAR_ICON_BUTTON_CLASS}
                open={searchOpen()}
                onOpenChange={setSearchOpen}
                onSelect={(result) =>
                  addFileWindow(fileSearchResultToFileItem(result), viewportCenterWorld())
                }
              />
            </div>
            <WorkspaceTaskbarAudio
              onShowVideo={(path) => {
                const item = state().windows.find(
                  (window) => definitionFor(window).initialState.viewing === path,
                )
                if (item) focusWindow(item.id)
              }}
              onStopPlayback={() => playbackSession.dispatch({ type: 'stop' })}
            />
            <WorkspaceTaskbarSettings
              workspaceTransition={model.settings?.workspaceTransition ?? 'fade'}
              onWorkspaceTransitionChange={(value) => setWorkspaceTransition(value)}
            />
          </div>
        </WorkspaceTaskbar>

        <FloatingContextMenu
          state={model.pinMenu}
          anchor={(current) => ({ x: current.x, y: current.y })}
          onDismiss={overlayCommands.closePinMenu}
          zIndex={FLOATING_Z_PIN_MENU}
          data-slot='pin-context-menu'
          pinContextMenuRoot
        >
          {(current) => (
            <button
              type='button'
              data-slot='context-menu-item'
              class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
              role='menuitem'
              onClick={() => {
                removePinnedItem(current.pinId)
                overlayCommands.closePinMenu()
              }}
            >
              Unpin
            </button>
          )}
        </FloatingContextMenu>

        <WorkspaceSwitcher
          open={workspacePanelOpen()}
          activeId={workspaceId()}
          registry={model.registry}
          editable={model.editable}
          onToggle={() => {
            clearCanvasCrossWorkspaceHover()
            toggleWorkspacePanel()
          }}
          onDismiss={() => {
            clearCanvasCrossWorkspaceHover()
            setWorkspacePanelOpen(false)
          }}
          onSelect={(id) =>
            registryCommands.transition(() => navigateSearchParams({ ws: id }, 'push'))
          }
          onOpenNewTab={(id) =>
            window.open(`/workspace?ws=${encodeURIComponent(id)}`, '_blank', 'noopener,noreferrer')
          }
          onCreate={() =>
            registryCommands.transition(() => navigateSearchParams({ ws: randomId() }, 'push'))
          }
          onTakeControl={() => registryCommands.takeControl()}
          onRename={(id, name) => registryCommands.updateMetadata(id, { name })}
          onIcon={(id, icon, iconColor) => registryCommands.updateMetadata(id, { icon, iconColor })}
          onDelete={lifecycle.deleteWorkspace}
          onConvert={lifecycle.convertWorkspace}
          onReorder={registryCommands.reorder}
          draggingWindow={model.transferActive}
          hoverTarget={model.transferHover}
          transferReady={model.transferReady}
        />

        {outlineOpen() ? (
          <aside class='fixed top-0 bottom-8 left-0 z-[110000] flex w-72 flex-col border-r border-border bg-card/95 shadow-xl backdrop-blur'>
            <div class='flex h-11 items-center justify-between border-b px-3'>
              <span class='text-sm font-semibold'>Canvas outline</span>
              <button
                type='button'
                aria-label='Close canvas outline'
                class='size-8 rounded hover:bg-muted'
                onClick={() => {
                  setOutlineOpen(false)
                }}
              >
                <X class='mx-auto size-4' />
              </button>
            </div>
            <div class='min-h-0 flex-1 overflow-auto p-2'>
              <p class='px-2 pt-3 pb-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase'>
                Windows
              </p>
              {list(canvasWindows.from(state().windows), (item) => (
                <button
                  type='button'
                  class='flex h-9 w-full items-center gap-2 rounded px-2 text-left text-sm hover:bg-muted'
                  onClick={() => {
                    focusWindow(item.id)
                  }}
                >
                  <span class='shrink-0'>
                    {windowIcon(definitionFor(item), fileIconContext(), 'sm')}
                  </span>
                  <span class='truncate'>{definitionFor(item).title}</span>
                </button>
              ))}
            </div>
          </aside>
        ) : null}

        <div
          use={domBinding(model.mountViewport, mountCanvasElement)}
          data-testid='infinite-canvas'
          class={cn('relative min-h-0 flex-1 overflow-hidden bg-muted/20 outline-none', {
            'cursor-grab': spaceHeld(),
            'cursor-grabbing': geometryActive(),
          })}
          style={{
            'background-image':
              state().camera.zoom < FAR_ZOOM
                ? 'none'
                : 'radial-gradient(circle, color-mix(in oklab, var(--muted-foreground) 36%, transparent) 1px, transparent 1px)',
            'background-size': `${CANVAS_GRID_SIZE * state().camera.zoom}px ${CANVAS_GRID_SIZE * state().camera.zoom}px`,
            'background-position': `${state().camera.x}px ${state().camera.y}px`,
            'background-color': geometryActive()
              ? 'color-mix(in oklab, var(--muted) 45%, var(--background))'
              : undefined,
          }}
          tabindex={-1}
          onPointerDown={(event) => {
            if (fileDropPreview()) setFileDropPreview(null)
            if (event.button === 0 && event.target === event.currentTarget) {
              clearSelection()
              overlayCommands.closeCanvasMenu()
              event.currentTarget.focus()
            }
          }}
          onWheel={(event) => {
            if (event.ctrlKey || event.metaKey) {
              event.preventDefault()
              zoomAt(
                event.clientX,
                event.clientY,
                state().camera.zoom * Math.exp(-event.deltaY * 0.002),
              )
              return
            }
          }}
          onContextMenu={onCanvasContextMenu}
          onDragOver={(event) => {
            if (readOnlyMode()) return
            if (!event.dataTransfer || !hasFileDragData(event.dataTransfer)) return
            if ((event.target as Element | null)?.closest('[data-testid="canvas-window"]')) return
            event.preventDefault()
            event.dataTransfer.dropEffect = 'copy'
          }}
          onDragLeave={(event) => {
            const nextTarget = event.relatedTarget as Node | null
            if (!nextTarget || !event.currentTarget.contains(nextTarget)) setFileDropPreview(null)
          }}
          onDragEnd={() => {
            setFileDropPreview(null)
          }}
          onDrop={(event) => {
            if (readOnlyMode()) return
            const transfer = event.dataTransfer
            if (!transfer) return
            if ((event.target as Element | null)?.closest('[data-testid="canvas-window"]')) return
            const data = getFileDragData(transfer)
            if (!data || data.sourceKind !== 'local') return
            event.preventDefault()
            const point = screenToWorld(event.clientX, event.clientY)
            const placement =
              fileDropPreview() ??
              fileWindowPlacement(
                point,
                state(),
                data.virtualOpenTarget
                  ? 'hermes'
                  : data.isDirectory
                    ? 'browser'
                    : mediaWindowSizeKey(getMediaTypeFromPath(data.path)),
              )
            setFileDropPreview(null)
            if (data.virtualOpenTarget && isHermesOpenTarget(data.virtualOpenTarget)) {
              addHermesWindow(
                fileItemFromDrag(data.path, false),
                data.virtualOpenTarget,
                point,
                placement.bounds,
              )
              return
            }
            addFileWindow(fileItemFromDrag(data.path, data.isDirectory), point, {
              duplicate: true,
              worldBounds: placement.bounds,
            })
          }}
        >
          {!readOnlyMode() && !state().windows.length ? (
            <div class='pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-8'>
              <div class='pointer-events-auto max-w-lg rounded-2xl border border-border bg-card/90 p-7 text-center shadow-xl backdrop-blur'>
                <h1 class='text-lg font-semibold'>Build your knowledge canvas</h1>
                <p class='mt-2 text-sm leading-6 text-muted-foreground'>
                  Add documents, files, or AI chats.
                </p>
                <div class='mt-5 flex flex-wrap justify-center gap-2'>
                  <button
                    type='button'
                    class='rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground'
                    onClick={() => {
                      openNoteComposer()
                    }}
                  >
                    New document
                  </button>
                  <button
                    type='button'
                    class='rounded-md border border-border px-3 py-2 text-sm hover:bg-muted'
                    onClick={() => {
                      addFileWindow(null, viewportCenterWorld())
                    }}
                  >
                    Browse files
                  </button>
                  <button
                    type='button'
                    class='rounded-md border border-border px-3 py-2 text-sm hover:bg-muted'
                    onClick={() => {
                      addBlankHermesWindow()
                    }}
                  >
                    Ask AI
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          <div
            use={domBinding(model.mountWorld, mountCanvasElement)}
            data-testid='canvas-world'
            class={cn('absolute top-0 left-0 origin-top-left will-change-transform', {
              'transition-transform duration-200 ease-out': cameraAnimating(),
            })}
            style={{
              transform: `translate3d(${state().camera.x}px, ${state().camera.y}px, 0) scale(${state().camera.zoom})`,
            }}
          >
            {list(canvasStrings.from(canvasGroupIds()), (groupId) => {
              const members = () => groupWindows(groupId)
              const item = () => activeWindowForGroup(groupId)
              const split = () => workspaceSnapshot()?.tabGroupSplits?.[groupId]
              const memberIds = () => members().map((member) => member.id)
              const worldBounds = () =>
                members()[0]?.bounds ?? item()?.bounds ?? EMPTY_CANVAS_BOUNDS
              const maximized = () => {
                const active = item()
                return active ? maximizedWindowId() === active.id : false
              }
              const visualBounds = () => {
                if (!maximized()) return canvasWindowVisualBounds(worldBounds())
                const zoom = state().camera.zoom
                return {
                  x: -state().camera.x / zoom,
                  y: -state().camera.y / zoom,
                  width: viewportSize().width,
                  height: viewportSize().height,
                }
              }
              const selected = () => members().some((member) => selectedIds().includes(member.id))
              const details = () => {
                const active = item()
                return active
                  ? canvasWindowDetails(definitionFor(active))
                  : { kind: '', path: null }
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
                const padding = Math.min(
                  16,
                  Math.max(7, Math.min(screenWidth, screenHeight) * 0.07),
                )
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
                  Boolean(
                    active && details().path && details().path !== definitionFor(active).title,
                  ) &&
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
                    opacity:
                      canvasMergeDrag()?.target && canvasMergeDrag()?.sourceGroupId === groupId
                        ? 0.55
                        : undefined,
                    'z-index': maximized()
                      ? 2000000
                      : selected()
                        ? 1000000 + item()!.zIndex
                        : item()!.zIndex,
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
                    tabs={() => members().map(definitionFor)}
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
                    mergeHighlightInsertIndex={() =>
                      canvasMergeDrag()?.target?.groupId === groupId
                        ? canvasMergeDrag()!.target!.insertIndex
                        : null
                    }
                    splitLeftTabId={() => split()?.leftTabId}
                    onActivateTab={selectCanvasTab}
                    onFocusWindow={activateWindow}
                    onCloseTab={(windowId) => closeWindow(windowId)}
                    onToggleTabPinned={toggleCanvasTabPinned}
                    onTabPullStart={startCanvasTabPull}
                    onExitSplitView={() =>
                      updateCanvasWorkspace((current) =>
                        WorkspaceDocumentCommands.exitSplit(current, groupId),
                      )
                    }
                    onUseAsSplitLeftTab={(tabId) =>
                      updateCanvasWorkspace((current) =>
                        WorkspaceDocumentCommands.setSplitLeft(current, tabId),
                      )
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
                    onClose={readOnlyMode() ? undefined : () => closeWindowGroup(groupId)}
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
                        'invisible pointer-events-none':
                          state().camera.zoom < LIVE_ZOOM && !maximized(),
                      })}
                    >
                      {list(canvasStrings.from(memberIds()), (paneId, index) => {
                        const pane = state().windows.find((window) => window.id === paneId)
                        const definition = pane ? definitionFor(pane) : undefined
                        const paneVisible = () =>
                          paneId === item()!.id || paneId === split()?.leftTabId
                        return (
                          <>
                            {split() && paneId === item()!.id && paneId !== split()?.leftTabId ? (
                              <div
                                data-testid='workspace-split-divider'
                                data-no-window-drag
                                class='w-1.5 shrink-0 cursor-col-resize border-border bg-muted/40 hover:bg-primary/25'
                                style={{
                                  'border-left-width': '1px',
                                  'border-right-width': '1px',
                                  order: 1,
                                }}
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
                                  (definition?.type === 'browser'
                                    ? model.workspace.activeWindowId
                                    : model.focusedId) === paneId
                                }
                                editableFolders={readOnlyMode() ? [] : editableFolders()}
                                knowledgeBases={knowledgeBases()}
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
                        style={{
                          gap: `${summaryMetrics().gap}px`,
                          padding: `${summaryMetrics().padding}px`,
                        }}
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
                  {selected() && !readOnlyMode() && !maximized() ? (
                    <ResizeHandles
                      onStart={(direction, event) =>
                        startWindowResize(item()!.id, direction, event)
                      }
                    />
                  ) : null}
                </div>
              ) : null
            })}
            {state().camera.zoom < FAR_ZOOM
              ? list(canvasStrings.from(canvasGroupIds()), (groupId) => {
                  const item = () => activeWindowForGroup(groupId)
                  const memberCount = () => groupWindows(groupId).length
                  const bounds = () =>
                    canvasWindowVisualBounds(item()?.bounds ?? EMPTY_CANVAS_BOUNDS)
                  const details = () => {
                    const active = item()
                    return active
                      ? canvasWindowDetails(definitionFor(active))
                      : { kind: '', path: null }
                  }
                  const metrics = () => {
                    const zoom = state().camera.zoom
                    const screenWidth = bounds().width * zoom
                    const screenHeight = bounds().height * zoom
                    const shortSide = Math.min(screenWidth, screenHeight)
                    return {
                      horizontal: screenWidth >= screenHeight * 1.25,
                      iconScale: Math.min(28, Math.max(12, shortSide * 0.2)) / 20 / zoom,
                      title: Math.min(18, Math.max(10, shortSide * 0.14)) / zoom,
                      kind: Math.min(13, Math.max(8, shortSide * 0.1)) / zoom,
                      path: Math.min(11, Math.max(7, shortSide * 0.085)) / zoom,
                      gap: Math.min(12, Math.max(5, shortSide * 0.08)) / zoom,
                      padding: Math.min(16, Math.max(6, shortSide * 0.08)) / zoom,
                      showPath: screenWidth >= 120 && screenHeight >= 70,
                    }
                  }
                  return item() ? (
                    <button
                      type='button'
                      data-testid='canvas-window-summary'
                      data-window-id={item().id}
                      class='absolute overflow-hidden rounded-lg bg-card p-0 text-left shadow-lg'
                      style={{
                        left: `${bounds().x}px`,
                        top: `${bounds().y}px`,
                        width: `${bounds().width}px`,
                        height: `${bounds().height}px`,
                        'z-index': item()!.zIndex,
                      }}
                      onClick={() => {
                        focusWindow(item()!.id)
                      }}
                    >
                      <span
                        data-testid='canvas-window-summary-content'
                        class={cn(
                          'absolute inset-0 flex items-center justify-center overflow-hidden text-center',
                          { 'flex-col': !metrics().horizontal },
                        )}
                        style={{
                          width: `${bounds().width}px`,
                          height: `${bounds().height}px`,
                          'box-sizing': 'border-box',
                          gap: `${metrics().gap}px`,
                          padding: `${metrics().padding}px`,
                        }}
                      >
                        <span
                          class='inline-flex shrink-0 items-center justify-center'
                          style={{ transform: `scale(${metrics().iconScale})` }}
                        >
                          {windowIcon(definitionFor(item()!), fileIconContext(), 'md')}
                        </span>
                        <span class='min-w-0 max-w-full overflow-hidden'>
                          <span
                            data-testid='canvas-window-summary-title'
                            class='block truncate font-semibold leading-[1.15]'
                            style={{ 'font-size': `${metrics().title}px` }}
                          >
                            {definitionFor(item()!).title}
                            {memberCount() > 1 ? <> · {memberCount()} tabs</> : null}
                          </span>
                          <span
                            class='mt-1 block truncate font-medium leading-[1.15] text-muted-foreground'
                            style={{ 'font-size': `${metrics().kind}px` }}
                          >
                            {details().kind}
                          </span>
                          {metrics().showPath &&
                          details().path &&
                          details().path !== definitionFor(item()!).title ? (
                            <span
                              class='mt-1 block truncate leading-[1.15] text-muted-foreground'
                              style={{ 'font-size': `${metrics().path}px` }}
                            >
                              {details().path}
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </button>
                  ) : null
                })
              : null}
            <div
              data-testid='canvas-drop-preview'
              class={cn(
                'pointer-events-none absolute overflow-hidden rounded-lg border-2 border-dashed border-primary bg-primary/10 shadow-xl',
                { invisible: !fileDropVisualBounds() },
              )}
              style={{
                left: `${fileDropVisualBounds()?.x ?? 0}px`,
                top: `${fileDropVisualBounds()?.y ?? 0}px`,
                width: `${fileDropVisualBounds()?.width ?? 0}px`,
                height: `${fileDropVisualBounds()?.height ?? 0}px`,
                'z-index': 1000000,
              }}
            >
              <div class='flex h-8 items-center justify-between border-b border-primary/40 bg-primary/15 px-3 text-xs font-medium text-primary'>
                <span>New window</span>
                <span class='tabular-nums'>
                  {fileDropPreview()?.bounds.width ?? 0} × {fileDropPreview()?.bounds.height ?? 0}
                </span>
              </div>
            </div>
          </div>
        </div>

        {model.canvasMenu ? (
          <div
            data-canvas-context-menu
            class='fixed z-[120000] max-h-[70vh] w-60 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-2xl'
            style={{
              left: `${Math.min(model.canvasMenu.clientX, model.viewportSize.width - 252)}px`,
              top: `${Math.min(model.canvasMenu.clientY, model.viewportSize.height - 340)}px`,
            }}
            onPointerDown={(event) => {
              event.stopPropagation()
            }}
          >
            {model.canvasMenu.kind === 'canvas' ? (
              <>
                <MenuButton
                  onClick={() => {
                    const value = model.canvasMenu as CanvasContextMenuState
                    openNoteComposer({ x: value.worldX, y: value.worldY })
                    overlayCommands.closeCanvasMenu()
                  }}
                >
                  <FileText class='size-4' />
                  New document
                </MenuButton>
                <MenuButton
                  onClick={() => {
                    const value = model.canvasMenu as CanvasContextMenuState
                    addFileWindow(null, { x: value.worldX, y: value.worldY })
                    overlayCommands.closeCanvasMenu()
                  }}
                >
                  <FolderOpen class='size-4' />
                  Open file browser
                </MenuButton>
                <MenuButton
                  onClick={() => {
                    const value = model.canvasMenu as CanvasContextMenuState
                    addBlankHermesWindow({ x: value.worldX, y: value.worldY })
                    overlayCommands.closeCanvasMenu()
                  }}
                >
                  <MessageSquare class='size-4' />
                  New AI chat
                </MenuButton>
              </>
            ) : null}
          </div>
        ) : null}

        {model.noteDialog ? (
          <div
            class='fixed inset-0 z-[1300000] flex items-center justify-center bg-black/55 p-4'
            onPointerDown={(event) => {
              if (event.target === event.currentTarget) overlayCommands.closeNote()
            }}
          >
            <div
              use={modalFocus({
                onEscape: overlayCommands.closeNote,
                fallbackFocus: () =>
                  document.querySelector('[data-testid="workspace-taskbar-workspaces"]'),
              })}
              role='dialog'
              aria-modal='true'
              aria-labelledby='canvas-dialog-title'
              class={cn(
                'w-full rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-2xl',
                {
                  'max-w-lg': model.noteDialog.kind === 'new-note',
                  'max-w-sm': model.noteDialog.kind !== 'new-note',
                },
              )}
            >
              <span id='canvas-dialog-title' class='sr-only'>
                {canvasDialogLabel(model.noteDialog)}
              </span>
              {((value) =>
                value ? (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault()
                      if (!value.title.trim() || !value.directory) return
                      createDocumentFromComposer(value)
                    }}
                  >
                    <h2 class='text-base font-semibold'>New document</h2>
                    <p class='mt-1 text-xs text-muted-foreground'>
                      Creates a Markdown file and opens it on this canvas.
                    </p>
                    <label class='mt-4 block text-sm text-muted-foreground'>Title</label>
                    <input
                      autofocus
                      aria-label='Document title'
                      maxlength={120}
                      class='mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring'
                      value={model.noteDialog.title}
                      onInput={(event) => {
                        overlayCommands.updateNoteTitle(event.currentTarget.value)
                      }}
                    />
                    <label class='mt-4 block text-sm text-muted-foreground'>Location</label>
                    <select
                      aria-label='Document location'
                      class='mt-1 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring'
                      value={model.noteDialog.directory}
                      onChange={(event) => {
                        overlayCommands.updateNoteDirectory(event.currentTarget.value)
                      }}
                    >
                      {list(canvasStrings.from(writableDirectories()), (directory) => (
                        <option value={directory}>{directory}</option>
                      ))}
                    </select>
                    <div class='mt-5 flex justify-end gap-2'>
                      <button
                        type='button'
                        class='h-9 rounded-md px-3 text-sm hover:bg-muted'
                        onClick={overlayCommands.closeNote}
                      >
                        Cancel
                      </button>
                      <button
                        type='submit'
                        class='h-9 rounded-md bg-primary px-3 text-sm text-primary-foreground disabled:opacity-40'
                        disabled={!model.noteDialog.title.trim() || !model.noteDialog.directory}
                      >
                        Create document
                      </button>
                    </div>
                  </form>
                ) : null)(
                model.noteDialog.kind === 'new-note'
                  ? (model.noteDialog as Extract<CanvasDialogState, { kind: 'new-note' }>)
                  : undefined,
              )}
            </div>
          </div>
        ) : null}
      </div>
    )
  }),
)
const startCanvas = (_element: HTMLElement, current: () => () => void) => {
  let disposed = false
  queueMicrotask(() => {
    if (!disposed) current()()
  })
  return () => {
    disposed = true
  }
}
const canvasStrings = collection<string>((value) => value)
const canvasWindows = collection<CanvasWindow>((window) => window.id)
const resizeHandles = collection<{ direction: ResizeDirection; class: string }>(
  (handle) => handle.direction,
)
