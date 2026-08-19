import { useQuery, useQueryClient } from '@tanstack/solid-query'
import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from 'solid-js'
import { api } from '@/lib/api/client'
import { queryKeys } from '@/lib/api/query-keys'
import { collectDroppedUploadFiles } from '@/lib/files/collect-dropped-upload-files'
import { extractPasteDataFromClipboardData } from '@/lib/files/extract-paste-data'
import { hasFileDragData } from '@/lib/files/file-drag-data'
import { normalizeNewFilePath } from '@/lib/files/new-file-name'
import type { PasteData } from '@/lib/files/paste-data'
import { getKnowledgeBaseRoot } from '@/lib/files/path-utils'
import type { FileItem } from '@/lib/files/types'
import type { VirtualEntry } from '@/lib/files/virtual-directory'
import { shouldOfferPasteAsNewFile } from '@/lib/files/should-offer-paste-as-new-file'
import { resetBreadcrumbFloating } from './breadcrumb-floating-store'
import { createFileBrowserDragController } from './file-browser-drag'
import { useExplorerSettings } from './use-explorer-settings'
import { useFileBrowserMutations } from './use-file-browser-mutations'
import { useFileDisplaySettings } from './use-file-display-settings'
import { registerKbSearchHotkeys } from './use-kb-search-hotkey'
import type { UploadToastState } from './types'

export type FileBrowserControllerOptions = Readonly<{
  currentPath: Accessor<string>
  files: Accessor<FileItem[]>
  editable: Accessor<boolean>
  editableFolders: Accessor<readonly string[]> | readonly string[]
  isActive?: Accessor<boolean>
  virtualEntry?: (file: FileItem) => VirtualEntry | undefined
  onFileCreated?: (path: string) => void
  onFileSaved?: (path: string) => void
  onInlineFileCreated?: (path: string) => void
  onInlineFolderCreated?: (path: string) => void
}>

