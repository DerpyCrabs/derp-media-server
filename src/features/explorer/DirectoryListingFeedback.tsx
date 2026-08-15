import LoaderCircle from 'lucide-solid/icons/loader-circle'
import { Show } from 'solid-js'

export function DirectoryListingErrorPanel(props: { onRetry: () => void; detail?: string }) {
  return (
    <div class='p-4' data-testid='directory-list-error'>
      <p class='text-destructive text-sm font-medium'>Failed to load files.</p>
      <Show when={props.detail?.trim()}>
        <p class='text-muted-foreground mt-1 text-xs wrap-break-word'>{props.detail}</p>
      </Show>
      <button
        type='button'
        class='bg-primary text-primary-foreground hover:bg-primary/90 mt-3 inline-flex h-9 items-center rounded-md px-4 text-sm font-medium shadow-sm'
        onClick={() => props.onRetry()}
      >
        Retry
      </button>
    </div>
  )
}

export function DirectoryListingLoading(props: { show: boolean }) {
  return (
    <Show when={props.show}>
      <div class='flex items-center justify-center gap-3 py-12' data-testid='directory-loading'>
        <LoaderCircle
          class='text-primary h-5 w-5 shrink-0 animate-spin'
          size={20}
          stroke-width={2}
        />
        <span class='text-muted-foreground text-sm font-medium'>Loading…</span>
      </div>
    </Show>
  )
}

export function DirectoryListingEmpty(props: { show: boolean; canUpload: boolean }) {
  return (
    <Show when={props.show}>
      <div
        class='col-span-full flex flex-col items-center justify-center px-4 py-10 text-center'
        data-testid='directory-empty'
      >
        <p class='text-foreground text-sm font-medium'>This folder is empty</p>
        <Show when={props.canUpload}>
          <p class='text-muted-foreground mt-1 max-w-sm text-xs'>
            Drop files here or use Upload to add items.
          </p>
        </Show>
        <Show when={!props.canUpload}>
          <p class='text-muted-foreground mt-1 max-w-sm text-xs'>
            There are no files in this folder.
          </p>
        </Show>
      </div>
    </Show>
  )
}

export function DirectoryListingEmptyTableRow(props: { show: boolean; canUpload: boolean }) {
  return (
    <Show when={props.show}>
      <tr data-testid='directory-empty'>
        <td colspan={3} class='p-8 text-center'>
          <p class='text-foreground text-sm font-medium'>This folder is empty</p>
          <Show when={props.canUpload}>
            <p class='text-muted-foreground mt-1 text-xs'>
              Drop files here or use Upload to add items.
            </p>
          </Show>
          <Show when={!props.canUpload}>
            <p class='text-muted-foreground mt-1 text-xs'>There are no files in this folder.</p>
          </Show>
        </td>
      </tr>
    </Show>
  )
}
