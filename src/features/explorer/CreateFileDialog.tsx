import { Input } from '@/lib/ui/input'
import { Button } from '@/lib/ui/button'
import { component, view } from 'effectweb'
import type { ModalOverlayScope } from './modal-overlay-scope'
import { Dialog } from '@/lib/ui/dialog'
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
const CreateFileDialogContent = component(
  { init: (_props: CreateFileDialogProps) => ({ fileName: '' }) },
  view((local, patch) => {
    const props = local.props
    const fileName = () => local.fileName,
      setFileName = (value: string) => patch({ fileName: value })
    const extExample = () => (props.defaultExtension === 'md' ? 'notes.md' : 'notes.txt')
    const fileExists = () => props.fileExists(fileName())
    return (
      <Dialog
        open
        title='Create New File'
        onOpenChange={(open) => {
          if (!open) props.onCancel()
        }}
        class='sm:max-w-md'
        footer={
          <>
            <Button variant='outline' onClick={props.onCancel} disabled={props.isPending}>
              Cancel
            </Button>
            <Button
              disabled={props.isPending || !fileName().trim() || fileExists()}
              onClick={() => props.onCreate(fileName())}
            >
              {props.isPending ? 'Creating…' : 'Create'}
            </Button>
          </>
        }
      >
        <Input
          type='text'
          aria-label='File name'
          aria-invalid={fileExists()}
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
        {fileExists() ? (
          <p class='mt-2 text-sm text-yellow-700 dark:text-yellow-300'>File already exists</p>
        ) : null}
        {props.error ? <p class='mt-2 text-sm text-destructive'>{props.error?.message}</p> : null}
      </Dialog>
    )
  }),
)
export const CreateFileDialog = view<CreateFileDialogProps>((props) => {
  return props.isOpen ? (
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
  ) : null
})