export function useFileBrowserController(options: FileBrowserControllerOptions) {
  const queryClient = useQueryClient()
  const { settingsQuery, knowledgeBases, customIcons } = useExplorerSettings()
  const currentPath = options.currentPath

  const kbRootPath = createMemo(() => getKnowledgeBaseRoot(currentPath(), knowledgeBases()))
  const inKb = createMemo(() => kbRootPath() !== null)
  const hasEditableFolders = createMemo(() => {
    const folders =
      typeof options.editableFolders === 'function'
        ? options.editableFolders()
        : options.editableFolders
    return folders.length > 0
  })

  const [searchQuery, setSearchQuery] = createSignal('')
  const [debouncedSearch, setDebouncedSearch] = createSignal('')
  const [searchPopoverOpen, setSearchPopoverOpen] = createSignal(false)
  const [searchInputElement, setSearchInputElement] = createSignal<HTMLInputElement>()

  function clearSearch() {
    setSearchQuery('')
    setDebouncedSearch('')
    setSearchPopoverOpen(false)
  }

  function setKbSearchOpen(open: boolean) {
    setSearchPopoverOpen(open)
    if (!open) {
      setSearchQuery('')
      setDebouncedSearch('')
    }
  }

  createEffect(
    () => searchQuery(),
    (query) => {
      const id = window.setTimeout(() => setDebouncedSearch(query), 300)
      return () => clearTimeout(id)
    },
  )

  const kbSearchQuery = useQuery(() => ({
    queryKey: queryKeys.kbSearch(kbRootPath()!, debouncedSearch()),
    queryFn: () =>
      api<{ results: { path: string; name: string; snippet: string }[] }>(
        `/api/kb/search?root=${encodeURIComponent(kbRootPath()!)}&q=${encodeURIComponent(debouncedSearch())}`,
      ),
    enabled: !!kbRootPath() && searchPopoverOpen() && debouncedSearch().trim().length > 0,
  }))

  const kbSearchResults = createMemo(() => kbSearchQuery.data?.results ?? [])
  const kbSearchLoading = createMemo(() => kbSearchQuery.isLoading)
  const showKbSearchResults = createMemo(
    () => inKb() && searchPopoverOpen() && searchQuery().trim().length > 0,
  )

  registerKbSearchHotkeys({
    active: () => inKb() && (options.isActive?.() ?? true),
    isOpen: searchPopoverOpen,
    setOpen: setKbSearchOpen,
    focusInput: () => searchInputElement()?.focus(),
  })

  const [uploadToast, setUploadToast] = createSignal<UploadToastState>({ kind: 'hidden' })
  const [externalUploadDragOver, setExternalUploadDragOver] = createSignal(false)
  let externalUploadDragDepth = 0
  let uploadToastTimer: number | undefined

  function clearUploadToastTimer() {
    if (uploadToastTimer !== undefined) {
      window.clearTimeout(uploadToastTimer)
      uploadToastTimer = undefined
    }
  }

  function setUploadToastHidden() {
    clearUploadToastTimer()
    setUploadToast({ kind: 'hidden' })
  }

  function setUploadError(message: string) {
    clearUploadToastTimer()
    setUploadToast({ kind: 'error', message })
  }

  onCleanup(() => clearUploadToastTimer())

  async function uploadFilesToServer(files: File[], targetDir = currentPath()) {
    if (files.length === 0 || !options.editable()) return
    clearUploadToastTimer()
    setUploadToast({ kind: 'uploading', fileCount: files.length })
    try {
      const formData = new FormData()
      formData.append('targetDir', targetDir)
      for (const file of files) {
        formData.append('files', file, file.name)
      }
      const response = await fetch('/api/files/upload', { method: 'POST', body: formData })
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null
        setUploadToast({
          kind: 'error',
          message: data?.error || `Upload failed (${response.status})`,
        })
        return
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
      setUploadToast({ kind: 'success' })
      uploadToastTimer = window.setTimeout(setUploadToastHidden, 2000)
    } catch (error) {
      setUploadToast({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Upload failed',
      })
    }
  }

  function isOsFileUploadDrag(event: globalThis.DragEvent) {
    const dataTransfer = event.dataTransfer
    return !!(
      dataTransfer &&
      dataTransfer.types.includes('Files') &&
      !hasFileDragData(dataTransfer)
    )
  }

  function onExternalUploadDragEnter(event: globalThis.DragEvent) {
    if (!options.editable() || !isOsFileUploadDrag(event)) return
    event.preventDefault()
    externalUploadDragDepth++
    if (externalUploadDragDepth === 1) setExternalUploadDragOver(true)
  }

  function onExternalUploadDragLeave(event: globalThis.DragEvent) {
    if (!options.editable() || !isOsFileUploadDrag(event)) return
    event.preventDefault()
    if (externalUploadDragDepth <= 0) return
    externalUploadDragDepth--
    if (externalUploadDragDepth <= 0) {
      externalUploadDragDepth = 0
      setExternalUploadDragOver(false)
    }
  }

  function onExternalUploadDragOver(event: globalThis.DragEvent) {
    if (!options.editable() || !isOsFileUploadDrag(event)) return
    event.preventDefault()
    const dataTransfer = event.dataTransfer
    if (dataTransfer) dataTransfer.dropEffect = 'copy'
  }

  async function onExternalUploadDrop(event: globalThis.DragEvent) {
    event.preventDefault()
    externalUploadDragDepth = 0
    setExternalUploadDragOver(false)
    if (!options.editable()) return
    const dataTransfer = event.dataTransfer
    if (!dataTransfer || dataTransfer.files.length === 0) return
    const files = await collectDroppedUploadFiles(dataTransfer)
    if (files.length > 0) void uploadFilesToServer(files)
  }

  const [pasteData, setPasteData] = createSignal<PasteData | null>(null)
  const [showPasteDialog, setShowPasteDialog] = createSignal(false)

  function closePasteDialog() {
    setShowPasteDialog(false)
    setPasteData(null)
    pasteMutation.reset()
  }

  const mutations = useFileBrowserMutations({
    onFileCreated: options.onFileCreated,
    onFileSaved: (path) => {
      closePasteDialog()
      options.onFileSaved?.(path)
    },
  })

  const { moveMutation, createFileMutation, createFolderMutation, pasteMutation } = mutations

  function handlePasteEvent(event: ClipboardEvent) {
    if (!options.editable() || !shouldOfferPasteAsNewFile(event)) return
    event.preventDefault()
    void extractPasteDataFromClipboardData(event.clipboardData, {
      textSuggestedExtension: inKb() ? 'md' : 'txt',
    }).then((data) => {
      if (!data) return
      setPasteData(data)
      setShowPasteDialog(true)
    })
  }

  function handlePasteFileSubmit(
    fileName: string,
    mode: 'create' | 'replace',
    expectedVersion?: number,
  ) {
    const data = pasteData()
    if (!data) return
    const path = currentPath() ? `${currentPath()}/${fileName}` : fileName
    if (data.type === 'image') {
      pasteMutation.mutate({ path, base64Content: data.content, mode, expectedVersion })
    } else if (data.type === 'file') {
      if (data.isTextContent) {
        pasteMutation.mutate({ path, content: data.content, mode, expectedVersion })
      } else {
        pasteMutation.mutate({ path, base64Content: data.content, mode, expectedVersion })
      }
    } else {
      pasteMutation.mutate({ path, content: data.content, mode, expectedVersion })
    }
  }

  function moveFile(sourcePath: string, destinationDir: string) {
    const fileName = sourcePath.split(/[/\\]/).pop()!
    const newPath = destinationDir ? `${destinationDir}/${fileName}` : fileName
    moveMutation.mutate({ oldPath: sourcePath, newPath })
  }

  const allowMoveFile = createMemo(() => (options.editable() ? moveFile : undefined))
  const dragController = createFileBrowserDragController({
    files: options.files,
    currentPath,
    editableFolders: options.editableFolders,
    allowMoveFile,
    virtualOpenTarget: (file) => options.virtualEntry?.(file)?.openTarget,
  })

  const displaySettings = useFileDisplaySettings(currentPath, settingsQuery)

  const [inlineMode, setInlineMode] = createSignal<'file' | 'folder' | null>(null)
  const [inlineName, setInlineName] = createSignal('')
  const showInlineCreate = createMemo(() => options.editable() && inKb())
  const inlineFileExists = createMemo(() => {
    if (inlineMode() !== 'file') return false
    const stem = inlineName().trim()
    if (!stem) return false
    const finalName = normalizeNewFilePath(stem, inKb())
    return options
      .files()
      .some((file) => !file.isDirectory && file.name.toLowerCase() === finalName.toLowerCase())
  })
  const inlineFolderExists = createMemo(() => {
    if (inlineMode() !== 'folder') return false
    const name = inlineName().trim().toLowerCase()
    if (!name) return false
    return options.files().some((file) => file.isDirectory && file.name.toLowerCase() === name)
  })

  function submitInlineFile() {
    const stem = inlineName().trim()
    if (!stem || inlineFileExists() || !showInlineCreate()) return
    const base = currentPath() ? `${currentPath()}/${stem}` : stem
    const path = normalizeNewFilePath(base, inKb())
    createFileMutation.mutate(
      { path, content: '' },
      {
        onSuccess: () => {
          setInlineMode(null)
          setInlineName('')
          createFileMutation.reset()
          options.onInlineFileCreated?.(path)
        },
      },
    )
  }

  function submitInlineFolder() {
    const name = inlineName().trim()
    if (!name || inlineFolderExists() || !showInlineCreate()) return
    const path = currentPath() ? `${currentPath()}/${name}` : name
    createFolderMutation.mutate(
      { path },
      {
        onSuccess: () => {
          setInlineMode(null)
          setInlineName('')
          createFolderMutation.reset()
          options.onInlineFolderCreated?.(path)
        },
      },
    )
  }

  function resetInlineCreate() {
    setInlineMode(null)
    setInlineName('')
    createFileMutation.reset()
    createFolderMutation.reset()
  }

  const isUploading = createMemo(() => uploadToast().kind === 'uploading')

  createEffect(
    () => currentPath(),
    () => {
      clearSearch()
      resetInlineCreate()
      dragController.resetDrag()
      resetBreadcrumbFloating()
      externalUploadDragDepth = 0
      setExternalUploadDragOver(false)
      closePasteDialog()
    },
    { defer: true },
  )

  return {
    settingsQuery,
    knowledgeBases,
    customIcons,
    inKb,
    hasEditableFolders,
    displaySettings,
    searchQuery,
    setSearchQuery,
    debouncedSearch,
    searchPopoverOpen,
    setSearchInputElement,
    setKbSearchOpen,
    clearSearch,
    kbSearchResults,
    kbSearchLoading,
    showKbSearchResults,
    uploadToast,
    setUploadError,
    setUploadToastHidden,
    isUploading,
    externalUploadDragOver,
    uploadFilesToServer,
    onExternalUploadDragEnter,
    onExternalUploadDragLeave,
    onExternalUploadDragOver,
    onExternalUploadDrop,
    pasteData,
    showPasteDialog,
    pasteExistingFiles: options.files,
    handlePasteEvent,
    handlePasteFileSubmit,
    closePasteDialog,
    inlineMode,
    setInlineMode,
    inlineName,
    setInlineName,
    inlineFileExists,
    inlineFolderExists,
    showInlineCreate,
    submitInlineFile,
    submitInlineFolder,
    resetInlineCreate,
    allowMoveFile,
    ...dragController,
    ...mutations,
  }
}

export type FileBrowserController = ReturnType<typeof useFileBrowserController>
