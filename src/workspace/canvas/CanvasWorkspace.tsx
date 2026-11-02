import { MenuItem } from '@/lib/ui/menu-item'
import { Slider } from '@/lib/ui/slider'
import { Input } from '@/lib/ui/input'
import { Button } from '@/lib/ui/button'
import { TaskbarButton } from '../shared/TaskbarButton'
import { Select } from '@/lib/ui/select'
import { WorkspaceCommands } from '@/workspace/commands/WorkspaceCommands'
import { windowCommands, type WorkspaceCommand } from '@/workspace/commands/commands'
import { cn } from '@/lib/ui/cn'
import { view, domBinding, list, collection, controllerView, observe } from 'effectweb'
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
import { CanvasWindowGroup } from './CanvasWindowGroup'
import { FloatingContextMenu } from '@/features/explorer/FloatingContextMenu'
import { FLOATING_Z_PIN_MENU } from '@/lib/ui/floating-z-index'
import { Dialog } from '@/lib/ui/dialog'
import {
  FAR_ZOOM,
  EMPTY_CANVAS_BOUNDS,
  canvasWindowDetails,
  fileItemFromDrag,
  mediaWindowSizeKey,
  createCanvasController,
} from './canvas-workspace-controller'
const MenuButton = view<{
  children: unknown
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}>((props) => {
  return (
    <Button
      variant='destructive'
      type='button'
      disabled={props.disabled}
      class={`flex h-9 w-full items-center gap-2 rounded-md px-2.5 justify-start text-left text-sm disabled:opacity-40 ${props.danger ? 'text-destructive hover:bg-destructive/10' : 'hover:bg-muted'}`}
      onClick={() => {
        props.onClick()
      }}
    >
      {props.children as never}
    </Button>
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
      createDocumentFromComposer,
      session,
      registryCommands,
      setWorkspaceTransition,
      overlayCommands,
    } = model
    const state = () => model.state
    const fileIconContext = () => model.fileIconContext
    const selectedWindow = model.selectedWindow
    const maximizedWindowId = model.maximizedWindowId
    const lastAudioWindow = model.lastAudioWindow
    const searchOpen = model.searchOpen
    const workspacePanelOpen = model.workspacePanelOpen
    const workspaceId = model.workspaceId
    const outlineOpen = model.outlineOpen
    const spaceHeld = model.spaceHeld
    const geometryActive = model.geometryActive
    const fileDropPreview = model.fileDropPreview
    const readOnlyMode = model.readOnlyMode
    const cameraAnimating = model.cameraAnimating
    const canvasGroupIds = model.canvasGroupIds
    const fileDropVisualBounds = model.fileDropVisualBounds
    const writableDirectories = model.writableDirectories
    const definitionFor = (window: CanvasWindow) => {
      const definition = model.scene.definitions.get(window.id)
      if (!definition) throw new Error('Missing workspace window ' + window.id)
      return definition
    }
    const groupWindows = (groupId: string) => model.scene.groups.get(groupId) ?? []
    const activeWindowForGroup = (groupId: string) => model.scene.activeWindows.get(groupId)
    const activeDefinition = selectedWindow
      ? model.scene.definitions.get(selectedWindow.id)
      : undefined
    const commands: WorkspaceCommand[] = [
      ...windowCommands(
        [...model.scene.definitions.values()],
        selectedWindow?.id,
        model.editable,
        model.focusWindow,
      ),
      {
        id: 'new-browser',
        label: 'New file browser',
        group: 'Commands',
        disabled: !model.editable,
        run: () => addFileWindow(null, viewportCenterWorld()),
      },
      {
        id: 'search',
        label: 'Search files',
        group: 'Commands',
        run: () => model.setSearchOpen(true),
      },
      {
        id: 'workspaces',
        label: 'Switch workspace',
        group: 'Commands',
        run: () => setWorkspacePanelOpen(true),
      },
      { id: 'fit-all', label: 'Fit all windows', group: 'Commands', run: model.fitAllWindows },
      {
        id: 'zoom-reset',
        label: 'Zoom to 100%',
        group: 'Commands',
        run: () => setZoomFromControl(1),
      },
      ...(!model.editable
        ? [
            {
              id: 'take-control',
              label: 'Take control of this workspace',
              detail: 'Make this browser tab the active workspace',
              group: 'Commands' as const,
              run: registryCommands.takeControl,
            },
          ]
        : []),
      ...(activeDefinition
        ? [
            {
              id: 'maximize',
              label: maximizedWindowId ? 'Restore canvas view' : 'Maximize window',
              group: 'Commands' as const,
              disabled: !model.editable,
              run: () =>
                maximizedWindowId
                  ? model.setMaximizedWindowId(null)
                  : model.maximizeWindow(activeDefinition.id),
            },
            {
              id: 'close-tab',
              label: 'Close active tab',
              detail: activeDefinition.tabPinned
                ? 'Unpin this tab to close it'
                : activeDefinition.title,
              group: 'Commands' as const,
              disabled: !model.editable || activeDefinition.tabPinned,
              run: () => model.closeWindow(activeDefinition.id),
            },
          ]
        : []),
    ]
    return (
      <div
        use={domBinding(model.start, startCanvas)}
        data-workspace-opened={model.opened ? '' : undefined}
        class={`canvas-layout fixed inset-0 flex select-none flex-col overflow-hidden bg-background text-foreground ${model.opened ? 'pointer-events-auto' : 'pointer-events-none'}`}
      >
        <WorkspaceCommands available={model.opened} items={commands} />
        {!model.editable ? (
          <div class='fixed left-1/2 top-2 z-[100002] -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-1.5 text-xs shadow-lg'>
            Read only — workspace is open elsewhere
          </div>
        ) : null}
        <WorkspaceTaskbar fixed scrollable class='canvas-taskbar'>
          <TaskbarButton
            size='icon'
            variant='ghost'
            type='button'
            title='Canvas outline'
            aria-label='Canvas outline'
            class={WORKSPACE_TASKBAR_ICON_BUTTON_CLASS}
            onClick={() => {
              setOutlineOpen((open) => !open)
            }}
          >
            <PanelLeft class='size-5' stroke-width={1.75} />
          </TaskbarButton>
          <TaskbarButton
            size='icon'
            variant='ghost'
            type='button'
            title='Workspaces'
            aria-label='Open workspaces'
            data-testid='workspace-taskbar-workspaces'
            data-workspace-toggle
            class={WORKSPACE_TASKBAR_ICON_BUTTON_CLASS}
            onClick={toggleWorkspacePanel}
          >
            <PanelsTopLeft class='size-5' stroke-width={1.75} />
          </TaskbarButton>
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
            {model.serverPins.length > 0 && selectedWindow ? (
              <div class='w-2 shrink-0' aria-hidden='true' />
            ) : null}
            <div class='flex min-w-0 flex-1 items-center' data-testid='canvas-navigation'>
              {((item) =>
                item ? (
                  <TaskbarButton
                    variant='ghost'
                    type='button'
                    data-testid='canvas-window-breadcrumb'
                    class='min-w-0 flex-1 truncate rounded px-2 py-1 justify-start text-left text-sm hover:bg-muted'
                    onClick={() => {
                      focusWindow(item.id)
                    }}
                  >
                    {definitionFor(item).title}
                  </TaskbarButton>
                ) : null)(selectedWindow)}
            </div>
          </div>
          <div class={WORKSPACE_TASKBAR_END_CLASS}>
            <WorkspaceSaveStatus session={session} />
            <div data-testid='canvas-create-tools' class='flex items-center gap-1'>
              {!maximizedWindowId ? (
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
                  <Slider
                    title='Canvas zoom'
                    aria-label='Canvas zoom'
                    aria-valuetext={`${Math.round(state().camera.zoom * 100)} percent`}
                    min={Math.round(CANVAS_MIN_ZOOM * 100)}
                    max={Math.round(CANVAS_MAX_ZOOM * 100)}
                    step={1}
                    value={Math.round(state().camera.zoom * 100)}
                    class='data-horizontal:w-16 w-16'
                    onValueChange={(value) => {
                      setZoomFromControl(value / 100)
                    }}
                  />
                  <TaskbarButton
                    variant='ghost'
                    type='button'
                    title='Reset zoom'
                    aria-label={`Reset canvas zoom, currently ${Math.round(state().camera.zoom * 100)} percent`}
                    class='h-7 min-w-9 px-1 text-[11px] tabular-nums hover:bg-muted'
                    onClick={() => {
                      zoomBy(1 / state().camera.zoom)
                    }}
                  >
                    {Math.round(state().camera.zoom * 100)}%
                  </TaskbarButton>
                </div>
              ) : null}
              <TaskbarButton
                size='icon'
                variant='ghost'
                type='button'
                class={WORKSPACE_TASKBAR_ICON_BUTTON_CLASS}
                title='Fit all canvas cards'
                aria-label='Fit all canvas cards'
                onClick={fitAllWindows}
              >
                <Maximize2 class='size-3.5' />
              </TaskbarButton>
              {((item) =>
                item ? (
                  <TaskbarButton
                    size='icon'
                    variant='default'
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
                  </TaskbarButton>
                ) : null)(lastAudioWindow)}
              <FileSearchButton
                title='Search library and open a new canvas window'
                testId='canvas-search-trigger'
                class={WORKSPACE_TASKBAR_ICON_BUTTON_CLASS}
                open={searchOpen}
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
            <MenuItem
              variant='ghost'
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
            </MenuItem>
          )}
        </FloatingContextMenu>

        {observe(model.catalogSource, (registry) => (
          <WorkspaceSwitcher
            open={workspacePanelOpen}
            activeId={workspaceId}
            registry={registry}
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
              window.open(
                `/workspace?ws=${encodeURIComponent(id)}`,
                '_blank',
                'noopener,noreferrer',
              )
            }
            onCreate={() =>
              registryCommands.transition(() => navigateSearchParams({ ws: randomId() }, 'push'))
            }
            onTakeControl={() => registryCommands.takeControl()}
            onRename={(id, name) => registryCommands.updateMetadata(id, { name })}
            onIcon={(id, icon, iconColor) =>
              registryCommands.updateMetadata(id, { icon, iconColor })
            }
            onDelete={lifecycle.deleteWorkspace}
            onConvert={lifecycle.convertWorkspace}
            onReorder={registryCommands.reorder}
            draggingWindow={model.transferActive}
            hoverTarget={model.transferHover}
            transferReady={model.transferReady}
          />
        ))}

        {outlineOpen ? (
          <aside class='fixed top-0 bottom-8 left-0 z-[110000] flex w-72 flex-col border-r border-border bg-card/95 shadow-xl backdrop-blur'>
            <div class='flex h-11 items-center justify-between border-b px-3'>
              <span class='text-sm font-semibold'>Canvas outline</span>
              <Button
                size='icon'
                variant='ghost'
                type='button'
                aria-label='Close canvas outline'
                class='size-8 rounded hover:bg-muted'
                onClick={() => {
                  setOutlineOpen(false)
                }}
              >
                <X class='mx-auto size-4' />
              </Button>
            </div>
            <div class='min-h-0 flex-1 overflow-auto p-2'>
              <p class='px-2 pt-3 pb-1 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase'>
                Windows
              </p>
              {list(canvasWindows.from(state().windows), (item) => (
                <Button
                  variant='ghost'
                  type='button'
                  class='flex h-9 w-full items-center gap-2 rounded px-2 justify-start text-left text-sm hover:bg-muted'
                  onClick={() => {
                    focusWindow(item.id)
                  }}
                >
                  <span class='shrink-0'>
                    {windowIcon(definitionFor(item), fileIconContext(), 'sm')}
                  </span>
                  <span class='truncate'>{definitionFor(item).title}</span>
                </Button>
              ))}
            </div>
          </aside>
        ) : null}

        <div
          use={{
            ...domBinding(model.mountViewport, mountCanvasElement),
            identity: model.mountViewport,
          }}
          data-testid='infinite-canvas'
          class={cn('relative min-h-0 flex-1 overflow-hidden bg-muted/20 outline-none', {
            'cursor-grab': spaceHeld,
            'cursor-grabbing': geometryActive,
          })}
          style={{
            'background-image':
              state().camera.zoom < FAR_ZOOM
                ? 'none'
                : 'radial-gradient(circle, color-mix(in oklab, var(--muted-foreground) 36%, transparent) 1px, transparent 1px)',
            'background-size': `${CANVAS_GRID_SIZE * state().camera.zoom}px ${CANVAS_GRID_SIZE * state().camera.zoom}px`,
            'background-position': `${state().camera.x}px ${state().camera.y}px`,
            'background-color': geometryActive
              ? 'color-mix(in oklab, var(--muted) 45%, var(--background))'
              : undefined,
          }}
          tabindex={-1}
          onPointerDown={(event) => {
            if (fileDropPreview) setFileDropPreview(null)
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
            if (readOnlyMode) return
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
            if (readOnlyMode) return
            const transfer = event.dataTransfer
            if (!transfer) return
            if ((event.target as Element | null)?.closest('[data-testid="canvas-window"]')) return
            const data = getFileDragData(transfer)
            if (!data || data.sourceKind !== 'local') return
            event.preventDefault()
            const point = screenToWorld(event.clientX, event.clientY)
            const placement =
              fileDropPreview ??
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
          {!readOnlyMode && !state().windows.length ? (
            <div class='pointer-events-none absolute inset-0 z-10 flex items-center justify-center p-8'>
              <div class='pointer-events-auto max-w-lg rounded-2xl border border-border bg-card/90 p-7 text-center shadow-xl backdrop-blur'>
                <h1 class='text-lg font-semibold'>Build your knowledge canvas</h1>
                <p class='mt-2 text-sm leading-6 text-muted-foreground'>
                  Add documents, files, or AI chats.
                </p>
                <div class='mt-5 flex flex-wrap justify-center gap-2'>
                  <Button
                    variant='default'
                    type='button'
                    class='rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground'
                    onClick={() => {
                      openNoteComposer()
                    }}
                  >
                    New document
                  </Button>
                  <Button
                    variant='outline'
                    type='button'
                    class='rounded-md border border-border px-3 py-2 text-sm hover:bg-muted'
                    onClick={() => {
                      addFileWindow(null, viewportCenterWorld())
                    }}
                  >
                    Browse files
                  </Button>
                  <Button
                    variant='outline'
                    type='button'
                    class='rounded-md border border-border px-3 py-2 text-sm hover:bg-muted'
                    onClick={() => {
                      addBlankHermesWindow()
                    }}
                  >
                    Ask AI
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
          <div
            use={{
              ...domBinding(model.mountWorld, mountCanvasElement),
              identity: model.mountWorld,
            }}
            data-testid='canvas-world'
            class={cn('absolute top-0 left-0 origin-top-left will-change-transform', {
              'transition-transform duration-200 ease-out': cameraAnimating,
            })}
            style={{
              transform: `translate3d(${state().camera.x}px, ${state().camera.y}px, 0) scale(${state().camera.zoom})`,
            }}
          >
            {list(canvasGroups.from(model.windowGroups), (group) => (
              <CanvasWindowGroup {...group} />
            ))}
            {state().camera.zoom < FAR_ZOOM
              ? list(canvasStrings.from(canvasGroupIds), (groupId) => {
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
                    <Button
                      variant='ghost'
                      type='button'
                      data-testid='canvas-window-summary'
                      data-window-id={item()!.id}
                      class='absolute overflow-hidden rounded-lg bg-card p-0 justify-start text-left shadow-lg'
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
                    </Button>
                  ) : null
                })
              : null}
            <div
              data-testid='canvas-drop-preview'
              class={cn(
                'pointer-events-none absolute overflow-hidden rounded-lg border-2 border-dashed border-primary bg-primary/10 shadow-xl',
                { invisible: !fileDropVisualBounds },
              )}
              style={{
                left: `${fileDropVisualBounds?.x ?? 0}px`,
                top: `${fileDropVisualBounds?.y ?? 0}px`,
                width: `${fileDropVisualBounds?.width ?? 0}px`,
                height: `${fileDropVisualBounds?.height ?? 0}px`,
                'z-index': 1000000,
              }}
            >
              <div class='flex h-8 items-center justify-between border-b border-primary/40 bg-primary/15 px-3 text-xs font-medium text-primary'>
                <span>New window</span>
                <span class='tabular-nums'>
                  {fileDropPreview?.bounds.width ?? 0} × {fileDropPreview?.bounds.height ?? 0}
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
          <Dialog
            open
            onOpenChange={(open) => {
              if (!open) overlayCommands.closeNote()
            }}
            title={canvasDialogLabel(model.noteDialog)}
            class='sm:max-w-lg'
          >
            {((value) =>
              value ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault()
                    if (!value.title.trim() || !value.directory) return
                    createDocumentFromComposer(value)
                  }}
                >
                  <label class='mt-4 block text-sm text-muted-foreground'>Title</label>
                  <Input
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
                  <Select
                    aria-label='Document location'
                    class='min-w-0 w-full'
                    value={model.noteDialog.directory}
                    onValueChange={(value) => {
                      overlayCommands.updateNoteDirectory(value)
                    }}
                    options={writableDirectories.map((directory) => ({
                      value: directory,
                      label: directory,
                    }))}
                  />
                  <div class='mt-5 flex justify-end gap-2'>
                    <Button
                      variant='ghost'
                      type='button'
                      class='h-9 rounded-md px-3 text-sm hover:bg-muted'
                      onClick={overlayCommands.closeNote}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant='default'
                      type='submit'
                      class='h-9 rounded-md bg-primary px-3 text-sm text-primary-foreground disabled:opacity-40'
                      disabled={!model.noteDialog.title.trim() || !model.noteDialog.directory}
                    >
                      Create document
                    </Button>
                  </div>
                </form>
              ) : null)(
              model.noteDialog.kind === 'new-note'
                ? (model.noteDialog as Extract<CanvasDialogState, { kind: 'new-note' }>)
                : undefined,
            )}
          </Dialog>
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

const canvasGroups = collection<Parameters<typeof CanvasWindowGroup>[0]>((group) => group.groupId)
