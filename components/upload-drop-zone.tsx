'use client'

import { useState, useRef, useCallback } from 'react'
import { Upload } from 'lucide-react'

interface UploadDropZoneProps {
  enabled: boolean
  onUpload: (files: File[]) => void
  children: React.ReactNode
  className?: string
}

async function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const entries: FileSystemEntry[] = []
  let batch: FileSystemEntry[]
  do {
    batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject)
    })
    entries.push(...batch)
  } while (batch.length > 0)
  return entries
}

async function readEntry(entry: FileSystemEntry, basePath: string, files: File[]): Promise<void> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry
    const file = await new Promise<File>((resolve, reject) => {
      fileEntry.file(resolve, reject)
    })
    const relativePath = basePath ? `${basePath}/${entry.name}` : entry.name
    files.push(new File([file], relativePath, { type: file.type, lastModified: file.lastModified }))
  } else if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry
    const reader = dirEntry.createReader()
    const entries = await readAllEntries(reader)
    const dirPath = basePath ? `${basePath}/${entry.name}` : entry.name
    for (const child of entries) {
      await readEntry(child, dirPath, files)
    }
  }
}

async function collectDroppedFiles(dataTransfer: DataTransfer): Promise<File[]> {
  const files: File[] = []
  const items = dataTransfer.items

  if (items) {
    const entries: FileSystemEntry[] = []
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.()
      if (entry) entries.push(entry)
    }

    if (entries.length > 0) {
      for (const entry of entries) {
        await readEntry(entry, '', files)
      }
      return files
    }
  }

  // Fallback: plain file list (no folder support)
  for (let i = 0; i < dataTransfer.files.length; i++) {
    files.push(dataTransfer.files[i])
  }
  return files
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

      const files = await collectDroppedFiles(e.dataTransfer)
      if (files.length > 0) {
        onUpload(files)
      }
    },
    [enabled, onUpload],
  )

  return (
    <div
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
