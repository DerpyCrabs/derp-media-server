import { view, type JSX } from 'effectweb'
import type { FileItem } from '@/lib/files/types'
import type { FileColumnVisibility } from '@/lib/models/settings-types'
import ArrowUp from '@effectweb/lucide/icons/arrow-up'
import { cn } from '@/lib/ui/cn'
import { FileExplorerListing } from './FileExplorerListing'
import { VirtualDirectoryGrid } from '@/features/explorer/VirtualDirectoryGrid'
import { VirtualDirectoryList } from '@/features/explorer/VirtualDirectoryList'
import {
  DirectoryListingEmpty,
  DirectoryListingEmptyTableRow,
} from '@/features/explorer/DirectoryListingFeedback'
import type { FileExplorerScrollTarget } from './FileExplorerView'
import { formatCreatedDate } from './file-display-settings'
export type FileBrowserElementAttributes<Element extends HTMLElement> = JSX.Attributes<Element> & {
  [attribute: string]: unknown
}
export type FileBrowserPaneListing = Readonly<{
  files: readonly FileItem[]
  viewMode: 'list' | 'grid'
  columns: FileColumnVisibility
  includeParent: boolean
  scrollTarget: FileExplorerScrollTarget
  scrollScope?: string | undefined
  showEmpty: boolean
  canUpload: boolean
}>
export type FileBrowserPaneLayout = Readonly<{
  gridContainerClass?: string
  listContainerClass?: string
  gridClass?: string
  listClass?: string
  listSizeColumnClass?: string
}>
export type FileBrowserPaneRows = Readonly<{
  onParentClick: () => void
  onFileClick: (file: FileItem, event?: MouseEvent | KeyboardEvent) => void
  onFileActivate?: (file: FileItem) => void
  parentGridAttributes?: FileBrowserElementAttributes<HTMLDivElement>
  parentRowAttributes?: FileBrowserElementAttributes<HTMLTableRowElement>
  fileGridAttributes?: (file: FileItem) => FileBrowserElementAttributes<HTMLDivElement>
  fileRowAttributes?: (file: FileItem) => FileBrowserElementAttributes<HTMLTableRowElement>
  renderGridIcon: (file: FileItem) => JSX.Element
  renderListIcon: (file: FileItem) => JSX.Element
  renderGridOverlay?: (file: FileItem) => JSX.Element
  renderGridDetails?: (file: FileItem) => JSX.Element
  renderListName?: (file: FileItem) => JSX.Element
  renderListNameTrailing?: (file: FileItem) => JSX.Element
  renderListSize?: (file: FileItem) => JSX.Element
  renderListActions?: (file: FileItem) => JSX.Element
  parentGridSubtitle?: JSX.Element
  renderParentRowEnd?: () => JSX.Element
}>
export type FileBrowserPaneProps = Readonly<{
  listing: FileBrowserPaneListing
  layout?: FileBrowserPaneLayout
  rows: FileBrowserPaneRows
}>
/** Shared directory surface used by all application hosts. */
export const FileBrowserPane = view<FileBrowserPaneProps>((props) => {
  const parentGridAttributes = () => props.rows.parentGridAttributes ?? {}
  const parentRowAttributes = () => props.rows.parentRowAttributes ?? {}
  const fileGridAttributes = (file: FileItem) => props.rows.fileGridAttributes?.(file) ?? {}
  const fileRowAttributes = (file: FileItem) => props.rows.fileRowAttributes?.(file) ?? {}
  const tableColumns = () => [
    { class: 'w-[40px]' },
    {},
    ...(props.listing.columns.createdDate ? [{ class: 'w-40' }] : []),
    ...(props.listing.columns.size ? [{ class: props.layout?.listSizeColumnClass ?? 'w-24' }] : []),
    ...(props.rows.renderListActions || props.rows.renderParentRowEnd
      ? [{ class: 'w-[52px] sm:w-0' }]
      : []),
  ]
  const listColSpan = () => tableColumns().length
  const tableClass = () => {
    if (props.listing.columns.createdDate) return 'min-w-[32rem]'
    if (props.listing.columns.size) return 'min-w-[22rem]'
    return ''
  }
  const parentCard = () => {
    const attributes = parentGridAttributes()
    return (
      <div
        {...attributes}
        class={cn(
          'ring-foreground/10 bg-card text-card-foreground flex cursor-pointer flex-col overflow-hidden rounded-xl py-0 text-left shadow-xs ring-1 transition-colors select-none hover:bg-muted/50',
          attributes.class,
        )}
        onClick={props.rows.onParentClick}
        onKeyDown={(event) => event.key === 'Enter' && props.rows.onParentClick()}
        role='button'
        tabindex={0}
      >
        <div class='bg-muted/80 flex aspect-video flex-col items-center justify-center p-4'>
          <ArrowUp class='mb-2 h-12 w-12 text-muted-foreground' size={48} stroke-width={2} />
          <p class='text-center text-sm font-medium'>..</p>
          {props.rows.parentGridSubtitle ? props.rows.parentGridSubtitle : null}
        </div>
      </div>
    )
  }
  const parentRow = () => {
    const attributes = parentRowAttributes()
    return (
      <tr
        {...attributes}
        class={cn(
          'cursor-pointer select-none border-b border-border transition-colors hover:bg-muted/50',
          attributes.class,
        )}
        onClick={props.rows.onParentClick}
      >
        <td class='w-[40px] min-w-[40px] max-w-[40px] box-border p-3 align-middle sm:p-2'>
          <div class='flex items-center justify-center'>
            <ArrowUp class='h-5 w-5 text-muted-foreground' size={20} stroke-width={2} />
          </div>
        </td>
        <td class='min-w-0 p-3 align-middle font-medium sm:p-2'>..</td>
        {props.listing.columns.createdDate ? (
          <td class='min-w-0 p-3 align-middle text-muted-foreground sm:p-2' />
        ) : null}
        {props.listing.columns.size ? (
          <td class='min-w-0 p-3 align-middle text-right text-muted-foreground sm:p-2' />
        ) : null}
        {props.rows.renderParentRowEnd ? props.rows.renderParentRowEnd?.() : null}
      </tr>
    )
  }
  const FileCard = (rowProps: { file: FileItem }) => {
    const file = () => rowProps.file
    const attributes = () => fileGridAttributes(file())
    return (
      <div
        {...attributes()}
        data-file-path={file().path}
        class={cn(
          'ring-foreground/10 bg-card text-card-foreground flex cursor-pointer flex-col overflow-hidden rounded-xl py-0 text-left shadow-xs ring-1 transition-colors select-none hover:bg-muted/50',
          attributes().class,
        )}
        onClick={(event) => props.rows.onFileClick(file(), event)}
        onDblClick={() => props.rows.onFileActivate?.(file())}
        onKeyDown={(event) => {
          const handler = attributes().onKeyDown
          if (typeof handler === 'function') handler(event)
          if (!event.defaultPrevented && event.key === 'Enter')
            props.rows.onFileClick(file(), event)
        }}
        role='button'
        tabindex={0}
      >
        <div class='group relative flex aspect-video items-center justify-center overflow-hidden bg-muted'>
          {props.rows.renderGridOverlay?.(file())}
          <div class='text-muted-foreground'>{props.rows.renderGridIcon(file())}</div>
        </div>
        {props.rows.renderGridDetails?.(file()) ?? (
          <div class='flex flex-col gap-1 p-3'>
            <p class='truncate text-sm font-medium' title={file().name}>
              {file().name}
            </p>
          </div>
        )}
      </div>
    )
  }
  const FileRow = (rowProps: { file: FileItem }) => {
    const file = () => rowProps.file
    const attributes = () => fileRowAttributes(file())
    return (
      <tr
        {...attributes()}
        data-file-path={file().path}
        class={cn(
          'group cursor-pointer select-none border-b border-border transition-colors hover:bg-muted/50',
          attributes().class,
        )}
        onClick={(event) => props.rows.onFileClick(file(), event)}
        onDblClick={() => props.rows.onFileActivate?.(file())}
      >
        <td class='w-[40px] min-w-[40px] max-w-[40px] box-border p-3 align-middle sm:p-2'>
          <div class='flex items-center justify-center'>{props.rows.renderListIcon(file())}</div>
        </td>
        <td class='min-w-0 p-3 align-middle font-medium sm:p-2'>
          <div class='flex min-w-0 items-center gap-2'>
            <div class='min-w-0 flex-1'>
              {props.rows.renderListName?.(file()) ?? (
                <span class='block truncate'>{file().name}</span>
              )}
            </div>
            {props.rows.renderListNameTrailing ? props.rows.renderListNameTrailing?.(file()) : null}
          </div>
        </td>
        {props.listing.columns.createdDate ? (
          <td
            class='min-w-0 p-3 align-middle text-muted-foreground tabular-nums sm:p-2'
            data-column='created-date'
          >
            {formatCreatedDate(file().createdDate)}
          </td>
        ) : null}
        {props.listing.columns.size ? (
          <td
            class='min-w-0 p-3 align-middle text-right text-muted-foreground sm:p-2'
            data-column='size'
          >
            {props.rows.renderListSize?.(file()) ?? (
              <span class='inline-block w-20 tabular-nums'>
                {file().isDirectory ? '' : file().size}
              </span>
            )}
          </td>
        ) : null}
        {props.rows.renderListActions ? props.rows.renderListActions?.(file()) : null}
      </tr>
    )
  }
  return (
    <FileExplorerListing
      viewMode={props.listing.viewMode}
      renderGrid={() => (
        <div class={props.layout?.gridContainerClass}>
          <VirtualDirectoryGrid
            files={props.listing.files}
            includeParent={props.listing.includeParent}
            scrollTarget={props.listing.scrollTarget}
            scrollScope={props.listing.scrollScope}
            class={props.layout?.gridClass}
            renderParentCard={parentCard}
            renderFileCard={(file) => FileCard({ file })}
          />
          <DirectoryListingEmpty
            show={props.listing.showEmpty}
            canUpload={props.listing.canUpload}
          />
        </div>
      )}
      renderList={() => (
        <div class={props.layout?.listContainerClass}>
          <VirtualDirectoryList
            files={props.listing.files}
            includeParent={props.listing.includeParent}
            scrollTarget={props.listing.scrollTarget}
            scrollScope={props.listing.scrollScope}
            class={props.layout?.listClass}
            colSpan={listColSpan()}
            columns={tableColumns()}
            tableClass={tableClass()}
            sizeColumnClass={props.layout?.listSizeColumnClass}
            renderParentRow={parentRow}
            renderFileRow={(file) => FileRow({ file })}
            renderEmptyRow={() => (
              <DirectoryListingEmptyTableRow
                show={props.listing.showEmpty}
                canUpload={props.listing.canUpload}
                colSpan={listColSpan()}
              />
            )}
          />
        </div>
      )}
    />
  )
})
