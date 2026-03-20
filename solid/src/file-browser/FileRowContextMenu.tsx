import type { FileItem } from '@/lib/types'
import type { Accessor } from 'solid-js'
import { createEffect, onCleanup, Show } from 'solid-js'

type MenuState = { x: number; y: number; file: FileItem }

type FileRowContextMenuProps = {
  menu: Accessor<MenuState | null>
  onDismiss: () => void
  onDelete: (file: FileItem) => void
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
        return (
          <div
            data-slot='file-row-context-menu'
            class='fixed z-55 min-w-36 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md'
            style={{ left: `${ctx.x}px`, top: `${ctx.y}px` }}
            role='menu'
          >
            <button
              type='button'
              data-slot='context-menu-item'
              class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground text-destructive'
              role='menuitem'
              onClick={() => props.onDelete(ctx.file)}
            >
              Delete
            </button>
          </div>
        )
      }}
    </Show>
  )
}
