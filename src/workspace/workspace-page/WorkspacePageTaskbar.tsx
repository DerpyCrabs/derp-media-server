import { setFileDragData, type FileDragData } from '@/lib/file-drag-data'
import { FLOATING_Z_PIN_MENU } from '@/lib/floating-z-index'
import type { PinnedTaskbarItem } from '@/lib/use-workspace'
import { isWorkspaceTabIconColorKey } from '@/lib/workspace-tab-icon-colors'
import type { WorkspaceLayoutPreset } from '@/lib/workspace-layout-presets'
import FolderOpen from 'lucide-solid/icons/folder-open'
import { For, Show, type JSX } from 'solid-js'
import { FloatingContextMenu } from '@/src/file-browser/FloatingContextMenu'
import { pinnedShellIcon } from '@/src/lib/use-file-icon'
import type { GlobalSettings } from '@/lib/use-settings'
import { WorkspaceNamedLayoutMenu } from '@/src/workspace/WorkspaceNamedLayoutMenu'
import { WorkspaceTaskbarAudio } from '@/src/workspace/WorkspaceTaskbarAudio'
import { WorkspaceTaskbarSettings } from '@/src/workspace/WorkspaceTaskbarSettings'
import type { PersistedWorkspaceState, WorkspaceSource } from '@/lib/use-workspace'
import { FileSearchButton } from '@/src/FileSearchPalette'
import type { FileSearchResult } from '@/lib/file-search'

export type WorkspacePageTaskbarProps = {
  onOpenBrowser: () => void
  hasAnyTaskbarItems: () => boolean
  pinnedItems: () => PinnedTaskbarItem[]
  taskbarGroupIds: () => string[]
  taskbarWindowRows: () => JSX.Element
  storageSessionKey: () => string
  browserSource: () => WorkspaceSource
  workspace: () => PersistedWorkspaceState | null
  setWorkspace: (
    fn: (prev: PersistedWorkspaceState | null) => PersistedWorkspaceState | null,
  ) => void
  settingsData: () => GlobalSettings | undefined
  serverLayoutPresets: () => WorkspaceLayoutPreset[]
  presetsReady: () => boolean
  collectLayoutSnapshot: () => PersistedWorkspaceState
  applyLayoutSnapshot: (
    snapshot: PersistedWorkspaceState,
    options?: { baselinePresetId?: string | null },
  ) => void
  syncLayoutBaselineToCurrent: () => void
  revertLayoutToBaseline: () => void
  declareBaselinePresetId: (id: string | null) => void
  isLayoutDirty: () => boolean
  layoutBaselinePresetId: () => string | null
  workspaceFileIconContext: () => import('@/src/lib/use-file-icon').FileIconContext
  selectPinned: (pin: PinnedTaskbarItem) => void
  removePinnedItem: (id: string) => void
  pinMenu: () => { x: number; y: number; pinId: string } | null
  setPinMenu: (v: { x: number; y: number; pinId: string } | null) => void
  focusWindow: (id: string) => void
  stopWorkspacePlaybackFromTaskbar: () => void
  requestPlay: (source: WorkspaceSource, path: string, dir?: string) => void
  suppressTaskbarAudioChrome?: () => boolean
  onOpenSearchResult: (result: FileSearchResult) => void
}

