import { Button } from '@/lib/ui/button'
import { view } from 'effectweb'
import type { FileItem } from '@/lib/files/types'
import type { ModalOverlayScope } from './modal-overlay-scope'
import { Dialog } from '@/lib/ui/dialog'
type DeleteFileDialogProps = {
  overlayScope?: ModalOverlayScope
  item: FileItem | null
  isPending: boolean
  onDismiss: () => void
  onConfirm: () => void
  title?: string
  description?: string
  confirmLabel?: string
}
export const DeleteFileDialog = view<DeleteFileDialogProps>((props) => {
  return props.item ? (
    <Dialog
      open
      role='alertdialog'
      showCloseButton={false}
      onOpenChange={(open) => {
        if (!open) props.onDismiss()
      }}
      title={props.title ?? `Delete ${props.item.isDirectory ? 'Folder' : 'File'}?`}
      class='sm:max-w-md'
      footer={
        <>
          <Button variant='outline' onClick={props.onDismiss}>
            Cancel
          </Button>
          <Button variant='destructive' disabled={props.isPending} onClick={props.onConfirm}>
            {props.isPending ? 'Deleting…' : (props.confirmLabel ?? 'Delete')}
          </Button>
        </>
      }
    >
      <p class='text-sm text-muted-foreground mt-2'>
        {props.description ? (
          props.description
        ) : (
          <>
            Are you sure you want to delete &quot;{props.item.name}&quot;?
            <span class='block mt-2 text-sm font-medium text-foreground'>
              This action cannot be undone.
            </span>
          </>
        )}
      </p>
    </Dialog>
  ) : null
})
