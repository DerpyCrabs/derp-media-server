import type { PersistedWorkspaceState } from '@/lib/use-workspace'
import { getWorkspaceWindowTitle } from '@/lib/use-workspace'
import { FLOATING_Z_PIN_MENU } from '@/lib/floating-z-index'
import type { FileIconContext } from '../lib/use-file-icon'
import { workspaceTaskbarRowIcon } from '../lib/use-file-icon'
import { FloatingContextMenu } from '../file-browser/FloatingContextMenu'
import { Show, createSignal } from 'solid-js'
import type { Accessor } from 'solid-js'
import { resolveGroupVisibleTabId, tabsInGroup } from './tab-group-ops'
import { applicationContentRegistry } from '@/src/integrations/registry'
import { contentWindowKind } from '@/lib/content-window'
import {
  contentInstanceFromCurrentWindow,
  contentWindowFilesystemPath,
} from '@/src/integrations/current-window-content'

export function TaskbarGroupRow(props: {
  groupId: string
  workspace: Accessor<PersistedWorkspaceState | null>
  /** Subscribed separately so the row updates when only focus changes (not only `windows`). */
  activeWindowId: Accessor<string | null>
  playingPath: Accessor<string | null>
  fileIconContext: () => FileIconContext
  taskbarMouseHandled: { current: boolean }
  focusWindow: (id: string) => void
  setWindowMinimized: (id: string, minimized: boolean) => void
  closeWindow: (id: string) => void
}) {
  const [menu, setMenu] = createSignal<{ x: number; y: number } | null>(null)

  const groupWindows = () => tabsInGroup(props.workspace()?.windows ?? [], props.groupId)
  const leader = () => groupWindows()[0]
  const activeTabId = () => {
    const wk = props.workspace()
    if (!wk) return ''
    return resolveGroupVisibleTabId(wk, props.groupId)
  }
  const displayWindow = () =>
    groupWindows().find((w) => w.id === activeTabId()) ?? leader() ?? groupWindows()[0]
  const rowLabel = () => {
    const d = displayWindow()
    if (!d) return ''
    const n = groupWindows().length
    const label = getWorkspaceWindowTitle(d)
    return n > 1 ? `${label} (+${n - 1})` : label
  }
  const tooltip = () => {
    const d = displayWindow()
    if (!d) return ''
    const path = contentWindowFilesystemPath(d) ?? props.playingPath() ?? ''
    const isDir = contentWindowKind(d) === 'browser'
    return path ? `${isDir ? 'Folder' : 'File'}: ${path}` : getWorkspaceWindowTitle(d)
  }
  const isActive = () => groupWindows().some((w) => w.id === props.activeWindowId())
  const isMinimized = () => leader()?.layout?.minimized ?? false
  const contentStatus = () => {
    const window = displayWindow()
    if (!window) return null
    const instance = contentInstanceFromCurrentWindow(window)
    return instance ? applicationContentRegistry.liveStatus(instance) : null
  }

  const onSelect = () => {
    const g = groupWindows()
    const lid = leader()?.id ?? g[0]?.id
    if (!lid) return
    const visibleId = activeTabId() || lid
    if (isMinimized()) {
      props.focusWindow(visibleId)
    } else if (isActive()) {
      props.setWindowMinimized(lid, true)
    } else {
      props.focusWindow(visibleId)
    }
  }

  const restoreOrFocus = () => {
    const lid = leader()?.id
    if (!lid) return
    props.focusWindow(activeTabId() || lid)
  }

  const minimize = () => {
    const lid = leader()?.id
    if (!lid) return
    props.setWindowMinimized(lid, true)
  }

  const close = () => {
    const lid = leader()?.id
    if (!lid) return
    props.closeWindow(lid)
  }

  return (
    <Show when={leader() && displayWindow()}>
      <>
        <button
          type='button'
          data-taskbar-window-row
          data-taskbar-active={isActive() ? '' : undefined}
          title={tooltip()}
          aria-label={rowLabel()}
          aria-current={isActive() ? 'true' : undefined}
          onMouseDown={(e) => {
            if (e.button === 0) {
              props.taskbarMouseHandled.current = true
              onSelect()
            }
          }}
          onClick={() => {
            if (props.taskbarMouseHandled.current) {
              props.taskbarMouseHandled.current = false
              return
            }
            onSelect()
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setMenu({ x: e.clientX, y: e.clientY })
          }}
          class={`flex h-8 min-w-[120px] flex-[0_1_220px] items-center gap-1.5 overflow-hidden px-2 text-left text-xs touch-manipulation ${
            isActive()
              ? 'border-b-2 border-b-primary bg-muted text-foreground'
              : 'border-b-2 border-b-transparent bg-muted/50 text-muted-foreground'
          }`}
        >
          <span class='inline-flex shrink-0'>
            {workspaceTaskbarRowIcon(
              displayWindow()!,
              props.fileIconContext(),
              props.playingPath(),
            )}
          </span>
          <span class='min-w-0 truncate'>{rowLabel()}</span>
          <Show when={contentStatus()?.needsInput}>
            <span class='size-2 shrink-0 rounded-full bg-amber-500' title='Needs input' />
          </Show>
          <Show when={contentStatus()?.working}>
            <span class='size-2 shrink-0 animate-pulse rounded-full bg-blue-500' title='Working' />
          </Show>
          <Show when={contentStatus()?.failed}>
            <span class='size-2 shrink-0 rounded-full bg-red-500' title='Failed' />
          </Show>
          <Show when={contentStatus()?.unread}>
            <span class='size-2 shrink-0 rounded-full bg-emerald-500' title='Unread response' />
          </Show>
        </button>
        <FloatingContextMenu
          state={menu}
          anchor={(m) => ({ x: m.x, y: m.y })}
          onDismiss={() => setMenu(null)}
          zIndex={FLOATING_Z_PIN_MENU}
          data-slot='taskbar-window-context-menu'
          data-testid='workspace-taskbar-window-context-menu'
          pinContextMenuRoot
        >
          {() => (
            <>
              <Show when={isMinimized()}>
                <button
                  type='button'
                  data-slot='context-menu-item'
                  data-testid='workspace-taskbar-menu-restore'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => {
                    restoreOrFocus()
                    setMenu(null)
                  }}
                >
                  Restore
                </button>
              </Show>
              <Show when={!isMinimized()}>
                <button
                  type='button'
                  data-slot='context-menu-item'
                  data-testid='workspace-taskbar-menu-minimize'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => {
                    minimize()
                    setMenu(null)
                  }}
                >
                  Minimize
                </button>
              </Show>
              <button
                type='button'
                data-slot='context-menu-item'
                data-testid='workspace-taskbar-menu-close'
                class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                role='menuitem'
                onClick={() => {
                  close()
                  setMenu(null)
                }}
              >
                Close
              </button>
            </>
          )}
        </FloatingContextMenu>
      </>
    </Show>
  )
}
