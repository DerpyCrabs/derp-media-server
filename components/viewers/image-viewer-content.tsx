'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, Download, ZoomIn, ZoomOut, RotateCw, Maximize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface ImageViewerContentProps {
  mediaUrl: string
  fileName: string
  onClose?: () => void
  onNavigateNext?: () => void
  onNavigatePrevious?: () => void
  imageIndex?: number
  totalImages?: number
  downloadUrl?: string
}

export function ImageViewerContent({
  mediaUrl,
  fileName,
  onClose,
  onNavigateNext,
  onNavigatePrevious,
  imageIndex,
  totalImages,
  downloadUrl,
}: ImageViewerContentProps) {
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const [rotation, setRotation] = useState(0)

  useEffect(() => {
    setZoom('fit')
    setRotation(0)
  }, [mediaUrl])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        onNavigatePrevious?.()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        onNavigateNext?.()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onNavigateNext, onNavigatePrevious])

  const handleDownload = useCallback(() => {
    const url = downloadUrl || mediaUrl
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }, [downloadUrl, mediaUrl, fileName])

  const handleZoomIn = () => {
    setZoom((prev) => Math.min((prev === 'fit' ? 100 : prev) + 25, 400))
  }

  const handleZoomOut = () => {
    setZoom((prev) => Math.max((prev === 'fit' ? 100 : prev) - 25, 25))
  }

  return (
    <div className='flex flex-col h-full bg-black'>
      <div className='flex items-center justify-between p-4 bg-black/50 backdrop-blur-sm'>
        <div className='flex-1'>
          <h2 className='text-white text-lg font-medium truncate max-w-md'>{fileName}</h2>
        </div>
        {totalImages != null && totalImages > 0 && imageIndex != null && (
          <div className='shrink-0 px-4'>
            <span className='text-white text-sm font-medium'>
              {imageIndex + 1} of {totalImages}
            </span>
          </div>
        )}
        <div className='flex items-center gap-2 flex-1 justify-end'>
          <Button
            variant='ghost'
            size='icon'
            onClick={handleZoomOut}
            className='text-white hover:bg-white/10'
          >
            <ZoomOut className='h-5 w-5' />
          </Button>
          <span className='text-white text-sm min-w-16 text-center'>
            {zoom === 'fit' ? 'Fit' : `${zoom}%`}
          </span>
          <Button
            variant='ghost'
            size='icon'
            onClick={handleZoomIn}
            className='text-white hover:bg-white/10'
          >
            <ZoomIn className='h-5 w-5' />
          </Button>
          <Button
            variant='ghost'
            size='icon'
            onClick={() => {
              setZoom('fit')
              setRotation(0)
            }}
            className='text-white hover:bg-white/10'
            title='Fit to screen'
          >
            <Maximize2 className='h-5 w-5' />
          </Button>
          <Button
            variant='ghost'
            size='icon'
            onClick={() => setRotation((r) => (r + 90) % 360)}
            className='text-white hover:bg-white/10'
          >
            <RotateCw className='h-5 w-5' />
          </Button>
          <div className='w-px h-6 bg-white/20 mx-2' />
          <Button
            variant='ghost'
            size='icon'
            onClick={handleDownload}
            className='text-white hover:bg-white/10'
          >
            <Download className='h-5 w-5' />
          </Button>
          {onClose && (
            <Button
              variant='ghost'
              size='icon'
              onClick={onClose}
              className='text-white hover:bg-white/10'
            >
              <X className='h-5 w-5' />
            </Button>
          )}
        </div>
      </div>

      <div className='flex-1 flex items-center justify-center overflow-auto p-4 relative'>
        {onNavigatePrevious && (
          <div
            className='absolute left-0 top-0 bottom-0 w-[30%] cursor-pointer z-10'
            onClick={onNavigatePrevious}
          />
        )}
        {onNavigateNext && (
          <div
            className='absolute right-0 top-0 bottom-0 w-[30%] cursor-pointer z-10'
            onClick={onNavigateNext}
          />
        )}
        <img
          src={mediaUrl}
          alt={fileName}
          className='transition-transform duration-200 pointer-events-none'
          style={{
            ...(zoom === 'fit'
              ? { width: '100%', height: '100%', objectFit: 'contain' as const }
              : {
                  maxWidth: '100%',
                  maxHeight: '100%',
                  width: 'auto',
                  height: 'auto',
                  objectFit: 'none' as const,
                }),
            transform: `scale(${zoom === 'fit' ? 1 : zoom / 100}) rotate(${rotation}deg)`,
          }}
        />
      </div>
    </div>
  )
}
