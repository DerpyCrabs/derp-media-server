import { VIRTUAL_FOLDERS, isVirtualFolderPath } from '@/lib/files/constants'
import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import { preloadVideoIntrinsics } from '@/lib/media/video-intrinsics'
import {
  breadcrumbFloating,
  setBreadcrumbFolderMenu,
} from '@/features/explorer/breadcrumb-floating-store'
import { api, post } from '@/lib/api/client'
import {
  prefetchFolderContentsOnHover,
  prefetchParentDirectoryHover,
  type PrefetchFolderHoverContext,
} from '@/features/explorer/prefetch-folder-hover'
import { queryKeys } from '@/lib/api/query-keys'
import { fileDownloadHref } from '@/lib/files/download-urls'
import type { FileItem } from '@/lib/files/types'
import {
  hasVirtualCapability,
  virtualFileSizeVisible,
  virtualEntrySubtitle,
  type DirectoryListing,
  type VirtualEntry,
  type VirtualOpenTarget,
} from '@/lib/files/virtual-directory'
import { virtualAppearanceForPath } from './virtual-directory-appearance'
import { MediaType } from '@/lib/files/types'
import { normalizeNewFilePath } from '@/lib/files/new-file-name'
import { formatFileSize, getMediaType } from '@/lib/media/media-utils'
import { fileOpenTargetStore } from './file-open-target'
import { cn } from '@/lib/ui/cn'
import { isPathEditable } from '@/lib/files/path-utils'
import { For, Show, createEffect, createMemo, createSignal } from 'solid-js'
import type { BreadcrumbMenuTarget } from '@/features/explorer/BreadcrumbContextMenu'
import { DEFAULT_WINDOW_SOURCE } from '@/lib/models/window-model'
import { BrowserWindowModalLayer } from './BrowserWindowModalLayer'
import { modalDialogBackdropClass } from '@/features/explorer/modal-overlay-scope'
import { SOLID_AVAILABLE_ICONS } from '@/lib/ui/solid-available-icons'
import { sortFilesForPath } from '@/features/explorer/file-display-settings'
import { useFileBrowserController } from '@/features/explorer/use-file-browser-controller'
import {
  FileBrowserSurface,
  type FileBrowserSurfaceRows,
} from '@/features/explorer/FileBrowserSurface'
import { useFileRowContextMenu } from '@/features/explorer/use-file-row-context-menu'
import { useDeferredLoading } from '@/lib/ui/use-deferred-loading'
import { useStoreSync } from '@/lib/state/solid-store-sync'
import { useViewStats } from '@/features/explorer/use-view-stats'
import { fileItemIcon, gridHeroIcon } from '@/features/explorer/use-file-icon'
import { browserPaneParentDir } from './browser-pane-paths'
import type { BrowserWindowHostProps } from './browser-window-host-types'

