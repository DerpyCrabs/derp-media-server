import { view, domBinding, list, collection, controllerView } from 'effectweb'
import { randomId } from '@/lib/random-id'
import { layoutBoundsForWindowHighlight } from './workspace-file-open-target-picker'
import { navigateSearchParams } from '@/lib/browser/browser-history'
import { DesktopWorkspaceCanvas } from './DesktopWorkspaceCanvas'
import { DesktopWorkspaceTaskbar } from './DesktopWorkspaceTaskbar'
import { WorkspaceSwitcher } from '../shared/WorkspaceSwitcher'
import { taskbarGroupModel } from './taskbar-group-model'
import { TaskbarGroupRow } from './DesktopWorkspaceTaskbarRows'
import { createDesktopController } from './desktop-workspace-controller'
export const DesktopWorkspace = controllerView(
  { controller: createDesktopController },
  view((model) => {
    const {
      editableOpenBrowser,
      setEditableWorkspace,
      windowActions,
      editableFocusWindow,
      editableCloseWindow,
      editableSetWindowMinimized,
      editableToggleFullscreen,
      beginPointerGesture,
      editableActivateTab,
      editableCloseTab,
      editableToggleTabPinned,
      editableHandleTabPullStart,
      editableDropFileToTabBar,
      editableStartSplitPaneDrag,
      setLayoutPicker,
      editableHandleWorkspaceTilingPick,
      editableOpenLayoutPicker,
      moveWindowDrag,
      endWindowDrag,
      setWorkspacePanelOpen,
      beginCrossWorkspaceHover,
      toggleWorkspacePanelFromTaskbar,
      editableOpenSearchResult,
      editableSelectPinned,
      setPinMenu,
      editableRemovePinnedItem,
      stopWorkspacePlaybackFromTaskbar,
      editableRequestPlay,
      dismissWorkspacePanel,
      leaveForWorkspace,
      lifecycle,
      session,
      registryCommands,
      setWorkspaceTransition,
      snap,
    } = model
    const hasWorkspaceWindows = () => model.hasWorkspaceWindows
    const workspace = () => model.workspace
    const orderedWindowGroupIds = () => model.orderedWindowGroupIds
    const workspaceFileIconContext = () => model.workspaceFileIconContext
    const layoutPicker = () => model.layoutPicker
    const workspacePanelOpen = model.workspacePanelOpen
    const workspaceId = model.workspaceId
    const fileOpenTargetPick = model.fileOpenTargetPick
    const fileOpenPickHoverId = model.fileOpenPickHoverId
    const hasAnyTaskbarItems = model.hasAnyTaskbarItems
    const pinnedItems = model.pinnedItems
    const pinMenu = model.pinMenu
    const browserSource = () => model.browserSource
    const suppressWorkspaceTaskbarAudioForVideoViewer = () =>
      model.suppressWorkspaceTaskbarAudioForVideoViewer
    const taskbarWindowRows = () => (
      <>
        {list(desktopGroupIds.from(orderedWindowGroupIds()), (groupId) => (
          <TaskbarGroupRow
            group={taskbarGroupModel(model.workspace, groupId)}
            playingPath={model.playbackPlayingPath}
            fileIconContext={model.workspaceFileIconContext}
            focusWindow={editableFocusWindow}
            setWindowMinimized={editableSetWindowMinimized}
            closeWindow={editableCloseWindow}
          />
        ))}{' '}
      </>
    )
    return (
      <div
        data-workspace-opened={model.opened ? '' : undefined}
        class={`workspace-layout fixed inset-0 flex flex-col overflow-hidden bg-background select-none ${model.opened ? 'pointer-events-auto' : 'pointer-events-none'} ${
          model.settings?.workspaceTransition !== 'instant' ? 'transition-opacity duration-150' : ''
        }`}
      >
        <div
          class='relative min-h-0 flex-1 overflow-hidden'
          use={{
            ...domBinding(snap.actions.bindWorkspaceAreaRoot, mountDesktopArea),
            identity: snap.actions.bindWorkspaceAreaRoot,
          }}
        >
          {!model.editable ? (
            <div class='absolute left-1/2 top-2 z-[100002] -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-1.5 text-xs shadow-lg'>
              Read only — workspace is open elsewhere
            </div>
          ) : null}
          <DesktopWorkspaceCanvas
            empty={{ hasWindows: hasWorkspaceWindows, openBrowser: editableOpenBrowser }}
            document={{
              state: workspace,
              onSet: setEditableWorkspace,
              groupIds: orderedWindowGroupIds,
            }}
            content={{
              editableFolders: () => model.editableFolders,
              knowledgeBases: () => model.settings?.knowledgeBases ?? [],
              fileIconContext: workspaceFileIconContext,
              windowActions,
            }}
            windows={{
              focus: editableFocusWindow,
              close: editableCloseWindow,
              minimize: editableSetWindowMinimized,
              toggleFullscreen: editableToggleFullscreen,
              beginPointerGesture,
            }}
            tabs={{
              activate: editableActivateTab,
              close: editableCloseTab,
              togglePinned: editableToggleTabPinned,
              pull: editableHandleTabPullStart,
              dropFile: editableDropFileToTabBar,
              startSplitDrag: editableStartSplitPaneDrag,
            }}
            picker={{
              state: layoutPicker,
              close: () => setLayoutPicker(null),
              pick: editableHandleWorkspaceTilingPick,
              setHover: snap.actions.setTilingPickerHoverPreview,
              open: editableOpenLayoutPicker,
            }}
            snap={{
              model: snap,
              canMutate: () => model.editable,
              moveDrag: moveWindowDrag,
              endDrag: endWindowDrag,
            }}
          />
          {fileOpenTargetPick
            ? ((hid) => {
                if (!hid) return null

                const b = layoutBoundsForWindowHighlight(workspace()?.windows ?? [], hid)
                if (!b) return null
                return (
                  <div
                    class='pointer-events-none absolute z-[100001] rounded-sm border-2 border-primary bg-primary/15'
                    style={{
                      left: `${b.x}px`,
                      top: `${b.y}px`,
                      width: `${b.width}px`,
                      height: `${b.height}px`,
                    }}
                  />
                )
              })(fileOpenPickHoverId)
            : null}
        </div>
        <DesktopWorkspaceTaskbar
          session={session}
          commands={{
            openBrowser: editableOpenBrowser,
            openWorkspaces: () => toggleWorkspacePanelFromTaskbar(),
            changeTransition: (value) => setWorkspaceTransition(value),
            openSearchResult: editableOpenSearchResult,
          }}
          items={{
            hasAny: hasAnyTaskbarItems,
            pinned: pinnedItems,
            groupIds: orderedWindowGroupIds(),
            windowRows: taskbarWindowRows,
            settings: model.settings,
            fileIconContext: workspaceFileIconContext(),
            selectPinned: editableSelectPinned,
          }}
          pinMenu={{ state: pinMenu, onSet: setPinMenu, remove: editableRemovePinnedItem }}
          playback={{
            browserSource,
            workspace,
            focusWindow: editableFocusWindow,
            stop: stopWorkspacePlaybackFromTaskbar,
            request: editableRequestPlay,
            suppressAudioChrome: suppressWorkspaceTaskbarAudioForVideoViewer,
          }}
        />
        <WorkspaceSwitcher
          open={workspacePanelOpen}
          activeId={workspaceId}
          registry={model.registry}
          editable={model.editable}
          onToggle={() => setWorkspacePanelOpen((open) => !open)}
          onDismiss={dismissWorkspacePanel}
          onSelect={(id) => {
            void leaveForWorkspace(id)
          }}
          onOpenNewTab={(id) => {
            if (id === workspaceId) return
            window.open(`/workspace?ws=${encodeURIComponent(id)}`, '_blank', 'noopener,noreferrer')
          }}
          onCreate={() => {
            const id = randomId()
            void registryCommands.transition(() => {
              setWorkspacePanelOpen(false)
              navigateSearchParams({ ws: id, dir: null, preset: null }, 'push')
            })
          }}
          onTakeControl={() => registryCommands.takeControl()}
          onRename={(id, name) => registryCommands.updateMetadata(id, { name })}
          onIcon={(id, icon, iconColor) => registryCommands.updateMetadata(id, { icon, iconColor })}
          onDelete={lifecycle.deleteWorkspace}
          onConvert={lifecycle.convertWorkspace}
          onReorder={(order) => registryCommands.reorder(order)}
          draggingWindow={model.transferActive}
          onDragHover={beginCrossWorkspaceHover}
          hoverTarget={model.transferHover}
          transferReady={model.transferReady}
        />
      </div>
    )
  }),
)
const desktopGroupIds = collection<string>((id) => id)
const mountDesktopArea = (
  element: HTMLDivElement,
  current: () => (element: HTMLDivElement | null) => void,
) => {
  current()(element)
  return () => current()(null)
}
