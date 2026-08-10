import {
  getFileDragData,
  hasFileDragData,
  isCompatibleSource,
  setFileDragData,
} from '@/lib/file-drag-data'
import { VIRTUAL_FOLDERS, isVirtualFolderPath } from '@/lib/constants'
import type { GlobalSettings } from '@/lib/use-settings'
import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import { collectDroppedUploadFiles } from '@/lib/collect-dropped-upload-files'
import {
  finePointerDragEnabled,
  subscribeFinePointerDragEnabled,
} from '@/lib/enable-fine-pointer-drag'
import { preloadWorkspaceVideoIntrinsics } from '@/lib/workspace-video-intrinsics-preload'
import {
  breadcrumbFloating,
  resetBreadcrumbFloating,
  setBreadcrumbFolderMenu,
} from '@/lib/breadcrumb-floating-store'
import { api, post } from '@/lib/api'
import {
  prefetchFolderContentsOnHover,
  prefetchParentDirectoryHover,
  type PrefetchFolderHoverContext,
} from '@/lib/prefetch-folder-hover'
import { extractPasteDataFromClipboardData } from '@/lib/extract-paste-data'
import type { PasteData } from '@/lib/paste-data'
import { queryKeys } from '@/lib/query-keys'
import type { ShareLink } from '@/lib/shares'
import { buildShareUrl, copyShareUrl, getShareUrlWarning } from '@/src/lib/share-url'
import { shouldOfferPasteAsNewFile } from '@/lib/should-offer-paste-as-new-file'
import { fileDownloadHref } from '@/lib/download-urls'
import { stripSharePrefix, type SourceContext } from '@/lib/source-context'
import type { FileItem } from '@/lib/types'
import {
  hasVirtualCapability,
  virtualAppearanceForPath,
  virtualFileSizeVisible,
  virtualEntrySubtitle,
  type DirectoryListing,
  type VirtualEntry,
  type VirtualOpenTarget,
} from '@/lib/virtual-directory'
import { MediaType } from '@/lib/types'
import { normalizeNewFilePath } from '@/lib/new-file-name'
import { formatFileSize, getMediaType } from '@/lib/media-utils'
import { useBrowserViewModeStore } from '@/lib/browser-view-mode-store'
import { persistViewMode } from '@/lib/view-mode-persistence'
import { useWorkspaceFileOpenTargetStore } from '@/lib/workspace-file-open-target'
import { cn, getKnowledgeBaseRoot, isPathEditable } from '@/lib/utils'
import ArrowUp from 'lucide-solid/icons/arrow-up'
import FilePlus from 'lucide-solid/icons/file-plus'
import FolderPlus from 'lucide-solid/icons/folder-plus'
import BookOpenText from 'lucide-solid/icons/book-open-text'
import Upload from 'lucide-solid/icons/upload'
import {
  For,
  Match,
  Show,
  Switch,
  batch,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
} from 'solid-js'
import type { BreadcrumbMenuTarget } from '../file-browser/BreadcrumbContextMenu'
import { Breadcrumbs } from '../file-browser/Breadcrumbs'
import { DirectoryBackgroundContextMenu } from '../file-browser/DirectoryBackgroundContextMenu'
import { KbDashboard } from '../file-browser/KbDashboard'
import { KbInlineCreateFooter } from '../file-browser/KbInlineCreateFooter'
import { KbSearchResults } from '../file-browser/KbSearchResults'
import type { AuthConfig, UploadToastState } from '../file-browser/types'
import {
  DirectoryListingEmpty,
  DirectoryListingEmptyTableRow,
  DirectoryListingErrorPanel,
  DirectoryListingLoading,
} from '../file-browser/DirectoryListingFeedback'
import { UploadMenu } from '../file-browser/UploadMenu'
import { DEFAULT_WORKSPACE_SOURCE } from './workspace-page-persistence'
import { WorkspaceBrowserModalLayer } from './WorkspaceBrowserModalLayer'
import { modalDialogBackdropClass } from '../file-browser/modal-overlay-scope'
import { SOLID_AVAILABLE_ICONS } from '../lib/solid-available-icons'
import { ViewModeToggle } from '../file-browser/ViewModeToggle'
import { VirtualDirectoryGrid } from '../file-browser/VirtualDirectoryGrid'
import { VirtualDirectoryList } from '../file-browser/VirtualDirectoryList'
import { registerKbSearchHotkeys } from '../file-browser/use-kb-search-hotkey'
import { useInlineModeInputFocus } from '../file-browser/use-inline-mode-input-focus'
import { useFileRowContextMenu } from '../file-browser/use-file-row-context-menu'
import { createLongPressContextMenuHandlers } from '../lib/long-press-context-menu'
import { openInReader } from '../reader/reader-url'
import { useDeferredLoading } from '../lib/use-deferred-loading'
import { useStoreSync } from '../lib/solid-store-sync'
import { useViewStats } from '../lib/use-view-stats'
import { fileItemIcon, gridHeroIcon } from '../lib/use-file-icon'
import { workspaceBrowserPaneParentDir } from './workspace-browser-pane-paths'
import type {
  WorkspaceBrowserPaneProps,
  WorkspaceShareConfig,
} from './workspace-browser-pane-types'

export type { WorkspaceShareConfig } from './workspace-browser-pane-types'

