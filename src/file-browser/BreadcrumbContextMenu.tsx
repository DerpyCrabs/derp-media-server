import type { BreadcrumbFolderMenuTarget } from '@/lib/breadcrumb-floating-store'
import { FloatingContextMenu } from './FloatingContextMenu'
import AppWindow from 'lucide-solid/icons/app-window'
import ExternalLink from 'lucide-solid/icons/external-link'
import Pencil from 'lucide-solid/icons/pencil'
import type { Accessor } from 'solid-js'
import { Show } from 'solid-js'

export type BreadcrumbMenuTarget = BreadcrumbFolderMenuTarget

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
  return (
    <FloatingContextMenu
      state={props.target}
      anchor={(ctx) => ({ x: ctx.x, y: ctx.y })}
      onDismiss={props.onDismiss}
      breadcrumbFolderMenuSurface
      data-slot='breadcrumb-context-menu'
    >
      {(ctx) => (
        <>
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
        </>
      )}
    </FloatingContextMenu>
  )
}
