import { component, view, observe } from 'effectweb'
import { memoView } from 'effectweb/advanced'
import { workspaceValueEquals } from '../model/workspace-equality'
import type { TaskbarGroupModel } from './taskbar-group-model'
import { getWorkspaceWindowTitle } from '@/workspace/model/workspace'
import { FLOATING_Z_PIN_MENU } from '@/lib/ui/floating-z-index'
import type { FileIconContext } from '@/features/explorer/file-icon'
import { taskbarWindowIcon } from '@/features/explorer/file-icon'
import { FloatingContextMenu } from '@/features/explorer/FloatingContextMenu'
import { hermesSessionsSource } from '@/features/hermes/hermes-session-store'
export const TaskbarGroupRow = memoView(
  component<
    {
      group: TaskbarGroupModel
      playingPath: string | null
      fileIconContext: FileIconContext
      focusWindow: (id: string) => void
      setWindowMinimized: (id: string, minimized: boolean) => void
      closeWindow: (id: string) => void
    },
    { menu: { x: number; y: number } | null; mouseHandled: boolean }
  >(
    { init: () => ({ menu: null, mouseHandled: false }) },
    view((local, patch) =>
      observe(hermesSessionsSource, (hermes) => {
        const props = local.props
        const menu = (): { x: number; y: number } | null =>
          local.menu as { x: number; y: number } | null
        const setMenu = (
          value:
            | { x: number; y: number }
            | null
            | ((current: { x: number; y: number } | null) => { x: number; y: number } | null),
        ) => {
          patch({ menu: typeof value === 'function' ? value(menu()) : value })
        }
        const displayWindow = () => props.group.window
        const activeTabId = () => props.group.visibleId
        const rowLabel = () => {
          const d = displayWindow()
          if (!d) return ''
          const n = props.group.count
          const label = getWorkspaceWindowTitle(d)
          return n > 1 ? `${label} (+${n - 1})` : label
        }
        const tooltip = () => {
          const d = displayWindow()
          if (!d) return ''
          const path =
            d.iconPath ??
            (d.type === 'browser'
              ? (d.initialState.dir ?? '')
              : (d.initialState.viewing ?? d.initialState.playing ?? props.playingPath ?? ''))
          const isDir = d.type === 'browser'
          return path ? `${isDir ? 'Folder' : 'File'}: ${path}` : getWorkspaceWindowTitle(d)
        }
        const isActive = () => props.group.active
        const isMinimized = () => props.group.minimized
        const hermesState = () => {
          const id = displayWindow()?.hermes?.sessionId
          return id ? Object.values(hermes).find((session) => session.sessionId === id) : undefined
        }
        const onSelect = () => {
          const lid = props.group.leaderId
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
          const lid = props.group.leaderId
          if (!lid) return
          props.focusWindow(activeTabId() || lid)
        }
        const minimize = () => {
          const lid = props.group.leaderId
          if (!lid) return
          props.setWindowMinimized(lid, true)
        }
        const close = () => {
          const lid = props.group.leaderId
          if (!lid) return
          props.closeWindow(lid)
        }
        return props.group.leaderId && displayWindow() ? (
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
                  patch({ mouseHandled: true })
                  onSelect()
                }
              }}
              onClick={() => {
                if (local.mouseHandled) {
                  patch({ mouseHandled: false })
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
                {taskbarWindowIcon(displayWindow()!, props.fileIconContext, props.playingPath)}
              </span>
              <span class='min-w-0 truncate'>{rowLabel()}</span>
              {hermesState()?.decision ? (
                <span class='size-2 shrink-0 rounded-full bg-amber-500' title='Needs input' />
              ) : null}
              {!hermesState()?.decision &&
              (hermesState()?.status === 'sending' || hermesState()?.status === 'streaming') ? (
                <span
                  class='size-2 shrink-0 animate-pulse rounded-full bg-blue-500'
                  title='Working'
                />
              ) : null}
              {hermesState()?.status === 'error' ? (
                <span class='size-2 shrink-0 rounded-full bg-red-500' title='Failed' />
              ) : null}
              {hermesState()?.unread ? (
                <span class='size-2 shrink-0 rounded-full bg-emerald-500' title='Unread response' />
              ) : null}
            </button>
            <FloatingContextMenu
              state={menu()}
              anchor={(m) => ({ x: m.x, y: m.y })}
              onDismiss={() => setMenu(null)}
              zIndex={FLOATING_Z_PIN_MENU}
              data-slot='taskbar-window-context-menu'
              data-testid='workspace-taskbar-window-context-menu'
              pinContextMenuRoot
            >
              {() => (
                <>
                  {isMinimized() ? (
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
                  ) : null}
                  {!isMinimized() ? (
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
                  ) : null}
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
        ) : null
      }),
    ),
  ),
  workspaceValueEquals,
)
