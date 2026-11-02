import { Input } from '@/lib/ui/input'
import { Button } from '@/lib/ui/button'
import { component, view } from 'effectweb'
import type { ModalOverlayScope } from './modal-overlay-scope'
import { Dialog } from '@/lib/ui/dialog'
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
      <Dialog
        open
        title='Create New Folder'
        onOpenChange={(open) => {
          if (!open) props.onCancel()
        }}
        class='sm:max-w-md'
        footer={
          <>
            <Button variant='outline' onClick={props.onCancel} disabled={props.isPending}>
              Cancel
            </Button>
            <Button disabled={!canSubmit()} onClick={submit}>
              {props.isPending ? 'Creating…' : 'Create'}
            </Button>
          </>
        }
      >
        <Input
          type='text'
          aria-label='Folder name'
          aria-invalid={folderExists()}
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
      </Dialog>
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