export function WorkspaceBrowserPane(props: WorkspaceBrowserPaneProps) {
  const queryClient = useQueryClient()
  const [deleteTarget, setDeleteTarget] = createSignal<FileItem | null>(null)
  const [unsupportedFile, setUnsupportedFile] = createSignal<FileItem | null>(null)
  const [draggedPath, setDraggedPath] = createSignal<string | null>(null)
  const [dragOverPath, setDragOverPath] = createSignal<string | null>(null)
  const [dragAllowsMove, setDragAllowsMove] = createSignal(false)
  const [enableDrag, setEnableDrag] = createSignal(finePointerDragEnabled())
  const [showCreateFile, setShowCreateFile] = createSignal(false)
  const [newFileName, setNewFileName] = createSignal('')
  const [showCreateFolder, setShowCreateFolder] = createSignal(false)
  const [newFolderName, setNewFolderName] = createSignal('')
  const [searchQuery, setSearchQuery] = createSignal('')
  const [debouncedSearch, setDebouncedSearch] = createSignal('')
  const [searchPopoverOpen, setSearchPopoverOpen] = createSignal(false)
  const [uploadToast, setUploadToast] = createSignal<UploadToastState>({ kind: 'hidden' })
  let externalUploadDragDepth = 0
  const [directoryScrollEl, setDirectoryScrollEl] = createSignal<HTMLDivElement | undefined>()
  const [externalUploadDragOver, setExternalUploadDragOver] = createSignal(false)
  const [inlineMode, setInlineMode] = createSignal<'file' | 'folder' | null>(null)
  const [inlineName, setInlineName] = createSignal('')
  const [directoryBackgroundMenu, setDirectoryBackgroundMenu] = createSignal<{
    x: number
    y: number
  } | null>(null)
  const [showRename, setShowRename] = createSignal(false)
  const [renamingItem, setRenamingItem] = createSignal<FileItem | null>(null)
  const [renameNewName, setRenameNewName] = createSignal('')
  const [moveTarget, setMoveTarget] = createSignal<FileItem | null>(null)
  const [iconEditTarget, setIconEditTarget] = createSignal<FileItem | null>(null)
  const [showPasteDialog, setShowPasteDialog] = createSignal(false)
  const [pasteData, setPasteData] = createSignal<PasteData | null>(null)
  const [shareDialogTarget, setShareDialogTarget] = createSignal<FileItem | null>(null)
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
  const shareViewModeTick = useStoreSync(useBrowserViewModeStore)
  let inlineFileInputEl: HTMLInputElement | undefined
  let inlineFolderInputEl: HTMLInputElement | undefined
  let kbSearchInputEl: HTMLInputElement | undefined
  let browserRootEl: HTMLDivElement | undefined

  useInlineModeInputFocus(
    inlineMode,
    () => inlineFileInputEl,
    () => inlineFolderInputEl,
  )

  onMount(() => {
    setEnableDrag(finePointerDragEnabled())
    return subscribeFinePointerDragEnabled(setEnableDrag)
  })
  const win = createMemo(() => props.workspace()?.windows.find((w) => w.id === props.windowId))

  const fileOpenTargetTick = useStoreSync(useWorkspaceFileOpenTargetStore)
  const workspaceFileOpenMode = () => {
    void fileOpenTargetTick()
    return useWorkspaceFileOpenTargetStore.getState().target
  }
  const currentPath = createMemo(() => win()?.initialState?.dir ?? '')

  const share = createMemo((): WorkspaceShareConfig | null => {
    const w = win()
    if (w?.source.kind === 'share' && w.source.token) {
      const panel = props.sharePanel()
      const fromWindow = (w.source.sharePath ?? '').trim()
      const fromPanel =
        panel && panel.token === w.source.token ? (panel.sharePath ?? '').trim() : ''
      return { token: w.source.token, sharePath: fromWindow || fromPanel }
    }
    return props.sharePanel() ?? null
  })

  const listDir = createMemo(() => {
    const p = currentPath()
    const sh = share()
    if (sh) return stripSharePrefix(p, sh.sharePath.replace(/\\/g, '/'))
    return p
  })

  function mediaPathForShareChild(relWithinShare: string): string {
    const sh = share()
    if (!sh) return relWithinShare
    const base = sh.sharePath.replace(/\\/g, '/').replace(/\/+$/, '')
    const r = relWithinShare.replace(/^\/+/, '')
    return r ? `${base}/${r}` : base
  }

  const viewSourceContext = createMemo((): SourceContext => {
    const sh = share()
    if (sh) return { shareToken: sh.token, sharePath: sh.sharePath }
    return {}
  })
  const viewStats = useViewStats(() => viewSourceContext())

  const filesQuery = useQuery(() => {
    const sh = share()
    return {
      queryKey: sh
        ? queryKeys.shareFiles(sh.token, listDir())
        : [...queryKeys.files(listDir()), virtualOffset()],
      queryFn: () =>
        sh
          ? api<DirectoryListing>(
              `/api/share/${sh.token}/files?dir=${encodeURIComponent(listDir())}`,
            )
          : api<DirectoryListing>(
              `/api/files?surface=workspace&dir=${encodeURIComponent(listDir())}&offset=${virtualOffset()}`,
            ),
      refetchInterval: virtualRefreshEnabled() ? 5_000 : false,
    }
  })

  createEffect(
    on(currentPath, () => {
      setVirtualOffset(0)
      setVirtualPages([])
      setVirtualRefreshEnabled(false)
    }),
  )
  createEffect(() => {
    const page = filesQuery.data
    if (!page) return
    setVirtualRefreshEnabled(!!page.virtualDirectory)
    setVirtualPages((current) =>
      virtualOffset() === 0
        ? [page]
        : [...current.filter((value) => value.virtualDirectory?.offset !== virtualOffset()), page],
    )
  })
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

  const pasteExistingFiles = createMemo(() => files())

  const isVirtualFolder = createMemo(() =>
    (Object.values(VIRTUAL_FOLDERS) as string[]).includes(currentPath()),
  )

  const isAdminPaneEditable = createMemo(
    () =>
      !share() &&
      !isVirtualFolder() &&
      !virtualDirectory() &&
      isPathEditable(currentPath(), props.editableFolders),
  )
  const isContextDirEditable = createMemo(() =>
    share() ? !!props.shareCanEdit : isAdminPaneEditable(),
  )
  const showShareCreateToolbar = createMemo(() => !!share() && !!props.shareAllowUpload)

  const parentParts = createMemo(() =>
    currentPath() ? currentPath().split(/[/\\]/).filter(Boolean) : [],
  )
  const dropParentDir = createMemo(() => {
    const p = parentParts()
    if (p.length <= 1) return ''
    return p.slice(0, -1).join('/')
  })
  const canDropOnParent = createMemo(() => {
    if (!currentPath()) return false
    if (!isPathEditable(dropParentDir() || '', props.editableFolders)) return false
    if (share()) return !!props.shareCanEdit
    return isAdminPaneEditable()
  })

  const canDropOn = (targetPath: string, sourcePath?: string | null) => {
    const src = sourcePath ?? draggedPath()
    if (!src || src === targetPath) return false
    if (targetPath.startsWith(src + '/')) return false
    return true
  }

  const dragSourceKind = createMemo((): 'local' | 'share' => (share() ? 'share' : 'local'))
  const dragSourceToken = createMemo(() => share()?.token)

  function invalidateKbQueries() {
    const sh = share()
    void queryClient.invalidateQueries({
      queryKey: sh ? queryKeys.shareContent(sh.token) : queryKeys.adminContent(),
    })
  }

  const moveItemMutation = useMutation(() => ({
    mutationFn: (
      vars:
        | { kind: 'admin'; oldPath: string; newPath: string }
        | { kind: 'share'; token: string; oldPath: string; newPath: string },
    ) =>
      vars.kind === 'share'
        ? post(`/api/share/${vars.token}/rename`, { oldPath: vars.oldPath, newPath: vars.newPath })
        : post('/api/files/rename', { oldPath: vars.oldPath, newPath: vars.newPath }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
      const sh = share()
      if (sh) void queryClient.invalidateQueries({ queryKey: queryKeys.shareFiles(sh.token) })
      invalidateKbQueries()
    },
  }))

  function handleMoveFile(sourcePath: string, destinationDir: string) {
    const sh = share()
    const shareNorm = sh?.sharePath.replace(/\\/g, '/') ?? ''
    if (sh) {
      const sourceRel = stripSharePrefix(sourcePath, shareNorm)
      const destRel = stripSharePrefix(destinationDir, shareNorm)
      const baseName = sourceRel.split('/').filter(Boolean).pop()!
      const newPath = destRel ? `${destRel}/${baseName}` : baseName
      moveItemMutation.mutate({ kind: 'share', token: sh.token, oldPath: sourceRel, newPath })
      return
    }
    const fileName = sourcePath.split(/[/\\]/).pop()!
    const newPath = destinationDir ? `${destinationDir}/${fileName}` : fileName
    moveItemMutation.mutate({ kind: 'admin', oldPath: sourcePath, newPath })
  }

  const allowMoveFile = createMemo(() => {
    if (share()) return props.shareCanEdit ? handleMoveFile : undefined
    return isAdminPaneEditable() ? handleMoveFile : undefined
  })

  const renameItemMutation = useMutation(() => ({
    mutationFn: (
      vars:
        | { kind: 'admin'; oldPath: string; newPath: string }
        | { kind: 'share'; token: string; oldPath: string; newPath: string },
    ) =>
      vars.kind === 'share'
        ? post(`/api/share/${vars.token}/rename`, { oldPath: vars.oldPath, newPath: vars.newPath })
        : post('/api/files/rename', { oldPath: vars.oldPath, newPath: vars.newPath }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
      const sh = share()
      if (sh) void queryClient.invalidateQueries({ queryKey: queryKeys.shareFiles(sh.token) })
      invalidateKbQueries()
    },
  }))

  const settingsQuery = useQuery(() => ({
    queryKey: queryKeys.settings(),
    queryFn: () => api<GlobalSettings>('/api/settings'),
    staleTime: Infinity,
    enabled: !share(),
  }))

  const authQuery = useQuery(() => ({
    queryKey: queryKeys.authConfig(),
    queryFn: () => api<AuthConfig>('/api/auth/config'),
    staleTime: Infinity,
    enabled: !share(),
  }))

  const sharesQuery = useQuery(() => ({
    queryKey: queryKeys.shares(),
    queryFn: () => api<{ shares: ShareLink[] }>('/api/shares'),
    staleTime: Infinity,
    enabled: !share(),
  }))

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

  const shares = createMemo(() => sharesQuery.data?.shares ?? [])

  const sharedPathSet = createMemo(() => {
    const set = new Set<string>()
    for (const s of shares()) {
      set.add(s.path.replace(/\\/g, '/'))
    }
    return set
  })

  const shareDialogExistingShares = createMemo((): ShareLink[] => {
    const t = shareDialogTarget()
    if (!t) return []
    const np = t.path.replace(/\\/g, '/')
    return shares().filter((s) => s.path.replace(/\\/g, '/') === np)
  })

  const shareDialogIsEditable = createMemo(() => {
    const t = shareDialogTarget()
    if (!t) return false
    return isPathEditable(t.path, props.editableFolders)
  })

  const knowledgeBases = createMemo(() =>
    share() ? [] : (settingsQuery.data?.knowledgeBases ?? []),
  )

  function isRowKnowledgeBase(file: FileItem) {
    return file.isDirectory && knowledgeBases().includes(file.path.replace(/\\/g, '/'))
  }

  const kbRootPath = createMemo(() => {
    if (share()) return null
    return getKnowledgeBaseRoot(currentPath(), knowledgeBases())
  })

  const inKb = createMemo(() => (share() ? !!props.shareIsKnowledgeBase : kbRootPath() !== null))
  const isActivePane = createMemo(() => props.workspace()?.activeWindowId === props.windowId)

  function setKbSearchOpen(open: boolean) {
    setSearchPopoverOpen(open)
    if (!open) {
      setSearchQuery('')
      setDebouncedSearch('')
    }
  }

  const showInlineCreate = createMemo(
    () => inKb() && ((!!share() && !!props.shareAllowUpload) || isAdminPaneEditable()),
  )

  const createFileMutation = useMutation(() => ({
    mutationFn: (vars: { path: string; content: string; shareToken?: string }) =>
      vars.shareToken
        ? post(`/api/share/${vars.shareToken}/create`, {
            type: 'file',
            path: vars.path,
            content: vars.content,
          })
        : post('/api/files/create', { type: 'file', path: vars.path, content: vars.content }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
      const sh = share()
      if (sh) void queryClient.invalidateQueries({ queryKey: queryKeys.shareFiles(sh.token) })
      if (inKb()) invalidateKbQueries()
    },
  }))

  const createFolderMutation = useMutation(() => ({
    mutationFn: (
      vars: { mode: 'share'; token: string; path: string } | { mode: 'local'; path: string },
    ) =>
      vars.mode === 'share'
        ? post(`/api/share/${vars.token}/create`, { type: 'folder', path: vars.path })
        : post('/api/files/create', { type: 'folder', path: vars.path }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
      const sh = share()
      if (sh) void queryClient.invalidateQueries({ queryKey: queryKeys.shareFiles(sh.token) })
      if (inKb()) invalidateKbQueries()
    },
  }))

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
    },
  }))

  const pasteMutation = useMutation(() => ({
    mutationFn: (vars: {
      path: string
      content?: string
      base64Content?: string
      shareToken?: string
      mode: 'create' | 'replace'
      expectedVersion?: number
    }) =>
      vars.shareToken
        ? post(`/api/share/${vars.shareToken}/${vars.mode === 'replace' ? 'edit' : 'create'}`, {
            ...(vars.mode === 'create' ? { type: 'file' as const } : {}),
            path: vars.path,
            content: vars.content,
            base64Content: vars.base64Content,
            expectedVersion: vars.expectedVersion,
          })
        : post(vars.mode === 'replace' ? '/api/files/edit' : '/api/files/create', {
            ...(vars.mode === 'create' ? { type: 'file' as const } : {}),
            path: vars.path,
            content: vars.content,
            base64Content: vars.base64Content,
            expectedVersion: vars.expectedVersion,
          }),
    onSuccess: (_d, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
      const sh = share()
      if (sh) void queryClient.invalidateQueries({ queryKey: queryKeys.shareFiles(sh.token) })
      if (inKb()) invalidateKbQueries()
      setShowPasteDialog(false)
      setPasteData(null)
      const pathToOpen = share() ? mediaPathForShareChild(variables.path) : variables.path
      const popName = pathToOpen.split(/[/\\]/).filter(Boolean).pop() ?? 'file'
      const lower = popName.toLowerCase()
      const ext = lower.includes('.') ? (lower.split('.').pop() ?? '') : ''
      props.onOpenViewer(props.windowId, {
        path: pathToOpen,
        name: popName,
        isDirectory: false,
        size: 0,
        extension: ext,
        type: getMediaType(ext),
      })
    },
  }))

  const viewMode = createMemo(() => {
    const sh = share()
    if (sh) {
      void shareViewModeTick()
      return useBrowserViewModeStore
        .getState()
        .getViewMode(`share-workspace-viewmode-${sh.token}`, 'list')
    }
    const s = settingsQuery.data
    return s?.viewModes?.[currentPath()] ?? 'list'
  })

  const viewModeMutation = useMutation(() => ({
    mutationFn: (vars: { path: string; viewMode: 'list' | 'grid' }) =>
      persistViewMode(vars.path, vars.viewMode),
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

  const workspaceCustomIcons = createMemo(() =>
    share() ? ({} as Record<string, string>) : (settingsQuery.data?.customIcons ?? {}),
  )

  createEffect(() => {
    const q = searchQuery()
    const id = window.setTimeout(() => setDebouncedSearch(q), 300)
    onCleanup(() => clearTimeout(id))
  })

  createEffect(
    on(currentPath, () => {
      batch(() => {
        setSearchQuery('')
        setDebouncedSearch('')
        setSearchPopoverOpen(false)
        setInlineMode(null)
        setInlineName('')
        setDraggedPath(null)
        setDragOverPath(null)
        setDragAllowsMove(false)
        resetBreadcrumbFloating()
        setShowPasteDialog(false)
        setPasteData(null)
        pasteMutation.reset()
      })
      externalUploadDragDepth = 0
      setExternalUploadDragOver(false)
    }),
  )

  registerKbSearchHotkeys({
    active: () => inKb() && isActivePane(),
    isOpen: searchPopoverOpen,
    setOpen: setKbSearchOpen,
    focusInput: () => kbSearchInputEl?.focus(),
  })

  const adminKbSearchQuery = useQuery(() => ({
    queryKey: queryKeys.kbSearch(kbRootPath()!, debouncedSearch()),
    queryFn: () =>
      api<{ results: { path: string; name: string; snippet: string }[] }>(
        `/api/kb/search?root=${encodeURIComponent(kbRootPath()!)}&q=${encodeURIComponent(debouncedSearch())}`,
      ),
    enabled:
      !!kbRootPath() && searchPopoverOpen() && debouncedSearch().trim().length > 0 && !share(),
  }))

  const shareKbSearchQuery = useQuery(() => {
    const sh = share()
    const q = debouncedSearch().trim()
    const token = sh?.token ?? ''
    return {
      queryKey: queryKeys.shareKbSearch(token, q, listDir()),
      queryFn: () => {
        const params = new URLSearchParams({ q })
        const d = listDir()
        if (d) params.set('dir', d)
        return api<{ results: { path: string; name: string; snippet: string }[] }>(
          `/api/share/${token}/kb/search?${params}`,
        )
      },
      enabled: !!sh && inKb() && searchPopoverOpen() && q.length > 0,
    }
  })

  const kbSearchResults = createMemo(() => {
    if (share()) return shareKbSearchQuery.data?.results ?? []
    return adminKbSearchQuery.data?.results ?? []
  })

  const kbSearchLoading = createMemo(() =>
    share() ? shareKbSearchQuery.isLoading : adminKbSearchQuery.isLoading,
  )

  const showKbSearchResults = createMemo(
    () => inKb() && searchPopoverOpen() && debouncedSearch().trim().length > 0,
  )

  const shareLinkBase = createMemo(() => {
    if (share()) {
      if (typeof window !== 'undefined') return window.location.origin
      return ''
    }
    const d = authQuery.data?.shareLinkDomain
    if (typeof d === 'string' && d.trim()) return d.trim().replace(/\/$/, '')
    if (typeof window !== 'undefined') return window.location.origin
    return ''
  })

  const showEmptyFolder = createMemo(
    () =>
      !filesQuery.isError &&
      filesQuery.data !== undefined &&
      files().length === 0 &&
      !showKbSearchResults(),
  )

  const showAdminCreateToolbar = createMemo(() => isAdminPaneEditable() && !share())
  const showVirtualCreateToolbar = createMemo(
    () =>
      hasVirtualCapability(virtualDirectory(), 'createFile') ||
      hasVirtualCapability(virtualDirectory(), 'createFolder'),
  )

  const allowWorkspaceUpload = createMemo(
    () => showShareCreateToolbar() || showAdminCreateToolbar(),
  )

  const isUploading = createMemo(() => uploadToast().kind === 'uploading')

  const fileRowMenu = useFileRowContextMenu({
    onDeleteRequest: (f) => setDeleteTarget(f),
  })

  createEffect(() => {
    if (fileRowMenu.menu()) setDirectoryBackgroundMenu(null)
  })

  const deleteMutation = useMutation(() => ({
    mutationFn: (itemPath: string) => {
      const sh = share()
      if (sh) {
        const rel = stripSharePrefix(itemPath, sh.sharePath.replace(/\\/g, '/'))
        return post(`/api/share/${sh.token}/delete`, { path: rel })
      }
      return post('/api/files/delete', { path: itemPath })
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
      const sh = share()
      if (sh) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.shareFiles(sh.token) })
      } else {
        void queryClient.invalidateQueries({ queryKey: queryKeys.shares() })
      }
    },
  }))

  const revokeShareMutation = useMutation(() => ({
    mutationFn: (vars: { token: string }) => post('/api/shares/delete', vars),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.shares() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
    },
  }))

  const knowledgeBaseMutation = useMutation(() => ({
    mutationFn: (filePath: string) => post('/api/settings/knowledgeBase', { filePath }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
    },
  }))

  function handleContextToggleKnowledgeBase(file: FileItem) {
    knowledgeBaseMutation.mutate(file.path.replace(/\\/g, '/'))
  }

  const renameTargetExists = createMemo(() => {
    const item = renamingItem()
    const name = renameNewName().trim()
    if (!item || !name || renameItemMutation.isPending) return false
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
    action: import('@/lib/virtual-directory').VirtualCapability,
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
          setUploadToast({
            kind: 'clipboardError',
            message: error instanceof Error ? error.message : 'Could not load Hermes projects',
            url: '',
          }),
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
      setVirtualAppearanceIcon(String(entry?.metadata?.icon || 'Folder'))
      setVirtualAppearanceColor(String(entry?.metadata?.color || ''))
      virtualActionMutation.reset()
      return
    }
    if (action === 'branch') {
      void virtualActionMutation.mutateAsync({ action, path: file.path }).then((result) => {
        if (!result.openTarget) return
        const branch: FileItem = {
          ...file,
          name: `${file.name} branch`,
          path: `virtual-branch-${Date.now()}`,
        }
        props.onOpenVirtualTarget?.(props.windowId, branch, result.openTarget)
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
    renameItemMutation.reset()
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
    const sh = share()
    const shareNorm = sh?.sharePath.replace(/\\/g, '/') ?? ''
    if (sh) {
      const oldRel = stripSharePrefix(item.path, shareNorm)
      const parts = oldRel.split('/').filter(Boolean)
      const parent = parts.slice(0, -1).join('/')
      const newRel = parent ? `${parent}/${newName}` : newName
      renameItemMutation.mutate(
        { kind: 'share', token: sh.token, oldPath: oldRel, newPath: newRel },
        { onSuccess: () => cancelRename() },
      )
    } else {
      const oldPath = item.path.replace(/\\/g, '/')
      const par = workspaceBrowserPaneParentDir(oldPath)
      const newPath = par ? `${par}/${newName}` : newName
      renameItemMutation.mutate(
        { kind: 'admin', oldPath, newPath },
        { onSuccess: () => cancelRename() },
      )
    }
  }

  function openContextMove(file: FileItem) {
    setMoveTarget(file)
    moveItemMutation.reset()
  }

  function closeMoveDialog() {
    setMoveTarget(null)
    moveItemMutation.reset()
  }

  function confirmMoveTo(destinationDir: string) {
    const target = moveTarget()
    if (!target) return
    const sh = share()
    const shareNorm = sh?.sharePath.replace(/\\/g, '/') ?? ''
    if (sh) {
      const sourceRel = stripSharePrefix(target.path, shareNorm)
      const baseName = sourceRel.split('/').filter(Boolean).pop()!
      const newPath = destinationDir ? `${destinationDir}/${baseName}` : baseName
      moveItemMutation.mutate(
        { kind: 'share', token: sh.token, oldPath: sourceRel, newPath },
        { onSuccess: () => closeMoveDialog() },
      )
    } else {
      const fileName = target.path.split(/[/\\]/).pop()!
      const newPath = destinationDir ? `${destinationDir}/${fileName}` : fileName
      moveItemMutation.mutate(
        { kind: 'admin', oldPath: target.path, newPath },
        { onSuccess: () => closeMoveDialog() },
      )
    }
  }

  const moveDialogFilePath = createMemo(() => {
    const t = moveTarget()
    const sh = share()
    if (!t) return ''
    if (sh) return stripSharePrefix(t.path, sh.sharePath.replace(/\\/g, '/'))
    return t.path
  })

  createEffect(() => {
    currentPath()
    setUnsupportedFile(null)
  })

  function setViewMode(mode: 'list' | 'grid') {
    const sh = share()
    if (sh) {
      useBrowserViewModeStore.getState().setViewMode(`share-workspace-viewmode-${sh.token}`, mode)
      return
    }
    viewModeMutation.mutate({ path: currentPath(), viewMode: mode })
  }

  function unsupportedDownloadHref(file: FileItem) {
    const sh = share()
    return fileDownloadHref(file.path, sh ? { token: sh.token, sharePath: sh.sharePath } : null)
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
    const sh = share()
    link.href = fileDownloadHref(
      file.path,
      sh ? { token: sh.token, sharePath: sh.sharePath } : null,
    )
    link.download = file.isDirectory ? `${file.name}.zip` : file.name
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  function openDirectoryInMediaServer(file: FileItem) {
    if (!file.isDirectory || file.isVirtual) return
    const sh = share()
    const params = new URLSearchParams()
    if (sh) {
      const rel = stripSharePrefix(file.path, sh.sharePath.replace(/\\/g, '/'))
      if (rel) params.set('dir', rel)
      const query = params.toString()
      window.open(query ? `/share/${sh.token}?${query}` : `/share/${sh.token}`, '_blank')
      return
    }
    if (file.path) params.set('dir', file.path)
    const query = params.toString()
    window.open(query ? `/?${query}` : '/', '_blank')
  }

  function handleContextShare(file: FileItem) {
    setShareDialogTarget(file)
  }

  function getPathHasShareForFile(file: FileItem) {
    return sharedPathSet().has(file.path.replace(/\\/g, '/'))
  }

  async function handleCopyShareLink(file: FileItem) {
    if (!file.shareToken) return
    const fullShare = shares().find((candidate) => candidate.token === file.shareToken)
    if (!fullShare) return
    const url = buildShareUrl(fullShare, shareLinkBase())
    const warning = getShareUrlWarning(url)
    try {
      await copyShareUrl(url)
      setUploadToast({ kind: 'copied', label: 'Share link copied', warning })
      window.setTimeout(() => {
        setUploadToast((prev) => (prev.kind === 'copied' ? { kind: 'hidden' } : prev))
      }, 2000)
    } catch (err) {
      setUploadToast({
        kind: 'clipboardError',
        message: err instanceof Error ? err.message : 'Clipboard denied or unavailable',
        url,
        warning,
      })
    }
  }

  function handleBreadcrumbNavigate(path: string) {
    props.onNavigateDir(props.windowId, path)
  }

  function workspaceBreadcrumbAsFolderItem(m: BreadcrumbMenuTarget): FileItem {
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

  const workspaceBreadcrumbMenuActions = createMemo(() => {
    const m = breadcrumbMenu()
    if (!m) {
      return { showOpenInNewTab: false, showOpenInWorkspace: false, showSetIcon: false }
    }
    if (m.isHome) {
      return { showOpenInNewTab: true, showOpenInWorkspace: true, showSetIcon: false }
    }
    const virt = isVirtualFolderPath(m.serverPath)
    return {
      showOpenInNewTab: !virt,
      showOpenInWorkspace: !virt,
      showSetIcon: !virt && !share(),
    }
  })

  function handleWorkspaceBreadcrumbContextMenu(
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

  function handleWorkspaceBreadcrumbOpenInNewTab() {
    const m = breadcrumbMenu()
    if (!m) return
    const sh = share()
    if (m.isHome) {
      if (sh) window.open(`/share/${sh.token}/workspace`, '_blank')
      else window.open('/', '_blank')
      return
    }
    const item = workspaceBreadcrumbAsFolderItem(m)
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

  function handleWorkspaceBreadcrumbOpenInWorkspace() {
    const m = breadcrumbMenu()
    if (!m) return
    const sh = share()
    if (m.isHome) {
      window.open(sh ? `/share/${sh.token}` : '/', '_blank')
      return
    }
    const item = workspaceBreadcrumbAsFolderItem(m)
    if (!item.isDirectory || item.isVirtual) return
    if (sh) {
      const rel = stripSharePrefix(item.path, sh.sharePath.replace(/\\/g, '/'))
      const params = new URLSearchParams()
      if (rel) params.set('dir', rel)
      const q = params.toString()
      window.open(q ? `/share/${sh.token}?${q}` : `/share/${sh.token}`, '_blank')
      return
    }
    const params = new URLSearchParams()
    if (item.path) params.set('dir', item.path)
    const q = params.toString()
    window.open(q ? `/?${q}` : '/', '_blank')
  }

  function handleWorkspaceBreadcrumbSetIcon() {
    const m = breadcrumbMenu()
    if (!m || m.isHome || isVirtualFolderPath(m.serverPath) || share()) return
    setIconEditTarget(workspaceBreadcrumbAsFolderItem(m))
  }

  function handleWorkspaceSaveCustomIcon(iconName: string | null) {
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

  function openCreateFileDialog() {
    if (hasVirtualCapability(virtualDirectory(), 'createFile')) {
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
          props.onOpenVirtualTarget?.(props.windowId, draft, result.openTarget)
          if (!props.onOpenVirtualTarget) {
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
    const sh = share()
    if (sh) {
      const stem = normalizeNewFilePath(name, inKb())
      const rel = listDir() ? `${listDir()}/${stem}` : stem
      void createFileMutation
        .mutateAsync({ path: rel, content: '', shareToken: sh.token })
        .then(() => {
          setShowCreateFile(false)
          setNewFileName('')
        })
      return
    }
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
    const sh = share()
    if (sh) {
      const rel = listDir() ? `${listDir()}/${name}` : name
      void createFolderMutation
        .mutateAsync({ mode: 'share', token: sh.token, path: rel })
        .then(() => {
          setShowCreateFolder(false)
          setNewFolderName('')
        })
      return
    }
    const base = currentPath() ? `${currentPath()}/${name}` : name
    void createFolderMutation.mutateAsync({ mode: 'local', path: base }).then(() => {
      setShowCreateFolder(false)
      setNewFolderName('')
    })
  }

  function closePasteDialog() {
    setShowPasteDialog(false)
    setPasteData(null)
    pasteMutation.reset()
  }

  function handlePasteFileSubmit(
    fileName: string,
    mode: 'create' | 'replace',
    expectedVersion?: number,
  ) {
    const pd = pasteData()
    if (!pd) return
    const sh = share()
    if (sh) {
      const rel = listDir() ? `${listDir()}/${fileName}` : fileName
      if (pd.type === 'image') {
        pasteMutation.mutate({
          path: rel,
          base64Content: pd.content,
          shareToken: sh.token,
          mode,
          expectedVersion,
        })
      } else if (pd.type === 'file') {
        if (pd.isTextContent) {
          pasteMutation.mutate({
            path: rel,
            content: pd.content,
            shareToken: sh.token,
            mode,
            expectedVersion,
          })
        } else {
          pasteMutation.mutate({
            path: rel,
            base64Content: pd.content,
            shareToken: sh.token,
            mode,
            expectedVersion,
          })
        }
      } else {
        pasteMutation.mutate({
          path: rel,
          content: pd.content,
          shareToken: sh.token,
          mode,
          expectedVersion,
        })
      }
      return
    }
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

  async function handlePasteEvent(e: ClipboardEvent) {
    if (!allowWorkspaceUpload()) return
    if (!shouldOfferPasteAsNewFile(e)) return
    e.preventDefault()
    const data = await extractPasteDataFromClipboardData(e.clipboardData, {
      textSuggestedExtension: inKb() ? 'md' : 'txt',
    })
    if (!data) return
    setPasteData(data)
    setShowPasteDialog(true)
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
    setSearchQuery('')
    setDebouncedSearch('')
    setSearchPopoverOpen(false)
    props.onOpenViewer(props.windowId, fileItemFromPath(filePath, displayName))
  }

  function handleKbResultClickFromSearch(path: string) {
    const r = kbSearchResults().find((x) => x.path === path)
    handleKbResultClick(path, r?.name)
  }

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

  async function submitInlineFile() {
    const stem = inlineName().trim()
    if (!stem || inlineFileExists() || !showInlineCreate()) return
    const sh = share()
    const fileStem = normalizeNewFilePath(stem, inKb())
    try {
      if (sh) {
        const rel = listDir() ? `${listDir()}/${fileStem}` : fileStem
        const fullOpenPath = mediaPathForShareChild(rel)
        await createFileMutation.mutateAsync({
          path: rel,
          content: '',
          shareToken: sh.token,
        })
        setInlineMode(null)
        setInlineName('')
        createFileMutation.reset()
        props.onOpenViewer(props.windowId, fileItemFromPath(fullOpenPath))
        return
      }
      const base = currentPath() ? `${currentPath()}/${stem}` : stem
      const finalPath = normalizeNewFilePath(base, inKb())
      await createFileMutation.mutateAsync({ path: finalPath, content: '' })
      setInlineMode(null)
      setInlineName('')
      createFileMutation.reset()
      props.onOpenViewer(props.windowId, fileItemFromPath(finalPath))
    } catch {
      /* createFileMutation.isError surfaces failures */
    }
  }

  function submitInlineFolder() {
    const name = inlineName().trim()
    if (!name || inlineFolderExists() || !showInlineCreate()) return
    const sh = share()
    const rel = listDir() ? `${listDir()}/${name}` : name
    const base = currentPath() ? `${currentPath()}/${name}` : name
    const dirPathToOpen = sh ? mediaPathForShareChild(rel) : base
    const afterFolderCreate = () => {
      setInlineMode(null)
      setInlineName('')
      createFolderMutation.reset()
      props.onNavigateDir(props.windowId, dirPathToOpen)
    }
    if (sh) {
      void createFolderMutation
        .mutateAsync({ mode: 'share', token: sh.token, path: rel })
        .then(afterFolderCreate)
      return
    }
    void createFolderMutation.mutateAsync({ mode: 'local', path: base }).then(afterFolderCreate)
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

  function workspacePrefetchCtx(): PrefetchFolderHoverContext {
    const sh = share()
    if (sh) {
      return {
        queryClient,
        share: { token: sh.token, sharePath: sh.sharePath },
        shareIsKnowledgeBase: !!props.shareIsKnowledgeBase,
      }
    }
    return { queryClient, knowledgeBases: knowledgeBases() }
  }

  function prefetchFileRowHover(file: FileItem) {
    prefetchFolderContentsOnHover(workspacePrefetchCtx(), file)
    if (file.type !== MediaType.VIDEO) return
    const paneWin = win()
    if (!paneWin) return
    const sh = share()
    const base =
      sh?.sharePath.replace(/\\/g, '/') ??
      (paneWin.source.kind === 'share' ? (paneWin.source.sharePath ?? '').replace(/\\/g, '/') : '')
    preloadWorkspaceVideoIntrinsics(paneWin.source, file.path, base)
  }

  function handleParentDirectory() {
    props.onNavigateDir(props.windowId, workspaceBrowserPaneParentDir(currentPath()))
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
      const wdef = props.workspace()?.windows.find((x) => x.id === props.windowId)
      const sh = share()
      const src =
        wdef?.source ??
        (sh
          ? { kind: 'share', token: sh.token, sharePath: sh.sharePath }
          : DEFAULT_WORKSPACE_SOURCE)
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

  createEffect(() => {
    const f = unsupportedFile()
    if (!f) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setUnsupportedFile(null)
    }
    window.addEventListener('keydown', onKey)
    onCleanup(() => window.removeEventListener('keydown', onKey))
  })

  function parentRowDragOver(e: globalThis.DragEvent) {
    const dtr = e.dataTransfer
    if (!canDropOnParent() || !allowMoveFile()) return
    if (!dtr || (!draggedPath() && !hasFileDragData(dtr))) return
    if (draggedPath() && !dragAllowsMove()) return
    e.preventDefault()
    dtr.dropEffect = 'move'
    setDragOverPath('__parent__')
  }

  function parentRowDragLeave(e: globalThis.DragEvent) {
    const cur = e.currentTarget as Node | null
    if (cur && !cur.contains(e.relatedTarget as Node) && dragOverPath() === '__parent__') {
      setDragOverPath(null)
    }
  }

  function parentRowDrop(e: globalThis.DragEvent) {
    e.preventDefault()
    setDragOverPath(null)
    const mv = allowMoveFile()
    if (!mv) return
    const dest = workspaceBrowserPaneParentDir(currentPath())
    const dp = draggedPath()
    if (dp) {
      if (!dragAllowsMove()) return
      mv(dp, dest)
      return
    }
    const dtr = e.dataTransfer
    if (!dtr) return
    const data = getFileDragData(dtr)
    if (
      data &&
      isCompatibleSource({ sourceKind: dragSourceKind(), sourceToken: dragSourceToken() }, data) &&
      canDropOn(dest, data.path)
    ) {
      mv(data.path, dest)
    }
  }

  function onFileDragStart(file: FileItem, e: globalThis.DragEvent) {
    const dtr = e.dataTransfer
    if (!dtr || !enableDrag()) return
    const canMove = !!allowMoveFile() && isPathEditable(file.path, props.editableFolders)
    setDragAllowsMove(canMove)
    const kind = dragSourceKind()
    const tok = dragSourceToken()
    setFileDragData(dtr, {
      path: file.path,
      isDirectory: file.isDirectory,
      sourceKind: kind,
      ...(kind === 'share' && tok ? { sourceToken: tok } : {}),
      ...(virtualEntry(file)?.openTarget
        ? { virtualOpenTarget: virtualEntry(file)!.openTarget }
        : {}),
    })
    dtr.effectAllowed = canMove ? 'copyMove' : 'copy'
    setDraggedPath(file.path)
  }

  function onFileDragEnd() {
    setDraggedPath(null)
    setDragOverPath(null)
    setDragAllowsMove(false)
  }

  function handleFolderRowDragOver(path: string, e: globalThis.DragEvent) {
    const file = files().find((x) => x.path === path)
    if (file?.isDirectory) onFolderDragOver(file, e)
  }

  function handleFolderRowDragLeave(path: string, e: globalThis.DragEvent) {
    const file = files().find((x) => x.path === path)
    if (file?.isDirectory) onFolderDragLeave(file, e)
  }

  function handleFolderRowDrop(path: string, e: globalThis.DragEvent) {
    const file = files().find((x) => x.path === path)
    if (file?.isDirectory) onFolderDrop(file, e)
  }

  function onFolderDragOver(file: FileItem, e: globalThis.DragEvent) {
    const dtr = e.dataTransfer
    if (!file.isDirectory || !allowMoveFile() || !dtr) return
    const hasCross = !draggedPath() && hasFileDragData(dtr)
    if (!draggedPath() && !hasCross) return
    const dp = draggedPath()
    if (dp && !dragAllowsMove()) return
    if (dp && !canDropOn(file.path)) return
    if (!isPathEditable(file.path, props.editableFolders)) return
    e.preventDefault()
    dtr.dropEffect = 'move'
    setDragOverPath(file.path)
  }

  function onFolderDragLeave(file: FileItem, e: globalThis.DragEvent) {
    const cur = e.currentTarget as Node | null
    if (cur && !cur.contains(e.relatedTarget as Node) && dragOverPath() === file.path) {
      setDragOverPath(null)
    }
  }

  function onFolderDrop(file: FileItem, e: globalThis.DragEvent) {
    e.preventDefault()
    setDragOverPath(null)
    const mv = allowMoveFile()
    if (!mv || !file.isDirectory) return
    const dp = draggedPath()
    if (dp && canDropOn(file.path)) {
      if (!dragAllowsMove()) return
      mv(dp, file.path)
      return
    }
    if (!dp) {
      const dtr = e.dataTransfer
      if (!dtr) return
      const data = getFileDragData(dtr)
      if (
        data &&
        isCompatibleSource(
          { sourceKind: dragSourceKind(), sourceToken: dragSourceToken() },
          data,
        ) &&
        canDropOn(file.path, data.path)
      ) {
        mv(data.path, file.path)
      }
    }
  }

  async function uploadFilesToServer(files: File[]) {
    if (files.length === 0 || !allowWorkspaceUpload()) return
    const sh = share()
    const targetDir = sh ? listDir() : currentPath()
    const url = sh ? `/api/share/${sh.token}/upload` : '/api/files/upload'
    setUploadToast({ kind: 'uploading', fileCount: files.length })
    try {
      const formData = new FormData()
      formData.append('targetDir', targetDir)
      for (const file of files) {
        formData.append('files', file, file.name)
      }
      const res = await fetch(url, { method: 'POST', body: formData })
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null
        const message = data?.error || `Upload failed (${res.status})`
        setUploadToast({ kind: 'error', message })
        return
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
      if (sh) void queryClient.invalidateQueries({ queryKey: queryKeys.shareFiles(sh.token) })
      setUploadToast({ kind: 'success' })
      window.setTimeout(() => setUploadToast({ kind: 'hidden' }), 2000)
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
    if (!allowWorkspaceUpload() || !isOsFileUploadDrag(e)) return
    e.preventDefault()
    externalUploadDragDepth++
    if (externalUploadDragDepth === 1) setExternalUploadDragOver(true)
  }

  function onExternalUploadDragLeave(e: globalThis.DragEvent) {
    if (!isOsFileUploadDrag(e)) return
    e.preventDefault()
    if (externalUploadDragDepth <= 0) return
    externalUploadDragDepth--
    if (externalUploadDragDepth <= 0) {
      externalUploadDragDepth = 0
      setExternalUploadDragOver(false)
    }
  }

  function onExternalUploadDragOver(e: globalThis.DragEvent) {
    if (!allowWorkspaceUpload() || !isOsFileUploadDrag(e)) return
    e.preventDefault()
    const dtr = e.dataTransfer
    if (dtr) dtr.dropEffect = 'copy'
  }

  async function onExternalUploadDrop(e: globalThis.DragEvent) {
    e.preventDefault()
    externalUploadDragDepth = 0
    setExternalUploadDragOver(false)
    if (!allowWorkspaceUpload()) return
    const dtr = e.dataTransfer
    if (!dtr || dtr.files.length === 0) return
    const dropped = await collectDroppedUploadFiles(dtr)
    if (dropped.length > 0) void uploadFilesToServer(dropped)
  }

  return (
    <div
      ref={(el) => (browserRootEl = el)}
      class='relative flex h-full min-h-0 flex-1 flex-col overflow-hidden'
    >
      <div
        data-no-window-drag
        class='relative flex h-9 shrink-0 items-center bg-muted/50 px-2 py-0'
      >
        <div class='pointer-events-none absolute inset-x-0 bottom-0 h-px bg-border' aria-hidden />
        <div class='flex w-full min-w-0 flex-wrap items-center justify-between gap-1'>
          <div
            data-breadcrumb-slot
            class='relative flex min-h-0 min-w-0 max-w-full flex-1 overflow-hidden'
          >
            <Breadcrumbs
              currentPath={currentPath()}
              onNavigate={handleBreadcrumbNavigate}
              mode='Workspace'
              onCrumbContextMenu={handleWorkspaceBreadcrumbContextMenu}
            />
          </div>
          <div class='flex shrink-0 flex-wrap items-center justify-end gap-1 md:justify-start'>
            <Show when={inKb()}>
              <button
                type='button'
                aria-label='Search note contents'
                title='Search note contents (Ctrl+K)'
                aria-pressed={searchPopoverOpen()}
                class={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md outline-none transition-colors ${
                  searchPopoverOpen()
                    ? 'bg-accent text-accent-foreground shadow-sm'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
                onClick={() => setKbSearchOpen(!searchPopoverOpen())}
              >
                <BookOpenText class='h-3.5 w-3.5' stroke-width={2} aria-hidden='true' />
              </button>
            </Show>
            <Show when={showShareCreateToolbar()}>
              <button
                type='button'
                title='Create new folder'
                class='inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-muted hover:text-foreground dark:hover:bg-input/50'
                onClick={openCreateFolderDialog}
              >
                <FolderPlus class='h-3.5 w-3.5' stroke-width={2} />
              </button>
              <button
                type='button'
                title='Create new file'
                class='inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-muted hover:text-foreground dark:hover:bg-input/50'
                onClick={openCreateFileDialog}
              >
                <FilePlus class='h-3.5 w-3.5' stroke-width={2} />
              </button>
              <UploadMenu
                mode='Workspace'
                disabled={isUploading()}
                onUpload={(files) => void uploadFilesToServer(files)}
              />
              <div class='bg-border mx-1 h-5 w-px shrink-0' />
            </Show>
            <Show when={showAdminCreateToolbar()}>
              <button
                type='button'
                title='Create new folder'
                class='inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-muted hover:text-foreground dark:hover:bg-input/50'
                onClick={openCreateFolderDialog}
              >
                <FolderPlus class='h-3.5 w-3.5' stroke-width={2} />
              </button>
              <button
                type='button'
                title='Create new file'
                class='inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-muted hover:text-foreground dark:hover:bg-input/50'
                onClick={openCreateFileDialog}
              >
                <FilePlus class='h-3.5 w-3.5' stroke-width={2} />
              </button>
              <UploadMenu
                mode='Workspace'
                disabled={isUploading()}
                onUpload={(files) => void uploadFilesToServer(files)}
              />
              <div class='bg-border mx-1 h-5 w-px shrink-0' />
            </Show>
            <Show when={showVirtualCreateToolbar()}>
              <Show when={hasVirtualCapability(virtualDirectory(), 'createFolder')}>
                <button
                  type='button'
                  title='Create new project'
                  aria-label='Create new project'
                  class='inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground'
                  onClick={openCreateFolderDialog}
                >
                  <FolderPlus class='h-3.5 w-3.5' stroke-width={2} />
                </button>
              </Show>
              <Show when={hasVirtualCapability(virtualDirectory(), 'createFile')}>
                <button
                  type='button'
                  title='Create new session'
                  aria-label='Create new session'
                  class='inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground'
                  onClick={openCreateFileDialog}
                >
                  <FilePlus class='h-3.5 w-3.5' stroke-width={2} />
                </button>
              </Show>
              <div class='bg-border mx-1 h-5 w-px shrink-0' />
            </Show>
            <ViewModeToggle viewMode={viewMode()} onChange={setViewMode} mode='Workspace' />
          </div>
        </div>
      </div>

      <Show when={inKb() && searchPopoverOpen()}>
        <div class='shrink-0 border-b border-border bg-muted/20 p-2' data-testid='kb-search-bar'>
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
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault()
                const buttons =
                  browserRootEl?.querySelectorAll<HTMLButtonElement>('[data-kb-search-result]')
                const target = e.key === 'ArrowDown' ? buttons?.[0] : buttons?.[buttons.length - 1]
                target?.focus()
              } else if (e.key === 'Enter') {
                const first =
                  browserRootEl?.querySelector<HTMLButtonElement>('[data-kb-search-result]')
                if (first) {
                  e.preventDefault()
                  first.click()
                }
              }
            }}
          />
        </div>
      </Show>

      <Show when={filesQuery.isError}>
        <DirectoryListingErrorPanel
          onRetry={() => void filesQuery.refetch()}
          detail={filesQuery.error?.message}
        />
      </Show>

      <Show when={!filesQuery.isError}>
        <div
          class='relative flex min-h-0 flex-1 flex-col overflow-hidden outline-none'
          data-testid='workspace-upload-drop-zone'
          tabIndex={0}
          title={
            inKb() && allowWorkspaceUpload()
              ? 'Focus this pane and paste (Ctrl+V) to create a file from the clipboard.'
              : undefined
          }
          onDragEnter={onExternalUploadDragEnter}
          onDragLeave={onExternalUploadDragLeave}
          onDragOver={onExternalUploadDragOver}
          onDrop={(e) => void onExternalUploadDrop(e)}
          onPaste={(e) => void handlePasteEvent(e)}
          onContextMenu={openDirectoryBackgroundContextMenu}
        >
          <div
            ref={(el) => {
              setDirectoryScrollEl(el)
            }}
            class='min-h-0 flex-1 overflow-auto'
            onScroll={(event) => {
              const el = event.currentTarget
              const next = listing()?.virtualDirectory?.nextOffset
              if (next === undefined || filesQuery.isFetching) return
              if (el.scrollHeight - el.scrollTop - el.clientHeight < 320) setVirtualOffset(next)
            }}
          >
            <Show
              when={showKbSearchResults()}
              fallback={
                <>
                  <Show when={inKb() && (!!currentPath() || !!share())}>
                    <KbDashboard
                      mode='Workspace'
                      scopePath={share() ? share()!.sharePath.replace(/\\/g, '/') : currentPath()}
                      shareToken={share()?.token}
                      dir={share() ? listDir() || undefined : undefined}
                      onFileClick={(p) => handleKbResultClick(p)}
                      recentDragCanMove={(p) =>
                        !!(allowMoveFile() && isPathEditable(p, props.editableFolders))
                      }
                    />
                  </Show>
                  <DirectoryListingLoading
                    show={isFilesLoadingInitial() && showFilesDeferredLoading()}
                  />
                  <Show when={!isFilesLoadingInitial()}>
                    <Switch>
                      <Match when={viewMode() === 'grid'}>
                        <div class='px-2 py-2'>
                          <VirtualDirectoryGrid
                            files={files}
                            includeParent={() => !!currentPath()}
                            scrollTarget={{
                              kind: 'element',
                              getScrollElement: directoryScrollEl,
                            }}
                            class='gap-4'
                            renderParentCard={() => (
                              <div
                                data-no-window-drag
                                class={cn(
                                  'ring-foreground/10 bg-card text-card-foreground flex cursor-pointer flex-col overflow-hidden rounded-xl py-0 text-left shadow-xs ring-1 transition-colors select-none hover:bg-muted/50',
                                  dragOverPath() === '__parent__' ? 'bg-primary/20' : '',
                                )}
                                onClick={handleParentDirectory}
                                onPointerEnter={() =>
                                  prefetchParentDirectoryHover(workspacePrefetchCtx(), {
                                    currentPath: currentPath(),
                                    isVirtualFolder: isVirtualFolder(),
                                  })
                                }
                                onDragOver={allowMoveFile() ? parentRowDragOver : undefined}
                                onDragLeave={allowMoveFile() ? parentRowDragLeave : undefined}
                                onDrop={allowMoveFile() ? parentRowDrop : undefined}
                                onKeyDown={(e) => e.key === 'Enter' && handleParentDirectory()}
                                role='button'
                                tabindex={0}
                              >
                                <div class='bg-muted/80 flex aspect-video flex-col items-center justify-center p-4'>
                                  <ArrowUp
                                    class='mb-2 h-12 w-12 text-muted-foreground'
                                    size={48}
                                    stroke-width={2}
                                  />
                                  <p class='text-center text-sm font-medium'>..</p>
                                </div>
                              </div>
                            )}
                            renderFileCard={(file) => (
                              <div
                                data-no-window-drag
                                data-file-path={file.path}
                                class={cn(
                                  'ring-foreground/10 bg-card text-card-foreground flex cursor-pointer flex-col overflow-hidden rounded-xl py-0 text-left shadow-xs ring-1 transition-colors select-none hover:bg-muted/50',
                                  file.isDirectory && dragOverPath() === file.path
                                    ? 'bg-primary/20'
                                    : '',
                                  draggedPath() === file.path ? 'opacity-50' : '',
                                )}
                                draggable={enableDrag()}
                                onClick={() => handleFileClick(file)}
                                onPointerEnter={() => prefetchFileRowHover(file)}
                                onContextMenu={(e) => fileRowMenu.openRowContextMenu(e, file)}
                                {...createLongPressContextMenuHandlers()}
                                onDragStart={(e) => onFileDragStart(file, e)}
                                onDragEnd={onFileDragEnd}
                                onDragOver={(e) => {
                                  if (!file.isDirectory || !allowMoveFile()) return
                                  onFolderDragOver(file, e)
                                }}
                                onDragLeave={(e) => {
                                  if (!file.isDirectory || !allowMoveFile()) return
                                  onFolderDragLeave(file, e)
                                }}
                                onDrop={(e) => {
                                  if (!file.isDirectory || !allowMoveFile()) return
                                  onFolderDrop(file, e)
                                }}
                                onKeyDown={(e) => e.key === 'Enter' && handleFileClick(file)}
                                role='button'
                                tabindex={0}
                              >
                                <div class='group relative flex aspect-video items-center justify-center overflow-hidden bg-muted'>
                                  <div
                                    class='text-muted-foreground'
                                    {...(isRowKnowledgeBase(file)
                                      ? { 'data-kb-root-icon': '' }
                                      : {})}
                                  >
                                    {gridHeroIcon(
                                      file,
                                      props.fileIconContext(),
                                      virtualEntry(file)?.appearance ??
                                        virtualAppearanceForPath(file.path),
                                    )}
                                  </div>
                                </div>
                                <div class='flex flex-col gap-1 p-3'>
                                  <p class='truncate text-sm font-medium' title={file.name}>
                                    {file.name}
                                  </p>
                                  <div class='flex items-center justify-between gap-2 text-xs text-muted-foreground'>
                                    <span class='truncate'>
                                      {virtualEntrySubtitle(virtualEntry(file))}
                                    </span>
                                    <span>
                                      {virtualFileSizeVisible(file, virtualEntry(file))
                                        ? formatFileSize(file.size)
                                        : ''}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            )}
                          />
                          <DirectoryListingEmpty
                            show={showEmptyFolder()}
                            canUpload={allowWorkspaceUpload()}
                          />
                        </div>
                      </Match>
                      <Match when={viewMode() === 'list'}>
                        <VirtualDirectoryList
                          files={files}
                          includeParent={() => !!currentPath()}
                          scrollTarget={{
                            kind: 'element',
                            getScrollElement: directoryScrollEl,
                          }}
                          class='relative w-full overflow-x-auto'
                          colSpan={3}
                          renderParentRow={() => (
                            <tr
                              data-no-window-drag
                              class={cn(
                                'cursor-pointer select-none border-b border-border transition-colors hover:bg-muted/50',
                                dragOverPath() === '__parent__' ? 'bg-primary/20' : '',
                              )}
                              onClick={handleParentDirectory}
                              onPointerEnter={() =>
                                prefetchParentDirectoryHover(workspacePrefetchCtx(), {
                                  currentPath: currentPath(),
                                  isVirtualFolder: isVirtualFolder(),
                                })
                              }
                              onDragOver={allowMoveFile() ? parentRowDragOver : undefined}
                              onDragLeave={allowMoveFile() ? parentRowDragLeave : undefined}
                              onDrop={allowMoveFile() ? parentRowDrop : undefined}
                            >
                              <td class='w-[40px] min-w-[40px] max-w-[40px] box-border p-2 align-middle'>
                                <div class='flex items-center justify-center'>
                                  <ArrowUp
                                    class='h-5 w-5 text-muted-foreground'
                                    size={20}
                                    stroke-width={2}
                                  />
                                </div>
                              </td>
                              <td class='min-w-0 p-2 align-middle font-medium'>..</td>
                              <td class='min-w-0 p-2 align-middle text-right text-muted-foreground' />
                            </tr>
                          )}
                          renderFileRow={(file) => {
                            const canDragRow = enableDrag()
                            return (
                              <tr
                                data-no-window-drag
                                data-file-path={file.path}
                                class={cn(
                                  'group cursor-pointer select-none border-b border-border transition-colors hover:bg-muted/50',
                                  file.isDirectory && dragOverPath() === file.path
                                    ? 'bg-primary/20'
                                    : '',
                                  draggedPath() === file.path ? 'opacity-50' : '',
                                )}
                                draggable={canDragRow}
                                onClick={() => handleFileClick(file)}
                                onPointerEnter={() => prefetchFileRowHover(file)}
                                onContextMenu={(e) => fileRowMenu.openRowContextMenu(e, file)}
                                {...createLongPressContextMenuHandlers()}
                                onDragStart={(e) => onFileDragStart(file, e)}
                                onDragEnd={onFileDragEnd}
                                onDragOver={(e) => {
                                  if (!file.isDirectory || !allowMoveFile()) return
                                  handleFolderRowDragOver(file.path, e)
                                }}
                                onDragLeave={(e) => {
                                  if (!file.isDirectory || !allowMoveFile()) return
                                  handleFolderRowDragLeave(file.path, e)
                                }}
                                onDrop={(e) => {
                                  if (!file.isDirectory || !allowMoveFile()) return
                                  handleFolderRowDrop(file.path, e)
                                }}
                              >
                                <td
                                  class='w-[40px] min-w-[40px] max-w-[40px] box-border p-2 align-middle'
                                  {...(isRowKnowledgeBase(file) ? { 'data-kb-root-icon': '' } : {})}
                                >
                                  <div class='flex items-center justify-center'>
                                    {fileItemIcon(
                                      file,
                                      props.fileIconContext(),
                                      'md',
                                      virtualEntry(file)?.appearance ??
                                        virtualAppearanceForPath(file.path),
                                    )}
                                  </div>
                                </td>
                                <td class='min-w-0 p-2 align-middle font-medium'>
                                  <div class='min-w-0'>
                                    <div class='truncate'>{file.name}</div>
                                    <Show when={virtualEntrySubtitle(virtualEntry(file))}>
                                      <div class='truncate text-[11px] font-normal text-muted-foreground'>
                                        {virtualEntrySubtitle(virtualEntry(file))}
                                      </div>
                                    </Show>
                                  </div>
                                </td>
                                <td class='min-w-0 p-2 align-middle text-right text-muted-foreground'>
                                  <span class='inline-block w-20 tabular-nums'>
                                    {virtualFileSizeVisible(file, virtualEntry(file))
                                      ? formatFileSize(file.size)
                                      : ''}
                                  </span>
                                </td>
                              </tr>
                            )
                          }}
                          renderEmptyRow={() => (
                            <DirectoryListingEmptyTableRow
                              show={showEmptyFolder()}
                              canUpload={allowWorkspaceUpload()}
                            />
                          )}
                        />
                      </Match>
                    </Switch>
                  </Show>
                </>
              }
            >
              <KbSearchResults
                results={kbSearchResults()}
                query={debouncedSearch()}
                isLoading={kbSearchLoading()}
                currentPath={currentPath()}
                onResultClick={handleKbResultClickFromSearch}
              />
            </Show>
          </div>

          <Show when={showInlineCreate()}>
            <KbInlineCreateFooter
              noWindowDrag
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

          <DirectoryBackgroundContextMenu
            menu={directoryBackgroundMenu}
            onDismiss={() => setDirectoryBackgroundMenu(null)}
            onNewFile={openCreateFileDialog}
            onNewFolder={openCreateFolderDialog}
          />

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
                        ? 'Savingâ€¦'
                        : dialog().action === 'moveToProject'
                          ? 'Move'
                          : 'Save'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </Show>

          <WorkspaceBrowserModalLayer
            iconEditTarget={iconEditTarget}
            setIconEditTarget={setIconEditTarget}
            workspaceCustomIcons={workspaceCustomIcons}
            onSaveWorkspaceCustomIcon={handleWorkspaceSaveCustomIcon}
            setCustomIconPending={setCustomIconMutation.isPending}
            removeCustomIconPending={removeCustomIconMutation.isPending}
            breadcrumbMenu={breadcrumbMenu}
            setBreadcrumbMenu={setBreadcrumbFolderMenu}
            workspaceBreadcrumbMenuActions={workspaceBreadcrumbMenuActions}
            onWorkspaceBreadcrumbOpenInNewTab={handleWorkspaceBreadcrumbOpenInNewTab}
            onWorkspaceBreadcrumbOpenInWorkspace={handleWorkspaceBreadcrumbOpenInWorkspace}
            onWorkspaceBreadcrumbSetIcon={handleWorkspaceBreadcrumbSetIcon}
            fileRowMenu={fileRowMenu}
            editableFoldersList={props.editableFolders}
            isContextDirEditable={isContextDirEditable}
            shareDeleteGated={() => !!share()}
            shareCanDelete={!!props.shareCanDelete}
            onAddToTaskbar={props.onAddToTaskbar}
            onFileRowRename={isContextDirEditable() ? openContextRename : undefined}
            onFileRowMove={isContextDirEditable() ? openContextMove : undefined}
            onSetRowIcon={!share() ? (f) => setIconEditTarget(f) : undefined}
            onOpenInNewTabFromRow={props.onOpenInNewTab ? openInNewTabFromRow : undefined}
            openInNewTabLabel={props.openInNewTabLabel}
            showOpenInNewTabForFiles={!!props.onOpenInNewTab}
            onOpenInSplitViewFromRow={props.onOpenInSplitView ? openInSplitViewFromRow : undefined}
            onOpenInMediaServer={openDirectoryInMediaServer}
            onOpenWithReader={share() ? undefined : openInReader}
            onContextDownload={handleContextDownload}
            getVirtualEntry={virtualEntry}
            onVirtualAction={handleVirtualAction}
            onContextShare={share() ? undefined : handleContextShare}
            shareDialogTarget={shareDialogTarget}
            setShareDialogTarget={setShareDialogTarget}
            shareDialogIsEditable={shareDialogIsEditable}
            shareDialogExistingShares={shareDialogExistingShares}
            shareLinkBaseForDialog={shareLinkBase}
            onCopyShareLink={handleCopyShareLink}
            getPathHasShare={share() ? undefined : getPathHasShareForFile}
            onContextToggleKnowledgeBase={share() ? undefined : handleContextToggleKnowledgeBase}
            isRowKnowledgeBase={isRowKnowledgeBase}
            showRename={showRename}
            renamingItem={renamingItem}
            renameNewName={renameNewName}
            setRenameNewName={setRenameNewName}
            submitRename={submitRename}
            cancelRename={cancelRename}
            renamePending={renameItemMutation.isPending || virtualActionMutation.isPending}
            renameError={
              (renameItemMutation.error ?? virtualActionMutation.error) as Error | undefined
            }
            renameTargetExists={renameTargetExists}
            moveTarget={moveTarget}
            closeMoveDialog={closeMoveDialog}
            moveDialogFilePath={moveDialogFilePath}
            confirmMoveTo={confirmMoveTo}
            movePending={moveItemMutation.isPending}
            moveError={moveItemMutation.error as Error | undefined}
            shareToken={() => share()?.token}
            shareRootPath={() => share()?.sharePath}
            onPickNewTabTarget={
              workspaceFileOpenMode() === 'new-tab' && props.onBeginFileOpenTargetPick
                ? () => props.onBeginFileOpenTargetPick?.()
                : undefined
            }
            workspaceDefaultFileOpen={workspaceFileOpenMode}
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
            revokeSharePending={share() ? false : revokeShareMutation.isPending}
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
              if (!share() && it.shareToken) {
                void revokeShareMutation
                  .mutateAsync({ token: it.shareToken })
                  .then(() => setDeleteTarget(null))
              } else {
                void deleteMutation.mutateAsync(it.path).then(() => setDeleteTarget(null))
              }
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
            setUploadToastHidden={() => setUploadToast({ kind: 'hidden' })}
          />
        </div>
      </Show>
    </div>
  )
}
