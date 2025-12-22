'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { X, Download, ZoomIn, ZoomOut, RotateCw, Maximize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ImageViewer() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const playingPath = searchParams.get('playing')
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const [rotation, setRotation] = useState(0)

  const closeViewer = () => {
    const params = new URLSearchParams(searchParams)
    params.delete('playing')
    params.delete('autoplay')
    router.push(`/?${params.toString()}`, { scroll: false })
    setZoom('fit')
    setRotation(0)
  }

  // Close viewer on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && playingPath) {
        closeViewer()
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingPath])

  const handleDownload = () => {
    if (!playingPath) return
    const link = document.createElement('a')
    link.href = `/api/media/${encodeURIComponent(playingPath)}`
    link.download = playingPath.split(/[/\\]/).pop() || 'image'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleZoomIn = () => {
    setZoom((prev) => {
      const currentZoom = prev === 'fit' ? 100 : prev
      return Math.min(currentZoom + 25, 400)
    })
  }

  const handleZoomOut = () => {
    setZoom((prev) => {
      const currentZoom = prev === 'fit' ? 100 : prev
      return Math.max(currentZoom - 25, 25)
    })
  }

  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360)
  }

  const handleFitToScreen = () => {
    setZoom('fit')
    setRotation(0)
  }

  if (!playingPath) return null

  // Check if the current file is an image
  const fileExtension = playingPath.split('.').pop()?.toLowerCase() || ''
  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico']
  const isImage = imageExtensions.includes(fileExtension)

  if (!isImage) return null

  const fileName = playingPath.split(/[/\\]/).pop() || ''

  return (
    <div className='fixed inset-0 z-50 bg-black/95 flex flex-col'>
      {/* Header with controls */}
      <div className='flex items-center justify-between p-4 bg-black/50 backdrop-blur-sm'>
        <div className='flex-1'>
          <h2 className='text-white text-lg font-medium truncate max-w-md'>{fileName}</h2>
        </div>
        <div className='flex items-center gap-2'>
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
            onClick={handleFitToScreen}
            className='text-white hover:bg-white/10'
            title='Fit to screen'
          >
            <Maximize2 className='h-5 w-5' />
          </Button>
          <Button
            variant='ghost'
            size='icon'
            onClick={handleRotate}
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
          <Button
            variant='ghost'
            size='icon'
            onClick={closeViewer}
            className='text-white hover:bg-white/10'
          >
            <X className='h-5 w-5' />
          </Button>
        </div>
      </div>

      {/* Image container */}
      <div
        className='flex-1 flex items-center justify-center overflow-auto p-4'
        onClick={closeViewer}
      >
        <img
          src={`/api/media/${encodeURIComponent(playingPath)}`}
          alt={fileName}
          className='transition-transform duration-200'
          style={{
            ...(zoom === 'fit'
              ? {
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                }
              : {
                  maxWidth: '100%',
                  maxHeight: '100%',
                  width: 'auto',
                  height: 'auto',
                  objectFit: 'none',
                }),
            transform: `scale(${zoom === 'fit' ? 1 : zoom / 100}) rotate(${rotation}deg)`,
          }}
          onClick={(e) => {
            e.stopPropagation()
            // Allow clicking directly on image to close (but not when zoomed/rotated)
            if (zoom === 'fit' && rotation === 0) {
              closeViewer()
            }
          }}
        />
      </div>
    </div>
  )
}
