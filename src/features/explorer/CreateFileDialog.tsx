import { createSignal, Show } from 'solid-js'
import type { ModalOverlayScope } from './modal-overlay-scope'
import { modalDialogBackdropClass } from './modal-overlay-scope'

export type CreateFileDialogProps = {
  overlayScope?: ModalOverlayScope
  isOpen: boolean
  onCreate: (name: string) => void
  onCancel: () => void
  isPending: boolean
  error: Error | null | undefined
  fileExists: (name: string) => boolean
  defaultExtension: 'txt' | 'md'
}

function CreateFileDialogContent(props: CreateFileDialogProps) {
  const [fileName, setFileName] = createSignal('')
  const extExample = () => (props.defaultExtension === 'md' ? 'notes.md' : 'notes.txt')
  const fileExists = () => props.fileExists(fileName())
  return (
    <div
      data-no-window-drag
      class={modalDialogBackdropClass(props.overlayScope)}
      role='presentation'
      onClick={() => props.onCancel()}
    >
      <div
        role='dialog'
        aria-modal='true'
        aria-labelledby='create-file-dialog-title'
        class='w-full max-w-md rounded-lg border border-border bg-card text-card-foreground shadow-lg p-6'
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id='create-file-dialog-title' class='text-lg font-semibold'>
          Create New File
        </h2>
        <p class='text-sm text-muted-foreground mt-1'>
          {props.defaultExtension === 'md'
            ? 'Enter a note name. A .md extension will be added unless it already ends in .md.'
            : 'Enter a name for the new file. A .txt extension will be added if no extension is provided.'}
        </p>
        <input
          type='text'
          class={[
            'mt-4 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
            { 'border-yellow-500': fileExists() },
          ]}
          placeholder={`File name (e.g., ${extExample()})`}
          value={fileName()}
          onInput={(e) => setFileName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && fileName().trim() && !fileExists() && !props.isPending) {
              props.onCreate(fileName())
            }
          }}
          disabled={props.isPending}
          autofocus
        />
        <Show when={fileExists()}>
          <p class='mt-2 text-sm text-yellow-700 dark:text-yellow-300'>File already exists</p>
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
            disabled={props.isPending || !fileName().trim() || fileExists()}
            onClick={() => props.onCreate(fileName())}
          >
            {props.isPending ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function CreateFileDialog(props: CreateFileDialogProps) {
  return (
    <Show when={props.isOpen}>
      <CreateFileDialogContent
        overlayScope={props.overlayScope}
        isOpen={props.isOpen}
        onCreate={props.onCreate}
        onCancel={props.onCancel}
        isPending={props.isPending}
        error={props.error}
        fileExists={props.fileExists}
        defaultExtension={props.defaultExtension}
      />
    </Show>
  )
}
