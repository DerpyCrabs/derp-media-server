'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogPopup,
  DialogTitle,
} from '@/components/ui/dialog'
import { PdfViewerContent } from '@/components/viewers/pdf-viewer-content'

export function PdfViewer() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const viewingPath = searchParams.get('viewing')

  const closeViewer = () => {
    const params = new URLSearchParams(searchParams)
    params.delete('viewing')
    router.replace(`/?${params.toString()}`, { scroll: false })
  }

  const fileExtension = viewingPath?.split('.').pop()?.toLowerCase() || ''
  const isPdf = viewingPath && fileExtension === 'pdf'

  if (!isPdf) return null

  const fileName = viewingPath.split(/[/\\]/).pop() || ''
  const mediaUrl = `/api/media/${encodeURIComponent(viewingPath)}`

  return (
    <Dialog open={!!viewingPath} onOpenChange={(open) => !open && closeViewer()}>
      <DialogPortal>
        <DialogOverlay className='bg-black/95' />
        <DialogPopup className='fixed inset-0 z-50 flex flex-col'>
          <span className='sr-only'>
            <DialogTitle>{fileName}</DialogTitle>
          </span>
          <PdfViewerContent
            mediaUrl={mediaUrl}
            fileName={fileName}
            onClose={closeViewer}
            downloadUrl={mediaUrl}
          />
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  )
}
