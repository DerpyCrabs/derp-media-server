import { useState, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PasteData } from '@/lib/use-paste'
import { AlertCircle, FileIcon, HardDrive } from 'lucide-react'
import { formatFileSize } from '@/lib/media-utils'

interface PasteDialogProps {
  isOpen: boolean
  pasteData: PasteData | null
  isPending: boolean
  error: Error | null
  existingFiles: string[]
  onPaste: (fileName: string) => void
  onClose: () => void
}

export function PasteDialog({
  isOpen,
  pasteData,
  isPending,
  error,
  existingFiles,
  onPaste,
  onClose,
}: PasteDialogProps) {
  const [fileName, setFileName] = useState('')

  // Initialize filename from pasteData if not set
  const currentFileName = fileName || pasteData?.suggestedName || ''

  // Check if file exists (derived state, no effect needed)
  const fileExists = useMemo(() => {
    if (!currentFileName.trim()) return false
    return existingFiles.includes(currentFileName.toLowerCase())
  }, [currentFileName, existingFiles])

  const handlePaste = () => {
    const fileNameToUse = currentFileName.trim()
    if (fileNameToUse) {
      onPaste(fileNameToUse)
    }
  }

  const handleClose = () => {
    if (!isPending) {
      setFileName('') // Reset on close
      onClose()
    }
  }

  const handleFileNameChange = (value: string) => {
    setFileName(value)
  }

  const getContentTypeLabel = () => {
    if (!pasteData) return 'Content'
    switch (pasteData.type) {
      case 'image':
        return 'Image'
      case 'text':
        return 'Text'
      case 'file':
        return 'File'
      default:
        return 'Content'
    }
  }

  const renderPreview = () => {
    if (!pasteData || !pasteData.showPreview) return null

    if (pasteData.type === 'image') {
      return (
        <div className='space-y-2'>
          <div className='rounded-lg border bg-muted/30 p-4 flex items-center justify-center max-h-64 overflow-hidden'>
            <img
              src={`data:${pasteData.fileType || 'image/png'};base64,${pasteData.content}`}
              alt='Preview'
              className='max-w-full max-h-56 object-contain'
            />
          </div>
          {pasteData.fileSize && (
            <div className='flex items-center gap-2 text-xs text-muted-foreground px-2'>
              <HardDrive className='h-3 w-3' />
              <span>{formatFileSize(pasteData.fileSize)}</span>
            </div>
          )}
        </div>
      )
    }

    if (pasteData.type === 'text' || pasteData.type === 'file') {
      // For text content, show preview
      if (pasteData.isTextContent) {
        const previewText =
          pasteData.content.length > 500
            ? pasteData.content.substring(0, 500) + '...'
            : pasteData.content

        return (
          <div className='space-y-2'>
            <div className='rounded-lg border bg-muted/30'>
              <ScrollArea className='h-48'>
                <pre className='p-4 text-xs font-mono whitespace-pre-wrap wrap-break-word'>
                  {previewText}
                </pre>
              </ScrollArea>
              {pasteData.content.length > 500 && (
                <div className='px-4 py-2 text-xs text-muted-foreground border-t'>
                  Showing first 500 characters of {pasteData.content.length} total
                </div>
              )}
            </div>
            {pasteData.fileSize && (
              <div className='flex items-center gap-2 text-xs text-muted-foreground px-2'>
                <HardDrive className='h-3 w-3' />
                <span>{formatFileSize(pasteData.fileSize)}</span>
              </div>
            )}
          </div>
        )
      } else {
        // For binary files, show metadata preview (filename and size)
        return (
          <div className='rounded-lg border bg-muted/30 p-6'>
            <div className='flex flex-col items-center gap-4 text-center'>
              <div className='rounded-full bg-primary/10 p-4'>
                <FileIcon className='h-8 w-8 text-primary' />
              </div>
              <div className='space-y-2'>
                <p className='font-medium text-sm'>{pasteData.suggestedName}</p>
                <div className='flex items-center justify-center gap-4 text-xs text-muted-foreground'>
                  {pasteData.fileType && <span className='font-mono'>{pasteData.fileType}</span>}
                  {pasteData.fileSize && (
                    <div className='flex items-center gap-1'>
                      <HardDrive className='h-3 w-3' />
                      <span>{formatFileSize(pasteData.fileSize)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      }
    }

    return null
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className='max-w-2xl'>
        <DialogHeader>
          <DialogTitle>Paste {getContentTypeLabel()}</DialogTitle>
        </DialogHeader>

        <div className='space-y-4'>
          {/* Preview */}
          {renderPreview()}

          {/* Filename input */}
          <div className='space-y-2'>
            <label className='text-sm font-medium'>Filename</label>
            <Input
              value={currentFileName}
              onChange={(e) => handleFileNameChange(e.target.value)}
              placeholder={`e.g., ${pasteData?.suggestedName}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && currentFileName.trim()) {
                  handlePaste()
                }
              }}
              autoFocus
              disabled={isPending}
              className={fileExists ? 'border-yellow-500' : ''}
            />
          </div>

          {/* File exists warning */}
          {fileExists && (
            <div className='rounded-lg bg-yellow-500/10 border border-yellow-500/50 p-3 flex items-start gap-2'>
              <AlertCircle className='h-4 w-4 text-yellow-600 dark:text-yellow-500 mt-0.5 shrink-0' />
              <div className='text-sm text-yellow-800 dark:text-yellow-200'>
                <p className='font-medium'>File already exists</p>
                <p className='text-xs mt-1 opacity-90'>
                  A file with this name already exists. Pasting will overwrite the existing file.
                </p>
              </div>
            </div>
          )}

          {/* Error message */}
          {error && (
            <div className='rounded-lg bg-destructive/10 p-3 text-sm text-destructive'>
              {error.message}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant='outline' onClick={handleClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handlePaste} disabled={isPending || !currentFileName.trim()}>
            {isPending ? 'Pasting...' : fileExists ? 'Overwrite' : 'Paste'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
