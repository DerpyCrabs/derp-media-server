import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import { hasFileDragData } from '@/lib/files/file-drag-data'
import { collectDroppedUploadFiles } from '@/lib/files/collect-dropped-upload-files'
import { extractPasteDataFromClipboardData } from '@/lib/files/extract-paste-data'
import { shouldOfferPasteAsNewFile } from '@/lib/files/should-offer-paste-as-new-file'
import {
  breadcrumbFloating,
  resetBreadcrumbFloating,
  setBreadcrumbFolderMenu,
} from '@/features/explorer/breadcrumb-floating-store'
import { api, post } from '@/lib/api/client'
import {
  prefetchFolderContentsOnHover,
  prefetchParentDirectoryHover,
  type PrefetchFolderHoverContext,
} from '@/features/explorer/prefetch-folder-hover'
import { queryKeys } from '@/lib/api/query-keys'
import { VIRTUAL_FOLDERS, isVirtualFolderPath } from '@/lib/files/constants'
import type { PasteData } from '@/lib/files/paste-data'
import { MediaType, type FileItem } from '@/lib/files/types'
import { normalizeNewFilePath } from '@/lib/files/new-file-name'
import { formatFileSize } from '@/lib/media/media-utils'
import { cn } from '@/lib/ui/cn'
import { getKnowledgeBaseRoot, isPathEditable } from '@/lib/files/path-utils'
import FilePlus from 'lucide-solid/icons/file-plus'
import FolderPlus from 'lucide-solid/icons/folder-plus'
import BookOpenText from 'lucide-solid/icons/book-open-text'
import Star from 'lucide-solid/icons/star'
import Upload from 'lucide-solid/icons/upload'
import Eye from 'lucide-solid/icons/eye'
import Ellipsis from 'lucide-solid/icons/ellipsis'
import { createEffect, createMemo, createSignal, Show } from 'solid-js'
import type { FileIconContext } from '@/features/explorer/use-file-icon'
import { fileItemIcon, gridHeroIcon } from '@/features/explorer/use-file-icon'
import { createUrlSearchParamsMemo, useBrowserHistory } from '@/lib/browser/browser-history'
import type { BreadcrumbMenuTarget } from '@/features/explorer/BreadcrumbContextMenu'
import { Breadcrumbs } from '@/features/explorer/Breadcrumbs'
import { FileBrowserModalLayer } from '@/features/explorer/FileBrowserModalLayer'
import { DirectoryBackgroundContextMenu } from '@/features/explorer/DirectoryBackgroundContextMenu'
import { KbDashboard } from '@/features/explorer/KbDashboard'
import { KbInlineCreateFooter } from '@/features/explorer/KbInlineCreateFooter'
import { KbSearchResults } from '@/features/explorer/KbSearchResults'
import { navigateToFolder } from '@/features/explorer/navigate-folder'
import { useFileRowContextMenu } from '@/features/explorer/use-file-row-context-menu'
import { UploadMenu } from '@/features/explorer/UploadMenu'
import type { ServerConfig, UploadToastState } from '@/features/explorer/types'
import { FloatingScrollActions } from '@/features/explorer/FloatingScrollActions'
import { useInlineModeInputFocus } from '@/features/explorer/use-inline-mode-input-focus'
import { registerKbSearchHotkeys } from '@/features/explorer/use-kb-search-hotkey'
import { ViewModeToggle } from '@/features/explorer/ViewModeToggle'
import { FileExplorerView } from '@/features/explorer/FileExplorerView'
import { FileBrowserPane } from '@/features/explorer/FileBrowserPane'
import { createFileBrowserDragController } from '@/features/explorer/file-browser-drag'
import { useExplorerSettings } from '@/features/explorer/use-explorer-settings'
import { PaneSwitch } from '@/features/panes/PaneSwitch'
import { ThemeSwitcher } from './ThemeSwitcher'
import { useAdminEventsStream } from '@/lib/api/use-admin-events-stream'
import { MainMediaPlayers } from './MainMediaPlayers'
import { useDynamicFavicon } from '@/media-center/use-dynamic-favicon'
import { useStoreSync } from '@/lib/state/solid-store-sync'
import { useBrowserViewModeStore } from '@/features/explorer/browser-view-mode-store'
import { openInReader } from '@/features/reader/reader-url'
import { persistViewMode } from '@/features/explorer/view-mode-persistence'
import { useViewStats } from '@/features/explorer/use-view-stats'
import { createLongPressContextMenuHandlers } from '@/features/explorer/long-press-context-menu'
import { useDeferredLoading } from '@/lib/ui/use-deferred-loading'
import { playFile, viewFile } from '@/lib/browser/url-state-actions'
import { FileSearchButton } from '@/features/explorer/FileSearchPalette'
import { fileSearchResultToFileItem, type FileSearchResult } from '@/lib/files/file-search'
import {
  audioPlaybackQueueFromFiles,
  playbackItemFromFileItem,
  playbackItemFromPath,
  playbackPathKey,
  playbackPathMatches,
  playbackQueuesEqual,
  type PlaybackItem,
} from '@/features/playback'
import { usePlaybackSession, usePlaybackSnapshot } from '@/features/playback/PlaybackProvider'

