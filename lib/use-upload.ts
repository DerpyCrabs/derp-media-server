'use client'

import { useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'

interface UploadState {
  isUploading: boolean
  error: string | null
  fileCount: number
}

interface UseUploadOptions {
  shareToken?: string
}

export function useUpload({ shareToken }: UseUploadOptions = {}) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<UploadState>({
    isUploading: false,
    error: null,
    fileCount: 0,
  })

  const uploadFiles = useCallback(
    async (files: File[], targetDir: string) => {
      if (files.length === 0) return

      setState({ isUploading: true, error: null, fileCount: files.length })

      try {
        const formData = new FormData()
        formData.append('targetDir', targetDir)
        for (const file of files) {
          formData.append('files', file, file.name)
        }

        const url = shareToken ? `/api/share/${shareToken}/upload` : '/api/files/upload'

        const res = await fetch(url, { method: 'POST', body: formData })

        if (!res.ok) {
          const data = await res.json().catch(() => null)
          const message = data?.error || `Upload failed (${res.status})`
          setState((s) => ({ ...s, isUploading: false, error: message }))
          return
        }

        setState({ isUploading: false, error: null, fileCount: 0 })

        if (shareToken) {
          queryClient.invalidateQueries({ queryKey: ['share-files', shareToken] })
        } else {
          queryClient.invalidateQueries({ queryKey: ['files'] })
        }
      } catch (err) {
        setState((s) => ({
          ...s,
          isUploading: false,
          error: err instanceof Error ? err.message : 'Upload failed',
        }))
      }
    },
    [shareToken, queryClient],
  )

  const reset = useCallback(() => {
    setState({ isUploading: false, error: null, fileCount: 0 })
  }, [])

  return {
    uploadFiles,
    isUploading: state.isUploading,
    error: state.error,
    fileCount: state.fileCount,
    reset,
  }
}
