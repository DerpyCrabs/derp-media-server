import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

export interface PasteData {
  type: 'text' | 'image' | 'file'
  content: string
  suggestedName: string
  fileType?: string
  showPreview?: boolean
  fileSize?: number
  isTextContent?: boolean
}

export function usePaste(currentPath: string) {
  const queryClient = useQueryClient()
  const [pasteData, setPasteData] = useState<PasteData | null>(null)
  const [showPasteDialog, setShowPasteDialog] = useState(false)
  const [lastPastedFile, setLastPastedFile] = useState<string | null>(null)

  const pasteFileMutation = useMutation({
    mutationFn: async ({
      fileName,
      content,
      base64Content,
    }: {
      fileName: string
      content?: string
      base64Content?: string
    }) => {
      const filePath = currentPath ? `${currentPath}/${fileName}` : fileName
      const res = await fetch('/api/files/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'file', path: filePath, content, base64Content }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to create file')
      }
      return { data: await res.json(), filePath }
    },
    onSuccess: ({ filePath }) => {
      setLastPastedFile(filePath)
      queryClient.invalidateQueries({ queryKey: ['files', currentPath] })
      setShowPasteDialog(false)
      setPasteData(null)
    },
  })

  const handlePaste = async (e: React.ClipboardEvent) => {
    e.preventDefault()

    const clipboardData = e.clipboardData
    if (!clipboardData) return

    // Helper function to check if a file type is text-based
    const isTextFileType = (mimeType: string, fileName: string): boolean => {
      // Check MIME type
      if (mimeType.startsWith('text/')) return true

      // Check common text file extensions
      const textExtensions = [
        'txt',
        'md',
        'json',
        'xml',
        'csv',
        'log',
        'yaml',
        'yml',
        'ini',
        'conf',
        'sh',
        'bat',
        'ps1',
        'js',
        'ts',
        'jsx',
        'tsx',
        'css',
        'scss',
        'html',
        'htm',
        'py',
        'java',
        'c',
        'cpp',
        'h',
        'cs',
        'go',
        'rs',
        'php',
        'rb',
        'swift',
        'kt',
        'sql',
      ]
      const extension = fileName.split('.').pop()?.toLowerCase()
      return extension ? textExtensions.includes(extension) : false
    }

    // Check for files first
    const files = clipboardData.files
    if (files && files.length > 0) {
      // Handle pasted files - always ask for filename
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const fileName = file.name
        const fileSize = file.size
        const isTextFile = isTextFileType(file.type, fileName)

        // Read file content
        const reader = new FileReader()
        reader.onload = async (event) => {
          const result = event.target?.result
          if (!result) return

          // For images and binary files, use base64
          if (file.type.startsWith('image/')) {
            const base64 = (result as string).split(',')[1]
            setPasteData({
              type: 'image',
              content: base64,
              suggestedName: fileName,
              fileType: file.type,
              fileSize,
              showPreview: true,
              isTextContent: false,
            })
            setShowPasteDialog(true)
          } else if (isTextFile) {
            // For text files, show content preview
            setPasteData({
              type: 'file',
              content: result as string,
              suggestedName: fileName,
              fileType: file.type,
              fileSize,
              showPreview: true,
              isTextContent: true,
            })
            setShowPasteDialog(true)
          } else {
            // For binary files (videos, PDFs, etc.), show filename and size preview
            const base64 = (result as string).split(',')[1]
            setPasteData({
              type: 'file',
              content: base64,
              suggestedName: fileName,
              fileType: file.type,
              fileSize,
              showPreview: true,
              isTextContent: false,
            })
            setShowPasteDialog(true)
          }
        }

        if (file.type.startsWith('image/') || isTextFile) {
          if (file.type.startsWith('image/')) {
            reader.readAsDataURL(file)
          } else {
            reader.readAsText(file)
          }
        } else {
          // For binary files, read as data URL to get base64
          reader.readAsDataURL(file)
        }
      }
      return
    }

    // Check for images from clipboard (e.g., screenshots)
    const items = clipboardData.items
    for (let i = 0; i < items.length; i++) {
      const item = items[i]
      if (item.type.startsWith('image/')) {
        const blob = item.getAsFile()
        if (blob) {
          const reader = new FileReader()
          reader.onload = (event) => {
            const result = event.target?.result
            if (result && typeof result === 'string') {
              const base64 = result.split(',')[1]
              const extension = item.type.split('/')[1] || 'png'
              setPasteData({
                type: 'image',
                content: base64,
                suggestedName: `image-${Date.now()}.${extension}`,
                fileType: item.type,
                fileSize: blob.size,
                showPreview: true,
                isTextContent: false,
              })
              setShowPasteDialog(true)
            }
          }
          reader.readAsDataURL(blob)
        }
        return
      }
    }

    // Check for text
    const text = clipboardData.getData('text/plain')
    if (text) {
      // Calculate size in bytes (approximate)
      const textSize = new Blob([text]).size
      setPasteData({
        type: 'text',
        content: text,
        suggestedName: `pasted-${Date.now()}.txt`,
        fileSize: textSize,
        showPreview: true,
        isTextContent: true,
      })
      setShowPasteDialog(true)
    }
  }

  const handlePasteFile = (fileName: string) => {
    if (!pasteData) return

    // For images, always use base64
    if (pasteData.type === 'image') {
      pasteFileMutation.mutate({ fileName, base64Content: pasteData.content })
    } else if (pasteData.type === 'file') {
      // For files, check if content is text or binary
      if (pasteData.isTextContent) {
        // Text file - content is already text
        pasteFileMutation.mutate({ fileName, content: pasteData.content })
      } else {
        // Binary file - content is base64
        pasteFileMutation.mutate({ fileName, base64Content: pasteData.content })
      }
    } else {
      // Text type
      pasteFileMutation.mutate({ fileName, content: pasteData.content })
    }
  }

  const closePasteDialog = () => {
    setShowPasteDialog(false)
    setPasteData(null)
    pasteFileMutation.reset()
  }

  return {
    pasteData,
    showPasteDialog,
    pasteFileMutation,
    lastPastedFile,
    handlePaste,
    handlePasteFile,
    closePasteDialog,
  }
}
