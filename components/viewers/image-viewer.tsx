'use client'

import { useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogPopup,
  DialogTitle,
} from '@/components/ui/dialog'
import { FileItem, MediaType } from '@/lib/types'
import { useFiles } from '@/lib/use-files'
import { ImageViewerContent } from '@/components/viewers/image-viewer-content'

export function ImageViewer() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const viewingPath = searchParams.get('viewing')
  const currentDir = searchParams.get('dir') || ''

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

  const { data: allFiles = [] } = useFiles(dirToFetch)

  const imageFiles = useMemo(() => {
    return allFiles.filter((file: FileItem) => file.type === MediaType.IMAGE)
  }, [allFiles])

  const closeViewer = useCallback(() => {
    const params = new URLSearchParams(searchParams)
    params.delete('viewing')
    router.replace(`/?${params.toString()}`, { scroll: false })
  }, [searchParams, router])

  const currentIndex = imageFiles.findIndex((file) => file.path === viewingPath)

  const navigateToNext = useCallback(() => {
    if (!viewingPath || currentIndex === -1 || currentIndex === imageFiles.length - 1) return
    const nextFile = imageFiles[currentIndex + 1]
    const params = new URLSearchParams(searchParams)
    params.set('viewing', nextFile.path)
    if (currentDir) params.set('dir', currentDir)
    router.replace(`/?${params.toString()}`, { scroll: false })
  }, [viewingPath, currentIndex, imageFiles, searchParams, currentDir, router])

  const navigateToPrevious = useCallback(() => {
    if (!viewingPath || currentIndex === -1 || currentIndex === 0) return
    const prevFile = imageFiles[currentIndex - 1]
    const params = new URLSearchParams(searchParams)
    params.set('viewing', prevFile.path)
    if (currentDir) params.set('dir', currentDir)
    router.replace(`/?${params.toString()}`, { scroll: false })
  }, [viewingPath, currentIndex, imageFiles, searchParams, currentDir, router])

  const fileExtension = viewingPath?.split('.').pop()?.toLowerCase() || ''
  const imageExtensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'ico']
  const isImage = viewingPath && imageExtensions.includes(fileExtension)

  if (!isImage) return null

  const fileName = viewingPath.split(/[/\\]/).pop() || ''

  return (
    <Dialog open={!!viewingPath} onOpenChange={(open) => !open && closeViewer()}>
      <DialogPortal>
        <DialogOverlay className='bg-black/95' />
        <DialogPopup className='fixed inset-0 z-50 flex flex-col'>
          <span className='sr-only'>
            <DialogTitle>{fileName}</DialogTitle>
          </span>
          <ImageViewerContent
            mediaUrl={`/api/media/${encodeURIComponent(viewingPath)}`}
            fileName={fileName}
            onClose={closeViewer}
            onNavigateNext={currentIndex < imageFiles.length - 1 ? navigateToNext : undefined}
            onNavigatePrevious={currentIndex > 0 ? navigateToPrevious : undefined}
            imageIndex={currentIndex !== -1 ? currentIndex : undefined}
            totalImages={imageFiles.length > 0 ? imageFiles.length : undefined}
            downloadUrl={`/api/media/${encodeURIComponent(viewingPath)}`}
          />
        </DialogPopup>
      </DialogPortal>
    </Dialog>
  )
}
