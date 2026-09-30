import { view } from 'effectweb'
import LoaderCircle from '@effectweb/lucide/icons/loader-circle'
export const DirectoryListingErrorPanel = view<{ onRetry: () => void; detail?: string }>(
  (props) => {
    return (
      <div class='p-4' data-testid='directory-list-error'>
        <p class='text-destructive text-sm font-medium'>Failed to load files.</p>
        {props.detail?.trim() ? (
          <p class='text-muted-foreground mt-1 text-xs wrap-break-word'>{props.detail}</p>
        ) : null}
        <button
          type='button'
          class='bg-primary text-primary-foreground hover:bg-primary/90 mt-3 inline-flex h-9 items-center rounded-md px-4 text-sm font-medium shadow-sm'
          onClick={() => props.onRetry()}
        >
          Retry
        </button>
      </div>
    )
  },
)
export const DirectoryListingLoading = view<{ show: boolean }>((props) => {
  return props.show ? (
    <div class='flex items-center justify-center gap-3 py-12' data-testid='directory-loading'>
      <LoaderCircle class='text-primary h-5 w-5 shrink-0 animate-spin' size={20} stroke-width={2} />
      <span class='text-muted-foreground text-sm font-medium'>Loading…</span>
    </div>
  ) : null
})
export const DirectoryListingEmpty = view<{ show: boolean; canUpload: boolean }>((props) => {
  return props.show ? (
    <div
      class='col-span-full flex flex-col items-center justify-center px-4 py-10 text-center'
      data-testid='directory-empty'
    >
      <p class='text-foreground text-sm font-medium'>This folder is empty</p>
      {props.canUpload ? (
        <p class='text-muted-foreground mt-1 max-w-sm text-xs'>
          Drop files here or use Upload to add items.
        </p>
      ) : null}
      {!props.canUpload ? (
        <p class='text-muted-foreground mt-1 max-w-sm text-xs'>
          There are no files in this folder.
        </p>
      ) : null}
    </div>
  ) : null
})
export const DirectoryListingEmptyTableRow = view<{
  show: boolean
  canUpload: boolean
  colSpan?: number
}>((props) => {
  return props.show ? (
    <tr data-testid='directory-empty'>
      <td colspan={props.colSpan ?? 3} class='p-8 text-center'>
        <p class='text-foreground text-sm font-medium'>This folder is empty</p>
        {props.canUpload ? (
          <p class='text-muted-foreground mt-1 text-xs'>
            Drop files here or use Upload to add items.
          </p>
        ) : null}
        {!props.canUpload ? (
          <p class='text-muted-foreground mt-1 text-xs'>There are no files in this folder.</p>
        ) : null}
      </td>
    </tr>
  ) : null
})
