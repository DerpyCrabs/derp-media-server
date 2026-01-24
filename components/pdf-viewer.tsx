'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { X, Download, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogPortal, DialogOverlay, DialogTitle } from '@/components/ui/dialog'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'

export function PdfViewer() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const viewingPath = searchParams.get('viewing')

  const closeViewer = () => {
    const params = new URLSearchParams(searchParams)
    params.delete('viewing')
    router.replace(`/?${params.toString()}`, { scroll: false })
  }

  const handleDownload = () => {
    if (!viewingPath) return
    const link = document.createElement('a')
    link.href = `/api/media/${encodeURIComponent(viewingPath)}`
    link.download = viewingPath.split(/[/\\]/).pop() || 'document.pdf'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleOpenInNewTab = () => {
    if (!viewingPath) return
    window.open(`/api/media/${encodeURIComponent(viewingPath)}`, '_blank')
  }

  // Check if the current file is a PDF
  const fileExtension = viewingPath?.split('.').pop()?.toLowerCase() || ''
  const isPdf = viewingPath && fileExtension === 'pdf'

  if (!isPdf) return null

  const fileName = viewingPath.split(/[/\\]/).pop() || ''

  return (
    <Dialog open={!!viewingPath} onOpenChange={(open) => !open && closeViewer()}>
      <DialogPortal>
        <DialogOverlay className='bg-black/95' />
        <DialogPrimitive.Content
          className='fixed inset-0 z-50 flex flex-col data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0'
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <VisuallyHidden.Root>
            <DialogTitle>{fileName}</DialogTitle>
          </VisuallyHidden.Root>
          {/* Header with controls */}
          <div className='flex items-center justify-between p-4 bg-black/50 backdrop-blur-sm'>
            <div className='flex-1'>
              <h2 className='text-white text-lg font-medium truncate max-w-md'>{fileName}</h2>
            </div>
            <div className='flex items-center gap-2 flex-1 justify-end'>
              <Button
                variant='ghost'
                size='icon'
                onClick={handleOpenInNewTab}
                className='text-white hover:bg-white/10'
                title='Open in new tab'
              >
                <ExternalLink className='h-5 w-5' />
              </Button>
              <Button
                variant='ghost'
                size='icon'
                onClick={handleDownload}
                className='text-white hover:bg-white/10'
                title='Download'
              >
                <Download className='h-5 w-5' />
              </Button>
              <div className='w-px h-6 bg-white/20 mx-2' />
              <Button
                variant='ghost'
                size='icon'
                onClick={closeViewer}
                className='text-white hover:bg-white/10'
                title='Close'
              >
                <X className='h-5 w-5' />
              </Button>
            </div>
          </div>

          {/* PDF container */}
          <div className='flex-1 flex items-center justify-center overflow-hidden bg-neutral-800'>
            <embed
              src={`/api/media/${encodeURIComponent(viewingPath)}#toolbar=1`}
              type='application/pdf'
              className='w-full h-full'
              title={fileName}
            />
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}
