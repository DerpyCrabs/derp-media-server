import AppWindow from 'lucide-solid/icons/app-window'
import ExternalLink from 'lucide-solid/icons/external-link'
import Pencil from 'lucide-solid/icons/pencil'
import type { Accessor } from 'solid-js'
import { Show, createEffect, onCleanup } from 'solid-js'

export type BreadcrumbMenuTarget = {
  x: number
  y: number
  serverPath: string
  displayName: string
  isHome: boolean
}

type Props = {
  target: Accessor<BreadcrumbMenuTarget | null>
  onDismiss: () => void
  showOpenInNewTab?: boolean
  onOpenInNewTab?: () => void
  showOpenInWorkspace?: boolean
  onOpenInWorkspace?: () => void
  showSetIcon?: boolean
  onSetIcon?: () => void
  showDownloadAsZip?: boolean
  onDownloadAsZip?: () => void
}

export function BreadcrumbContextMenu(props: Props) {
  createEffect(() => {
    const t = props.target()
    if (!t) return
    const onDoc = (e: MouseEvent) => {
      const el = e.target as Element | null
      if (el?.closest?.('[data-slot="breadcrumb-context-menu"]')) return
      props.onDismiss()
    }
    document.addEventListener('mousedown', onDoc)
    onCleanup(() => document.removeEventListener('mousedown', onDoc))
  })

  return (
    <Show when={props.target()} keyed>
      {(ctx) => (
        <div
          data-no-window-drag
          data-slot='breadcrumb-context-menu'
          class='fixed z-500000 min-w-36 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md'
          style={{ left: `${ctx.x}px`, top: `${ctx.y}px` }}
          role='menu'
        >
          <Show when={props.showSetIcon && !ctx.isHome}>
            <button
              type='button'
              data-slot='context-menu-item'
              data-testid='breadcrumb-menu-set-icon'
              class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
              role='menuitem'
              onClick={() => {
                props.onSetIcon?.()
                props.onDismiss()
              }}
            >
              <Pencil class='h-4 w-4 shrink-0' stroke-width={2} />
              Set icon
            </button>
          </Show>
          <Show when={props.showOpenInNewTab && !ctx.isHome}>
            <button
              type='button'
              data-slot='context-menu-item'
              data-testid='breadcrumb-menu-open-new-tab'
              class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
              role='menuitem'
              onClick={() => {
                props.onOpenInNewTab?.()
                props.onDismiss()
              }}
            >
              <ExternalLink class='h-4 w-4 shrink-0' stroke-width={2} />
              Open in new tab
            </button>
          </Show>
          <Show when={props.showOpenInWorkspace}>
            <button
              type='button'
              data-slot='context-menu-item'
              data-testid='breadcrumb-menu-open-workspace'
              class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
              role='menuitem'
              onClick={() => {
                props.onOpenInWorkspace?.()
                props.onDismiss()
              }}
            >
              <AppWindow class='h-4 w-4 shrink-0' stroke-width={2} />
              Open in Workspace
            </button>
          </Show>
          <Show when={props.showDownloadAsZip}>
            <button
              type='button'
              data-slot='context-menu-item'
              data-testid='breadcrumb-menu-download-zip'
              class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
              role='menuitem'
              onClick={() => {
                props.onDownloadAsZip?.()
                props.onDismiss()
              }}
            >
              Download as ZIP
            </button>
          </Show>
        </div>
      )}
    </Show>
  )
}
