'use client'

import { X, Download, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface PdfViewerContentProps {
  mediaUrl: string
  fileName: string
  onClose?: () => void
  downloadUrl?: string
}

export function PdfViewerContent({
  mediaUrl,
  fileName,
  onClose,
  downloadUrl,
}: PdfViewerContentProps) {
  const handleDownload = () => {
    const url = downloadUrl || mediaUrl
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div className='flex flex-col h-full'>
      <div className='flex items-center justify-between p-4 bg-black/50 backdrop-blur-sm'>
        <div className='flex-1'>
          <h2 className='text-white text-lg font-medium truncate max-w-md'>{fileName}</h2>
        </div>
        <div className='flex items-center gap-2 flex-1 justify-end'>
          <Button
            variant='ghost'
            size='icon'
            onClick={() => window.open(mediaUrl, '_blank')}
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
          {onClose && (
            <>
              <div className='w-px h-6 bg-white/20 mx-2' />
              <Button
                variant='ghost'
                size='icon'
                onClick={onClose}
                className='text-white hover:bg-white/10'
                title='Close'
              >
                <X className='h-5 w-5' />
              </Button>
            </>
          )}
        </div>
      </div>

      <div className='flex-1 flex items-center justify-center overflow-hidden bg-neutral-800'>
        <embed
          src={`${mediaUrl}#toolbar=1`}
          type='application/pdf'
          className='w-full h-full'
          title={fileName}
        />
      </div>
    </div>
  )
}