export function MediaCenterPage() {
  const history = useBrowserHistory()
  const urlSearchParams = createUrlSearchParamsMemo(history)
  const queryClient = useQueryClient()
  const playbackSession = usePlaybackSession()
  const playbackSnapshot = usePlaybackSnapshot()
  useAdminEventsStream()

  const currentPath = createMemo(() => urlSearchParams().get('dir') ?? '')

  const playingParam = createMemo(() => urlSearchParams().get('playing'))

  const playingPath = createMemo(() => playingParam() ?? '')

  const isVirtualFolder = createMemo(() =>
    (Object.values(VIRTUAL_FOLDERS) as string[]).includes(currentPath()),
  )

  const serverConfigQuery = useQuery(() => ({
    queryKey: queryKeys.serverConfig(),
    queryFn: () => api<ServerConfig>('/api/config'),
    staleTime: Infinity,
  }))

  const editableFolders = createMemo(() => serverConfigQuery.data?.editableFolders ?? [])
  const mediaRoots = createMemo(() => serverConfigQuery.data?.mediaRoots ?? [])
  const isEditable = createMemo(
    () => !isVirtualFolder() && isPathEditable(currentPath(), editableFolders(), mediaRoots()),
  )

  const filesQuery = useQuery(() => ({
    queryKey: queryKeys.files(currentPath()),
    queryFn: () =>
      api<{ files: FileItem[] }>(`/api/files?dir=${encodeURIComponent(currentPath())}`),
  }))

  const { settingsQuery, knowledgeBases, customIcons } = useExplorerSettings()

  const files = createMemo(() => filesQuery.data?.files ?? [])
  const fileBrowserScrollScope = () => 'main-file-browser'
  const isFilesLoadingInitial = createMemo(
    () => filesQuery.isPending && filesQuery.data === undefined,
  )
  const showFilesDeferredLoading = useDeferredLoading(() => isFilesLoadingInitial())
  const pasteExistingFiles = createMemo(() => files())

  const kbRootPath = createMemo(() => getKnowledgeBaseRoot(currentPath(), knowledgeBases()))
  const inKb = createMemo(() => kbRootPath() !== null)
  const hasEditableFolders = createMemo(() => editableFolders().length > 0)

  const viewStats = useViewStats(() => ({}))
  useDynamicFavicon(() => customIcons(), { getSearch: () => history().search })

  const viewModeTick = useStoreSync(useBrowserViewModeStore)

  const isAudioPlayingBar = createMemo(() => {
    const state = playbackSnapshot()
    return !!state.currentItem && state.mode === 'audio'
  })

  const fileIconCtx = createMemo((): FileIconContext => {
    const state = playbackSnapshot()
    return {
      customIcons: customIcons(),
      knowledgeBases: knowledgeBases(),
      playingPath: playingParam(),
      currentFile: state.currentItem?.locator ?? null,
      mediaPlayerIsPlaying: state.phase === 'playing',
      mediaType: state.currentItem ? state.mode : null,
    }
  })

  function playbackItemForPath(path: string): PlaybackItem | null {
    const normalizedPath = playbackPathKey(path)
    const listed = files().find((file) => playbackPathKey(file.path) === normalizedPath)
    return listed ? playbackItemFromFileItem(listed) : playbackItemFromPath(path)
  }

  function playbackQueueFor(item: PlaybackItem): PlaybackItem[] {
    if (item.media === 'video') return [item]
    const queue = audioPlaybackQueueFromFiles(files(), item)
    return queue.some((candidate) => playbackPathMatches(candidate, item.locator))
      ? queue
      : [...queue, item]
  }

  let previousLibraryPlayingPath: string | null = null
  createEffect(
    () => {
      const path = playingParam()
      if (window.location.pathname !== '/') return { path: null, onRoot: false as const }
      if (!path) return { path: null, onRoot: true as const }
      const item = playbackItemForPath(path)
      if (!item) return { path, onRoot: true as const, item: null }
      return {
        path,
        onRoot: true as const,
        item,
        mode:
          item.media === 'video' && urlSearchParams().get('audioOnly') === 'true'
            ? 'audio'
            : item.media,
        queue: playbackQueueFor(item),
      }
    },
    (next) => {
      if (!next.onRoot) return
      if (!next.path) {
        if (previousLibraryPlayingPath) playbackSession.dispatch({ type: 'stop' })
        previousLibraryPlayingPath = null
        return
      }
      previousLibraryPlayingPath = next.path
      if (!next.item) return
      const state = playbackSession.getSnapshot()
      const sameCurrent =
        state.currentItem !== null && playbackPathMatches(state.currentItem, next.item.locator)
      if (!sameCurrent) {
        playbackSession.dispatch({
          type: 'load',
          item: next.item,
          queue: next.queue,
          mode: next.mode,
          autoplay: true,
        })
        return
      }
      if (state.mode !== next.mode) playbackSession.dispatch({ type: 'setMode', mode: next.mode })
      if (next.item.media !== 'audio') return
      if (!playbackQueuesEqual(state.queue, next.queue)) {
        playbackSession.dispatch({
          type: 'setQueue',
          queue: next.queue,
          current: state.currentItem,
        })
      }
    },
  )

  const [searchQuery, setSearchQuery] = createSignal('')
  const [debouncedSearch, setDebouncedSearch] = createSignal('')
  const [searchPopoverOpen, setSearchPopoverOpen] = createSignal(false)
  const [iconEditTarget, setIconEditTarget] = createSignal<FileItem | null>(null)
  const breadcrumbMenu = () => breadcrumbFloating.folderMenu

  createEffect(
    () => searchQuery(),
    (query) => {
      const id = window.setTimeout(() => setDebouncedSearch(query), 300)
      // eslint-disable-next-line solid/reactivity
      return () => clearTimeout(id)
    },
  )

  createEffect(
    () => currentPath(),
    () => {
      setSearchQuery('')
      setDebouncedSearch('')
      setSearchPopoverOpen(false)
      setInlineMode(null)
      setInlineName('')
      resetBreadcrumbFloating()
    },
    { defer: true },
  )

  registerKbSearchHotkeys({
    active: inKb,
    isOpen: searchPopoverOpen,
    setOpen: (open) => {
      setSearchPopoverOpen(open)
      if (!open) {
        setSearchQuery('')
        setDebouncedSearch('')
      }
    },
    focusInput: () => kbSearchInputEl?.focus(),
  })

  const kbSearchQuery = useQuery(() => ({
    queryKey: queryKeys.kbSearch(kbRootPath()!, debouncedSearch()),
    queryFn: () =>
      api<{ results: { path: string; name: string; snippet: string }[] }>(
        `/api/kb/search?root=${encodeURIComponent(kbRootPath()!)}&q=${encodeURIComponent(debouncedSearch())}`,
      ),
    enabled: !!kbRootPath() && searchPopoverOpen() && debouncedSearch().trim().length > 0,
  }))

  const viewMode = createMemo(() => {
    void viewModeTick()
    const s = settingsQuery.data
    return useBrowserViewModeStore
      .getState()
      .getViewMode(`admin-viewmode-${currentPath()}`, s?.viewModes?.[currentPath()] ?? 'list')
  })

  const favorites = createMemo(() => settingsQuery.data?.favorites ?? [])
  const favoriteSet = createMemo(() => new Set(favorites()))

  const viewModeMutation = useMutation(() => ({
    mutationFn: (vars: { path: string; viewMode: 'list' | 'grid' }) =>
      persistViewMode(vars.path, vars.viewMode),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
    },
  }))

  const favoriteMutation = useMutation(() => ({
    mutationFn: (vars: { filePath: string }) => post('/api/settings/favorite', vars),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.files(VIRTUAL_FOLDERS.FAVORITES) })
    },
  }))

  const [uploadToast, setUploadToast] = createSignal<UploadToastState>({ kind: 'hidden' })
  const [deleteTarget, setDeleteTarget] = createSignal<FileItem | null>(null)
  const [showCreateFolder, setShowCreateFolder] = createSignal(false)
  const [showCreateFile, setShowCreateFile] = createSignal(false)
  const [showRename, setShowRename] = createSignal(false)
  const [renameItem, setRenameItem] = createSignal<FileItem | null>(null)
  const [moveTarget, setMoveTarget] = createSignal<FileItem | null>(null)
  const [showMoveDialog, setShowMoveDialog] = createSignal(false)
  const [copyTarget, setCopyTarget] = createSignal<FileItem | null>(null)
  const [showCopyDialog, setShowCopyDialog] = createSignal(false)
  const [newItemName, setNewItemName] = createSignal('')
  let externalUploadDragDepth = 0
  const [externalUploadDragOver, setExternalUploadDragOver] = createSignal(false)
  const [pasteData, setPasteData] = createSignal<PasteData | null>(null)
  const [showPasteDialog, setShowPasteDialog] = createSignal(false)
  const [inlineMode, setInlineMode] = createSignal<'file' | 'folder' | null>(null)
  const [inlineName, setInlineName] = createSignal('')
  const [directoryBackgroundMenu, setDirectoryBackgroundMenu] = createSignal<{
    x: number
    y: number
  } | null>(null)
  let inlineFileInputEl: HTMLInputElement | undefined
  let inlineFolderInputEl: HTMLInputElement | undefined
  let kbSearchInputEl: HTMLInputElement | undefined

  useInlineModeInputFocus(
    inlineMode,
    () => inlineFileInputEl,
    () => inlineFolderInputEl,
  )

  const fileRowMenu = useFileRowContextMenu({
    onDeleteRequest: (f) => setDeleteTarget(f),
  })

  createEffect(
    () => fileRowMenu.menu(),
    (menu) => {
      if (menu) setDirectoryBackgroundMenu(null)
    },
  )

  const isUploading = createMemo(() => uploadToast().kind === 'uploading')
  const invalidateContent = () =>
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminContent() })

  const deleteMutation = useMutation(() => ({
    mutationFn: (itemPath: string) => post('/api/files/delete', { path: itemPath }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
      invalidateContent()
    },
  }))

  const createFolderMutation = useMutation(() => ({
    mutationFn: (vars: { type: 'folder'; path: string }) => post('/api/files/create', vars),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
      invalidateContent()
    },
  }))

  const createFileMutation = useMutation(() => ({
    mutationFn: (vars: { type: 'file'; path: string; content: string }) =>
      post('/api/files/create', vars),
    onSuccess: (_d, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
      invalidateContent()
      viewFile(variables.path, currentPath())
    },
  }))

  const renameMutation = useMutation(() => ({
    mutationFn: (vars: { oldPath: string; newPath: string }) => post('/api/files/rename', vars),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
      invalidateContent()
    },
  }))

  const moveMutation = useMutation(() => ({
    mutationFn: (vars: { oldPath: string; newPath: string }) => post('/api/files/rename', vars),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
      invalidateContent()
    },
  }))

  const pasteMutation = useMutation(() => ({
    mutationFn: (vars: {
      path: string
      content?: string
      base64Content?: string
      mode: 'create' | 'replace'
      expectedVersion?: number
    }) =>
      post(vars.mode === 'replace' ? '/api/files/edit' : '/api/files/create', {
        ...(vars.mode === 'create' ? { type: 'file' as const } : {}),
        path: vars.path,
        content: vars.content,
        base64Content: vars.base64Content,
        expectedVersion: vars.expectedVersion,
      }),
    onSuccess: (_d, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
      invalidateContent()
      setShowPasteDialog(false)
      setPasteData(null)
      viewFile(variables.path, currentPath())
    },
  }))

  function closePasteDialog() {
    setShowPasteDialog(false)
    setPasteData(null)
    pasteMutation.reset()
  }

  async function handlePasteEvent(e: ClipboardEvent) {
    if (!isEditable()) return
    if (!shouldOfferPasteAsNewFile(e)) return
    e.preventDefault()
    const data = await extractPasteDataFromClipboardData(e.clipboardData, {
      textSuggestedExtension: inKb() ? 'md' : 'txt',
    })
    if (!data) return
    setPasteData(data)
    setShowPasteDialog(true)
  }

  function handlePasteFileSubmit(
    fileName: string,
    mode: 'create' | 'replace',
    expectedVersion?: number,
  ) {
    const pd = pasteData()
    if (!pd) return
    const rel = currentPath() ? `${currentPath()}/${fileName}` : fileName
    if (pd.type === 'image') {
      pasteMutation.mutate({ path: rel, base64Content: pd.content, mode, expectedVersion })
    } else if (pd.type === 'file') {
      if (pd.isTextContent) {
        pasteMutation.mutate({ path: rel, content: pd.content, mode, expectedVersion })
      } else {
        pasteMutation.mutate({ path: rel, base64Content: pd.content, mode, expectedVersion })
      }
    } else {
      pasteMutation.mutate({ path: rel, content: pd.content, mode, expectedVersion })
    }
  }

  function handleMoveFileFromDrag(sourcePath: string, destinationDir: string) {
    const fileName = sourcePath.split(/[/\\\\]/).pop()!
    const newPath = destinationDir ? `${destinationDir}/${fileName}` : fileName
    moveMutation.mutate({ oldPath: sourcePath, newPath })
  }

  const allowMoveFile = createMemo(() => (isEditable() ? handleMoveFileFromDrag : undefined))
  const dragController = createFileBrowserDragController({
    files,
    currentPath,
    editableFolders,
    allowMoveFile,
  })
  const {
    draggedPath,
    dragOverPath,
    enableDrag,
    canDropOnParent,
    parentRowDragOver,
    parentRowDragLeave,
    parentRowDrop,
    onFileDragStart,
    onFileDragEnd,
    handleFolderRowDragOver,
    handleFolderRowDragLeave,
    handleFolderRowDrop,
  } = dragController

  const copyMutation = useMutation(() => ({
    mutationFn: (vars: { sourcePath: string; destinationDir: string }) =>
      post('/api/files/copy', vars),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
    },
  }))

  const knowledgeBaseMutation = useMutation(() => ({
    mutationFn: (filePath: string) => post('/api/settings/knowledgeBase', { filePath }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
    },
  }))

  const setCustomIconMutation = useMutation(() => ({
    mutationFn: (vars: { path: string; iconName: string }) => post('/api/settings/icon', vars),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
    },
  }))

  const removeCustomIconMutation = useMutation(() => ({
    mutationFn: (path: string) => post('/api/settings/icon/remove', { path }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
    },
  }))

  const folderExists = createMemo(() => {
    const n = newItemName().trim()
    if (!n) return false
    return files().some((f) => f.isDirectory && f.name.toLowerCase() === n.toLowerCase())
  })

  const fileExists = createMemo(() => {
    const n = newItemName().trim()
    if (!n) return false
    const fileName = normalizeNewFilePath(n, inKb())
    return files().some((f) => !f.isDirectory && f.name.toLowerCase() === fileName.toLowerCase())
  })

  const showInlineCreate = createMemo(() => isEditable() && inKb())

  const inlineFileExists = createMemo(() => {
    if (inlineMode() !== 'file') return false
    const stem = inlineName().trim()
    if (!stem) return false
    const finalName = normalizeNewFilePath(stem, inKb())
    return files().some((f) => !f.isDirectory && f.name.toLowerCase() === finalName.toLowerCase())
  })

  const inlineFolderExists = createMemo(() => {
    if (inlineMode() !== 'folder') return false
    const n = inlineName().trim().toLowerCase()
    if (!n) return false
    return files().some((f) => f.isDirectory && f.name.toLowerCase() === n)
  })

  function submitInlineFile() {
    const stem = inlineName().trim()
    if (!stem || inlineFileExists() || !showInlineCreate()) return
    const base = currentPath() ? `${currentPath()}/${stem}` : stem
    const finalPath = normalizeNewFilePath(base, inKb())
    createFileMutation.mutate(
      { type: 'file', path: finalPath, content: '' },
      {
        onSuccess: () => {
          setInlineMode(null)
          setInlineName('')
          createFileMutation.reset()
        },
      },
    )
  }

  function submitInlineFolder() {
    const name = inlineName().trim()
    if (!name || inlineFolderExists() || !showInlineCreate()) return
    const folderPath = currentPath() ? `${currentPath()}/${name}` : name
    createFolderMutation.mutate(
      { type: 'folder', path: folderPath },
      {
        onSuccess: () => {
          setInlineMode(null)
          setInlineName('')
          createFolderMutation.reset()
          if (inKb()) navigateToFolder(folderPath)
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

  function openDirectoryBackgroundContextMenu(e: MouseEvent) {
    if (!showInlineCreate()) return
    const target = e.target
    if (!(target instanceof Element)) return
    if (target.closest('[data-file-path]')) return
    e.preventDefault()
    e.stopPropagation()
    fileRowMenu.dismiss()
    setDirectoryBackgroundMenu({ x: e.clientX, y: e.clientY })
  }

  const renameTargetExists = createMemo(() => {
    const n = newItemName().trim()
    const ed = renameItem()
    if (!n || !ed || renameMutation.isPending) return false
    return files().some((f) => f.path !== ed.path && f.name.toLowerCase() === n.toLowerCase())
  })

  const renameTargetIsDirectory = createMemo(() => {
    const ed = renameItem()
    if (!ed) return false
    return files().find((f) => f.path === ed.path)?.isDirectory ?? ed.isDirectory
  })

  const moveDialogTarget = createMemo(() => (showMoveDialog() ? moveTarget() : null))
  const copyDialogTarget = createMemo(() => (showCopyDialog() ? copyTarget() : null))

  async function uploadFilesToServer(files: File[], targetDir: string) {
    if (files.length === 0) return
    setUploadToast({ kind: 'uploading', fileCount: files.length })
    try {
      const formData = new FormData()
      formData.append('targetDir', targetDir)
      for (const file of files) {
        formData.append('files', file, file.name)
      }
      const res = await fetch('/api/files/upload', { method: 'POST', body: formData })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        const message = data?.error || `Upload failed (${res.status})`
        setUploadToast({ kind: 'error', message })
        return
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
      setUploadToast({ kind: 'success' })
      window.setTimeout(() => {
        setUploadToast({ kind: 'hidden' })
      }, 2000)
    } catch (err) {
      setUploadToast({
        kind: 'error',
        message: err instanceof Error ? err.message : 'Upload failed',
      })
    }
  }

  function isOsFileUploadDrag(e: globalThis.DragEvent) {
    const dtr = e.dataTransfer
    return !!(dtr && dtr.types.includes('Files') && !hasFileDragData(dtr))
  }

  function onExternalUploadDragEnter(e: globalThis.DragEvent) {
    if (!isEditable() || !isOsFileUploadDrag(e)) return
    e.preventDefault()
    externalUploadDragDepth++
    if (externalUploadDragDepth === 1) setExternalUploadDragOver(true)
  }

  function onExternalUploadDragLeave(e: globalThis.DragEvent) {
    if (!isEditable()) return
    e.preventDefault()
    externalUploadDragDepth--
    if (externalUploadDragDepth <= 0) {
      externalUploadDragDepth = 0
      setExternalUploadDragOver(false)
    }
  }

  function onExternalUploadDragOver(e: globalThis.DragEvent) {
    if (!isEditable() || !isOsFileUploadDrag(e)) return
    e.preventDefault()
    const dtr = e.dataTransfer
    if (dtr) dtr.dropEffect = 'copy'
  }

  async function onExternalUploadDrop(e: globalThis.DragEvent) {
    e.preventDefault()
    externalUploadDragDepth = 0
    setExternalUploadDragOver(false)
    if (!isEditable()) return
    const dtr = e.dataTransfer
    if (!dtr || dtr.files.length === 0) return
    const files = await collectDroppedUploadFiles(dtr)
    if (files.length > 0) void uploadFilesToServer(files, currentPath())
  }

  function handleParentDirectory() {
    if (isVirtualFolder()) {
      navigateToFolder(null)
      return
    }
    const parts = currentPath().split(/[/\\]/).filter(Boolean)
    if (parts.length > 0) {
      const parentPath = parts.slice(0, -1).join('/')
      navigateToFolder(parentPath || null)
    }
  }

  function handleBreadcrumbNavigate(path: string) {
    navigateToFolder(path || null)
  }

  function breadcrumbAsFolderItem(m: BreadcrumbMenuTarget): FileItem {
    const p = m.serverPath
    return {
      name: m.displayName,
      path: p,
      type: MediaType.FOLDER,
      size: 0,
      extension: '',
      isDirectory: true,
      isVirtual: isVirtualFolderPath(p),
    }
  }

  const breadcrumbMenuActions = createMemo(() => {
    const m = breadcrumbMenu()
    if (!m) {
      return { showOpenInNewTab: false, showOpenInOtherSurface: false, showSetIcon: false }
    }
    if (m.isHome) {
      return { showOpenInNewTab: true, showOpenInOtherSurface: true, showSetIcon: false }
    }
    const virt = isVirtualFolderPath(m.serverPath)
    return {
      showOpenInNewTab: !virt,
      showOpenInOtherSurface: !virt,
      showSetIcon: !virt,
    }
  })

  function handleBreadcrumbCrumbContextMenu(
    e: MouseEvent,
    info: { navigatePath: string; displayName: string; isHome: boolean },
  ) {
    setBreadcrumbFolderMenu({
      x: e.clientX,
      y: e.clientY,
      serverPath: info.navigatePath.replace(/\\/g, '/'),
      displayName: info.displayName,
      isHome: info.isHome,
    })
  }

  function handleBreadcrumbOpenInNewTab() {
    const m = breadcrumbMenu()
    if (!m) return
    if (m.isHome) {
      window.open(`${window.location.origin}${window.location.pathname || '/'}`, '_blank')
      return
    }
    handleContextOpenInNewTab(breadcrumbAsFolderItem(m))
  }

  function handleBreadcrumbOpenInOtherSurface() {
    const m = breadcrumbMenu()
    if (!m) return
    if (m.isHome) {
      window.open('/workspace', '_blank')
      return
    }
    handleContextOpenInOtherSurface(breadcrumbAsFolderItem(m))
  }

  function handleBreadcrumbSetIcon() {
    const m = breadcrumbMenu()
    if (!m || m.isHome || isVirtualFolderPath(m.serverPath)) return
    setIconEditTarget(breadcrumbAsFolderItem(m))
  }

  function handleContextDownload(file: FileItem) {
    const link = document.createElement('a')
    link.href = `/api/files/download?path=${encodeURIComponent(file.path)}`
    link.download = file.isDirectory ? `${file.name}.zip` : file.name
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  function handleContextOpenInNewTab(file: FileItem) {
    if (!file.isDirectory || file.isVirtual) return
    const params = new URLSearchParams()
    if (file.path) params.set('dir', file.path)
    const url = `${window.location.origin}${window.location.pathname || '/'}?${params.toString()}`
    window.open(url, '_blank')
  }

  function handleContextOpenInOtherSurface(file: FileItem) {
    if (!file.isDirectory || file.isVirtual) return
    const params = new URLSearchParams()
    if (file.path) params.set('dir', file.path)
    const query = params.toString()
    window.open(query ? `/workspace?${query}` : '/workspace', '_blank')
  }

  function handleContextToggleFavorite(file: FileItem) {
    favoriteMutation.mutate({ filePath: file.path })
  }

  function isRowFavorite(file: FileItem) {
    return favoriteSet().has(file.path)
  }

  function openCreateFolder() {
    setNewItemName('')
    createFolderMutation.reset()
    setShowCreateFolder(true)
  }

  function openCreateFile() {
    setNewItemName('')
    createFileMutation.reset()
    setShowCreateFile(true)
  }

  function submitCreateFolder() {
    const name = newItemName().trim()
    const folderPath = currentPath() ? `${currentPath()}/${name}` : name
    createFolderMutation.mutate(
      { type: 'folder', path: folderPath },
      {
        onSuccess: () => {
          setShowCreateFolder(false)
          setNewItemName('')
          createFolderMutation.reset()
        },
      },
    )
  }

  function submitCreateFile() {
    let filePath = newItemName().trim()
    if (!filePath) return
    filePath = currentPath() ? `${currentPath()}/${filePath}` : filePath
    filePath = normalizeNewFilePath(filePath, inKb())
    createFileMutation.mutate(
      { type: 'file', path: filePath, content: '' },
      {
        onSuccess: () => {
          setShowCreateFile(false)
          setNewItemName('')
          createFileMutation.reset()
        },
      },
    )
  }

  function handleContextRename(file: FileItem) {
    setRenameItem(file)
    setNewItemName(file.name)
    renameMutation.reset()
    setShowRename(true)
  }

  function submitRename() {
    const ed = renameItem()
    if (!ed) return
    const pathParts = ed.path.split(/[/\\]/).filter(Boolean)
    const parentPath = pathParts.slice(0, -1).join('/')
    const newPath = parentPath ? `${parentPath}/${newItemName().trim()}` : newItemName().trim()
    renameMutation.mutate(
      { oldPath: ed.path, newPath },
      {
        onSuccess: () => {
          setShowRename(false)
          setRenameItem(null)
          setNewItemName('')
          renameMutation.reset()
        },
      },
    )
  }

  function handleContextMove(file: FileItem) {
    setMoveTarget(file)
    moveMutation.reset()
    setShowMoveDialog(true)
  }

  function handleDialogMove(dest: string) {
    const t = moveTarget()
    if (!t) return
    const fileName = t.path.split(/[/\\]/).pop()!
    const normDest = dest.replace(/\\/g, '/').replace(/\/+$/, '')
    const newPath = normDest ? `${normDest}/${fileName}` : fileName
    const oldPath = t.path.replace(/\\/g, '/')
    moveMutation.mutate(
      { oldPath, newPath },
      {
        onSuccess: () => {
          setShowMoveDialog(false)
          setMoveTarget(null)
          moveMutation.reset()
        },
      },
    )
  }

  function handleContextCopyTo(file: FileItem) {
    setCopyTarget(file)
    copyMutation.reset()
    setShowCopyDialog(true)
  }

  function handleCopyToDestination(dest: string) {
    const t = copyTarget()
    if (!t) return
    copyMutation.mutate(
      { sourcePath: t.path, destinationDir: dest },
      {
        onSuccess: () => {
          setShowCopyDialog(false)
          setCopyTarget(null)
          copyMutation.reset()
        },
      },
    )
  }

  function fileBrowserPrefetchCtx(): PrefetchFolderHoverContext {
    return { queryClient, knowledgeBases: knowledgeBases() }
  }

  function handleFileClick(file: FileItem, sourceDir = currentPath()) {
    if (file.isDirectory) {
      navigateToFolder(file.path)
      return
    }

    viewStats.incrementView(file.path)
    const isMediaFile = file.type === MediaType.AUDIO || file.type === MediaType.VIDEO
    if (isMediaFile) {
      const item = playbackItemFromFileItem(file)
      if (!item) return
      const state = playbackSession.getSnapshot()
      if (
        state.currentItem &&
        playbackPathMatches(state.currentItem, item.locator) &&
        state.mode === item.media
      ) {
        playbackSession.dispatch({ type: 'toggle' })
      } else {
        playbackSession.dispatch({
          type: 'load',
          item,
          queue: playbackQueueFor(item),
          mode: item.media,
          autoplay: true,
        })
      }
      playFile(file.path, sourceDir)
    } else {
      viewFile(file.path, sourceDir)
    }
  }

  function handleLibrarySearchResult(result: FileSearchResult) {
    handleFileClick(fileSearchResultToFileItem(result), result.parentPath)
  }

  function setViewMode(mode: 'list' | 'grid') {
    useBrowserViewModeStore.getState().setViewMode(`admin-viewmode-${currentPath()}`, mode)
    viewModeMutation.mutate({ path: currentPath(), viewMode: mode })
  }

  function handleKbResultClick(filePath: string) {
    setSearchQuery('')
    setSearchPopoverOpen(false)
    viewFile(filePath, currentPath())
  }

  function handleContextToggleKnowledgeBase(file: FileItem) {
    knowledgeBaseMutation.mutate(file.path.replace(/\\/g, '/'))
  }

  function handleContextSetIcon(file: FileItem) {
    setIconEditTarget(file)
  }

  function handleSaveCustomIcon(iconName: string | null) {
    const t = iconEditTarget()
    if (!t) return
    const p = t.path.replace(/\\/g, '/')
    if (iconName) {
      void setCustomIconMutation.mutateAsync({ path: p, iconName })
    } else {
      void removeCustomIconMutation.mutateAsync(p)
    }
  }

  function isRowKnowledgeBase(file: FileItem) {
    return file.isDirectory && knowledgeBases().includes(file.path.replace(/\\/g, '/'))
  }

  const showKbSearchResults = createMemo(() => inKb() && searchQuery().trim().length > 0)
  const showEmptyFolder = createMemo(
    () =>
      !filesQuery.isError &&
      filesQuery.data !== undefined &&
      files().length === 0 &&
      !showKbSearchResults(),
  )

  return (
    <div class='min-h-screen bg-background'>
      <MainMediaPlayers editableFolders={editableFolders()} knowledgeBases={knowledgeBases()} />
      <div
        class={cn(
          isAudioPlayingBar() &&
            'max-[649px]:pb-[calc(2.875rem+env(safe-area-inset-bottom,0px))] min-[650px]:pb-12',
        )}
        data-testid='media-chrome-pad-root'
      >
        <div
          data-testid='file-browser'
          class='flex min-h-0 flex-1 flex-col'
          tabindex={0}
          title={
            isEditable() && inKb()
              ? 'Focus here and paste (Ctrl+V) to create a file from the clipboard.'
              : undefined
          }
          onPaste={(e) => void handlePasteEvent(e)}
        >
          <div class='container mx-auto lg:p-4'>
            <div class='ring-foreground/10 bg-card text-card-foreground flex flex-col gap-0 overflow-hidden rounded-none py-0 text-sm shadow-xs ring-1 lg:rounded-xl'>
              <div class='shrink-0 border-b border-border bg-muted/30 p-1.5 lg:p-2'>
                <div class='flex flex-wrap items-center justify-between w-full gap-1.5 lg:gap-2'>
                  <div
                    data-breadcrumb-slot
                    data-testid='breadcrumb-slot'
                    class='relative flex min-h-0 min-w-0 flex-1 overflow-hidden'
                  >
                    <Breadcrumbs
                      currentPath={currentPath()}
                      onNavigate={handleBreadcrumbNavigate}
                      onCrumbContextMenu={handleBreadcrumbCrumbContextMenu}
                    />
                  </div>
                  <Show when={inKb()}>
                    <div class='order-last flex basis-full items-center justify-end md:order-0 md:basis-auto md:justify-start'>
                      <button
                        type='button'
                        aria-label='Search note contents'
                        title='Search note contents (Ctrl+K)'
                        aria-pressed={searchPopoverOpen() ? 'true' : 'false'}
                        class={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent transition-colors ${
                          searchPopoverOpen()
                            ? 'bg-accent text-accent-foreground shadow-sm'
                            : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                        }`}
                        onClick={() => {
                          const open = !searchPopoverOpen()
                          setSearchPopoverOpen(open)
                          if (!open) {
                            setSearchQuery('')
                            setDebouncedSearch('')
                          }
                        }}
                      >
                        <BookOpenText class='h-4 w-4' aria-hidden='true' stroke-width={2} />
                      </button>
                    </div>
                  </Show>
                  <div class='flex items-center gap-1'>
                    <Show when={isEditable()}>
                      <button
                        type='button'
                        title='Create new folder'
                        aria-label='New folder'
                        class='inline-flex size-8 shrink-0 items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-muted hover:text-foreground dark:hover:bg-input/50'
                        onClick={() => openCreateFolder()}
                      >
                        <FolderPlus class='h-4 w-4' aria-hidden='true' stroke-width={2} />
                      </button>
                      <button
                        type='button'
                        title='Create new file'
                        aria-label='New file'
                        class='inline-flex size-8 shrink-0 items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-muted hover:text-foreground dark:hover:bg-input/50'
                        onClick={() => openCreateFile()}
                      >
                        <FilePlus class='h-4 w-4' aria-hidden='true' stroke-width={2} />
                      </button>
                      <UploadMenu
                        disabled={isUploading()}
                        onUpload={(files) => void uploadFilesToServer(files, currentPath())}
                      />
                    </Show>
                    <FileSearchButton
                      title='Search library'
                      testId='classic-file-search-trigger'
                      onSelect={handleLibrarySearchResult}
                    />
                    <ViewModeToggle viewMode={viewMode()} onChange={setViewMode} />
                    <ThemeSwitcher />
                  </div>
                </div>
                <Show when={inKb() && searchPopoverOpen()}>
                  <div class='pt-1.5' data-testid='kb-search-bar'>
                    <input
                      ref={(el) => {
                        kbSearchInputEl = el ?? undefined
                      }}
                      type='text'
                      placeholder='Search notes...'
                      autocomplete='off'
                      class='border-input bg-background focus-visible:ring-ring h-10 w-full rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none'
                      value={searchQuery()}
                      onInput={(e) => setSearchQuery(e.currentTarget.value)}
                    />
                  </div>
                </Show>
              </div>

              <div
                class='relative flex flex-col'
                data-testid='upload-drop-zone'
                onDragEnter={onExternalUploadDragEnter}
                onDragLeave={onExternalUploadDragLeave}
                onDragOver={onExternalUploadDragOver}
                onDrop={(e) => void onExternalUploadDrop(e)}
                onContextMenu={openDirectoryBackgroundContextMenu}
              >
                <div>
                  <PaneSwitch
                    kind={() => 'browser'}
                    browser={() => (
                      <FileExplorerView
                        files={files}
                        viewMode={viewMode}
                        includeParent={() => !!currentPath()}
                        scrollTarget={{ kind: 'window' }}
                        scrollScope={fileBrowserScrollScope}
                        loading={() => isFilesLoadingInitial()}
                        deferredLoading={showFilesDeferredLoading}
                        error={() => (filesQuery.isError ? filesQuery.error?.message : undefined)}
                        onRetry={() => void filesQuery.refetch()}
                        showEmpty={showEmptyFolder}
                        canUpload={isEditable}
                      >
                        <Show
                          when={showKbSearchResults()}
                          fallback={
                            <>
                              <Show when={inKb() && !!currentPath()}>
                                <KbDashboard
                                  scopePath={currentPath()}
                                  onFileClick={handleKbResultClick}
                                  recentDragCanMove={(p) =>
                                    !!allowMoveFile() && isPathEditable(p, editableFolders())
                                  }
                                />
                              </Show>
                              <Show when={!isFilesLoadingInitial()}>
                                <FileBrowserPane
                                  files={files}
                                  viewMode={viewMode}
                                  includeParent={() => !!currentPath()}
                                  scrollTarget={{ kind: 'window' }}
                                  scrollScope={fileBrowserScrollScope}
                                  gridContainerClass='py-4 px-4'
                                  listContainerClass='sm:px-4 py-2'
                                  gridClass='gap-4'
                                  listClass='relative w-full overflow-x-auto'
                                  listColSpan={4}
                                  listSizeColumnClass='w-28'
                                  showEmpty={showEmptyFolder}
                                  canUpload={isEditable}
                                  onParentClick={handleParentDirectory}
                                  onFileClick={handleFileClick}
                                  parentGridSubtitle={
                                    <p class='text-center text-xs text-muted-foreground'>
                                      Parent Folder
                                    </p>
                                  }
                                  parentGridAttributes={{
                                    onPointerEnter: () =>
                                      prefetchParentDirectoryHover(fileBrowserPrefetchCtx(), {
                                        currentPath: currentPath(),
                                        isVirtualFolder: isVirtualFolder(),
                                      }),
                                  }}
                                  parentRowAttributes={{
                                    class: cn(
                                      'border-b border-border transition-colors hover:bg-muted/50 cursor-pointer select-none',
                                      dragOverPath() === '__parent__' ? 'bg-primary/20' : '',
                                    ),
                                    onPointerEnter: () =>
                                      prefetchParentDirectoryHover(fileBrowserPrefetchCtx(), {
                                        currentPath: currentPath(),
                                        isVirtualFolder: isVirtualFolder(),
                                      }),
                                    onDragOver:
                                      allowMoveFile() && canDropOnParent()
                                        ? parentRowDragOver
                                        : undefined,
                                    onDragLeave:
                                      allowMoveFile() && canDropOnParent()
                                        ? parentRowDragLeave
                                        : undefined,
                                    onDrop:
                                      allowMoveFile() && canDropOnParent()
                                        ? parentRowDrop
                                        : undefined,
                                  }}
                                  fileGridAttributes={(file) => ({
                                    class: playingParam() === file.path ? 'bg-primary/10' : '',
                                    onPointerEnter: () =>
                                      prefetchFolderContentsOnHover(fileBrowserPrefetchCtx(), file),
                                    onContextMenu: (event) =>
                                      fileRowMenu.openRowContextMenu(event, file),
                                    ...createLongPressContextMenuHandlers(),
                                  })}
                                  fileRowAttributes={(file) => ({
                                    class: cn(
                                      playingParam() === file.path ? 'bg-primary/10' : '',
                                      file.isDirectory && dragOverPath() === file.path
                                        ? 'bg-primary/20'
                                        : '',
                                      draggedPath() === file.path ? 'opacity-50' : '',
                                    ),
                                    draggable: enableDrag() ? 'true' : 'false',
                                    onPointerEnter: () =>
                                      prefetchFolderContentsOnHover(fileBrowserPrefetchCtx(), file),
                                    onContextMenu: (event) =>
                                      fileRowMenu.openRowContextMenu(event, file),
                                    ...createLongPressContextMenuHandlers(),
                                    onDragStart: (event) => onFileDragStart(file, event),
                                    onDragEnd: onFileDragEnd,
                                    onDragOver: (event) => {
                                      if (!file.isDirectory || !allowMoveFile()) return
                                      handleFolderRowDragOver(file.path, event)
                                    },
                                    onDragLeave: (event) => {
                                      if (!file.isDirectory || !allowMoveFile()) return
                                      handleFolderRowDragLeave(file.path, event)
                                    },
                                    onDrop: (event) => {
                                      if (!file.isDirectory || !allowMoveFile()) return
                                      handleFolderRowDrop(file.path, event)
                                    },
                                  })}
                                  renderGridIcon={(file) => gridHeroIcon(file, fileIconCtx())}
                                  renderGridOverlay={(file) => {
                                    const isFav = () => favoriteSet().has(file.path)
                                    return (
                                      <>
                                        <button
                                          type='button'
                                          aria-label={'More actions for ' + file.name}
                                          class='absolute right-1.5 bottom-1.5 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm'
                                          onClick={(event) =>
                                            fileRowMenu.openRowMenuFromButton(event, file)
                                          }
                                        >
                                          <Ellipsis class='h-5 w-5' aria-hidden='true' />
                                        </button>
                                        <Show when={!file.isDirectory}>
                                          <button
                                            type='button'
                                            class={cn(
                                              'absolute top-1.5 left-1.5 z-10 rounded-full p-1 transition-all',
                                              isFav()
                                                ? 'bg-background/90 shadow-sm hover:bg-background'
                                                : 'bg-background/70 opacity-60 hover:bg-background/90 group-hover:opacity-100',
                                            )}
                                            title={
                                              isFav() ? 'Remove from favorites' : 'Add to favorites'
                                            }
                                            onClick={(event) => {
                                              event.stopPropagation()
                                              favoriteMutation.mutate({ filePath: file.path })
                                            }}
                                          >
                                            <Star
                                              class={cn(
                                                'h-3.5 w-3.5',
                                                isFav()
                                                  ? 'fill-yellow-400 text-yellow-400'
                                                  : 'text-muted-foreground',
                                              )}
                                              stroke-width={2}
                                            />
                                          </button>
                                        </Show>
                                        <Show when={!file.isDirectory}>
                                          <Show when={viewStats.getViewCount(file.path) > 0}>
                                            <div
                                              class='absolute top-1.5 right-1.5 z-10 flex items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 shadow-sm backdrop-blur-sm'
                                              title={viewStats.getViewCount(file.path) + ' views'}
                                            >
                                              <Eye
                                                class='h-3 w-3 text-muted-foreground'
                                                stroke-width={2}
                                              />
                                              <span class='text-xs font-medium text-muted-foreground'>
                                                {viewStats.getViewCount(file.path)}
                                              </span>
                                            </div>
                                          </Show>
                                        </Show>
                                      </>
                                    )
                                  }}
                                  renderGridDetails={(file) => (
                                    <div class='flex flex-col gap-1 p-3'>
                                      <p class='truncate text-sm font-medium' title={file.name}>
                                        {file.name}
                                      </p>
                                      <Show
                                        when={isVirtualFolder() && !file.isDirectory}
                                        fallback={
                                          <div class='flex items-center justify-end text-xs text-muted-foreground'>
                                            <span>
                                              {file.isDirectory ? '' : formatFileSize(file.size)}
                                            </span>
                                          </div>
                                        }
                                      >
                                        <p
                                          class='truncate text-xs text-muted-foreground'
                                          title={
                                            file.path.split(/[/\\]/).slice(0, -1).join('/') || '/'
                                          }
                                        >
                                          {file.path.split(/[/\\]/).slice(0, -1).join('/') || '/'}
                                        </p>
                                      </Show>
                                    </div>
                                  )}
                                  renderListIcon={(file) => (
                                    <span
                                      {...(isRowKnowledgeBase(file)
                                        ? { 'data-kb-root-icon': '' }
                                        : {})}
                                    >
                                      {fileItemIcon(file, fileIconCtx())}
                                    </span>
                                  )}
                                  renderListName={(file) => {
                                    const isFav = () => favoriteSet().has(file.path)
                                    return (
                                      <div class='flex items-center gap-2 min-w-0'>
                                        <Show when={!file.isDirectory}>
                                          <button
                                            type='button'
                                            class='shrink-0 opacity-50 hover:opacity-100 group-hover:opacity-100 transition-opacity inline-flex'
                                            title={
                                              isFav() ? 'Remove from favorites' : 'Add to favorites'
                                            }
                                            onClick={(event) => {
                                              event.stopPropagation()
                                              favoriteMutation.mutate({ filePath: file.path })
                                            }}
                                          >
                                            <Star
                                              class={cn(
                                                'h-4 w-4',
                                                isFav()
                                                  ? 'fill-yellow-400 text-yellow-400 opacity-100'
                                                  : 'text-muted-foreground',
                                              )}
                                              size={16}
                                              stroke-width={2}
                                            />
                                          </button>
                                        </Show>
                                        <div class='min-w-0 flex-1'>
                                          <span class='block truncate'>{file.name}</span>
                                          <Show when={isVirtualFolder() && !file.isDirectory}>
                                            <span class='block truncate text-xs text-muted-foreground'>
                                              {file.path.split(/[/\\]/).slice(0, -1).join('/') ||
                                                '/'}
                                            </span>
                                          </Show>
                                        </div>
                                      </div>
                                    )
                                  }}
                                  renderListMeta={(file) => (
                                    <div class='flex items-center justify-end gap-2'>
                                      <Show when={!file.isDirectory}>
                                        <Show when={viewStats.getViewCount(file.path) > 0}>
                                          <div
                                            class='flex items-center gap-1 text-xs'
                                            title={viewStats.getViewCount(file.path) + ' views'}
                                            data-testid='file-view-count'
                                          >
                                            <Eye class='h-3.5 w-3.5 shrink-0' stroke-width={2} />
                                            <span>{viewStats.getViewCount(file.path)}</span>
                                          </div>
                                        </Show>
                                      </Show>
                                      <span class='inline-block w-20 tabular-nums shrink-0'>
                                        {file.isDirectory ? '' : formatFileSize(file.size)}
                                      </span>
                                    </div>
                                  )}
                                  renderListActions={(file) => (
                                    <td class='p-1 align-middle'>
                                      <button
                                        type='button'
                                        aria-label={'More actions for ' + file.name}
                                        class='inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-muted'
                                        onClick={(event) =>
                                          fileRowMenu.openRowMenuFromButton(event, file)
                                        }
                                      >
                                        <Ellipsis class='h-5 w-5' aria-hidden='true' />
                                      </button>
                                    </td>
                                  )}
                                  renderParentRowEnd={() => <td />}
                                />
                              </Show>
                            </>
                          }
                        >
                          <KbSearchResults
                            results={kbSearchQuery.data?.results ?? []}
                            query={searchQuery()}
                            isLoading={kbSearchQuery.isLoading}
                            currentPath={currentPath()}
                            onResultClick={handleKbResultClick}
                          />
                        </Show>
                      </FileExplorerView>
                    )}
                  />
                </div>
                <Show when={showInlineCreate()}>
                  <KbInlineCreateFooter
                    inlineMode={inlineMode}
                    setInlineMode={setInlineMode}
                    inlineName={inlineName}
                    setInlineName={setInlineName}
                    inlineFileExists={inlineFileExists}
                    inlineFolderExists={inlineFolderExists}
                    createFilePending={() => createFileMutation.isPending}
                    createFileIsError={() => createFileMutation.isError}
                    createFileError={() => createFileMutation.error as Error | undefined}
                    createFolderPending={() => createFolderMutation.isPending}
                    createFolderIsError={() => createFolderMutation.isError}
                    createFolderError={() => createFolderMutation.error as Error | undefined}
                    submitInlineFile={submitInlineFile}
                    submitInlineFolder={submitInlineFolder}
                    resetInlineCreate={resetInlineCreate}
                    onFileInputRef={(el) => {
                      inlineFileInputEl = el
                    }}
                    onFolderInputRef={(el) => {
                      inlineFolderInputEl = el
                    }}
                  />
                </Show>
                <Show when={externalUploadDragOver()}>
                  <div class='pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10'>
                    <div class='text-primary flex flex-col items-center gap-2'>
                      <Upload class='h-10 w-10' stroke-width={2} />
                      <span class='text-lg font-medium'>Drop files to upload</span>
                    </div>
                  </div>
                </Show>
              </div>
            </div>
          </div>

          <DirectoryBackgroundContextMenu
            menu={directoryBackgroundMenu}
            onDismiss={() => setDirectoryBackgroundMenu(null)}
            onNewFile={openCreateFile}
            onNewFolder={openCreateFolder}
          />

          <FileBrowserModalLayer
            iconEditTarget={iconEditTarget}
            setIconEditTarget={setIconEditTarget}
            customIcons={customIcons}
            onSaveCustomIcon={handleSaveCustomIcon}
            setCustomIconPending={setCustomIconMutation.isPending}
            removeCustomIconPending={removeCustomIconMutation.isPending}
            uploadToast={uploadToast}
            setUploadToastHidden={() => setUploadToast({ kind: 'hidden' })}
            breadcrumbMenu={breadcrumbMenu}
            setBreadcrumbMenu={setBreadcrumbFolderMenu}
            breadcrumbMenuActions={breadcrumbMenuActions}
            onBreadcrumbOpenInNewTab={handleBreadcrumbOpenInNewTab}
            onBreadcrumbOpenInOtherSurface={handleBreadcrumbOpenInOtherSurface}
            otherSurfaceLabel='Open in Workspace'
            onBreadcrumbSetIcon={handleBreadcrumbSetIcon}
            fileRowMenu={fileRowMenu}
            editableFolders={editableFolders}
            isEditable={isEditable}
            hasEditableFolders={hasEditableFolders}
            onContextDownload={handleContextDownload}
            onContextOpenInNewTab={handleContextOpenInNewTab}
            onContextOpenInOtherSurface={handleContextOpenInOtherSurface}
            onContextOpenWithBrowser={handleFileClick}
            onContextOpenWithReader={openInReader}
            onContextToggleFavorite={handleContextToggleFavorite}
            isRowFavorite={isRowFavorite}
            onContextRename={handleContextRename}
            onContextMove={handleContextMove}
            onContextCopyTo={handleContextCopyTo}
            onContextSetIcon={handleContextSetIcon}
            onContextToggleKnowledgeBase={handleContextToggleKnowledgeBase}
            isRowKnowledgeBase={isRowKnowledgeBase}
            deleteTarget={deleteTarget}
            setDeleteTarget={setDeleteTarget}
            deletePending={deleteMutation.isPending}
            onConfirmDelete={() => {
              const it = deleteTarget()
              if (!it) return
              void deleteMutation.mutateAsync(it.path).then(() => setDeleteTarget(null))
            }}
            showCreateFolder={showCreateFolder}
            newItemName={newItemName}
            setNewItemName={setNewItemName}
            submitCreateFolder={submitCreateFolder}
            cancelCreateFolder={() => {
              setShowCreateFolder(false)
              setNewItemName('')
              createFolderMutation.reset()
            }}
            createFolderPending={createFolderMutation.isPending}
            createFolderError={(createFolderMutation.error as Error) ?? null}
            folderExists={folderExists}
            showCreateFile={showCreateFile}
            submitCreateFile={submitCreateFile}
            cancelCreateFile={() => {
              setShowCreateFile(false)
              setNewItemName('')
              createFileMutation.reset()
            }}
            createFilePending={createFileMutation.isPending}
            createFileError={(createFileMutation.error as Error) ?? null}
            fileExists={fileExists}
            inKb={inKb}
            showRename={showRename}
            renameItem={renameItem}
            newNameForRename={newItemName}
            setNewNameForRename={setNewItemName}
            submitRename={submitRename}
            cancelRename={() => {
              setShowRename(false)
              setRenameItem(null)
              setNewItemName('')
              renameMutation.reset()
            }}
            renamePending={renameMutation.isPending}
            renameError={(renameMutation.error as Error) ?? null}
            renameTargetExists={renameTargetExists}
            renameTargetIsDirectory={renameTargetIsDirectory}
            moveDialogTarget={moveDialogTarget}
            copyDialogTarget={copyDialogTarget}
            closeMoveDialog={() => {
              setShowMoveDialog(false)
              setMoveTarget(null)
              moveMutation.reset()
            }}
            closeCopyDialog={() => {
              setShowCopyDialog(false)
              setCopyTarget(null)
              copyMutation.reset()
            }}
            onDialogMove={handleDialogMove}
            onCopyToDestination={handleCopyToDestination}
            movePending={moveMutation.isPending}
            moveError={(moveMutation.error as Error) ?? null}
            copyPending={copyMutation.isPending}
            copyError={(copyMutation.error as Error) ?? null}
            editableFoldersList={editableFolders}
            showPasteDialog={showPasteDialog}
            pasteData={pasteData}
            pastePending={pasteMutation.isPending}
            pasteError={(pasteMutation.error as Error) ?? null}
            pasteExistingFiles={pasteExistingFiles}
            onPasteFileSubmit={handlePasteFileSubmit}
            closePasteDialog={closePasteDialog}
          />
          <FloatingScrollActions playingPath={playingPath} scrollScope={fileBrowserScrollScope} />
        </div>
      </div>
    </div>
  )
}
