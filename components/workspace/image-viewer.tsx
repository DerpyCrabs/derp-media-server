import { useState, useEffect, useCallback, useMemo } from 'react'
import { Download, ZoomIn, ZoomOut, RotateCw, Maximize2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FileItem, MediaType } from '@/lib/types'
import { useFiles } from '@/lib/use-files'
import { useMediaUrl } from '@/lib/use-media-url'
import { useNavigationSession } from '@/lib/use-navigation-session'
import type { NavigationSession } from '@/lib/navigation-session'
import type { SourceContext } from '@/lib/source-context'

interface ImageViewerProps {
  session?: NavigationSession
  mediaContext?: SourceContext
}

export function ImageViewer({ session: sessionProp, mediaContext }: ImageViewerProps) {
  const session = useNavigationSession(sessionProp)
  const { state, viewFile } = session
  const { getMediaUrl, getDownloadUrl } = useMediaUrl(mediaContext)
  const viewingPath = state.viewing
  const [zoom, setZoom] = useState<number | 'fit'>('fit')
  const [rotation, setRotation] = useState(0)

  const currentDir = state.dir || ''

  const dirToFetch = useMemo(() => {
    if (!currentDir && !viewingPath) return ''
    let dir = currentDir
    if (!dir && viewingPath) {
      const pathParts = viewingPath.split(/[/\\]/)
      pathParts.pop()
      dir = pathParts.join('/')
    }
    return dir
  }, [currentDir, viewingPath])

  const { data: allFiles = [] } = useFiles(dirToFetch, mediaContext)

  const imageFiles = useMemo(() => {
    return allFiles.filter((file: FileItem) => file.type === MediaType.IMAGE)
  }, [allFiles])

  const navigateToNext = useCallback(() => {
    if (!viewingPath || imageFiles.length === 0) return
    const currentIndex = imageFiles.findIndex((file) => file.path === viewingPath)
    if (currentIndex === -1 || currentIndex === imageFiles.length - 1) return
    const nextFile = imageFiles[currentIndex + 1]
    viewFile(nextFile.path, currentDir || undefined)
    setZoom('fit')
    setRotation(0)
  }, [viewingPath, imageFiles, currentDir, viewFile])

  const navigateToPrevious = useCallback(() => {
    if (!viewingPath || imageFiles.length === 0) return
    const currentIndex = imageFiles.findIndex((file) => file.path === viewingPath)
    if (currentIndex === -1 || currentIndex === 0) return
    const prevFile = imageFiles[currentIndex - 1]
    viewFile(prevFile.path, currentDir || undefined)
    setZoom('fit')
    setRotation(0)
  }, [viewingPath, imageFiles, currentDir, viewFile])

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
  }, [viewingPath, navigateToPrevious, navigateToNext])

  const handleDownload = () => {
    if (!viewingPath) return
    const link = document.createElement('a')
    link.href = getDownloadUrl(viewingPath)
    link.download = viewingPath.split(/[/\\]/).pop() || 'image'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleZoomIn = () => {
    setZoom((prev) => Math.min((prev === 'fit' ? 100 : prev) + 25, 400))
  }

  const handleZoomOut = () => {
    setZoom((prev) => Math.max((prev === 'fit' ? 100 : prev) - 25, 25))
  }

  const handleRotate = () => {
    setRotation((prev) => (prev + 90) % 360)
  }

  const handleFitToScreen = () => {
    setZoom('fit')
    setRotation(0)
  }

  const fileExtension = viewingPath?.split('.').pop()?.toLowerCase() || ''
  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico']
  const isImage = viewingPath && imageExtensions.includes(fileExtension)

  if (!isImage) return null

  const fileName = viewingPath.split(/[/\\]/).pop() || ''
  const currentImageIndex = imageFiles.findIndex((file) => file.path === viewingPath)
  const currentImageNumber = currentImageIndex !== -1 ? currentImageIndex + 1 : 1
  const totalImages = imageFiles.length

  return (
    <div className='flex h-full min-h-0 flex-col bg-black'>
      <div className='flex items-center justify-between gap-4 border-b border-white/10 bg-neutral-950 px-4 py-3'>
        <div className='min-w-0 flex-1'>
          <h2 className='truncate text-base font-medium'>{fileName}</h2>
        </div>
        {totalImages > 0 && (
          <div className='shrink-0 px-2 text-sm text-muted-foreground'>
            {currentImageNumber} of {totalImages}
          </div>
        )}
        <div className='flex flex-1 items-center justify-end gap-2'>
          <Button variant='ghost' size='icon' onClick={handleZoomOut}>
            <ZoomOut className='h-5 w-5' />
          </Button>
          <span className='min-w-16 text-center text-sm'>
            {zoom === 'fit' ? 'Fit' : `${zoom}%`}
          </span>
          <Button variant='ghost' size='icon' onClick={handleZoomIn}>
            <ZoomIn className='h-5 w-5' />
          </Button>
          <Button variant='ghost' size='icon' onClick={handleFitToScreen} title='Fit to screen'>
            <Maximize2 className='h-5 w-5' />
          </Button>
          <Button variant='ghost' size='icon' onClick={handleRotate}>
            <RotateCw className='h-5 w-5' />
          </Button>
          <Button variant='ghost' size='icon' onClick={handleDownload}>
            <Download className='h-5 w-5' />
          </Button>
        </div>
      </div>
      <div className='relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-4'>
        <button
          type='button'
          className='absolute left-0 top-0 bottom-0 z-10 w-[30%] cursor-pointer'
          onClick={navigateToPrevious}
          aria-label='Previous image'
        />
        <button
          type='button'
          className='absolute right-0 top-0 bottom-0 z-10 w-[30%] cursor-pointer'
          onClick={navigateToNext}
          aria-label='Next image'
        />
        <img
          src={getMediaUrl(viewingPath)}
          alt={fileName}
          className='pointer-events-none transition-transform duration-200'
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
