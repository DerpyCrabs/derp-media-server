'use client'

import { useRef, useCallback } from 'react'
import { Menu } from '@base-ui/react/menu'
import { Upload, File, Folder } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'

interface UploadMenuButtonProps {
  disabled?: boolean
  onUpload: (files: File[]) => void
}

export function UploadMenuButton({ disabled, onUpload }: UploadMenuButtonProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (files && files.length > 0) {
        const fileArray: globalThis.File[] = []
        for (let i = 0; i < files.length; i++) {
          const file = files[i]
          const relativePath = file.webkitRelativePath || file.name
          fileArray.push(
            new globalThis.File([file], relativePath, {
              type: file.type,
              lastModified: file.lastModified,
            }),
          )
        }
        onUpload(fileArray)
      }
      e.target.value = ''
    },
    [onUpload],
  )

  const triggerFileInput = useCallback(() => {
    setTimeout(() => fileInputRef.current?.click(), 0)
  }, [])

  const triggerFolderInput = useCallback(() => {
    setTimeout(() => folderInputRef.current?.click(), 0)
  }, [])

  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          disabled={disabled}
          className={buttonVariants({ variant: 'outline', size: 'icon-sm' }) + ' cursor-pointer'}
          title='Upload'
        >
          <Upload className='h-4 w-4' />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner
            className='isolate z-50 outline-none'
            side='bottom'
            align='start'
            sideOffset={4}
          >
            <Menu.Popup className='data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95 ring-foreground/10 bg-popover text-popover-foreground z-50 min-w-36 origin-(--transform-origin) overflow-hidden rounded-md p-1 shadow-md ring-1 duration-100 outline-none'>
              <Menu.Item
                className='flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground'
                onClick={triggerFileInput}
              >
                <File className='h-4 w-4' />
                Upload files
              </Menu.Item>
              <Menu.Item
                className='flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground'
                onClick={triggerFolderInput}
              >
                <Folder className='h-4 w-4' />
                Upload folder
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      <input
        ref={fileInputRef}
        type='file'
        multiple
        className='hidden'
        onChange={handleInputChange}
      />
      <input
        ref={folderInputRef}
        type='file'
        // @ts-expect-error webkitdirectory is not in React's HTMLInputElement type
        webkitdirectory=''
        multiple
        className='hidden'
        onChange={handleInputChange}
      />
    </>
  )
}
