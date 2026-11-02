import { Dialog } from '@/lib/ui/dialog'
import { Button } from '@/lib/ui/button'
import { Input } from '@/lib/ui/input'
import { component, view, domBinding } from 'effectweb'
import type { ModalOverlayScope } from './modal-overlay-scope'
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
const selectRenameStem = (
  element: HTMLInputElement,
  current: () => { name: string; directory: boolean },
) => {
  const { name, directory } = current()
  const dot = name.lastIndexOf('.')
  element.focus()
  element.setSelectionRange(0, !directory && dot > 0 ? dot : name.length)
}
const RenameDialogContent = component(
  { init: (props: RenameDialogProps) => ({ newName: props.itemName }) },
  view((local, patch) => {
    const props = local.props
    const newName = () => local.newName,
      setNewName = (value: string) => patch({ newName: value })
    const candidateName = () => newName().trim()
    const nameExists = () => props.nameExists(candidateName())
    const canSubmit = () =>
      !!candidateName() && candidateName() !== props.itemName && !nameExists() && !props.isPending
    const submit = () => {
      if (canSubmit()) props.onRename(candidateName())
    }
    return (
      <Dialog
        open
        title='Rename'
        onOpenChange={(open) => {
          if (!open) props.onCancel()
        }}
        class='sm:max-w-md'
        footer={
          <>
            <Button variant='outline' disabled={props.isPending} onClick={props.onCancel}>
              Cancel
            </Button>
            <Button disabled={!canSubmit()} onClick={submit}>
              {props.isPending ? 'Renaming…' : 'Rename'}
            </Button>
          </>
        }
      >
        <Input
          use={{
            ...domBinding({ name: props.itemName, directory: props.isDirectory }, selectRenameStem),
            identity: props.itemName,
          }}
          type='text'
          aria-label='New name'
          aria-invalid={nameExists()}
          placeholder='New name'
          value={newName()}
          onInput={(e) => setNewName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          disabled={props.isPending}
          autofocus
        />
        {nameExists() ? (
          <p class='mt-2 text-sm text-yellow-700 dark:text-yellow-300'>Name already exists</p>
        ) : null}
        {props.error ? <p class='mt-2 text-sm text-destructive'>{props.error?.message}</p> : null}
      </Dialog>
    )
  }),
)
export const RenameDialog = view<RenameDialogProps>((props) => {
  return props.isOpen ? (
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
  ) : null
})
