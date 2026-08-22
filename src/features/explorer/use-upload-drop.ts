import { useQueryClient } from '@tanstack/solid-query'
import { createMemo, createSignal, onCleanup, type Accessor } from 'solid-js'
import { queryKeys } from '@/lib/api/query-keys'
import { collectDroppedUploadFiles } from '@/lib/files/collect-dropped-upload-files'
import { hasFileDragData } from '@/lib/files/file-drag-data'
import type { UploadToastState } from './types'

export function useUploadDrop(options: {
  currentPath: Accessor<string>
  editable: Accessor<boolean>
}) {
  const queryClient = useQueryClient()
  const [toast, setToast] = createSignal<UploadToastState>({ kind: 'hidden' })
  const [dragOver, setDragOver] = createSignal(false)
  let dragDepth = 0
  let toastTimer: number | undefined

  function clearToastTimer() {
    if (toastTimer === undefined) return
    window.clearTimeout(toastTimer)
    toastTimer = undefined
  }

  function hideToast() {
    clearToastTimer()
    setToast({ kind: 'hidden' })
  }

  function setError(message: string) {
    clearToastTimer()
    setToast({ kind: 'error', message })
  }

  onCleanup(clearToastTimer)

  async function upload(files: File[], targetDir = options.currentPath()) {
    if (files.length === 0 || !options.editable()) return
    clearToastTimer()
    setToast({ kind: 'uploading', fileCount: files.length })
    try {
      const formData = new FormData()
      formData.append('targetDir', targetDir)
      for (const file of files) formData.append('files', file, file.name)
      const response = await fetch('/api/files/upload', { method: 'POST', body: formData })
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null
        setError(data?.error || `Upload failed (${response.status})`)
        return
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
      setToast({ kind: 'success' })
      toastTimer = window.setTimeout(hideToast, 2000)
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Upload failed')
    }
  }

  function isOsFileDrag(event: globalThis.DragEvent) {
    const data = event.dataTransfer
    return !!data?.types.includes('Files') && !hasFileDragData(data)
  }

  function enter(event: globalThis.DragEvent) {
    if (!options.editable() || !isOsFileDrag(event)) return
    event.preventDefault()
    dragDepth++
    if (dragDepth === 1) setDragOver(true)
  }

  function leave(event: globalThis.DragEvent) {
    if (!options.editable() || !isOsFileDrag(event)) return
    event.preventDefault()
    if (dragDepth <= 0) return
    dragDepth--
    if (dragDepth === 0) setDragOver(false)
  }

  function over(event: globalThis.DragEvent) {
    if (!options.editable() || !isOsFileDrag(event)) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }

  async function drop(event: globalThis.DragEvent) {
    event.preventDefault()
    dragDepth = 0
    setDragOver(false)
    if (!options.editable() || !event.dataTransfer?.files.length) return
    const files = await collectDroppedUploadFiles(event.dataTransfer)
    if (files.length) void upload(files)
  }

  const uploading = createMemo(() => toast().kind === 'uploading')

  return {
    toast,
    hideToast,
    setError,
    uploading,
    dragOver,
    upload,
    enter,
    leave,
    over,
    drop,
  }
}
