'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { X, Download, ZoomIn, ZoomOut, RotateCw, Maximize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogPortal, DialogOverlay, DialogTitle } from '@/components/ui/dialog'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as VisuallyHidden from '@radix-ui/react-visually-hidden'
import { FileItem, MediaType } from '@/lib/types'
import { useFiles } from '@/lib/use-files'

export function ImageViewer() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const viewingPath = searchParams.get('viewing')
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const [rotation, setRotation] = useState(0)

  const currentDir = searchParams.get('dir') || ''

  // Extract directory from viewing path if no dir param
  const dirToFetch = useMemo(() => {
    if (!currentDir && !viewingPath) return ''

    let dir = currentDir
    if (!dir && viewingPath) {
      const pathParts = viewingPath.split(/[/\\]/)
      pathParts.pop() // Remove filename
      dir = pathParts.join('/')
    }
    return dir
  }, [currentDir, viewingPath])

  // Fetch files in the current directory using React Query
  const { data: allFiles = [] } = useFiles(dirToFetch)

  // Filter only image files
  const imageFiles = useMemo(() => {
    return allFiles.filter((file: FileItem) => file.type === MediaType.IMAGE)
  }, [allFiles])

  const closeViewer = () => {
    const params = new URLSearchParams(searchParams)
    params.delete('viewing')
    router.replace(`/?${params.toString()}`, { scroll: false })
    setZoom('fit')
    setRotation(0)
  }

  const navigateToNext = useCallback(() => {
    if (!viewingPath || imageFiles.length === 0) return

    const currentIndex = imageFiles.findIndex((file) => file.path === viewingPath)
    if (currentIndex === -1 || currentIndex === imageFiles.length - 1) return

    const nextFile = imageFiles[currentIndex + 1]
    const params = new URLSearchParams(searchParams)
    params.set('viewing', nextFile.path)
    if (currentDir) {
      params.set('dir', currentDir)
    }
    router.replace(`/?${params.toString()}`, { scroll: false })
    setZoom('fit')
    setRotation(0)
  }, [viewingPath, imageFiles, searchParams, currentDir, router, setZoom, setRotation])

  const navigateToPrevious = useCallback(() => {
    if (!viewingPath || imageFiles.length === 0) return

    const currentIndex = imageFiles.findIndex((file) => file.path === viewingPath)
    if (currentIndex === -1 || currentIndex === 0) return

    const prevFile = imageFiles[currentIndex - 1]
    const params = new URLSearchParams(searchParams)
    params.set('viewing', prevFile.path)
    if (currentDir) {
      params.set('dir', currentDir)
    }
    router.replace(`/?${params.toString()}`, { scroll: false })
    setZoom('fit')
    setRotation(0)
  }, [viewingPath, imageFiles, searchParams, currentDir, router, setZoom, setRotation])

  // Handle keyboard navigation
  useEffect(() => {
    if (!viewingPath) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        navigateToPrevious()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        navigateToNext()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [viewingPath, imageFiles, navigateToPrevious, navigateToNext])

  const handleDownload = () => {
    if (!viewingPath) return
    const link = document.createElement('a')
    link.href = `/api/media/${encodeURIComponent(viewingPath)}`
    link.download = viewingPath.split(/[/\\]/).pop() || 'image'
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

  // Check if the current file is an image
  const fileExtension = viewingPath?.split('.').pop()?.toLowerCase() || ''
  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico']
  const isImage = viewingPath && imageExtensions.includes(fileExtension)

  if (!isImage) return null

  const fileName = viewingPath.split(/[/\\]/).pop() || ''

  // Calculate current image position
  const currentImageIndex = imageFiles.findIndex((file) => file.path === viewingPath)
  const currentImageNumber = currentImageIndex !== -1 ? currentImageIndex + 1 : 1
  const totalImages = imageFiles.length

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
            {totalImages > 0 && (
              <div className='shrink-0 px-4'>
                <span className='text-white text-sm font-medium'>
                  {currentImageNumber} of {totalImages}
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
          <div className='flex-1 flex items-center justify-center overflow-auto p-4 relative'>
            {/* Left navigation area */}
            <div
              className='absolute left-0 top-0 bottom-0 w-[30%] cursor-pointer z-10'
              onClick={navigateToPrevious}
            />
            {/* Right navigation area */}
            <div
              className='absolute right-0 top-0 bottom-0 w-[30%] cursor-pointer z-10'
              onClick={navigateToNext}
            />
            <img
              src={`/api/media/${encodeURIComponent(viewingPath)}`}
              alt={fileName}
              className='transition-transform duration-200 pointer-events-none'
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
            />
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}
