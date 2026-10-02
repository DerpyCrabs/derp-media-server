import { type Snapshot, component, view, list } from 'effectweb'
import { cn } from '@/lib/ui/cn'
import type {
  FileColumnVisibility,
  FileSortField,
  FileSortOrder,
} from '@/lib/models/settings-types'
import ArrowDown from '@effectweb/lucide/icons/arrow-down'
import ArrowUp from '@effectweb/lucide/icons/arrow-up'
import Check from '@effectweb/lucide/icons/check'
import LayoutGrid from '@effectweb/lucide/icons/layout-grid'
import List from '@effectweb/lucide/icons/list'
import SlidersHorizontal from '@effectweb/lucide/icons/sliders-horizontal'
import { defaultDirection } from './file-display-settings'
import { FloatingContextMenu } from './FloatingContextMenu'
import { FLOATING_Z_EXPLORER_DISPLAY_OPTIONS } from '@/lib/ui/floating-z-index'
type ExplorerDisplayOptionsProps = {
  sortOrder: FileSortOrder
  columns: FileColumnVisibility
  sortingDisabled?: boolean
  compact?: boolean
  viewMode: 'list' | 'grid'
  onSortChange: (sortOrder: FileSortOrder) => void
  onColumnsChange: (columns: FileColumnVisibility) => void
  onViewModeChange: (viewMode: 'list' | 'grid') => void
}
const fields: { field: FileSortField; label: string }[] = [
  { field: 'name', label: 'Name' },
  { field: 'createdDate', label: 'Created' },
  { field: 'size', label: 'Size' },
  { field: 'favorite', label: 'Favorites' },
  { field: 'views', label: 'Views' },
]
export const ExplorerDisplayOptions = component(
  {
    init: (_props: Snapshot<ExplorerDisplayOptionsProps>) => ({
      open: false,
      anchor: null as HTMLDivElement | null,
    }),
  },
  view((local, patch) => {
    const props = local.props
    const open = () => local.open,
      setOpen = (value: boolean) => patch({ open: value })
    const anchor = () => local.anchor,
      setAnchor = (value: HTMLDivElement | null) => patch({ anchor: value })
    function selectSort(field: FileSortField) {
      const direction =
        props.sortOrder.field === field
          ? props.sortOrder.direction === 'asc'
            ? 'desc'
            : 'asc'
          : defaultDirection(field)
      props.onSortChange({ field, direction })
    }
    function selectView(viewMode: 'list' | 'grid') {
      setOpen(false)
      props.onViewModeChange(viewMode)
    }
    return (
      <div class='relative'>
        <button
          type='button'
          class={cn(
            props.compact ? 'size-6.5' : 'size-8',
            'inline-flex shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground',
          )}
          aria-label='Display options'
          aria-expanded={open() ? 'true' : 'false'}
          title='Display options'
          onClick={(event) => {
            setAnchor(event.currentTarget.parentElement as HTMLDivElement)
            setOpen(!open())
          }}
        >
          <SlidersHorizontal class={props.compact ? 'size-3.5' : 'size-4'} stroke-width={2} />
        </button>
        <FloatingContextMenu
          open={open()}
          anchorRef={anchor()}
          minWidthMin={208}
          zIndex={FLOATING_Z_EXPLORER_DISPLAY_OPTIONS}
          onDismiss={() => setOpen(false)}
          class='max-h-[calc(100vh-1rem)] w-52 overflow-y-auto'
          data-testid='explorer-display-options'
        >
          <>
            <div class='px-2 py-1 text-xs font-medium text-muted-foreground'>View</div>
            <button
              type='button'
              role='menuitem'
              aria-label='List view'
              class='flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground'
              onClick={() => selectView('list')}
            >
              <span class='w-4'>
                {props.viewMode === 'list' ? <Check class='size-4' stroke-width={2} /> : null}
              </span>
              <List class='size-4' stroke-width={2} />
              <span>List</span>
            </button>
            <button
              type='button'
              role='menuitem'
              aria-label='Grid view'
              class='flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground'
              onClick={() => selectView('grid')}
            >
              <span class='w-4'>
                {props.viewMode === 'grid' ? <Check class='size-4' stroke-width={2} /> : null}
              </span>
              <LayoutGrid class='size-4' stroke-width={2} />
              <span>Grid</span>
            </button>
            <div class='my-1 border-t border-border' />
            <div class='px-2 py-1 text-xs font-medium text-muted-foreground'>Sort by</div>
            {list(
              fields,
              (item) => item.field,
              (item) => (
                <button
                  type='button'
                  role='menuitem'
                  disabled={props.sortingDisabled}
                  class='flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40'
                  onClick={() => selectSort(item.field)}
                >
                  <span class='w-4'>
                    {props.sortOrder.field === item.field ? (
                      <Check class='size-4' stroke-width={2} />
                    ) : null}
                  </span>
                  <span class='flex-1 text-left'>{item.label}</span>
                  {props.sortOrder.field === item.field ? (
                    props.sortOrder.direction === 'asc' ? (
                      <ArrowUp class='size-4' stroke-width={2} />
                    ) : (
                      <ArrowDown class='size-4' stroke-width={2} />
                    )
                  ) : null}
                </button>
              ),
            )}
            <div class='my-1 border-t border-border' />
            <div class='px-2 py-1 text-xs font-medium text-muted-foreground'>Columns</div>
            <label class='flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm opacity-60'>
              <input type='checkbox' checked disabled /> Name
            </label>
            <label class='flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent'>
              <input
                type='checkbox'
                checked={props.columns.createdDate}
                onChange={(event) =>
                  props.onColumnsChange({
                    ...props.columns,
                    createdDate: event.currentTarget.checked,
                  })
                }
              />
              Created
            </label>
            <label class='flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent'>
              <input
                type='checkbox'
                checked={props.columns.size}
                onChange={(event) =>
                  props.onColumnsChange({ ...props.columns, size: event.currentTarget.checked })
                }
              />
              Size
            </label>
            <label class='flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent'>
              <input
                type='checkbox'
                checked={props.columns.favorite}
                onChange={(event) =>
                  props.onColumnsChange({ ...props.columns, favorite: event.currentTarget.checked })
                }
              />
              Favorites
            </label>
            <label class='flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent'>
              <input
                type='checkbox'
                checked={props.columns.views}
                onChange={(event) =>
                  props.onColumnsChange({ ...props.columns, views: event.currentTarget.checked })
                }
              />
              Views
            </label>
          </>
        </FloatingContextMenu>
      </div>
    )
  }),
)
