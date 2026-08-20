import { cn } from '@/lib/ui/cn'
import { setFileDragData } from '@/lib/files/file-drag-data'
import { pinnedItemIcon, type FileIconContext } from '@/features/explorer/use-file-icon'
import type { TaskbarPin as PinnedTaskbarItem } from '@/lib/models/taskbar-pins'
import { taskbarPinLabel } from '@/workspace/model/workspace-taskbar-pin'
import { For } from 'solid-js'
import type { JSX } from '@solidjs/web'

export const WORKSPACE_TASKBAR_ICON_BUTTON_CLASS =
  'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-none text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring'

export const WORKSPACE_TASKBAR_END_CLASS = 'flex shrink-0 items-center gap-1 pl-2'

export function WorkspaceTaskbar(props: {
  children: JSX.Element
  fixed?: boolean
  scrollable?: boolean
  class?: string
}) {
  return (
    <header
      data-workspace-taskbar
      class={cn(
        'relative z-[999999] flex h-8 shrink-0 items-center gap-2 bg-background px-3',
        props.fixed && 'fixed inset-x-0 bottom-0',
        props.scrollable && 'scrollbar-none overflow-x-auto',
        props.class,
      )}
      onWheel={(event) => {
        if (!props.scrollable || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
        event.currentTarget.scrollLeft += event.deltaY
        event.preventDefault()
      }}
    >
      {props.children}
    </header>
  )
}

export function WorkspaceTaskbarPins(props: {
  items: PinnedTaskbarItem[]
  customIcons: Record<string, string>
  fileIconContext: FileIconContext
  onSelect: (pin: PinnedTaskbarItem) => void
  onContextMenu: (pin: PinnedTaskbarItem, event: MouseEvent) => void
}) {
  return (
    <div class='flex shrink-0 items-center gap-2'>
      <For each={props.items}>
        {(pin) => {
          const label = taskbarPinLabel(pin)
          return (
            <div
              class='flex shrink-0 items-center justify-center px-0.5 py-1'
              data-taskbar-pin=''
              draggable='true'
              onDragStart={(event) => {
                if (!event.dataTransfer) return
                setFileDragData(event.dataTransfer, {
                  path: pin.path,
                  isDirectory: pin.isDirectory,
                  sourceKind: 'local',
                })
                event.dataTransfer.effectAllowed = 'copy'
              }}
            >
              <div
                role='button'
                tabindex={0}
                data-testid='workspace-taskbar-pin'
                title={label}
                aria-label={label}
                class={`${WORKSPACE_TASKBAR_ICON_BUTTON_CLASS} cursor-default [&_svg]:pointer-events-none`}
                onClick={() => props.onSelect(pin)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  props.onSelect(pin)
                }}
                onContextMenu={(event) => props.onContextMenu(pin, event)}
              >
                {pinnedItemIcon(pin, props.customIcons, props.fileIconContext)}
              </div>
            </div>
          )
        }}
      </For>
    </div>
  )
}
