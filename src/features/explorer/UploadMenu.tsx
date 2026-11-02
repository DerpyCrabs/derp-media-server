import { Button } from '@/lib/ui/button'
import { DropdownMenu } from '@/lib/ui/menu'
import { domBinding, domMount, component, view } from 'effectweb'
import FileIcon from '@effectweb/lucide/icons/file'
import Folder from '@effectweb/lucide/icons/folder'
import Upload from '@effectweb/lucide/icons/upload'
type UploadMenuProps = { disabled: boolean; onUpload: (files: File[]) => void; compact?: boolean }
const attachRoot = (
  element: HTMLDivElement,
  current: () => (element: HTMLDivElement | null) => void,
) => {
  current()(element)
  return { update: () => current()(element), dispose: () => current()(null) }
}
const folderInputBinding = domMount((element: HTMLInputElement) => {
  element.setAttribute('webkitdirectory', '')
})
export const UploadMenu = component<UploadMenuProps, { root: HTMLDivElement | null }>(
  { init: () => ({ root: null }) },
  view((local, patch) => {
    const props = local.props
    const change = (event: Event & { currentTarget: HTMLInputElement }) => {
      const input = event.currentTarget
      if (input.files?.length)
        props.onUpload(
          Array.from(
            input.files,
            (file) =>
              new File([file], file.webkitRelativePath || file.name, {
                type: file.type,
                lastModified: file.lastModified,
              }),
          ),
        )
      input.value = ''
    }
    return (
      <div
        data-upload-root
        use={domBinding((root: HTMLDivElement | null) => patch({ root }), attachRoot)}
      >
        <DropdownMenu
          aria-label='Upload'
          align='end'
          trigger={
            <Button
              variant='ghost'
              size={props.compact ? 'icon-sm' : 'icon'}
              aria-label='Upload'
              disabled={props.disabled}
            >
              <Upload />
            </Button>
          }
          items={[
            {
              kind: 'item',
              label: 'Upload files',
              icon: <FileIcon />,
              onSelect: () =>
                local.root
                  ?.querySelector<HTMLInputElement>('input:not([webkitdirectory])')
                  ?.click(),
            },
            {
              kind: 'item',
              label: 'Upload folder',
              icon: <Folder />,
              onSelect: () =>
                local.root?.querySelector<HTMLInputElement>('input[webkitdirectory]')?.click(),
            },
          ]}
        />
        <input type='file' multiple class='hidden' onChange={change} />
        <input type='file' multiple use={folderInputBinding} class='hidden' onChange={change} />
      </div>
    )
  }),
)
