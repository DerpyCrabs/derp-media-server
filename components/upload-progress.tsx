'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, CheckCircle2, XCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface UploadProgressProps {
  isUploading: boolean
  error: string | null
  fileCount: number
  onDismiss: () => void
}

export function UploadProgress({ isUploading, error, fileCount, onDismiss }: UploadProgressProps) {
  const [showSuccess, setShowSuccess] = useState(false)
  const prevUploading = useRef(false)

  useEffect(() => {
    if (prevUploading.current && !isUploading && !error) {
      setShowSuccess(true)
      const timer = setTimeout(() => {
        setShowSuccess(false)
        onDismiss()
      }, 2000)
      return () => clearTimeout(timer)
    }
    prevUploading.current = isUploading
  }, [isUploading, error, onDismiss])

  if (!isUploading && !error && !showSuccess) return null

  return (
    <div className='fixed bottom-4 right-4 z-50 min-w-[280px] max-w-sm rounded-lg border bg-background shadow-lg p-3'>
      {isUploading && (
        <div className='flex items-center gap-3'>
          <Loader2 className='h-5 w-5 animate-spin text-primary shrink-0' />
          <span className='text-sm font-medium'>
            Uploading {fileCount} {fileCount === 1 ? 'file' : 'files'}...
          </span>
        </div>
      )}
      {!isUploading && !error && showSuccess && (
        <div className='flex items-center gap-3'>
          <CheckCircle2 className='h-5 w-5 text-green-500 shrink-0' />
          <span className='text-sm font-medium'>Upload complete</span>
        </div>
      )}
      {error && (
        <div className='flex items-start gap-3'>
          <XCircle className='h-5 w-5 text-destructive shrink-0 mt-0.5' />
          <div className='flex-1 min-w-0'>
            <p className='text-sm font-medium text-destructive'>Upload failed</p>
            <p className='text-xs text-muted-foreground mt-0.5 wrap-break-word'>{error}</p>
          </div>
          <Button variant='ghost' size='icon' className='h-6 w-6 shrink-0' onClick={onDismiss}>
            <X className='h-3.5 w-3.5' />
          </Button>
        </div>
      )}
    </div>
  )
}
