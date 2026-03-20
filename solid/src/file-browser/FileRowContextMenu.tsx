import type { FileItem } from '@/lib/types'
import { isPathEditable } from '@/lib/utils'
import Pin from 'lucide-solid/icons/pin'
import type { Accessor } from 'solid-js'
import { createEffect, onCleanup, Show } from 'solid-js'

type MenuState = { x: number; y: number; file: FileItem }

type FileRowContextMenuProps = {
  menu: Accessor<MenuState | null>
  editableFolders: Accessor<string[]>
  onDismiss: () => void
  onDownload: (file: FileItem) => void
  onDelete: (file: FileItem) => void
  onAddToTaskbar?: (file: FileItem) => void
}

export function FileRowContextMenu(props: FileRowContextMenuProps) {
  createEffect(() => {
    const ctx = props.menu()
    if (!ctx) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Element | null
      if (t?.closest?.('[data-slot="file-row-context-menu"]')) return
      props.onDismiss()
    }
    document.addEventListener('mousedown', onDoc)
    onCleanup(() => document.removeEventListener('mousedown', onDoc))
  })

  return (
    <Show when={props.menu()}>
      {(getCtx) => {
        const ctx = getCtx()
        const downloadLabel = () => (ctx.file.isDirectory ? 'Download as ZIP' : 'Download')
        const showDelete = () =>
          isPathEditable(ctx.file.path, props.editableFolders()) && !ctx.file.isVirtual

        return (
          <div
            data-slot='file-row-context-menu'
            class='fixed z-[500000] min-w-36 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md'
            style={{ left: `${ctx.x}px`, top: `${ctx.y}px` }}
            role='menu'
          >
            <Show when={props.onAddToTaskbar && !ctx.file.isVirtual}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                role='menuitem'
                onClick={() => {
                  props.onAddToTaskbar?.(ctx.file)
                  props.onDismiss()
                }}
              >
                <Pin class='h-4 w-4 shrink-0' stroke-width={2} />
                Add to taskbar
              </button>
            </Show>
            <button
              type='button'
              data-slot='context-menu-item'
              class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
              role='menuitem'
              onClick={() => {
                props.onDownload(ctx.file)
                props.onDismiss()
              }}
            >
              {downloadLabel()}
            </button>
            <Show when={showDelete()}>
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground text-destructive'
                role='menuitem'
                onClick={() => props.onDelete(ctx.file)}
              >
                Delete
              </button>
            </Show>
          </div>
        )
      }}
    </Show>
  )
}
