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
import { shouldOfferPasteAsNewFile } from '@/lib/should-offer-paste-as-new-file'
import { fileDownloadHref } from '@/lib/download-urls'
import { stripSharePrefix, type SourceContext } from '@/lib/source-context'
import type { FileItem } from '@/lib/types'
import { MediaType } from '@/lib/types'
import { formatFileSize, getMediaType } from '@/lib/media-utils'
import { useBrowserViewModeStore } from '@/lib/browser-view-mode-store'
import { cn, getKnowledgeBaseRoot, isPathEditable } from '@/lib/utils'
import ArrowUp from 'lucide-solid/icons/arrow-up'
import FilePlus from 'lucide-solid/icons/file-plus'
import FileText from 'lucide-solid/icons/file-text'
import FolderPlus from 'lucide-solid/icons/folder-plus'
import Search from 'lucide-solid/icons/search'
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
import { ViewModeToggle } from '../file-browser/ViewModeToggle'
import { registerKbSearchHotkeys } from '../file-browser/use-kb-search-hotkey'
import { useInlineModeInputFocus } from '../file-browser/use-inline-mode-input-focus'
import { useFileRowContextMenu } from '../file-browser/use-file-row-context-menu'
import { createLongPressContextMenuHandlers } from '../lib/long-press-context-menu'
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
  const [externalUploadDragOver, setExternalUploadDragOver] = createSignal(false)
  const [inlineMode, setInlineMode] = createSignal<'file' | 'folder' | null>(null)
  const [inlineName, setInlineName] = createSignal('')
  const [showRename, setShowRename] = createSignal(false)
  const [renamingItem, setRenamingItem] = createSignal<FileItem | null>(null)
  const [renameNewName, setRenameNewName] = createSignal('')
  const [moveTarget, setMoveTarget] = createSignal<FileItem | null>(null)
  const [iconEditTarget, setIconEditTarget] = createSignal<FileItem | null>(null)
  const [showPasteDialog, setShowPasteDialog] = createSignal(false)
  const [pasteData, setPasteData] = createSignal<PasteData | null>(null)
  const [shareDialogTarget, setShareDialogTarget] = createSignal<FileItem | null>(null)
  const breadcrumbMenu = () => breadcrumbFloating.folderMenu
  const shareViewModeTick = useStoreSync(useBrowserViewModeStore)
  let inlineFileInputEl: HTMLInputElement | undefined
  let inlineFolderInputEl: HTMLInputElement | undefined
  let kbSearchInputEl: HTMLInputElement | undefined

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
      queryKey: sh ? queryKeys.shareFiles(sh.token, listDir()) : queryKeys.files(listDir()),
      queryFn: () =>
        sh
          ? api<{ files: FileItem[] }>(
              `/api/share/${sh.token}/files?dir=${encodeURIComponent(listDir())}`,
            )
          : api<{ files: FileItem[] }>(`/api/files?dir=${encodeURIComponent(listDir())}`),
    }
  })

  const files = createMemo(() => filesQuery.data?.files ?? [])
  const isFilesLoadingInitial = createMemo(
    () => filesQuery.isPending && filesQuery.data === undefined,
  )
  const showFilesDeferredLoading = useDeferredLoading(() => isFilesLoadingInitial())

  const pasteExistingLowerNames = createMemo(() => files().map((f) => f.name.toLowerCase()))

  const isVirtualFolder = createMemo(() =>
    (Object.values(VIRTUAL_FOLDERS) as string[]).includes(currentPath()),
  )

  const isAdminPaneEditable = createMemo(
    () => !share() && !isVirtualFolder() && isPathEditable(currentPath(), props.editableFolders),
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

  const showInlineCreate = createMemo(
    () => inKb() && ((!!share() && !!props.shareAllowUpload) || isAdminPaneEditable()),
  )

  function invalidateKbQueries() {
    const sh = share()
    const dir = listDir()
    if (sh) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.shareKbRecent(sh.token, dir) })
      void queryClient.invalidateQueries({ queryKey: queryKeys.shareKbRecent() })
    } else {
      const p = currentPath()
      if (p) void queryClient.invalidateQueries({ queryKey: queryKeys.kbRecent(p) })
    }
  }

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

  const pasteMutation = useMutation(() => ({
    mutationFn: (vars: {
      path: string
      content?: string
      base64Content?: string
      shareToken?: string
    }) =>
      vars.shareToken
        ? post(`/api/share/${vars.shareToken}/create`, {
            type: 'file',
            path: vars.path,
            content: vars.content,
            base64Content: vars.base64Content,
          })
        : post('/api/files/create', {
            type: 'file',
            path: vars.path,
            content: vars.content,
            base64Content: vars.base64Content,
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
      post('/api/settings/viewMode', vars),
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

  createEffect(() => {
    if (!searchPopoverOpen()) return
    const onDoc = (e: MouseEvent) => {
      const root = document.querySelector('[data-kb-search-root]')
      if (root?.contains(e.target as Node)) return
      setSearchPopoverOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    onCleanup(() => document.removeEventListener('mousedown', onDoc))
  })

  registerKbSearchHotkeys({
    active: inKb,
    isOpen: searchPopoverOpen,
    setOpen: setSearchPopoverOpen,
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

  const allowWorkspaceUpload = createMemo(
    () => showShareCreateToolbar() || showAdminCreateToolbar(),
  )

  const isUploading = createMemo(() => uploadToast().kind === 'uploading')

  const fileRowMenu = useFileRowContextMenu({
    onDeleteRequest: (f) => setDeleteTarget(f),
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
    return files().some((f) => f.path !== item.path && f.name.toLowerCase() === name.toLowerCase())
  })

  function openContextRename(file: FileItem) {
    setRenamingItem(file)
    setRenameNewName(file.name)
    setShowRename(true)
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

  function handleContextShare(file: FileItem) {
    setShareDialogTarget(file)
  }

  function getPathHasShareForFile(file: FileItem) {
    return sharedPathSet().has(file.path.replace(/\\/g, '/'))
  }

  async function handleCopyShareLink(file: FileItem) {
    if (!file.shareToken) return
    const url = `${shareLinkBase()}/share/${file.shareToken}`
    try {
      await navigator.clipboard.writeText(url)
      setUploadToast({ kind: 'copied', label: 'Share link copied' })
      window.setTimeout(() => {
        setUploadToast((prev) => (prev.kind === 'copied' ? { kind: 'hidden' } : prev))
      }, 2000)
    } catch (err) {
      setUploadToast({
        kind: 'clipboardError',
        message: err instanceof Error ? err.message : 'Clipboard denied or unavailable',
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
      else window.open(`${window.location.origin}/`, '_blank')
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
    window.open(`${window.location.origin}/?${params.toString()}`, '_blank')
  }

  function handleWorkspaceBreadcrumbOpenInWorkspace() {
    const m = breadcrumbMenu()
    if (!m) return
    const sh = share()
    if (m.isHome) {
      window.open(sh ? `/share/${sh.token}/workspace` : '/workspace', '_blank')
      return
    }
    const item = workspaceBreadcrumbAsFolderItem(m)
    if (!item.isDirectory || item.isVirtual) return
    if (sh) {
      const rel = stripSharePrefix(item.path, sh.sharePath.replace(/\\/g, '/'))
      const params = new URLSearchParams()
      if (rel) params.set('dir', rel)
      const q = params.toString()
      window.open(
        q ? `/share/${sh.token}/workspace?${q}` : `/share/${sh.token}/workspace`,
        '_blank',
      )
      return
    }
    const params = new URLSearchParams()
    if (item.path) params.set('dir', item.path)
    const q = params.toString()
    window.open(q ? `/workspace?${q}` : '/workspace', '_blank')
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

  function openInSplitViewFromRow(file: FileItem) {
    props.onOpenInSplitView?.(props.windowId, file)
  }

  function openCreateFileDialog() {
    setNewFileName('')
    setShowCreateFile(true)
  }

  function openCreateFolderDialog() {
    setNewFolderName('')
    setShowCreateFolder(true)
  }

  function submitCreateFile() {
    const name = newFileName().trim()
    if (!name || fileExists()) return
    const sh = share()
    const addExt = inKb() ? '.md' : '.txt'
    if (sh) {
      const stem = name.includes('.') ? name : `${name}${addExt}`
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
    const finalPath = base.includes('.') ? base : `${base}${addExt}`
    void createFileMutation.mutateAsync({ path: finalPath, content: '' }).then(() => {
      setShowCreateFile(false)
      setNewFileName('')
    })
  }

  function submitCreateFolder() {
    const name = newFolderName().trim()
    if (!name || folderExists()) return
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

  function handlePasteFileSubmit(fileName: string) {
    const pd = pasteData()
    if (!pd) return
    const sh = share()
    if (sh) {
      const rel = listDir() ? `${listDir()}/${fileName}` : fileName
      if (pd.type === 'image') {
        pasteMutation.mutate({ path: rel, base64Content: pd.content, shareToken: sh.token })
      } else if (pd.type === 'file') {
        if (pd.isTextContent) {
          pasteMutation.mutate({ path: rel, content: pd.content, shareToken: sh.token })
        } else {
          pasteMutation.mutate({ path: rel, base64Content: pd.content, shareToken: sh.token })
        }
      } else {
        pasteMutation.mutate({ path: rel, content: pd.content, shareToken: sh.token })
      }
      return
    }
    const rel = currentPath() ? `${currentPath()}/${fileName}` : fileName
    if (pd.type === 'image') {
      pasteMutation.mutate({ path: rel, base64Content: pd.content })
    } else if (pd.type === 'file') {
      if (pd.isTextContent) {
        pasteMutation.mutate({ path: rel, content: pd.content })
      } else {
        pasteMutation.mutate({ path: rel, base64Content: pd.content })
      }
    } else {
      pasteMutation.mutate({ path: rel, content: pd.content })
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

  async function submitQuickNote() {
    if (!allowWorkspaceUpload() || !inKb()) return
    const stem = `note-${Date.now()}.md`
    const sh = share()
    try {
      if (sh) {
        const rel = listDir() ? `${listDir()}/${stem}` : stem
        const fullOpenPath = mediaPathForShareChild(rel)
        await createFileMutation.mutateAsync({ path: rel, content: '', shareToken: sh.token })
        props.onOpenViewer(props.windowId, fileItemFromPath(fullOpenPath))
        return
      }
      const base = currentPath() ? `${currentPath()}/${stem}` : stem
      await createFileMutation.mutateAsync({ path: base, content: '' })
      props.onOpenViewer(props.windowId, fileItemFromPath(base))
    } catch {
      /* errors surface via createFileMutation.isError */
    }
  }

  const fileExists = createMemo(() => {
    const stem = newFileName().trim()
    if (!stem) return false
    const addExt = inKb() ? '.md' : '.txt'
    const finalName = stem.includes('.') ? stem : `${stem}${addExt}`
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
    const addExt = inKb() ? '.md' : '.txt'
    const finalName = stem.includes('.') ? stem : `${stem}${addExt}`
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
    const addExt = inKb() ? '.md' : '.txt'
    const fileStem = stem.includes('.') ? stem : `${stem}${addExt}`
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
      const finalPath = base.includes('.') ? base : `${base}${addExt}`
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

  function handleFileClick(file: FileItem) {
    if (file.isDirectory) {
      setUnsupportedFile(null)
      props.onNavigateDir(props.windowId, file.path)
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
      props.onRequestPlay?.(src, file.path, currentPath() || undefined)
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
    <div class='relative flex h-full min-h-0 flex-1 flex-col overflow-hidden'>
      <div
        data-no-window-drag
        class='flex h-9 shrink-0 items-center border-b border-border bg-muted/50 px-2 py-0'
      >
        <div class='flex w-full min-w-0 flex-wrap items-center justify-between gap-1'>
          <div data-breadcrumb-slot class='flex min-h-0 min-w-0 max-w-full flex-1 overflow-hidden'>
            <Breadcrumbs
              currentPath={currentPath()}
              onNavigate={handleBreadcrumbNavigate}
              mode='Workspace'
              onCrumbContextMenu={handleWorkspaceBreadcrumbContextMenu}
            />
          </div>
          <div class='flex shrink-0 flex-wrap items-center justify-end gap-1 md:justify-start'>
            <Show when={inKb()}>
              <div
                class='order-last flex basis-full items-center justify-end md:order-0 md:basis-auto md:justify-start'
                data-kb-search-root
              >
                <div class='relative'>
                  <button
                    type='button'
                    aria-label='Open search'
                    title='Search notes (Ctrl+K)'
                    class='text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent outline-none'
                    onClick={() => setSearchPopoverOpen(!searchPopoverOpen())}
                  >
                    <Search class='h-3.5 w-3.5' stroke-width={2} />
                  </button>
                  <Show when={searchPopoverOpen()}>
                    <div class='border-border bg-popover ring-offset-background absolute right-0 top-full z-50 mt-1.5 w-72 rounded-md border p-2 shadow-lg outline-none'>
                      <input
                        ref={(el) => {
                          kbSearchInputEl = el ?? undefined
                        }}
                        type='search'
                        placeholder='Search notes...'
                        class='border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none'
                        value={searchQuery()}
                        onInput={(e) => setSearchQuery((e.currentTarget as HTMLInputElement).value)}
                      />
                    </div>
                  </Show>
                </div>
              </div>
            </Show>
            <Show when={showShareCreateToolbar()}>
              <button
                type='button'
                title='Create new folder'
                class='inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-sm font-medium shadow-xs transition-colors hover:bg-muted hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50'
                onClick={openCreateFolderDialog}
              >
                <FolderPlus class='h-3.5 w-3.5' stroke-width={2} />
              </button>
              <button
                type='button'
                title='Create new file'
                class='inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-sm font-medium shadow-xs transition-colors hover:bg-muted hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50'
                onClick={openCreateFileDialog}
              >
                <FilePlus class='h-3.5 w-3.5' stroke-width={2} />
              </button>
              <Show when={inKb()}>
                <button
                  type='button'
                  title='Quick note (empty file, opens for editing)'
                  aria-label='Quick note'
                  class='inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-sm font-medium shadow-xs transition-colors hover:bg-muted hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50'
                  onClick={() => void submitQuickNote()}
                  disabled={createFileMutation.isPending}
                >
                  <FileText class='h-3.5 w-3.5' stroke-width={2} />
                </button>
              </Show>
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
                class='inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-sm font-medium shadow-xs transition-colors hover:bg-muted hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50'
                onClick={openCreateFolderDialog}
              >
                <FolderPlus class='h-3.5 w-3.5' stroke-width={2} />
              </button>
              <button
                type='button'
                title='Create new file'
                class='inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-sm font-medium shadow-xs transition-colors hover:bg-muted hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50'
                onClick={openCreateFileDialog}
              >
                <FilePlus class='h-3.5 w-3.5' stroke-width={2} />
              </button>
              <Show when={inKb()}>
                <button
                  type='button'
                  title='Quick note (empty file, opens for editing)'
                  aria-label='Quick note'
                  class='inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-sm font-medium shadow-xs transition-colors hover:bg-muted hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50'
                  onClick={() => void submitQuickNote()}
                  disabled={createFileMutation.isPending}
                >
                  <FileText class='h-3.5 w-3.5' stroke-width={2} />
                </button>
              </Show>
              <UploadMenu
                mode='Workspace'
                disabled={isUploading()}
                onUpload={(files) => void uploadFilesToServer(files)}
              />
              <div class='bg-border mx-1 h-5 w-px shrink-0' />
            </Show>
            <ViewModeToggle viewMode={viewMode()} onChange={setViewMode} mode='Workspace' />
          </div>
        </div>
      </div>

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
        >
          <div class='min-h-0 flex-1 overflow-auto'>
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
                        <div class='file-browser-grid gap-4 px-2 py-2'>
                          <Show when={currentPath()}>
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
                          </Show>
                          <For each={files()}>
                            {(file) => (
                              <div
                                data-no-window-drag
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
                                    {gridHeroIcon(file, props.fileIconContext())}
                                  </div>
                                </div>
                                <div class='flex flex-col gap-1 p-3'>
                                  <p class='truncate text-sm font-medium' title={file.name}>
                                    {file.name}
                                  </p>
                                  <div class='flex items-center justify-end text-xs text-muted-foreground'>
                                    <span>{file.isDirectory ? '' : formatFileSize(file.size)}</span>
                                  </div>
                                </div>
                              </div>
                            )}
                          </For>
                          <DirectoryListingEmpty
                            show={showEmptyFolder()}
                            canUpload={allowWorkspaceUpload()}
                          />
                        </div>
                      </Match>
                      <Match when={viewMode() === 'list'}>
                        <div class='relative w-full overflow-x-auto'>
                          <table class='w-full caption-bottom text-sm'>
                            <tbody class='[&_tr:last-child]:border-0'>
                              <Show when={currentPath()}>
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
                                  <td class='w-12 p-2 align-middle'>
                                    <div class='flex items-center justify-center'>
                                      <ArrowUp
                                        class='h-5 w-5 text-muted-foreground'
                                        size={20}
                                        stroke-width={2}
                                      />
                                    </div>
                                  </td>
                                  <td class='p-2 align-middle font-medium'>..</td>
                                  <td class='p-2 align-middle text-right text-muted-foreground' />
                                </tr>
                              </Show>
                              <For each={files()}>
                                {(file) => {
                                  const canDragRow = enableDrag()
                                  return (
                                    <tr
                                      data-no-window-drag
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
                                        class='w-12 p-2 align-middle'
                                        {...(isRowKnowledgeBase(file)
                                          ? { 'data-kb-root-icon': '' }
                                          : {})}
                                      >
                                        <div class='flex items-center justify-center'>
                                          {fileItemIcon(file, props.fileIconContext())}
                                        </div>
                                      </td>
                                      <td class='p-2 align-middle font-medium'>
                                        <span class='truncate'>{file.name}</span>
                                      </td>
                                      <td class='p-2 align-middle text-right text-muted-foreground'>
                                        <span class='inline-block w-20 tabular-nums'>
                                          {file.isDirectory ? '' : formatFileSize(file.size)}
                                        </span>
                                      </td>
                                    </tr>
                                  )
                                }}
                              </For>
                              <DirectoryListingEmptyTableRow
                                show={showEmptyFolder()}
                                canUpload={allowWorkspaceUpload()}
                              />
                            </tbody>
                          </table>
                        </div>
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
            showOpenInNewTabForFiles={!!props.onOpenInNewTab}
            onOpenInSplitViewFromRow={props.onOpenInSplitView ? openInSplitViewFromRow : undefined}
            onContextDownload={handleContextDownload}
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
            renamePending={renameItemMutation.isPending}
            renameError={renameItemMutation.error as Error | undefined}
            renameTargetExists={renameTargetExists}
            moveTarget={moveTarget}
            closeMoveDialog={closeMoveDialog}
            moveDialogFilePath={moveDialogFilePath}
            confirmMoveTo={confirmMoveTo}
            movePending={moveItemMutation.isPending}
            moveError={moveItemMutation.error as Error | undefined}
            shareToken={() => share()?.token}
            shareRootPath={() => share()?.sharePath}
            deleteTarget={deleteTarget}
            setDeleteTarget={setDeleteTarget}
            deletePending={deleteMutation.isPending}
            revokeSharePending={share() ? false : revokeShareMutation.isPending}
            onConfirmDelete={() => {
              const it = deleteTarget()
              if (!it) return
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
            createFolderPending={createFolderMutation.isPending}
            createFolderIsError={createFolderMutation.isError}
            createFolderError={createFolderMutation.error as Error | undefined}
            folderExists={folderExists}
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
            pasteExistingLowerNames={pasteExistingLowerNames}
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
