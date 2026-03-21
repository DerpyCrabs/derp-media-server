import { Show } from 'solid-js'

type CreateFileDialogProps = {
  isOpen: boolean
  fileName: string
  onFileNameChange: (name: string) => void
  onCreate: () => void
  onCancel: () => void
  isPending: boolean
  error: Error | null | undefined
  fileExists: boolean
  defaultExtension: 'txt' | 'md'
}

export function CreateFileDialog(props: CreateFileDialogProps) {
  const extExample = () => (props.defaultExtension === 'md' ? 'notes.md' : 'notes.txt')
  return (
    <Show when={props.isOpen}>
      <div
        class='fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4'
        role='presentation'
        onClick={() => props.onCancel()}
      >
        <div
          role='dialog'
          aria-modal='true'
          class='w-full max-w-md rounded-lg border border-border bg-card text-card-foreground shadow-lg p-6'
          onClick={(e) => e.stopPropagation()}
        >
          <h2 class='text-lg font-semibold'>Create New File</h2>
          <p class='text-sm text-muted-foreground mt-1'>
            Enter a name for the new file. .{props.defaultExtension} extension will be added if no
            extension is provided.
          </p>
          <input
            type='text'
            class='mt-4 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'
            classList={{ 'border-yellow-500': props.fileExists }}
            placeholder={`File name (e.g., ${extExample()})`}
            value={props.fileName}
            onInput={(e) => props.onFileNameChange(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (
                e.key === 'Enter' &&
                props.fileName.trim() &&
                !props.fileExists &&
                !props.isPending
              ) {
                props.onCreate()
              }
            }}
            disabled={props.isPending}
            autofocus
          />
          <Show when={props.fileExists}>
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
              disabled={props.isPending || !props.fileName.trim() || props.fileExists}
              onClick={() => props.onCreate()}
            >
              {props.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </Show>
  )
}
