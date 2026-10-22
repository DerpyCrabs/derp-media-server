import { component, view } from 'effectweb'
import { cn } from '@/lib/ui/cn'
import type { ModalOverlayScope } from './modal-overlay-scope'
import { modalDialogBackdropClass } from './modal-overlay-scope'
export type CreateFolderDialogProps = {
  overlayScope?: ModalOverlayScope
  isOpen: boolean
  onCreate: (name: string) => void
  onCancel: () => void
  isPending: boolean
  error: Error | null | undefined
  folderExists: (name: string) => boolean
}
const CreateFolderDialogContent = component(
  { init: (_props: CreateFolderDialogProps) => ({ folderName: '' }) },
  view((local, patch) => {
    const props = local.props
    const folderName = () => local.folderName,
      setFolderName = (value: string) => patch({ folderName: value })
    const folderExists = () => props.folderExists(folderName())
    const canSubmit = () => !!folderName().trim() && !folderExists() && !props.isPending
    const submit = () => {
      if (canSubmit()) props.onCreate(folderName())
    }
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
          aria-labelledby='create-folder-dialog-title'
          class='max-h-[calc(100%-1rem)] w-full max-w-md overflow-y-auto rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg'
          onClick={(e) => e.stopPropagation()}
        >
          <h2 id='create-folder-dialog-title' class='text-lg font-semibold'>
            Create New Folder
          </h2>
          <p class='mt-1 text-sm text-muted-foreground'>Enter a name for the new folder.</p>
          <input
            type='text'
            class={cn([
              'mt-4 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
              { 'border-yellow-500': folderExists() },
            ])}
            placeholder='Folder name'
            value={folderName()}
            onInput={(e) => setFolderName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
            disabled={props.isPending}
            autofocus
          />
          {folderExists() ? (
            <p class='mt-2 text-sm text-yellow-700 dark:text-yellow-300'>Folder already exists</p>
          ) : null}
          {props.error ? <p class='mt-2 text-sm text-destructive'>{props.error?.message}</p> : null}
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
              {props.isPending ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    )
  }),
)
export const CreateFolderDialog = view<CreateFolderDialogProps>((props) => {
  return props.isOpen ? (
    <CreateFolderDialogContent
      overlayScope={props.overlayScope}
      isOpen={props.isOpen}
      onCreate={props.onCreate}
      onCancel={props.onCancel}
      isPending={props.isPending}
      error={props.error}
      folderExists={props.folderExists}
    />
  ) : null
})
