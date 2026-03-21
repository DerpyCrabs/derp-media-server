import type { PersistedWorkspaceState } from '@/lib/use-workspace'
import { getWorkspaceWindowTitle } from '@/lib/use-workspace'
import type { FileIconContext } from '../lib/use-file-icon'
import { workspaceTaskbarRowIcon } from '../lib/use-file-icon'
import X from 'lucide-solid/icons/x'
import { Show } from 'solid-js'
import type { Accessor } from 'solid-js'
import { tabsInGroup } from './tab-group-ops'

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
  const groupWindows = () => tabsInGroup(props.workspace()?.windows ?? [], props.groupId)
  const leader = () => groupWindows()[0]
  const activeTabId = () => props.workspace()?.activeTabMap[props.groupId] ?? leader()?.id ?? ''
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
    const path =
      d.iconPath ??
      (d.type === 'browser'
        ? (d.initialState.dir ?? '')
        : d.type === 'player'
          ? (props.playingPath() ?? '')
          : (d.initialState.viewing ?? ''))
    const isDir = d.type === 'browser'
    return path ? `${isDir ? 'Folder' : 'File'}: ${path}` : getWorkspaceWindowTitle(d)
  }
  const isActive = () => groupWindows().some((w) => w.id === props.activeWindowId())

  const onSelect = () => {
    const g = groupWindows()
    const lid = leader()?.id ?? g[0]?.id
    if (!lid) return
    const isMinimized = leader()?.layout?.minimized ?? false
    if (isMinimized) {
      props.focusWindow(lid)
    } else if (isActive()) {
      props.setWindowMinimized(lid, true)
    } else {
      props.focusWindow(lid)
    }
  }

  return (
    <Show when={leader() && displayWindow()}>
      <div
        data-taskbar-window-row
        data-taskbar-active={isActive() ? '' : undefined}
        class={`flex h-8 min-w-[120px] flex-[0_1_220px] items-center gap-1 overflow-hidden border-r border-border px-2 ${
          isActive()
            ? 'border-b-2 border-b-primary bg-muted text-foreground'
            : 'border-b-2 border-b-transparent bg-muted/50 text-muted-foreground'
        }`}
      >
        <button
          type='button'
          title={tooltip()}
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
          class='flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-left text-xs touch-manipulation'
        >
          <span class='inline-flex shrink-0'>
            {workspaceTaskbarRowIcon(
              displayWindow()!,
              props.fileIconContext(),
              props.playingPath(),
            )}
          </span>
          <span class='min-w-0 truncate'>{rowLabel()}</span>
        </button>
        <button
          type='button'
          class='flex h-7 w-7 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
          aria-label={`Close ${rowLabel()}`}
          onClick={() => props.closeWindow(leader()!.id)}
        >
          <X class='h-4 w-4' stroke-width={2} />
        </button>
      </div>
    </Show>
  )
}
