import { FLOATING_Z_PIN_MENU } from '@/lib/ui/floating-z-index'
import type { TaskbarPin as PinnedTaskbarItem } from '@/lib/models/taskbar-pins'
import FolderOpen from 'lucide-solid/icons/folder-open'
import PanelsTopLeft from 'lucide-solid/icons/panels-top-left'
import { Show } from 'solid-js'
import type { JSX } from '@solidjs/web'
import { FloatingContextMenu } from '@/features/explorer/FloatingContextMenu'
import type { GlobalSettings } from '@/lib/models/settings-types'
import { WorkspaceTaskbarAudio } from '@/workspace/taskbar/WorkspaceTaskbarAudio'
import { WorkspaceTaskbarSettings } from '@/workspace/taskbar/WorkspaceTaskbarSettings'
import type { WindowSource as WorkspaceSource } from '@/lib/models/window-model'
import type { PersistedWorkspaceState } from '@/workspace/model/use-workspace'
import { FileSearchButton } from '@/features/explorer/FileSearchPalette'
import type { FileSearchResult } from '@/lib/files/file-search'
import { WorkspaceSaveStatus } from '@/workspace/shared/WorkspaceSaveStatus'
import {
  WorkspaceTaskbar,
  WorkspaceTaskbarPins,
  WORKSPACE_TASKBAR_END_CLASS,
  WORKSPACE_TASKBAR_ICON_BUTTON_CLASS,
} from '@/workspace/shared/WorkspaceTaskbar'

export type DesktopWorkspaceTaskbarProps = {
  commands: {
    openBrowser: () => void
    openWorkspaces: () => void
    openSearchResult: (result: FileSearchResult) => void
    changeTransition: (value: 'instant' | 'fade') => void
  }
  items: {
    hasAny: () => boolean
    pinned: () => PinnedTaskbarItem[]
    groupIds: () => string[]
    windowRows: () => JSX.Element
    settings: () => GlobalSettings | undefined
    fileIconContext: () => import('@/features/explorer/use-file-icon').FileIconContext
    selectPinned: (pin: PinnedTaskbarItem) => void
  }
  pinMenu: {
    state: () => { x: number; y: number; pinId: string } | null
    set: (v: { x: number; y: number; pinId: string } | null) => void
    remove: (id: string) => void
  }
  playback: {
    browserSource: () => WorkspaceSource
    workspace: () => PersistedWorkspaceState | null
    focusWindow: (id: string) => void
    stop: () => void
    request: (source: WorkspaceSource, path: string, dir?: string) => void
    suppressAudioChrome?: () => boolean
  }
}

export function DesktopWorkspaceTaskbar(props: DesktopWorkspaceTaskbarProps) {
  return (
    <>
      <WorkspaceTaskbar>
        <button
          type='button'
          title='Open browser window'
          class='flex h-7 w-7 shrink-0 items-center justify-center rounded-none text-amber-500 hover:bg-amber-500/15 hover:text-amber-400'
          onClick={() => props.commands.openBrowser()}
        >
          <FolderOpen class='h-5 w-5' stroke-width={1.75} />
        </button>
        <button
          type='button'
          title='Workspaces'
          aria-label='Open workspaces'
          data-testid='workspace-taskbar-workspaces'
          data-workspace-toggle
          class={WORKSPACE_TASKBAR_ICON_BUTTON_CLASS}
          onClick={() => props.commands.openWorkspaces()}
        >
          <PanelsTopLeft class='h-5 w-5' stroke-width={1.75} />
        </button>

        <div class='scrollbar-none flex min-w-0 flex-1 items-center overflow-x-auto'>
          <Show when={props.items.hasAny()}>
            <Show when={props.items.pinned().length > 0}>
              <WorkspaceTaskbarPins
                items={props.items.pinned()}
                customIcons={props.items.settings()?.customIcons ?? {}}
                fileIconContext={props.items.fileIconContext()}
                onSelect={props.items.selectPinned}
                onContextMenu={(pin, event) => {
                  event.preventDefault()
                  props.pinMenu.set({ x: event.clientX, y: event.clientY, pinId: pin.id })
                }}
              />
            </Show>
            <Show when={props.items.pinned().length > 0 && props.items.groupIds().length > 0}>
              <div class='w-2 shrink-0' aria-hidden='true' />
            </Show>
            <div class='scrollbar-none flex min-w-0 flex-1 items-center gap-1 overflow-x-auto'>
              {props.items.windowRows()}
            </div>
          </Show>
          <Show when={!props.items.hasAny()}>
            <div class='text-sm text-muted-foreground'>
              No windows open. Use the browser button to start a workspace.
            </div>
          </Show>
        </div>

        <div class={WORKSPACE_TASKBAR_END_CLASS}>
          <WorkspaceSaveStatus />
          <FileSearchButton
            title='Search library and open a new window'
            testId='workspace-global-file-search-trigger'
            class={WORKSPACE_TASKBAR_ICON_BUTTON_CLASS}
            onSelect={props.commands.openSearchResult}
          />
          <WorkspaceTaskbarAudio
            suppressTaskbarAudioChrome={props.playback.suppressAudioChrome}
            onShowVideo={(path, dir) => {
              if (!path) return
              const w = props.playback.workspace()
              const viewerWin = w?.windows.find(
                (win) => win.type === 'viewer' && win.initialState?.viewing === path,
              )
              if (viewerWin) {
                props.playback.focusWindow(viewerWin.id)
                return
              }
              props.playback.request(props.playback.browserSource(), path, dir)
            }}
            onStopPlayback={props.playback.stop}
          />
          <WorkspaceTaskbarSettings
            workspaceTransition={() => props.items.settings()?.workspaceTransition ?? 'fade'}
            onWorkspaceTransitionChange={props.commands.changeTransition}
          />
        </div>
      </WorkspaceTaskbar>

      <FloatingContextMenu
        state={props.pinMenu.state}
        anchor={(m) => ({ x: m.x, y: m.y })}
        onDismiss={() => props.pinMenu.set(null)}
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
              props.pinMenu.remove(m.pinId)
              props.pinMenu.set(null)
            }}
          >
            Unpin
          </button>
        )}
      </FloatingContextMenu>
    </>
  )
}
