'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { FileQuestion, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatFileSize } from '@/lib/media-utils'
import { FileItem, MediaType } from '@/lib/types'

export function UnsupportedFileViewer() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const viewingPath = searchParams.get('viewing')
  const [fileInfo, setFileInfo] = useState<FileItem | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!viewingPath) {
      // When viewingPath is cleared, reset the dialog state
      setFileInfo(null)
      setOpen(false)
      return
    }

    // Fetch file info
    const currentDir = searchParams.get('dir') || ''
    fetch(`/api/files?dir=${encodeURIComponent(currentDir)}`)
      .then((res) => res.json())
      .then((data) => {
        const file = data.files.find((f: FileItem) => f.path === viewingPath)
        if (file && file.type === MediaType.OTHER) {
          setFileInfo(file)
          setOpen(true)
        } else {
          setFileInfo(null)
          setOpen(false)
        }
      })
      .catch(() => {
        setFileInfo(null)
        setOpen(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewingPath])

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen)
    if (!newOpen) {
      // Close modal - remove viewing parameter
      const params = new URLSearchParams(searchParams)
      params.delete('viewing')
      router.replace(`/?${params.toString()}`, { scroll: false })
    }
  }

  if (!fileInfo) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <div className='flex items-center gap-3 mb-2'>
            <FileQuestion className='h-8 w-8 text-yellow-500' />
            <div className='text-left'>
              <DialogTitle className='text-lg'>{fileInfo.name}</DialogTitle>
              <DialogDescription className='text-xs'>
                {fileInfo.extension ? `.${fileInfo.extension.toUpperCase()}` : 'Unknown'} file •{' '}
                {formatFileSize(fileInfo.size)}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className='bg-muted/50 rounded-lg p-8 flex flex-col items-center justify-center text-center space-y-4'>
          <FileText className='h-16 w-16 text-muted-foreground opacity-50' />
          <div>
            <h3 className='text-lg font-medium mb-2'>Unsupported File Type</h3>
            <p className='text-sm text-muted-foreground'>
              This file type is not supported for preview. The media server currently supports
              video, audio, and image files.
            </p>
          </div>
          <div className='pt-2'>
            <Button variant='default' asChild>
              <a href={`/api/media/${encodeURIComponent(fileInfo.path)}`} download={fileInfo.name}>
                Download File
              </a>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
