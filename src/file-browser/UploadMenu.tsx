import { cn } from '@/lib/utils'
import FileIcon from 'lucide-solid/icons/file'
import Folder from 'lucide-solid/icons/folder'
import Upload from 'lucide-solid/icons/upload'
import { createEffect, createSignal, onCleanup, Show } from 'solid-js'

type UploadMenuProps = {
  disabled: boolean
  onUpload: (files: File[]) => void
  mode?: 'MediaServer' | 'Workspace'
}

export function UploadMenu(props: UploadMenuProps) {
  const isWorkspace = () => (props.mode ?? 'MediaServer') === 'Workspace'
  const [open, setOpen] = createSignal(false)
  let wrap: HTMLDivElement | undefined
  let fileInput: HTMLInputElement | undefined
  let folderInput: HTMLInputElement | undefined

  createEffect(() => {
    if (!open()) return
    const h = (e: MouseEvent) => {
      if (wrap && !wrap.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', h)
    onCleanup(() => document.removeEventListener('mousedown', h))
  })

  function handleInputChange(e: Event & { currentTarget: HTMLInputElement }) {
    const input = e.currentTarget
    const list = input.files
    if (list && list.length > 0) {
      const fileArray: File[] = []
      for (let i = 0; i < list.length; i++) {
        const file = list[i]
        const relativePath = file.webkitRelativePath || file.name
        fileArray.push(
          new File([file], relativePath, {
            type: file.type,
            lastModified: file.lastModified,
          }),
        )
      }
      props.onUpload(fileArray)
    }
    input.value = ''
    setOpen(false)
  }

  return (
    <div class='relative' ref={(el) => (wrap = el)}>
      <button
        type='button'
        title='Upload'
        disabled={props.disabled}
        aria-expanded={open()}
        class={cn(
          isWorkspace() ? 'h-7 w-7' : 'size-8',
          'inline-flex shrink-0 items-center justify-center rounded-md border border-border bg-background text-sm font-medium shadow-xs transition-colors',
          'hover:bg-muted hover:text-foreground',
          'dark:bg-input/30 dark:border-input dark:hover:bg-input/50',
          'aria-expanded:bg-muted aria-expanded:text-foreground',
          'disabled:pointer-events-none disabled:opacity-50',
        )}
        onClick={() => setOpen(!open())}
      >
        <Upload
          class={isWorkspace() ? 'h-3.5 w-3.5' : 'h-4 w-4'}
          size={isWorkspace() ? 14 : 16}
          stroke-width={2}
        />
      </button>
      <Show when={open()}>
        <div
          data-upload-menu
          class='absolute right-0 top-full mt-1 z-50 min-w-36 origin-top-right rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md'
          role='menu'
        >
          <button
            type='button'
            role='menuitem'
            class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
            onClick={() => {
              queueMicrotask(() => fileInput?.click())
            }}
          >
            <FileIcon size={16} stroke-width={2} />
            Upload files
          </button>
          <button
            type='button'
            role='menuitem'
            class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
            onClick={() => {
              queueMicrotask(() => folderInput?.click())
            }}
          >
            <Folder size={16} stroke-width={2} />
            Upload folder
          </button>
        </div>
      </Show>
      <input
        type='file'
        multiple
        class='hidden'
        ref={(el) => (fileInput = el)}
        onChange={handleInputChange}
      />
      <input
        type='file'
        multiple
        {...({ webkitdirectory: '' } as { webkitdirectory: string })}
        class='hidden'
        ref={(el) => (folderInput = el)}
        onChange={handleInputChange}
      />
    </div>
  )
}
