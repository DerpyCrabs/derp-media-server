import { Show } from 'solid-js'
import type { ModalOverlayScope } from './modal-overlay-scope'
import { modalDialogBackdropClass } from './modal-overlay-scope'

type RenameDialogProps = {
  overlayScope?: ModalOverlayScope
  isOpen: boolean
  itemName: string
  newName: string
  onNewNameChange: (name: string) => void
  onRename: () => void
  onCancel: () => void
  isPending: boolean
  error: Error | null | undefined
  nameExists: boolean
  isDirectory: boolean
}

export function RenameDialog(props: RenameDialogProps) {
  return (
    <Show when={props.isOpen}>
      <div
        class={modalDialogBackdropClass(props.overlayScope)}
        role='presentation'
        onClick={() => props.onCancel()}
      >
        <div
          role='dialog'
          aria-modal='true'
          class='w-full max-w-md rounded-lg border border-border bg-card text-card-foreground shadow-lg p-6'
          onClick={(e) => e.stopPropagation()}
        >
          <h2 class='text-lg font-semibold'>Rename {props.itemName}</h2>
          <p class='text-sm text-muted-foreground mt-1'>
            Enter a new name for this {props.isDirectory ? 'folder' : 'file'}.
          </p>
          <input
            type='text'
            class='mt-4 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
            classList={{ 'border-yellow-500': props.nameExists }}
            placeholder='New name'
            value={props.newName}
            onInput={(e) => props.onNewNameChange(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (
                e.key === 'Enter' &&
                props.newName.trim() &&
                props.newName !== props.itemName &&
                !props.nameExists &&
                !props.isPending
              ) {
                props.onRename()
              }
            }}
            disabled={props.isPending}
            autofocus
          />
          <Show when={props.nameExists}>
            <p class='mt-2 text-sm text-yellow-700 dark:text-yellow-300'>Name already exists</p>
          </Show>
          <Show when={props.error}>
            <p class='mt-2 text-sm text-destructive'>{props.error?.message}</p>
          </Show>
          <div class='flex justify-end gap-2 mt-6'>
            <button
              type='button'
              class='h-9 px-4 rounded-md border border-input bg-background text-sm font-medium hover:bg-accent'
              disabled={props.isPending}
              onClick={() => props.onCancel()}
            >
              Cancel
            </button>
            <button
              type='button'
              class='h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50'
              disabled={
                props.isPending ||
                !props.newName.trim() ||
                props.newName === props.itemName ||
                props.nameExists
              }
              onClick={() => props.onRename()}
            >
              {props.isPending ? 'Renaming...' : 'Rename'}
            </button>
          </div>
        </div>
      </div>
    </Show>
  )
}