export function WorkspacePageTaskbar(props: WorkspacePageTaskbarProps) {
  return (
    <>
      <div class='relative bg-background px-3' style={{ 'z-index': '999999' }}>
        <div class='flex h-8 items-center gap-2'>
          <button
            type='button'
            title='Open browser window'
            aria-label='Open browser window'
            class='flex h-7 w-7 shrink-0 items-center justify-center rounded-none text-amber-500 hover:bg-amber-500/15 hover:text-amber-400'
            onClick={() => props.onOpenBrowser()}
          >
            <FolderOpen class='h-5 w-5' stroke-width={1.75} />
          </button>

          <div class='flex min-w-0 flex-1 items-center overflow-x-auto'>
            <Show when={props.hasAnyTaskbarItems()}>
              <Show when={props.pinnedItems().length > 0}>
                <div class='flex shrink-0 items-center gap-2'>
                  <For each={props.pinnedItems()}>
                    {(pin) => {
                      const tooltip = `${pin.isDirectory ? 'Folder' : 'File'}: ${pin.path}`
                      return (
                        <div
                          class='flex shrink-0 items-center justify-center py-1 px-0.5'
                          data-taskbar-pin
                          draggable='true'
                          on:dragstart={(e: DragEvent) => {
                            const dt = e.dataTransfer
                            if (!dt) return
                            const d: FileDragData = {
                              path: pin.path,
                              isDirectory: pin.isDirectory,
                              sourceKind: 'local',
                            }
                            setFileDragData(dt, d)
                            dt.effectAllowed = 'copy'
                          }}
                        >
                          <div
                            role='button'
                            tabindex={0}
                            title={tooltip}
                            aria-label={tooltip}
                            class='flex h-7 w-7 shrink-0 cursor-default items-center justify-center rounded-none text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring [&_svg]:pointer-events-none'
                            onClick={() => props.selectPinned(pin)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                props.selectPinned(pin)
                              }
                            }}
                            onContextMenu={(e) => {
                              e.preventDefault()
                              props.setPinMenu({ x: e.clientX, y: e.clientY, pinId: pin.id })
                            }}
                          >
                            {pinnedShellIcon(
                              pin,
                              props.settingsData()?.customIcons ?? {},
                              props.workspaceFileIconContext(),
                            )}
                          </div>
                        </div>
                      )
                    }}
                  </For>
                </div>
              </Show>
              <Show when={props.pinnedItems().length > 0 && props.taskbarGroupIds().length > 0}>
                <div class='w-2 shrink-0' aria-hidden />
              </Show>
              <div class='flex min-w-0 flex-1 items-center gap-1 overflow-x-auto'>
                {props.taskbarWindowRows()}
              </div>
            </Show>
            <Show when={!props.hasAnyTaskbarItems()}>
              <div class='text-sm text-muted-foreground'>
                No windows open. Use the browser button to start a workspace.
              </div>
            </Show>
          </div>

          <div class='flex shrink-0 items-center gap-1 pl-2'>
            <FileSearchButton
              title='Search library and open a new window'
              testId='workspace-global-file-search-trigger'
              class='inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-none text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring'
              onSelect={props.onOpenSearchResult}
            />
            <WorkspaceTaskbarAudio
              suppressTaskbarAudioChrome={props.suppressTaskbarAudioChrome}
              onShowVideo={(path, dir) => {
                if (!path) return
                const w = props.workspace()
                const viewerWin = w?.windows.find(
                  (win) => win.type === 'viewer' && win.initialState?.viewing === path,
                )
                if (viewerWin) {
                  props.focusWindow(viewerWin.id)
                  return
                }
                props.requestPlay(props.browserSource(), path, dir)
              }}
              onStopPlayback={props.stopWorkspacePlaybackFromTaskbar}
            />
            <WorkspaceNamedLayoutMenu
              presets={props.serverLayoutPresets()}
              presetsReady={props.presetsReady()}
              collectLayoutSnapshot={props.collectLayoutSnapshot}
              applyLayoutSnapshot={props.applyLayoutSnapshot}
              syncLayoutBaselineToCurrent={props.syncLayoutBaselineToCurrent}
              revertLayoutToBaseline={props.revertLayoutToBaseline}
              declareBaselinePresetId={props.declareBaselinePresetId}
              isLayoutDirty={props.isLayoutDirty()}
              layoutBaselinePresetId={props.layoutBaselinePresetId()}
            />
            <WorkspaceTaskbarSettings
              browserTabTitle={() => props.workspace()?.browserTabTitle ?? ''}
              browserTabIcon={() => props.workspace()?.browserTabIcon ?? ''}
              browserTabIconColor={() => props.workspace()?.browserTabIconColor ?? ''}
              onBrowserTabTitleChange={(value) => {
                const t = value.trim()
                props.setWorkspace((prev) =>
                  prev ? { ...prev, browserTabTitle: t ? t.slice(0, 120) : undefined } : prev,
                )
              }}
              onBrowserTabIconChange={(value) => {
                const icon = value.trim().slice(0, 64)
                props.setWorkspace((prev) =>
                  prev
                    ? {
                        ...prev,
                        browserTabIcon: icon || undefined,
                        ...(!icon ? { browserTabIconColor: undefined } : {}),
                      }
                    : prev,
                )
              }}
              onBrowserTabIconColorChange={(value) => {
                const raw = value.trim()
                if (raw && !isWorkspaceTabIconColorKey(raw)) return
                props.setWorkspace((prev) =>
                  prev ? { ...prev, browserTabIconColor: raw || undefined } : prev,
                )
              }}
              onWorkspaceFileOpenTargetChange={(value) => {
                props.setWorkspace((prev) => (prev ? { ...prev, fileOpenTarget: value } : prev))
              }}
            />
          </div>
        </div>
      </div>

      <FloatingContextMenu
        state={props.pinMenu}
        anchor={(m) => ({ x: m.x, y: m.y })}
        onDismiss={() => props.setPinMenu(null)}
        zIndex={FLOATING_Z_PIN_MENU}
        data-slot='pin-context-menu'
        pinContextMenuRoot
      >
        {(m) => (
          <button
            type='button'
            data-slot='context-menu-item'
            class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
            role='menuitem'
            onClick={() => {
              props.removePinnedItem(m.pinId)
              props.setPinMenu(null)
            }}
          >
            Unpin
          </button>
        )}
      </FloatingContextMenu>
    </>
  )
}
