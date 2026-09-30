import { type Snapshot, domBinding, domMount, localComponent, view } from 'effectweb'
import { cn } from '@/lib/ui/cn'
import FileIcon from '@effectweb/lucide/icons/file'
import Folder from '@effectweb/lucide/icons/folder'
import Upload from '@effectweb/lucide/icons/upload'
type UploadMenuProps = { disabled: boolean; onUpload: (files: File[]) => void; compact?: boolean }
const dismissUploadMenu = (
  element: HTMLDivElement,
  current: () => { open: boolean; close: () => void },
) => {
  const listener = (event: MouseEvent) => {
    if (current().open && !element.contains(event.target as Node)) current().close()
  }
  document.addEventListener('mousedown', listener)
  return () => document.removeEventListener('mousedown', listener)
}
const folderInputBinding = domMount((element: HTMLInputElement) => {
  element.setAttribute('webkitdirectory', '')
})
export const UploadMenu = localComponent({
  init: (_props: Snapshot<UploadMenuProps>) => ({ open: false }),
  view: view((local, patch) => {
    const props = local.props
    const open = () => local.open,
      setOpen = (value: boolean) => patch({ open: value })
    function handleInputChange(e: Event & { currentTarget: HTMLInputElement }) {
      const input = e.currentTarget
      const list = input.files
      if (list && list.length > 0) {
        const fileArray: File[] = []
        for (let i = 0; i < list.length; i++) {
          const file = list[i]
          const relativePath = file.webkitRelativePath || file.name
          fileArray.push(
            new File([file], relativePath, { type: file.type, lastModified: file.lastModified }),
          )
        }
        props.onUpload(fileArray)
      }
      input.value = ''
      setOpen(false)
    }
    return (
      <div
        data-upload-root
        class='relative'
        use={domBinding(
          { open: local.open, close: () => patch({ open: false }) },
          dismissUploadMenu,
        )}
      >
        <button
          type='button'
          title='Upload'
          disabled={props.disabled}
          aria-expanded={open() ? 'true' : 'false'}
          class={cn(
            props.compact ? 'h-7 w-7' : 'size-8',
            'inline-flex shrink-0 items-center justify-center rounded-md text-sm font-medium transition-colors',
            'hover:bg-muted hover:text-foreground',
            'dark:hover:bg-input/50',
            'aria-expanded:bg-muted aria-expanded:text-foreground',
            'disabled:pointer-events-none disabled:opacity-50',
          )}
          onClick={() => setOpen(!open())}
        >
          <Upload
            class={props.compact ? 'h-3.5 w-3.5' : 'h-4 w-4'}
            size={props.compact ? 14 : 16}
            stroke-width={2}
          />
        </button>
        {open() ? (
          <div
            data-upload-menu
            class='absolute right-0 top-full mt-1 z-50 min-w-36 origin-top-right rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md'
            role='menu'
          >
            <button
              type='button'
              role='menuitem'
              class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
              onClick={(event) =>
                event.currentTarget
                  .closest('[data-upload-root]')
                  ?.querySelector<HTMLInputElement>('input:not([webkitdirectory])')
                  ?.click()
              }
            >
              <FileIcon size={16} stroke-width={2} />
              Upload files
            </button>
            <button
              type='button'
              role='menuitem'
              class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
              onClick={(event) =>
                event.currentTarget
                  .closest('[data-upload-root]')
                  ?.querySelector<HTMLInputElement>('input[webkitdirectory]')
                  ?.click()
              }
            >
              <Folder size={16} stroke-width={2} />
              Upload folder
            </button>
          </div>
        ) : null}
        <input type='file' multiple class='hidden' onChange={handleInputChange} />
        <input
          type='file'
          multiple
          use={folderInputBinding}
          class='hidden'
          onChange={handleInputChange}
        />
      </div>
    )
  }),
})
