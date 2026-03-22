import type { FileItem } from '@/lib/types'
import type { Accessor } from 'solid-js'
import { Show } from 'solid-js'

type DeleteFileDialogProps = {
  item: Accessor<FileItem | null>
  isPending: boolean
  onDismiss: () => void
  onConfirm: () => void
}

export function DeleteFileDialog(props: DeleteFileDialogProps) {
  return (
    <Show when={props.item()}>
      {(getItem) => {
        const item = getItem()
        const isRevoke = () => !!item.shareToken
        return (
          <div
            data-no-window-drag
            class='fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4'
            role='presentation'
            onClick={() => props.onDismiss()}
          >
            <div
              role='alertdialog'
              aria-modal='true'
              class='w-full max-w-md rounded-lg border border-border bg-card text-card-foreground shadow-lg p-6'
              onClick={(e) => e.stopPropagation()}
            >
              <h2 class='text-lg font-semibold'>
                {isRevoke() ? 'Revoke Share?' : `Delete ${item.isDirectory ? 'Folder' : 'File'}?`}
              </h2>
              <p class='text-sm text-muted-foreground mt-2'>
                <Show
                  when={isRevoke()}
                  fallback={
                    <>
                      Are you sure you want to delete &quot;{item.name}&quot;?
                      <span class='block mt-2 text-sm font-medium text-foreground'>
                        This action cannot be undone.
                      </span>
                    </>
                  }
                >
                  <>
                    Are you sure you want to revoke the share link for &quot;{item.name}&quot;? The
                    link will stop working immediately.
                  </>
                </Show>
              </p>
              <div class='flex justify-end gap-2 mt-6'>
                <button
                  type='button'
                  class='h-9 px-4 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent'
                  onClick={() => props.onDismiss()}
                >
                  Cancel
                </button>
                <button
                  type='button'
                  class='h-9 px-4 rounded-md bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 disabled:opacity-50'
                  disabled={props.isPending}
                  onClick={() => props.onConfirm()}
                >
                  {props.isPending
                    ? isRevoke()
                      ? 'Revoking...'
                      : 'Deleting...'
                    : isRevoke()
                      ? 'Revoke Share'
                      : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )
      }}
    </Show>
  )
}
