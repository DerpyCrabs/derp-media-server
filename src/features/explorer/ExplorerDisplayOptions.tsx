import { view } from 'effectweb'
import { Button } from '@/lib/ui/button'
import { DropdownMenu } from '@/lib/ui/menu'
import SlidersHorizontal from '@effectweb/lucide/icons/sliders-horizontal'
import type {
  FileColumnVisibility,
  FileSortField,
  FileSortOrder,
} from '@/lib/models/settings-types'
import { defaultDirection } from './file-display-settings'
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
  { field: 'modifiedDate', label: 'Modified' },
  { field: 'createdDate', label: 'Created' },
  { field: 'type', label: 'Type' },
  { field: 'size', label: 'Size' },
  { field: 'favorite', label: 'Favorites' },
  { field: 'views', label: 'Views' },
]
export const ExplorerDisplayOptions = view<ExplorerDisplayOptionsProps>((props) => (
  <DropdownMenu
    aria-label='Display options'
    align='end'
    trigger={
      <Button
        variant='ghost'
        size={props.compact ? 'icon-sm' : 'icon'}
        aria-label='Display options'
      >
        <SlidersHorizontal />
      </Button>
    }
    items={[
      {
        kind: 'radio',
        label: 'List view',
        value: 'list',
        checked: props.viewMode === 'list',
        onSelect: () => props.onViewModeChange('list'),
      },
      {
        kind: 'radio',
        label: 'Grid view',
        value: 'grid',
        checked: props.viewMode === 'grid',
        onSelect: () => props.onViewModeChange('grid'),
      },
      { kind: 'separator' },
      {
        kind: 'submenu',
        label: 'Sort by',
        disabled: props.sortingDisabled,
        items: [
          ...fields.map(({ field, label }) => ({
            kind: 'radio' as const,
            label,
            value: field,
            checked: props.sortOrder.field === field,
            onSelect: () => props.onSortChange({ field, direction: defaultDirection(field) }),
          })),
          { kind: 'separator' },
          {
            kind: 'checkbox',
            label: 'Descending',
            checked: props.sortOrder.direction === 'desc',
            onCheckedChange: (descending) =>
              props.onSortChange({ ...props.sortOrder, direction: descending ? 'desc' : 'asc' }),
          },
        ],
      },
      {
        kind: 'submenu',
        label: 'Columns',
        items: [
          {
            kind: 'checkbox',
            label: 'Name',
            checked: true,
            disabled: true,
            onCheckedChange: () => {},
          },
          ...(['createdDate', 'size', 'favorite', 'views'] as const).map((field) => ({
            kind: 'checkbox' as const,
            label: fields.find((item) => item.field === field)!.label,
            checked: props.columns[field],
            onCheckedChange: (checked: boolean) =>
              props.onColumnsChange({ ...props.columns, [field]: checked }),
          })),
        ],
      },
    ]}
  />
))
