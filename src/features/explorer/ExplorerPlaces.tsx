import { component, view, list, domMount } from 'effectweb'
import Star from '@effectweb/lucide/icons/star'
import MapPin from '@effectweb/lucide/icons/map-pin'
import HardDrive from '@effectweb/lucide/icons/hard-drive'
import House from '@effectweb/lucide/icons/house'
import Trash2 from '@effectweb/lucide/icons/trash-2'
import Folder from '@effectweb/lucide/icons/folder'
import { FloatingContextMenu } from './FloatingContextMenu'

const focusPlace = domMount((element: HTMLDivElement) => {
  ;(
    element.querySelector<HTMLButtonElement>('[aria-current=location]') ??
    element.querySelector<HTMLButtonElement>('[role=menuitem]')
  )?.focus()
})

type Props = {
  places: readonly { name: string; path: string; kind?: string }[]
  currentPath: string
  onNavigate: (path: string) => void
  onRefresh: () => void
  onTrash?: () => void
}
export const ExplorerPlaces = component(
  { init: (_props: Props) => ({ anchor: null as HTMLButtonElement | null }) },
  view((local, patch) => (
    <>
      <button
        type='button'
        class='inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground'
        aria-label='Places'
        aria-haspopup='menu'
        title='Places'
        aria-expanded={!!local.anchor}
        onClick={(event) => {
          patch({ anchor: local.anchor ? null : event.currentTarget })
          local.props.onRefresh()
        }}
      >
        <MapPin class='size-4' />
      </button>
      <FloatingContextMenu
        open={!!local.anchor}
        anchorRef={local.anchor}
        onDismiss={() => patch({ anchor: null })}
        class='max-h-[min(28rem,70vh)] w-60 overflow-y-auto'
      >
        <div
          use={focusPlace}
          onKeyDown={(event) => {
            if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return
            if (event.key === 'Tab') {
              patch({ anchor: null })
              local.anchor?.focus()
              return
            }
            const items = [
              ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role=menuitem]:not(:disabled)',
              ),
            ]
            const index = items.indexOf(document.activeElement as HTMLButtonElement)
            const next =
              event.key === 'ArrowDown'
                ? items[(index + 1) % items.length]
                : event.key === 'ArrowUp'
                  ? items[(index - 1 + items.length) % items.length]
                  : event.key === 'Home'
                    ? items[0]
                    : event.key === 'End'
                      ? items.at(-1)
                      : undefined
            if (next) {
              event.preventDefault()
              event.stopPropagation()
              next.focus()
            }
          }}
        >
          <div class='px-2 py-1 text-xs font-medium text-muted-foreground'>Places</div>
          {list(
            local.props.places,
            (place) => place.path,
            (place) => (
              <button
                type='button'
                role='menuitem'
                class='flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent'
                aria-current={place.path === local.props.currentPath ? 'location' : undefined}
                title={place.path || '/'}
                onClick={() => {
                  patch({ anchor: null })
                  local.props.onNavigate(place.path)
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
                <span class='min-w-0'>
                  <span class='block truncate'>{place.name}</span>
                  {local.props.places.some(
                    (other) => other.name === place.name && other.path !== place.path,
                  ) ? (
                    <span class='block truncate text-xs text-muted-foreground'>{place.path}</span>
                  ) : null}
                </span>
              </button>
            ),
          )}
          {local.props.onTrash ? (
            <button
              type='button'
              role='menuitem'
              class='mt-1 flex w-full items-center gap-2 border-t border-border px-2 py-2 text-left text-sm hover:bg-accent'
              onClick={() => {
                patch({ anchor: null })
                local.props.onTrash?.()
              }}
            >
              <Trash2 class='size-4 shrink-0' /> Trash
            </button>
          ) : null}
        </div>
      </FloatingContextMenu>
    </>
  )),
)
