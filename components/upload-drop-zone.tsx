import { useState, useRef, useCallback } from 'react'
import { Upload } from 'lucide-react'
import { collectDroppedUploadFiles } from '@/lib/collect-dropped-upload-files'

interface UploadDropZoneProps {
  enabled: boolean
  onUpload: (files: File[]) => void
  children: React.ReactNode
  className?: string
}

export function UploadDropZone({ enabled, onUpload, children, className }: UploadDropZoneProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const dragCounter = useRef(0)

  const isExternalFileDrag = useCallback((e: React.DragEvent) => {
    return e.dataTransfer.types.includes('Files') && !e.dataTransfer.types.includes('text/plain')
  }, [])

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      if (!enabled || !isExternalFileDrag(e)) return
      e.preventDefault()
      dragCounter.current++
      if (dragCounter.current === 1) setIsDragOver(true)
    },
    [enabled, isExternalFileDrag],
  )

  const handleDragLeave = useCallback(
    (e: React.DragEvent) => {
      if (!enabled) return
      e.preventDefault()
      dragCounter.current--
      if (dragCounter.current <= 0) {
        dragCounter.current = 0
        setIsDragOver(false)
      }
    },
    [enabled],
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      if (!enabled || !isExternalFileDrag(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    [enabled, isExternalFileDrag],
  )

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      dragCounter.current = 0
      setIsDragOver(false)

      if (!enabled || e.dataTransfer.files.length === 0) return

      const files = await collectDroppedUploadFiles(e.dataTransfer)
      if (files.length > 0) {
        onUpload(files)
      }
    },
    [enabled, onUpload],
  )

  return (
    <div
      data-testid='upload-drop-zone'
      className={`relative ${className || ''}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}
      {isDragOver && (
        <div className='absolute inset-0 z-50 flex items-center justify-center bg-primary/10 border-2 border-dashed border-primary rounded-lg pointer-events-none'>
          <div className='flex flex-col items-center gap-2 text-primary'>
            <Upload className='h-10 w-10' />
            <span className='text-lg font-medium'>Drop files to upload</span>
          </div>
        </div>
      )}
    </div>
  )
}