export function BrowserWindowHost(props: BrowserWindowHostProps) {
  const queryClient = useQueryClient()
  const [deleteTarget, setDeleteTarget] = createSignal<FileItem | null>(null)
  const [unsupportedFile, setUnsupportedFile] = createSignal<FileItem | null>(null)
  const [showCreateFile, setShowCreateFile] = createSignal(false)
  const [newFileName, setNewFileName] = createSignal('')
  const [showCreateFolder, setShowCreateFolder] = createSignal(false)
  const [newFolderName, setNewFolderName] = createSignal('')
  const [directoryScrollEl, setDirectoryScrollEl] = createSignal<HTMLDivElement | undefined>()
  const [showRename, setShowRename] = createSignal(false)
  const [renamingItem, setRenamingItem] = createSignal<FileItem | null>(null)
  const [renameNewName, setRenameNewName] = createSignal('')
  const [moveTarget, setMoveTarget] = createSignal<FileItem | null>(null)
  const [iconEditTarget, setIconEditTarget] = createSignal<FileItem | null>(null)
  const [virtualOffset, setVirtualOffset] = createSignal(0)
  const [virtualRefreshEnabled, setVirtualRefreshEnabled] = createSignal(false)
  const [virtualPages, setVirtualPages] = createSignal<DirectoryListing[]>([])
  const [projectPrimaryPath, setProjectPrimaryPath] = createSignal('')
  const [projectAdditionalPaths, setProjectAdditionalPaths] = createSignal('')
  const [gatewayPickerPath, setGatewayPickerPath] = createSignal('')
  const [virtualDetail, setVirtualDetail] = createSignal<{
    file: FileItem
    entry: VirtualEntry
  } | null>(null)
  const [virtualDeleteAction, setVirtualDeleteAction] = createSignal<
    'deletePermanently' | 'deleteProject' | null
  >(null)
  const [virtualActionDialog, setVirtualActionDialog] = createSignal<{
    action:
      | 'moveToProject'
      | 'addProjectFolder'
      | 'removeProjectFolder'
      | 'setPrimaryFolder'
      | 'setAppearance'
    file: FileItem
    entry?: VirtualEntry
  } | null>(null)
  const [virtualActionValue, setVirtualActionValue] = createSignal('')
  const [virtualAppearanceIcon, setVirtualAppearanceIcon] = createSignal('Folder')
  const [virtualAppearanceColor, setVirtualAppearanceColor] = createSignal('')
  const [virtualProjectChoices, setVirtualProjectChoices] = createSignal<
    { name: string; path: string }[]
  >([])
  const [virtualProjectChoicesLoading, setVirtualProjectChoicesLoading] = createSignal(false)
  const breadcrumbMenu = () => breadcrumbFloating.folderMenu

  const win = createMemo(() => props.windowState()?.windows.find((w) => w.id === props.windowId))

  const fileOpenTargetTick = useStoreSync(fileOpenTargetStore)
  const fileOpenMode = () => {
    void fileOpenTargetTick()
    return fileOpenTargetStore.getState().target
  }
  const currentPath = createMemo(() => win()?.initialState?.dir ?? '')

  const listDir = currentPath
  const viewStats = useViewStats()

  const filesQuery = useQuery(() => {
    return {
      queryKey: [...queryKeys.files(listDir()), virtualOffset()],
      queryFn: () =>
        api<DirectoryListing>(
          `/api/files?surface=workspace&dir=${encodeURIComponent(listDir())}&offset=${virtualOffset()}`,
        ),
      refetchInterval: virtualRefreshEnabled() ? 5_000 : false,
    }
  })

  createEffect(
    () => currentPath(),
    () => {
      setVirtualOffset(0)
      setVirtualPages([])
      setVirtualRefreshEnabled(false)
    },
  )
  createEffect(
    () => {
      const page = filesQuery.data
      return page ? { page, offset: virtualOffset() } : null
    },
    (next) => {
      if (!next) return
      const pageOffset = next.page.virtualDirectory?.offset ?? 0
      if (pageOffset !== next.offset) return
      setVirtualRefreshEnabled(!!next.page.virtualDirectory)
      setVirtualPages((current) =>
        next.offset === 0
          ? [next.page]
          : [
              ...current.filter((value) => value.virtualDirectory?.offset !== next.offset),
              next.page,
            ],
      )
    },
  )
  const listing = createMemo(() => filesQuery.data)
  const files = createMemo(() => {
    const pages = virtualPages()
    if (pages.length <= 1) return listing()?.files ?? []
    const seen = new Set<string>()
    return pages
      .flatMap((page) => page.files)
      .filter((file) => !seen.has(file.path) && !!seen.add(file.path))
  })
  const virtualDirectory = createMemo(() => listing()?.virtualDirectory)
  const virtualEntries = createMemo(
    () =>
      Object.assign({}, ...virtualPages().map((page) => page.virtualEntries ?? {})) as Record<
        string,
        VirtualEntry
      >,
  )
  const virtualEntry = (file: FileItem) => virtualEntries()[file.path]
  const isFilesLoadingInitial = createMemo(
    () => filesQuery.isPending && filesQuery.data === undefined,
  )
  const showFilesDeferredLoading = useDeferredLoading(() => isFilesLoadingInitial())

  const isVirtualFolder = createMemo(() =>
    (Object.values(VIRTUAL_FOLDERS) as string[]).includes(currentPath()),
  )

  const isAdminPaneEditable = createMemo(
    () =>
      !isVirtualFolder() &&
      !virtualDirectory() &&
      isPathEditable(currentPath(), props.editableFolders),
  )
  const isContextDirEditable = createMemo(() => isAdminPaneEditable())
  const isActivePane = createMemo(() => props.windowState()?.activeWindowId === props.windowId)

  const browser = useFileBrowserController({
    currentPath,
    files,
    editable: isAdminPaneEditable,
    editableFolders: () => props.editableFolders,
    isActive: isActivePane,
    virtualEntry,
    onFileSaved: (path) => props.onOpenViewer(props.windowId, fileItemFromPath(path)),
    onInlineFileCreated: (path) => props.onOpenViewer(props.windowId, fileItemFromPath(path)),
    onInlineFolderCreated: (path) => props.onNavigateDir(props.windowId, path),
  })
  const {
    settingsQuery,
    knowledgeBases,
    customIcons,
    inKb,
    clearSearch,
    showKbSearchResults,
    uploadToast,
    setUploadError,
    setUploadToastHidden,
    pasteData,
    showPasteDialog,
    pasteExistingFiles,
    handlePasteFileSubmit,
    closePasteDialog,
    renameMutation,
    moveMutation,
    createFileMutation,
    createFolderMutation,
    pasteMutation,
    deleteMutation,
    viewModeMutation,
    knowledgeBaseMutation,
    setCustomIconMutation,
    removeCustomIconMutation,
  } = browser

  function invalidateKbQueries() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminContent() })
  }

  const gatewayDirectoryQuery = useQuery(() => ({
    queryKey: ['virtual-directory', 'gateway-fs', gatewayPickerPath()],
    queryFn: () =>
      api<{ entries: { name: string; path: string; isDirectory: boolean }[]; error?: string }>(
        `/api/virtual-directory/fs?path=${encodeURIComponent(gatewayPickerPath())}`,
      ),
    enabled: showCreateFolder() && hasVirtualCapability(virtualDirectory(), 'createFolder'),
  }))

  const virtualDetailQuery = useQuery(() => ({
    queryKey: ['virtual-directory', 'open', virtualDetail()?.file.path],
    queryFn: () =>
      api<{ session: Record<string, unknown>; messages: unknown }>(
        `/api/virtual-directory/open?path=${encodeURIComponent(virtualDetail()!.file.path)}`,
      ),
    enabled: virtualDetail()?.entry.kind === 'session',
  }))

  function isRowKnowledgeBase(file: FileItem) {
    return file.isDirectory && knowledgeBases().includes(file.path.replace(/\\/g, '/'))
  }

  const virtualActionMutation = useMutation(() => ({
    mutationFn: (body: {
      action: string
      path: string
      name?: string
      metadata?: Record<string, unknown>
    }) => post<{ openTarget?: VirtualOpenTarget }>('/api/virtual-directory/action', body),
    onSettled: () => {
      setVirtualOffset(0)
      setVirtualPages([])
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
      invalidateKbQueries()
    },
  }))

  const viewMode = createMemo(() => {
    const s = settingsQuery.data
    return s?.viewModes?.[currentPath()] ?? 'list'
  })

  const sortingDisabled = createMemo(() => isVirtualFolder() || !!virtualDirectory())
  const displayedFiles = createMemo(() =>
    sortFilesForPath(files(), currentPath(), settingsQuery.data?.sortOrders, sortingDisabled()),
  )

  const showEmptyFolder = createMemo(
    () =>
      !filesQuery.isError &&
      filesQuery.data !== undefined &&
      files().length === 0 &&
      !showKbSearchResults(),
  )

  const showAdminCreateToolbar = isAdminPaneEditable
  const allowUpload = createMemo(() => showAdminCreateToolbar())

  const fileRowMenu = useFileRowContextMenu({
    onDeleteRequest: (f) => setDeleteTarget(f),
  })

  function handleContextToggleKnowledgeBase(file: FileItem) {
    knowledgeBaseMutation.mutate(file.path.replace(/\\/g, '/'))
  }

  const renameTargetExists = createMemo(() => {
    const item = renamingItem()
    const name = renameNewName().trim()
    if (!item || !name || renameMutation.isPending) return false
    const entry = virtualEntry(item)
    if (entry?.kind === 'session') return false
    if (entry?.kind === 'project') {
      if (name.toLowerCase() === 'archived') return true
      return files().some(
        (file) =>
          file.path !== item.path &&
          virtualEntry(file)?.kind === 'project' &&
          file.name.toLowerCase() === name.toLowerCase(),
      )
    }
    return files().some((f) => f.path !== item.path && f.name.toLowerCase() === name.toLowerCase())
  })

  function openContextRename(file: FileItem) {
    setRenamingItem(file)
    setRenameNewName(file.name)
    setShowRename(true)
  }

  function handleVirtualAction(
    action: import('@/lib/files/virtual-directory').VirtualCapability,
    file: FileItem,
  ) {
    if (action === 'rename') {
      openContextRename(file)
      return
    }
    const entry = virtualEntry(file)
    if (action === 'copyId') {
      if (entry?.id) void navigator.clipboard.writeText(entry.id)
      return
    }
    if (action === 'moveToProject') {
      setVirtualActionDialog({ action, file, entry })
      setVirtualActionValue('')
      setVirtualProjectChoices([])
      setVirtualProjectChoicesLoading(true)
      virtualActionMutation.reset()
      const virtualRoot = currentPath().split(/[/\\]/).filter(Boolean)[0] ?? ''
      void api<DirectoryListing>(
        `/api/files?surface=workspace&dir=${encodeURIComponent(virtualRoot)}&offset=0`,
      )
        .then((result) => {
          const choices = result.files
            .filter((candidate) => result.virtualEntries?.[candidate.path]?.kind === 'project')
            .map((candidate) => ({ name: candidate.name, path: candidate.path }))
          setVirtualProjectChoices(choices)
          if (choices[0]) setVirtualActionValue(choices[0].name)
        })
        .catch((error) =>
          setUploadError(error instanceof Error ? error.message : 'Could not load Hermes projects'),
        )
        .finally(() => setVirtualProjectChoicesLoading(false))
      return
    }
    if (action === 'addProjectFolder') {
      setVirtualActionDialog({ action, file, entry })
      setVirtualActionValue('')
      virtualActionMutation.reset()
      return
    }
    if (action === 'removeProjectFolder' || action === 'setPrimaryFolder') {
      const folders = virtualProjectFolders(entry)
      setVirtualActionDialog({ action, file, entry })
      setVirtualActionValue(folders[0] ?? '')
      virtualActionMutation.reset()
      return
    }
    if (action === 'setAppearance') {
      setVirtualActionDialog({ action, file, entry })
      const icon = entry?.metadata?.icon
      const color = entry?.metadata?.color
      setVirtualAppearanceIcon(typeof icon === 'string' ? icon : 'Folder')
      setVirtualAppearanceColor(typeof color === 'string' ? color : '')
      virtualActionMutation.reset()
      return
    }
    if (action === 'branch') {
      const windowId = props.windowId
      const onOpenVirtualTarget = props.onOpenVirtualTarget
      void virtualActionMutation.mutateAsync({ action, path: file.path }).then((result) => {
        if (!result.openTarget) return
        const branch: FileItem = {
          ...file,
          name: `${file.name} branch`,
          path: `virtual-branch-${Date.now()}`,
        }
        onOpenVirtualTarget?.(windowId, branch, result.openTarget)
      })
      return
    }
    if (action === 'deletePermanently' || action === 'deleteProject') {
      setVirtualDeleteAction(action)
      setDeleteTarget(file)
      return
    }
    void virtualActionMutation.mutateAsync({ action, path: file.path })
  }

  function virtualProjectFolders(entry?: VirtualEntry): string[] {
    const metadata = entry?.metadata ?? {}
    const folders = Array.isArray(metadata.folders) ? metadata.folders : []
    const paths = folders.flatMap((folder) => {
      if (typeof folder === 'string') return [folder]
      if (
        folder &&
        typeof folder === 'object' &&
        typeof (folder as { path?: unknown }).path === 'string'
      ) {
        return [(folder as { path: string }).path]
      }
      return []
    })
    const primary =
      typeof metadata.primary_path === 'string'
        ? metadata.primary_path
        : typeof metadata.primaryPath === 'string'
          ? metadata.primaryPath
          : ''
    return [...new Set([primary, ...paths].filter(Boolean))]
  }

  function submitVirtualActionDialog() {
    const dialog = virtualActionDialog()
    if (!dialog) return
    const value = virtualActionValue().trim()
    const body =
      dialog.action === 'setAppearance'
        ? {
            action: dialog.action,
            path: dialog.file.path,
            metadata: { icon: virtualAppearanceIcon(), color: virtualAppearanceColor() },
          }
        : { action: dialog.action, path: dialog.file.path, name: value }
    if (dialog.action !== 'setAppearance' && !value) return
    void virtualActionMutation.mutateAsync(body).then(() => setVirtualActionDialog(null))
  }

  function cancelRename() {
    setShowRename(false)
    setRenamingItem(null)
    setRenameNewName('')
    renameMutation.reset()
  }

  function submitRename() {
    const item = renamingItem()
    const newName = renameNewName().trim()
    if (!item || !newName || newName === item.name || renameTargetExists()) return
    const entry = virtualEntry(item)
    if (entry && hasVirtualCapability(entry, 'rename')) {
      void virtualActionMutation
        .mutateAsync({ action: 'rename', path: item.path, name: newName })
        .then(cancelRename)
      return
    }
    const oldPath = item.path.replace(/\\/g, '/')
    const par = browserPaneParentDir(oldPath)
    const newPath = par ? `${par}/${newName}` : newName
    renameMutation.mutate({ oldPath, newPath }, { onSuccess: () => cancelRename() })
  }

  function openContextMove(file: FileItem) {
    setMoveTarget(file)
    moveMutation.reset()
  }

  function closeMoveDialog() {
    setMoveTarget(null)
    moveMutation.reset()
  }

  function confirmMoveTo(destinationDir: string) {
    const target = moveTarget()
    if (!target) return
    const fileName = target.path.split(/[/\\]/).pop()!
    const newPath = destinationDir ? `${destinationDir}/${fileName}` : fileName
    moveMutation.mutate({ oldPath: target.path, newPath }, { onSuccess: () => closeMoveDialog() })
  }

  const moveDialogFilePath = createMemo(() => {
    const t = moveTarget()
    if (!t) return ''
    return t.path
  })

  createEffect(
    () => currentPath(),
    () => {
      setUnsupportedFile(null)
    },
  )

  function setViewMode(mode: 'list' | 'grid') {
    viewModeMutation.mutate({ path: currentPath(), viewMode: mode })
  }

  function unsupportedDownloadHref(file: FileItem) {
    return fileDownloadHref(file.path)
  }

  function handleContextDownload(file: FileItem) {
    const entry = virtualEntry(file)
    if (entry && hasVirtualCapability(entry, 'download')) {
      const link = document.createElement('a')
      link.href = `/api/virtual-directory/export?path=${encodeURIComponent(file.path)}`
      link.download = `${file.name}.json`
      link.click()
      return
    }
    const link = document.createElement('a')
    link.href = fileDownloadHref(file.path)
    link.download = file.isDirectory ? `${file.name}.zip` : file.name
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  function openDirectoryInOtherSurface(file: FileItem) {
    if (!file.isDirectory || file.isVirtual) return
    const params = new URLSearchParams()
    if (file.path) params.set('dir', file.path)
    const query = params.toString()
    window.open(query ? `/?${query}` : '/', '_blank')
  }

  function handleBreadcrumbNavigate(path: string) {
    props.onNavigateDir(props.windowId, path)
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

  function handleBreadcrumbContextMenu(
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
      window.open('/', '_blank')
      return
    }
    const item = breadcrumbAsFolderItem(m)
    if (!item.isDirectory || item.isVirtual) return
    if (props.onOpenInNewTab) {
      props.onOpenInNewTab(
        props.windowId,
        { path: item.path, isDirectory: true, isVirtual: item.isVirtual },
        currentPath(),
      )
      return
    }
    const params = new URLSearchParams()
    if (item.path) params.set('dir', item.path)
    window.open(`/?${params.toString()}`, '_blank')
  }

  function handleBreadcrumbOpenInOtherSurface() {
    const m = breadcrumbMenu()
    if (!m) return
    if (m.isHome) {
      window.open('/', '_blank')
      return
    }
    const item = breadcrumbAsFolderItem(m)
    if (!item.isDirectory || item.isVirtual) return
    const params = new URLSearchParams()
    if (item.path) params.set('dir', item.path)
    const q = params.toString()
    window.open(q ? `/?${q}` : '/', '_blank')
  }

  function handleBreadcrumbSetIcon() {
    const m = breadcrumbMenu()
    if (!m || m.isHome || isVirtualFolderPath(m.serverPath)) return
    setIconEditTarget(breadcrumbAsFolderItem(m))
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

  function openInNewTabFromRow(file: FileItem) {
    if (!props.onOpenInNewTab) return
    props.onOpenInNewTab(
      props.windowId,
      { path: file.path, isDirectory: file.isDirectory, isVirtual: file.isVirtual },
      currentPath(),
    )
  }

  function openFileInNewWindowFromRow(file: FileItem) {
    if (file.isDirectory || !props.onOpenFileInNewFloatingWindow) return
    props.onOpenFileInNewFloatingWindow(props.windowId, file)
  }

  function openInSplitViewFromRow(file: FileItem) {
    props.onOpenInSplitView?.(props.windowId, file)
  }

  function openWithBrowser(file: FileItem) {
    if (file.isDirectory) props.onNavigateDir(props.windowId, file.path)
    else props.onOpenViewer(props.windowId, file)
  }

  function openWithReader(file: FileItem) {
    props.onOpenReader(props.windowId, file)
  }

  function openCreateFileDialog() {
    if (hasVirtualCapability(virtualDirectory(), 'createFile')) {
      const windowId = props.windowId
      const onOpenVirtualTarget = props.onOpenVirtualTarget
      void virtualActionMutation
        .mutateAsync({ action: 'createFile', path: currentPath() })
        .then((result) => {
          if (!result.openTarget) return
          const draft: FileItem = {
            name: 'Untitled session',
            path: `virtual-draft-${Date.now()}`,
            type: MediaType.OTHER,
            size: 0,
            extension: '',
            isDirectory: false,
            isVirtual: true,
          }
          onOpenVirtualTarget?.(windowId, draft, result.openTarget)
          if (!onOpenVirtualTarget) {
            setVirtualDetail({
              file: draft,
              entry: {
                provider: 'hermes',
                kind: 'draft',
                capabilities: [],
                openTarget: result.openTarget,
              },
            })
          }
        })
      return
    }
    setNewFileName('')
    setShowCreateFile(true)
  }

  function openCreateFolderDialog() {
    setProjectPrimaryPath('')
    setProjectAdditionalPaths('')
    setGatewayPickerPath('')
    setNewFolderName('')
    setShowCreateFolder(true)
  }

  function submitCreateFile() {
    const name = newFileName().trim()
    if (!name || fileExists()) return
    const base = currentPath() ? `${currentPath()}/${name}` : name
    const finalPath = normalizeNewFilePath(base, inKb())
    void createFileMutation.mutateAsync({ path: finalPath, content: '' }).then(() => {
      setShowCreateFile(false)
      setNewFileName('')
    })
  }

  function submitCreateFolder() {
    const name = newFolderName().trim()
    if (!name || folderExists()) return
    if (hasVirtualCapability(virtualDirectory(), 'createFolder')) {
      const primaryPath = projectPrimaryPath().trim()
      if (!primaryPath) return
      const folders = [
        primaryPath,
        ...projectAdditionalPaths()
          .split(/\r?\n/)
          .map((value) => value.trim())
          .filter(Boolean),
      ]
      void virtualActionMutation
        .mutateAsync({
          action: 'createFolder',
          path: currentPath(),
          name,
          metadata: { primaryPath, folders },
        })
        .then(() => setShowCreateFolder(false))
      return
    }
    const base = currentPath() ? `${currentPath()}/${name}` : name
    void createFolderMutation.mutateAsync({ path: base }).then(() => {
      setShowCreateFolder(false)
      setNewFolderName('')
    })
  }

  const fileExists = createMemo(() => {
    const stem = newFileName().trim()
    if (!stem) return false
    const finalName = normalizeNewFilePath(stem, inKb())
    const fl = finalName.toLowerCase()
    const st = stem.toLowerCase()
    return files().some(
      (f) => !f.isDirectory && (f.name.toLowerCase() === fl || f.name.toLowerCase() === st),
    )
  })

  const folderExists = createMemo(() => {
    const n = newFolderName().trim().toLowerCase()
    if (!n) return false
    return files().some((f) => f.isDirectory && f.name.toLowerCase() === n)
  })

  function fileItemFromPath(filePath: string, displayName?: string): FileItem {
    const name = displayName ?? filePath.split(/[/\\]/).filter(Boolean).pop() ?? 'file'
    const lower = name.toLowerCase()
    const ext = lower.includes('.') ? (lower.split('.').pop() ?? '') : ''
    return {
      path: filePath,
      name,
      isDirectory: false,
      size: 0,
      extension: ext,
      type: getMediaType(ext),
    }
  }

  function handleKbResultClick(filePath: string, displayName?: string) {
    clearSearch()
    props.onOpenViewer(props.windowId, fileItemFromPath(filePath, displayName))
  }

  function prefetchContext(): PrefetchFolderHoverContext {
    return { queryClient, knowledgeBases: knowledgeBases() }
  }

  function prefetchFileRowHover(file: FileItem) {
    prefetchFolderContentsOnHover(prefetchContext(), file)
    if (file.type !== MediaType.VIDEO) return
    const paneWin = win()
    if (!paneWin) return
    preloadVideoIntrinsics(paneWin.source, file.path)
  }

  function handleParentDirectory() {
    props.onNavigateDir(props.windowId, browserPaneParentDir(currentPath()))
  }

  function handleFileClick(file: FileItem, sourceDir = currentPath()) {
    if (file.isDirectory) {
      setUnsupportedFile(null)
      props.onNavigateDir(props.windowId, file.path)
      return
    }
    const entry = virtualEntry(file)
    if (entry?.openTarget) {
      setUnsupportedFile(null)
      if (props.onOpenVirtualTarget)
        props.onOpenVirtualTarget(props.windowId, file, entry.openTarget)
      else setVirtualDetail({ file, entry })
      return
    }
    viewStats.incrementView(file.path)
    const mt = file.type
    if (mt === MediaType.AUDIO || mt === MediaType.VIDEO) {
      const wdef = props.windowState()?.windows.find((x) => x.id === props.windowId)
      const src = wdef?.source ?? DEFAULT_WINDOW_SOURCE
      props.onRequestPlay?.(src, file.path, sourceDir || undefined)
      return
    }
    if (mt === MediaType.OTHER) {
      setUnsupportedFile(file)
      return
    }
    setUnsupportedFile(null)
    props.onOpenViewer(props.windowId, file)
  }

  createEffect(
    () => !!unsupportedFile(),
    (isOpen) => {
      if (!isOpen) return undefined
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setUnsupportedFile(null)
      }
      window.addEventListener('keydown', onKey)
      // eslint-disable-next-line solid/reactivity
      return () => window.removeEventListener('keydown', onKey)
    },
  )

  const surfaceRows: FileBrowserSurfaceRows = {
    onParentPointerEnter: () =>
      prefetchParentDirectoryHover(prefetchContext(), {
        currentPath: currentPath(),
        isVirtualFolder: isVirtualFolder(),
      }),
    onFilePointerEnter: prefetchFileRowHover,
    renderGridIcon: (file) =>
      gridHeroIcon(
        file,
        props.fileIconContext(),
        virtualEntry(file)?.appearance ?? virtualAppearanceForPath(file.path),
      ),
    renderGridDetails: (file) => (
      <div class='flex flex-col gap-1 p-3'>
        <p class='truncate text-sm font-medium' title={file.name}>
          {file.name}
        </p>
        <div class='flex items-center justify-between gap-2 text-xs text-muted-foreground'>
          <span class='truncate'>{virtualEntrySubtitle(virtualEntry(file))}</span>
          <span>
            {virtualFileSizeVisible(file, virtualEntry(file)) ? formatFileSize(file.size) : ''}
          </span>
        </div>
      </div>
    ),
    renderListIcon: (file) =>
      fileItemIcon(
        file,
        props.fileIconContext(),
        'md',
        virtualEntry(file)?.appearance ?? virtualAppearanceForPath(file.path),
      ),
    renderListName: (file) => (
      <div class='min-w-0'>
        <div class='truncate'>{file.name}</div>
        <Show when={virtualEntrySubtitle(virtualEntry(file))}>
          <div class='truncate text-[11px] font-normal text-muted-foreground'>
            {virtualEntrySubtitle(virtualEntry(file))}
          </div>
        </Show>
      </div>
    ),
    renderListSize: (file) => (
      <span class='inline-block w-20 tabular-nums'>
        {virtualFileSizeVisible(file, virtualEntry(file)) ? formatFileSize(file.size) : ''}
      </span>
    ),
    dragGrid: true,
    highlightGridDrop: true,
  }

  return (
    <FileBrowserSurface
      layout='workspace'
      controller={browser}
      currentPath={currentPath}
      files={files}
      displayedFiles={displayedFiles}
      viewMode={viewMode}
      isVirtualFolder={isVirtualFolder}
      sortingDisabled={sortingDisabled}
      isFilesLoadingInitial={isFilesLoadingInitial}
      showFilesDeferredLoading={showFilesDeferredLoading}
      error={() => (filesQuery.isError ? filesQuery.error?.message : undefined)}
      onRetry={() => void filesQuery.refetch()}
      showEmpty={showEmptyFolder}
      scrollTarget={{ kind: 'element', getScrollElement: directoryScrollEl }}
      scrollScope={undefined}
      setScrollElement={setDirectoryScrollEl}
      onScroll={(event) => {
        const el = event.currentTarget
        const next = listing()?.virtualDirectory?.nextOffset
        if (next === undefined || filesQuery.isFetching) return
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 320) setVirtualOffset(next)
      }}
      onParentClick={handleParentDirectory}
      onFileClick={handleFileClick}
      onViewModeChange={setViewMode}
      onBreadcrumbNavigate={handleBreadcrumbNavigate}
      onBreadcrumbContextMenu={handleBreadcrumbContextMenu}
      onKbResultClick={handleKbResultClick}
      recentDragCanMove={(path) =>
        !!browser.allowMoveFile() && isPathEditable(path, props.editableFolders)
      }
      canUpload={allowUpload}
      toolbar={{
        canCreate: showAdminCreateToolbar,
        onCreateFolder: openCreateFolderDialog,
        onCreateFile: openCreateFileDialog,
        virtualCreate: {
          canCreateFolder: () => hasVirtualCapability(virtualDirectory(), 'createFolder'),
          canCreateFile: () => hasVirtualCapability(virtualDirectory(), 'createFile'),
          onCreateFolder: openCreateFolderDialog,
          onCreateFile: openCreateFileDialog,
        },
      }}
      fileRowMenu={fileRowMenu}
      noWindowDrag
      rows={surfaceRows}
    >
      <>
        <Show when={unsupportedFile()} keyed>
          {(file) => (
            <div
              data-no-window-drag
              class='bg-background/85 absolute inset-0 z-20 flex items-center justify-center p-4 backdrop-blur-sm'
              role='presentation'
              onClick={(e) => e.target === e.currentTarget && setUnsupportedFile(null)}
            >
              <div
                class='bg-card border-border w-full max-w-sm rounded-lg border p-6 shadow-lg'
                role='dialog'
                aria-modal='true'
                onClick={(e) => e.stopPropagation()}
              >
                <p class='text-muted-foreground mb-4 text-center text-sm'>
                  This file type cannot be previewed.
                </p>
                <a
                  href={unsupportedDownloadHref(file)}
                  download={file.name}
                  class='bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 w-full items-center justify-center rounded-md px-4 text-sm font-medium shadow-sm'
                >
                  Download File
                </a>
              </div>
            </div>
          )}
        </Show>

        <Show when={virtualDetail()}>
          {(getDetail) => (
            <div
              data-no-window-drag
              class='absolute inset-0 z-50 flex items-center justify-center bg-black/45 p-4'
              role='presentation'
              onClick={() => setVirtualDetail(null)}
            >
              <div
                role='dialog'
                aria-modal='true'
                class='max-h-[85%] w-full max-w-2xl overflow-auto rounded-lg border border-border bg-card p-5 text-card-foreground shadow-xl'
                onClick={(event) => event.stopPropagation()}
              >
                <div class='flex items-start justify-between gap-3'>
                  <div>
                    <h2 class='text-lg font-semibold'>{getDetail().file.name}</h2>
                    <p class='text-xs text-muted-foreground'>
                      {getDetail().entry.archived
                        ? 'Archived · read-only'
                        : 'Read-only Stage 1 session detail'}
                    </p>
                  </div>
                  <button
                    type='button'
                    class='rounded border border-input px-3 py-1 text-sm'
                    onClick={() => setVirtualDetail(null)}
                  >
                    Close
                  </button>
                </div>
                <Show when={getDetail().entry.kind === 'draft'}>
                  <p class='mt-5 text-sm text-muted-foreground'>
                    Untouched draft. Interactive composer arrives in Stage 2.
                  </p>
                </Show>
                <Show when={virtualDetailQuery.isPending}>
                  <p class='mt-5 text-sm text-muted-foreground'>Loading transcript…</p>
                </Show>
                <Show when={virtualDetailQuery.isError}>
                  <p class='text-destructive mt-5 text-sm'>
                    {(virtualDetailQuery.error as Error)?.message}
                  </p>
                </Show>
                <Show when={virtualDetailQuery.data}>
                  {(data) => (
                    <pre class='mt-5 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs'>
                      {JSON.stringify(data().messages, null, 2)}
                    </pre>
                  )}
                </Show>
              </div>
            </div>
          )}
        </Show>

        <Show when={virtualActionDialog()}>
          {(dialog) => (
            <div
              data-no-window-drag
              class={modalDialogBackdropClass('window')}
              role='presentation'
              onClick={() => setVirtualActionDialog(null)}
            >
              <div
                role='dialog'
                aria-modal='true'
                aria-labelledby='hermes-virtual-action-title'
                class='w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-lg'
                onClick={(event) => event.stopPropagation()}
              >
                <h2 id='hermes-virtual-action-title' class='text-base font-semibold'>
                  {dialog().action === 'moveToProject'
                    ? 'Move to Hermes project'
                    : dialog().action === 'addProjectFolder'
                      ? 'Add gateway directory'
                      : dialog().action === 'removeProjectFolder'
                        ? 'Remove gateway directory'
                        : dialog().action === 'setPrimaryFolder'
                          ? 'Set primary directory'
                          : 'Project appearance'}
                </h2>
                <Show when={dialog().action === 'moveToProject'}>
                  <p class='mt-1 truncate text-xs text-muted-foreground'>
                    {dialog().file.name} will use destination project cwd.
                  </p>
                  <select
                    class='mt-3 h-9 w-full rounded-md border border-input bg-background px-2 text-sm'
                    value={virtualActionValue()}
                    disabled={virtualProjectChoicesLoading() || !virtualProjectChoices().length}
                    onChange={(event) => setVirtualActionValue(event.currentTarget.value)}
                  >
                    <For each={virtualProjectChoices()}>
                      {(project) => <option value={project.name}>{project.name}</option>}
                    </For>
                  </select>
                  <Show when={!virtualProjectChoicesLoading() && !virtualProjectChoices().length}>
                    <p class='mt-2 text-xs text-muted-foreground'>
                      No destination projects available.
                    </p>
                  </Show>
                </Show>
                <Show when={dialog().action === 'addProjectFolder'}>
                  <input
                    autofocus
                    class='mt-3 h-9 w-full rounded-md border border-input bg-background px-2.5 text-sm'
                    placeholder='Existing gateway directory path'
                    value={virtualActionValue()}
                    onInput={(event) => setVirtualActionValue(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') submitVirtualActionDialog()
                    }}
                  />
                </Show>
                <Show
                  when={
                    dialog().action === 'removeProjectFolder' ||
                    dialog().action === 'setPrimaryFolder'
                  }
                >
                  <select
                    class='mt-3 h-9 w-full rounded-md border border-input bg-background px-2 text-sm'
                    value={virtualActionValue()}
                    onChange={(event) => setVirtualActionValue(event.currentTarget.value)}
                  >
                    <For each={virtualProjectFolders(dialog().entry)}>
                      {(folder) => <option value={folder}>{folder}</option>}
                    </For>
                  </select>
                  <Show when={!virtualProjectFolders(dialog().entry).length}>
                    <p class='mt-2 text-xs text-muted-foreground'>
                      Project has no gateway directories.
                    </p>
                  </Show>
                </Show>
                <Show when={dialog().action === 'setAppearance'}>
                  <div class='mt-3 grid max-h-36 grid-cols-8 gap-1 overflow-y-auto'>
                    <For each={SOLID_AVAILABLE_ICONS}>
                      {(item) => (
                        <button
                          type='button'
                          title={item.name}
                          aria-label={item.name}
                          class={cn(
                            'flex h-8 w-8 items-center justify-center rounded-md border',
                            virtualAppearanceIcon() === item.name
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-transparent text-muted-foreground hover:bg-muted',
                          )}
                          onClick={() => setVirtualAppearanceIcon(item.name)}
                        >
                          <item.Icon class='h-4 w-4' />
                        </button>
                      )}
                    </For>
                  </div>
                  <label class='mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground'>
                    <span>Accent color</span>
                    <span class='flex items-center gap-2'>
                      <input
                        type='color'
                        aria-label='Project accent color'
                        class='h-8 w-10 cursor-pointer rounded border border-input bg-background p-1'
                        value={virtualAppearanceColor() || '#8b5cf6'}
                        onInput={(event) => setVirtualAppearanceColor(event.currentTarget.value)}
                      />
                      <button
                        type='button'
                        class='rounded border border-input px-2 py-1 text-foreground'
                        onClick={() => setVirtualAppearanceColor('')}
                      >
                        Default
                      </button>
                    </span>
                  </label>
                </Show>
                <Show when={virtualActionMutation.isError}>
                  <p class='mt-2 text-xs text-destructive'>
                    {(virtualActionMutation.error as Error)?.message ?? 'Hermes action failed'}
                  </p>
                </Show>
                <div class='mt-4 flex justify-end gap-2'>
                  <button
                    type='button'
                    class='h-8 rounded-md border border-input px-3 text-sm'
                    onClick={() => setVirtualActionDialog(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type='button'
                    class='h-8 rounded-md bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50'
                    disabled={
                      virtualActionMutation.isPending ||
                      (dialog().action !== 'setAppearance' && !virtualActionValue().trim())
                    }
                    onClick={submitVirtualActionDialog}
                  >
                    {virtualActionMutation.isPending
                      ? 'Saving…'
                      : dialog().action === 'moveToProject'
                        ? 'Move'
                        : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </Show>

        <BrowserWindowModalLayer
          iconEditTarget={iconEditTarget}
          setIconEditTarget={setIconEditTarget}
          customIcons={customIcons}
          onSaveCustomIcon={handleSaveCustomIcon}
          setCustomIconPending={setCustomIconMutation.isPending}
          removeCustomIconPending={removeCustomIconMutation.isPending}
          breadcrumbMenu={breadcrumbMenu}
          setBreadcrumbMenu={setBreadcrumbFolderMenu}
          breadcrumbMenuActions={breadcrumbMenuActions}
          onBreadcrumbOpenInNewTab={handleBreadcrumbOpenInNewTab}
          onBreadcrumbOpenInOtherSurface={handleBreadcrumbOpenInOtherSurface}
          otherSurfaceLabel='Open in Media Server'
          onBreadcrumbSetIcon={handleBreadcrumbSetIcon}
          fileRowMenu={fileRowMenu}
          editableFoldersList={props.editableFolders}
          isContextDirEditable={isContextDirEditable}
          onAddToTaskbar={props.onAddToTaskbar}
          onFileRowRename={isContextDirEditable() ? openContextRename : undefined}
          onFileRowMove={isContextDirEditable() ? openContextMove : undefined}
          onSetRowIcon={(f) => setIconEditTarget(f)}
          onOpenInNewTabFromRow={props.onOpenInNewTab ? openInNewTabFromRow : undefined}
          openInNewTabLabel={props.openInNewTabLabel}
          showOpenInNewTabForFiles={!!props.onOpenInNewTab}
          onOpenInSplitViewFromRow={props.onOpenInSplitView ? openInSplitViewFromRow : undefined}
          onOpenInOtherSurface={openDirectoryInOtherSurface}
          onOpenWithBrowser={openWithBrowser}
          onOpenWithReader={openWithReader}
          onContextDownload={handleContextDownload}
          getVirtualEntry={virtualEntry}
          onVirtualAction={handleVirtualAction}
          onContextToggleKnowledgeBase={handleContextToggleKnowledgeBase}
          isRowKnowledgeBase={isRowKnowledgeBase}
          showRename={showRename}
          renamingItem={renamingItem}
          renameNewName={renameNewName}
          setRenameNewName={setRenameNewName}
          submitRename={submitRename}
          cancelRename={cancelRename}
          renamePending={renameMutation.isPending || virtualActionMutation.isPending}
          renameError={(renameMutation.error ?? virtualActionMutation.error) as Error | undefined}
          renameTargetExists={renameTargetExists}
          moveTarget={moveTarget}
          closeMoveDialog={closeMoveDialog}
          moveDialogFilePath={moveDialogFilePath}
          confirmMoveTo={confirmMoveTo}
          movePending={moveMutation.isPending}
          moveError={moveMutation.error as Error | undefined}
          onPickNewTabTarget={
            fileOpenMode() === 'new-tab' && props.onBeginFileOpenTargetPick
              ? () => props.onBeginFileOpenTargetPick?.()
              : undefined
          }
          defaultFileOpen={fileOpenMode}
          onOpenFileInNewWindow={
            props.onOpenFileInNewFloatingWindow ? openFileInNewWindowFromRow : undefined
          }
          deleteTarget={deleteTarget}
          setDeleteTarget={(value) => {
            setDeleteTarget(value)
            if (!value) setVirtualDeleteAction(null)
          }}
          deletePending={deleteMutation.isPending || virtualActionMutation.isPending}
          deleteTitle={
            virtualDeleteAction() === 'deletePermanently'
              ? 'Delete Session Permanently?'
              : virtualDeleteAction() === 'deleteProject'
                ? 'Delete Project?'
                : undefined
          }
          deleteDescription={
            virtualDeleteAction() === 'deletePermanently'
              ? 'This permanently deletes the archived Hermes session and cannot be undone.'
              : virtualDeleteAction() === 'deleteProject'
                ? 'This removes project metadata only. Directories and sessions are not deleted.'
                : undefined
          }
          deleteConfirmLabel={
            virtualDeleteAction() === 'deletePermanently'
              ? 'Delete Permanently'
              : virtualDeleteAction() === 'deleteProject'
                ? 'Delete Project'
                : undefined
          }
          onConfirmDelete={() => {
            const it = deleteTarget()
            if (!it) return
            const virtualAction = virtualDeleteAction()
            if (virtualAction) {
              void virtualActionMutation
                .mutateAsync({ action: virtualAction, path: it.path })
                .then(() => {
                  setDeleteTarget(null)
                  setVirtualDeleteAction(null)
                })
              return
            }
            void deleteMutation.mutateAsync(it.path).then(() => setDeleteTarget(null))
          }}
          showCreateFolder={showCreateFolder}
          setShowCreateFolder={setShowCreateFolder}
          newFolderName={newFolderName}
          setNewFolderName={setNewFolderName}
          submitCreateFolder={submitCreateFolder}
          createFolderPending={createFolderMutation.isPending || virtualActionMutation.isPending}
          createFolderIsError={createFolderMutation.isError || virtualActionMutation.isError}
          createFolderError={
            (createFolderMutation.error ?? virtualActionMutation.error) as Error | undefined
          }
          folderExists={folderExists}
          virtualProjectForm={() => hasVirtualCapability(virtualDirectory(), 'createFolder')}
          projectPrimaryPath={projectPrimaryPath}
          setProjectPrimaryPath={setProjectPrimaryPath}
          projectAdditionalPaths={projectAdditionalPaths}
          setProjectAdditionalPaths={setProjectAdditionalPaths}
          gatewayPickerPath={gatewayPickerPath}
          setGatewayPickerPath={setGatewayPickerPath}
          gatewayDirectoryEntries={() => gatewayDirectoryQuery.data?.entries ?? []}
          gatewayDirectoryError={() => gatewayDirectoryQuery.data?.error}
          showCreateFile={showCreateFile}
          setShowCreateFile={setShowCreateFile}
          newFileName={newFileName}
          setNewFileName={setNewFileName}
          submitCreateFile={submitCreateFile}
          createFilePending={createFileMutation.isPending}
          createFileIsError={createFileMutation.isError}
          createFileError={createFileMutation.error as Error | undefined}
          fileExists={fileExists}
          inKb={inKb}
          showPasteDialog={showPasteDialog}
          pasteData={pasteData}
          pastePending={pasteMutation.isPending}
          pasteError={(pasteMutation.error as Error) ?? null}
          pasteExistingFiles={pasteExistingFiles}
          onPasteFileSubmit={handlePasteFileSubmit}
          closePasteDialog={closePasteDialog}
          uploadToast={uploadToast}
          setUploadToastHidden={setUploadToastHidden}
        />
      </>
    </FileBrowserSurface>
  )
}
