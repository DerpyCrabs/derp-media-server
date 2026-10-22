import { view } from 'effectweb'
import type { BreadcrumbFolderMenuTarget } from '@/features/explorer/breadcrumb-floating-store'
import { FloatingContextMenu } from './FloatingContextMenu'
import AppWindow from '@effectweb/lucide/icons/app-window'
import ExternalLink from '@effectweb/lucide/icons/external-link'
import Pencil from '@effectweb/lucide/icons/pencil'
export type BreadcrumbMenuTarget = BreadcrumbFolderMenuTarget
type Props = {
  target: BreadcrumbMenuTarget | null
  onDismiss: () => void
  showOpenInNewTab?: boolean
  onOpenInNewTab?: () => void
  showOpenInOtherSurface?: boolean
  onOpenInOtherSurface?: () => void
  openInOtherSurfaceLabel?: string
  showSetIcon?: boolean
  onSetIcon?: () => void
  showDownloadAsZip?: boolean
  onDownloadAsZip?: () => void
}
export const BreadcrumbContextMenu = view<Props>((props) => {
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
          {props.showSetIcon && !ctx.isHome ? (
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
          ) : null}
          {props.showOpenInNewTab && !ctx.isHome ? (
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
          ) : null}
          {props.showOpenInOtherSurface ? (
            <button
              type='button'
              data-slot='context-menu-item'
              data-testid='breadcrumb-menu-open-workspace'
              class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
              role='menuitem'
              onClick={() => {
                props.onOpenInOtherSurface?.()
                props.onDismiss()
              }}
            >
              <AppWindow class='h-4 w-4 shrink-0' stroke-width={2} />
              {props.openInOtherSurfaceLabel ?? 'Open in other view'}
            </button>
          ) : null}
          {props.showDownloadAsZip ? (
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
          ) : null}
        </>
      )}
    </FloatingContextMenu>
  )
})
