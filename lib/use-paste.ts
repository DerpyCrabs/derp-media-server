import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { post } from '@/lib/api'

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

  const createMutation = useMutation({
    mutationFn: (vars: { type: 'file'; path: string; content?: string; base64Content?: string }) =>
      post('/api/files/create', vars),
  })
  const pasteFileMutation = {
    ...createMutation,
    mutate(args: { fileName: string; content?: string; base64Content?: string }) {
      const filePath = currentPath ? `${currentPath}/${args.fileName}` : args.fileName
      createMutation.mutate(
        { type: 'file', path: filePath, content: args.content, base64Content: args.base64Content },
        {
          onSuccess: () => {
            setLastPastedFile(filePath)
            queryClient.invalidateQueries({ queryKey: ['files'] })
            setShowPasteDialog(false)
            setPasteData(null)
          },
        },
      )
    },
  }

  const handlePaste = async (e: React.ClipboardEvent) => {
    e.preventDefault()

    const clipboardData = e.clipboardData
    if (!clipboardData) return

    const isTextFileType = (mimeType: string, fileName: string): boolean => {
      if (mimeType.startsWith('text/')) return true

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

    const files = clipboardData.files
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const fileName = file.name
        const fileSize = file.size
        const isTextFile = isTextFileType(file.type, fileName)

        const reader = new FileReader()
        reader.onload = async (event) => {
          const result = event.target?.result
          if (!result) return

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
          reader.readAsDataURL(file)
        }
      }
      return
    }

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

    const text = clipboardData.getData('text/plain')
    if (text) {
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

    if (pasteData.type === 'image') {
      pasteFileMutation.mutate({ fileName, base64Content: pasteData.content })
    } else if (pasteData.type === 'file') {
      if (pasteData.isTextContent) {
        pasteFileMutation.mutate({ fileName, content: pasteData.content })
      } else {
        pasteFileMutation.mutate({ fileName, base64Content: pasteData.content })
      }
    } else {
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
