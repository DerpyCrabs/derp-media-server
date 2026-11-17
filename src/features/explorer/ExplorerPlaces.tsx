import { Button } from '@/lib/ui/button'
import { Sheet } from '@/lib/ui/sheet'
import { MenuItem } from '@/lib/ui/menu-item'
import { FloatingContextMenu } from './FloatingContextMenu'
import {
  component,
  controllerView,
  modelOwner,
  ownerController,
  domBinding,
  list,
  view,
  type JSX,
} from 'effectweb'
import Star from '@effectweb/lucide/icons/star'
import PanelLeft from '@effectweb/lucide/icons/panel-left'
import HardDrive from '@effectweb/lucide/icons/hard-drive'
import House from '@effectweb/lucide/icons/house'
import Trash2 from '@effectweb/lucide/icons/trash-2'
import Folder from '@effectweb/lucide/icons/folder'
import { cn } from '@/lib/ui/cn'

type Place = { name: string; path: string; kind?: string }
type Props = {
  places: readonly Place[]
  currentPath: string
  onNavigate: (path: string) => void
  onRemove?: (path: string) => void
  onTrash?: () => void
}
export const ExplorerPlaces = component(
  { init: (_props: Props) => ({ menu: null as { x: number; y: number; path: string } | null }) },
  view((model, patch) => {
    const props = model.props
    const groups = [
      props.places.filter((place) => !['mount', 'bookmark', 'favorite'].includes(place.kind ?? '')),
      props.places.filter((place) => ['bookmark', 'favorite'].includes(place.kind ?? '')),
      props.places.filter((place) => place.kind === 'mount'),
    ].filter((group) => group.length)
    return (
      <nav aria-label='Places' class='flex min-h-0 flex-col gap-2 overflow-y-auto p-2'>
        {list(
          groups,
          (group) => group[0]!.path,
          (group, index) => (
            <div class={index ? 'border-t border-border pt-2' : ''}>
              {group[0]?.kind === 'mount' ? (
                <div class='px-2 py-1 text-xs text-muted-foreground'>Devices</div>
              ) : null}
              {list(
                group,
                (place) => place.path,
                (place) => (
                  <Button
                    variant='ghost'
                    class={cn(
                      'mb-0.5 h-auto min-h-9 w-full justify-start gap-2 rounded-md px-2 py-2 font-normal',
                      props.currentPath === place.path && 'bg-accent text-accent-foreground',
                    )}
                    aria-current={props.currentPath === place.path ? 'location' : undefined}
                    title={place.path || place.name}
                    onClick={() => props.onNavigate(place.path)}
                    onContextMenu={(event) => {
                      if (place.kind !== 'bookmark' || !props.onRemove) return
                      event.preventDefault()
                      event.stopPropagation()
                      patch({ menu: { x: event.clientX, y: event.clientY, path: place.path } })
                    }}
                  >
                    {place.kind === 'favorite' ? (
                      <Star class='size-4 shrink-0 text-amber-500' />
                    ) : place.kind === 'home' ? (
                      <House class='size-4 shrink-0' />
                    ) : place.kind === 'mount' || place.kind === 'root' ? (
                      <HardDrive class='size-4 shrink-0' />
                    ) : (
                      <Folder class='size-4 shrink-0' />
                    )}
                    <span class='min-w-0 truncate text-left'>
                      <span class='block truncate'>{place.name}</span>
                      {props.places.some(
                        (other) => other.name === place.name && other.path !== place.path,
                      ) ? (
                        <span class='block truncate text-xs text-muted-foreground'>
                          /{place.path}
                        </span>
                      ) : null}
                    </span>
                  </Button>
                ),
              )}
            </div>
          ),
        )}
        {props.onTrash ? (
          <Button
            variant='ghost'
            class='h-9 w-full justify-start gap-2 px-2 font-normal'
            onClick={props.onTrash}
          >
            <Trash2 class='size-4' />
            Trash
          </Button>
        ) : null}
        <FloatingContextMenu
          state={model.menu}
          anchor={(menu) => menu}
          onDismiss={() => patch({ menu: null })}
        >
          {(menu) => (
            <MenuItem
              onClick={() => {
                props.onRemove?.(menu.path)
                patch({ menu: null })
              }}
            >
              Remove from sidebar
            </MenuItem>
          )}
        </FloatingContextMenu>
      </nav>
    )
  }),
)

