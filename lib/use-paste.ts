import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { post } from '@/lib/api'
import { extractPasteDataFromClipboardData } from '@/lib/extract-paste-data'
import type { PasteData } from '@/lib/paste-data'
import { queryKeys } from '@/lib/query-keys'

export type { PasteData } from '@/lib/paste-data'

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
            void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
            setShowPasteDialog(false)
            setPasteData(null)
          },
        },
      )
    },
  }

  const handlePaste = async (e: React.ClipboardEvent) => {
    e.preventDefault()
    const extracted = await extractPasteDataFromClipboardData(e.clipboardData)
    if (!extracted) return
    setPasteData(extracted)
    setShowPasteDialog(true)
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
