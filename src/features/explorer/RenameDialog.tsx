import { createSignal, Show, untrack } from 'solid-js'
import type { ModalOverlayScope } from './modal-overlay-scope'
import { modalDialogBackdropClass } from './modal-overlay-scope'

type RenameDialogProps = {
  overlayScope?: ModalOverlayScope
  isOpen: boolean
  itemName: string
  onRename: (name: string) => void
  onCancel: () => void
  isPending: boolean
  error: Error | null | undefined
  nameExists: (name: string) => boolean
  isDirectory: boolean
}

function RenameDialogContent(props: RenameDialogProps) {
  const [newName, setNewName] = createSignal(untrack(() => props.itemName))
  const candidateName = () => newName().trim()
  const nameExists = () => props.nameExists(candidateName())
  const canSubmit = () =>
    !!candidateName() && candidateName() !== props.itemName && !nameExists() && !props.isPending
  const submit = () => {
    if (canSubmit()) props.onRename(candidateName())
  }
  return (
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
          class={[
            'mt-4 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
            { 'border-yellow-500': nameExists() },
          ]}
          placeholder='New name'
          value={newName()}
          onInput={(e) => setNewName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          disabled={props.isPending}
          autofocus
        />
        <Show when={nameExists()}>
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
            disabled={!canSubmit()}
            onClick={submit}
          >
            {props.isPending ? 'Renaming...' : 'Rename'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function RenameDialog(props: RenameDialogProps) {
  return (
    <Show when={props.isOpen}>
      <RenameDialogContent
        overlayScope={props.overlayScope}
        isOpen={props.isOpen}
        itemName={props.itemName}
        isDirectory={props.isDirectory}
        onRename={props.onRename}
        onCancel={props.onCancel}
        isPending={props.isPending}
        error={props.error}
        nameExists={props.nameExists}
      />
    </Show>
  )
}