const positionSidebar = (element: HTMLElement) => {
  const bounds = element.getBoundingClientRect()
  const top = Math.max(0, bounds.top)
  element.style.setProperty('--places-left', `${Math.max(0, bounds.left)}px`)
  element.style.setProperty('--places-top', `${top}px`)
  element.style.setProperty(
    '--places-height',
    `${Math.max(0, Math.min(innerHeight, bounds.bottom) - top)}px`,
  )
  element.style.setProperty('--places-width', `${Math.min(256, bounds.width * 0.85)}px`)
}
const sidebarSize = (element: HTMLDivElement, current: () => (wide: boolean) => void) => {
  let frame = 0
  const observer = new ResizeObserver(([entry]) => {
    const wide = (entry?.contentRect.width ?? 0) >= 900
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      positionSidebar(element)
      current()(wide)
    })
  })
  observer.observe(element)
  return () => {
    observer.disconnect()
    cancelAnimationFrame(frame)
  }
}
type SidebarProps = {
  visible: boolean
  embedded: boolean
  onRefresh: () => void
  sidebar: (close: () => void) => JSX.Element
  children: (toggle: JSX.Element) => JSX.Element
}
export const ExplorerSidebar = controllerView(
  {
    controller: (props: SidebarProps) => {
      const owner = modelOwner({ props, wide: false, open: false })
      props.onRefresh()
      return {
        ...ownerController(owner),
        resize: (wide: boolean) => {
          if (wide !== owner.read().wide) owner.patch({ wide, open: false })
        },
        close: () => owner.patch({ open: false }),
        setOpen: (open: boolean) => owner.patch({ open }),
        open: () => {
          owner.read().props.onRefresh()
          owner.patch({ open: true })
        },
      }
    },
  },
  view((model) => {
    const props = model.props
    return (
      <div
        class={cn(
          '@container/places relative flex min-w-0 flex-1',
          props.embedded ? 'h-full min-h-0' : undefined,
        )}
        data-places-layout
        use={domBinding(model.actions.resize, sidebarSize)}
      >
        {props.visible ? (
          <aside
            class={cn(
              'hidden w-56 shrink-0 flex-col border-r border-border bg-muted/20 @min-[900px]/places:flex',
              props.embedded
                ? 'min-h-0'
                : 'sticky top-0 h-[calc(100dvh-var(--media-top-space,0px))] self-start',
            )}
            data-testid='places-sidebar'
          >
            {props.sidebar(model.actions.close)}
          </aside>
        ) : null}
        <div class='flex min-h-0 min-w-0 flex-1 flex-col'>
          {props.children(
            props.visible ? (
              <Button
                variant='ghost'
                size='icon'
                class='@min-[900px]/places:hidden'
                aria-label='Show sidebar'
                title='Show sidebar'
                aria-expanded={model.open}
                onClick={(event) => {
                  const layout = event.currentTarget.closest<HTMLElement>('[data-places-layout]')
                  if (layout) positionSidebar(layout)
                  model.actions.open()
                }}
              >
                <PanelLeft />
              </Button>
            ) : null,
          )}
        </div>
        {props.visible && !model.wide && model.open ? (
          <Sheet
            open
            side='left'
            title='Places'
            onOpenChange={model.actions.setOpen}
            class='gap-0 data-[side=left]:left-[var(--places-left)] data-[side=left]:top-[var(--places-top)] data-[side=left]:bottom-auto data-[side=left]:h-[var(--places-height)] data-[side=left]:w-[var(--places-width)] data-[side=left]:max-w-none'
          >
            {props.sidebar(model.actions.close)}
          </Sheet>
        ) : null}
      </div>
    )
  }),
)
