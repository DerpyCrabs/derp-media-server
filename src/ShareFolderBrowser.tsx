import { FLOATING_Z_ROW_MENU } from '@/lib/floating-z-index'
import type { ExplorerItem, ExplorerVisibleRange } from '@/lib/explorer-model'
import { createExplorerModel, explorerItemKey } from '@/lib/explorer-model'
import { queryKeys } from '@/lib/query-keys'
import { useBrowserViewModeStore } from '@/lib/browser-view-mode-store'
import { stripSharePrefix } from '@/lib/source-context'
import { collectDroppedUploadFiles } from '@/lib/collect-dropped-upload-files'
import type { FileItem } from '@/lib/types'
import { MediaType } from '@/lib/types'
import type { DirectoryListing } from '@/lib/virtual-directory'
import { normalizeNewFilePath } from '@/lib/new-file-name'
import { formatFileSize } from '@/lib/media-utils'
import { cn } from '@/lib/utils'
import { useMediaPlayer } from '@/lib/use-media-player'
import { useQueryClient } from '@tanstack/solid-query'
import ArrowUp from 'lucide-solid/icons/arrow-up'
import ChevronRight from 'lucide-solid/icons/chevron-right'
import AppWindow from 'lucide-solid/icons/app-window'
import FilePlus from 'lucide-solid/icons/file-plus'
import Settings from 'lucide-solid/icons/settings'
import Folder from 'lucide-solid/icons/folder'
import FolderPlus from 'lucide-solid/icons/folder-plus'
import Ellipsis from 'lucide-solid/icons/ellipsis'
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
import { createUrlSearchParamsMemo, useBrowserHistory } from './browser-history'
import { navigateSearchParams } from './browser-history'
import {
  BreadcrumbContextMenu,
  type BreadcrumbMenuTarget,
} from './file-browser/BreadcrumbContextMenu'
import { DeleteFileDialog } from './file-browser/DeleteFileDialog'
import { KbInlineCreateFooter } from './file-browser/KbInlineCreateFooter'
import { MoveToDialog } from './file-browser/MoveToDialog'
import { RenameDialog } from './file-browser/RenameDialog'
import { UploadMenu } from './file-browser/UploadMenu'
import type { UploadToastState } from './file-browser/types'
import {
  DirectoryListingEmpty,
  DirectoryListingEmptyTableRow,
  DirectoryListingErrorPanel,
  DirectoryListingLoading,
} from './file-browser/DirectoryListingFeedback'
import { FloatingScrollActions } from './file-browser/FloatingScrollActions'
import { FloatingContextMenu } from './file-browser/FloatingContextMenu'
import { UploadToastStack } from './file-browser/UploadToastStack'
import { useInlineModeInputFocus } from './file-browser/use-inline-mode-input-focus'
import { VirtualDirectoryGrid } from './file-browser/VirtualDirectoryGrid'
import { VirtualDirectoryList } from './file-browser/VirtualDirectoryList'
import { ViewModeToggle } from './file-browser/ViewModeToggle'
import { getVirtualFileScroller } from './file-browser/virtual-directory-scroll'
import { useDynamicFavicon } from './lib/use-dynamic-favicon'
import { createLongPressContextMenuHandlers } from './lib/long-press-context-menu'
import { playFile, viewFile } from './lib/url-state-actions'
import type { FileIconContext } from './lib/use-file-icon'
import { EMPTY_FILE_ICON_CONTEXT, fileIcon, gridHeroIcon } from './lib/use-file-icon'
import { useDeferredLoading } from './lib/use-deferred-loading'
import { ThemeSwitcherMenuContent } from './ThemeSwitcherMenuContent'
import { MainMediaPlayers } from './media/MainMediaPlayers'
import { OfflineBadge } from './OfflineBadge'
import {
  isPathAvailableOffline,
  isOfflineFeatureAvailable,
  makeAvailableOffline,
} from './lib/offline-files'
import { removeWebOfflineAndWait, subscribeWebOfflineCatalog } from './lib/web-offline-storage'
import { shareOfflineJobScope } from './lib/offline-job-observer'
import type { TextViewerShareContext } from './media/TextViewerDialog'
import {
  grantOpenScope,
  legacyFileItemFromPath,
  resourceForFileItem,
} from './lib/legacy-resource-adapter'
import { executeOpenPlan, openResource } from './lib/open-resource'
import type { ResourceSummary } from '@/lib/resource'
import { createGrantExplorerAdapter } from './lib/resource-adapters/grant'
import {
  browserExplorerStorage,
  createBrowserOnlineAdapter,
  createUrlExplorerHistory,
} from './explorer/browser-adapters'
import { useExplorerModel } from './explorer/use-explorer-model'
import { createExplorerMutation } from './explorer/create-explorer-mutation'
import { explorerCapabilitiesForFile, explorerItemForFile } from './explorer/snapshot-items'
import { subscribeSseShare } from './lib/sse-shared-worker-client'

type ShareRestrictions = {
  allowDelete: boolean
  allowUpload: boolean
  allowEdit: boolean
  maxUploadBytes: number
}

export type ShareInfoPayload = {
  name: string
  path: string
  isDirectory: boolean
  editable: boolean
  mediaType: string
  extension: string
  restrictions?: ShareRestrictions
  isKnowledgeBase?: boolean
  /** Present when this share path lies inside a configured knowledge base (for KB markdown / paste). */
  knowledgeBaseRoot?: string
  adminViewMode: 'list' | 'grid'
  resource?: ResourceSummary
}

type MenuState = { x: number; y: number; file: FileItem }

type Props = {
  token: string
  shareInfo: ShareInfoPayload
}

export function ShareFolderBrowser(props: Props) {
  let browserRootEl: HTMLDivElement | undefined
  const history = useBrowserHistory()
  const urlSearchParams = createUrlSearchParamsMemo(history)
  const queryClient = useQueryClient()
  const initialSubDir = urlSearchParams().get('dir') ?? ''
  const initialGrantListing = queryClient.getQueryData<DirectoryListing>(
    queryKeys.shareFiles(props.token, initialSubDir),
  )
  const grantAdapter = createGrantExplorerAdapter({
    token: props.token,
    rootPath: props.shareInfo.path,
    editable: props.shareInfo.editable,
    restrictions: props.shareInfo.restrictions,
    ...(initialGrantListing
      ? { initialListing: { path: initialSubDir, listing: initialGrantListing } }
      : {}),
    subscribe: (listener) =>
      subscribeSseShare(props.token, (event) => {
        if (event.type === 'connected') {
          console.log('[Share SSE] Connected to share stream')
          return
        }
        if (event.type !== 'files-changed') return
        listener()
        void queryClient.invalidateQueries({ queryKey: queryKeys.shareInfo(props.token) })
        void queryClient.invalidateQueries({ queryKey: queryKeys.shareFiles(props.token) })
        void queryClient.invalidateQueries({ queryKey: queryKeys.shareContent(props.token) })
      }),
    ...(isOfflineFeatureAvailable()
      ? {
          offline: {
            subscribe: subscribeWebOfflineCatalog,
            isKept: (item: ExplorerItem) => isPathAvailableOffline(item.file.path),
            keep: async (item: ExplorerItem) => {
              const started = await makeAvailableOffline(item.file, {
                token: props.token,
                sharePath: props.shareInfo.path,
              })
              if (!started) throw new Error('Offline save is unavailable')
            },
            remove: (item: ExplorerItem, signal: AbortSignal) =>
              removeWebOfflineAndWait(
                item.file.path,
                item.file.name,
                shareOfflineJobScope(props.token),
                signal,
              ),
          },
        }
      : {}),
  })
  const explorer = useExplorerModel(
    createExplorerModel({
      adapter: grantAdapter,
      opener: openResource,
      history: createUrlExplorerHistory({
        currentPath: () => new URLSearchParams(window.location.search).get('dir') ?? '',
        navigate: (path, replace) =>
          navigateSearchParams({ dir: path || null }, replace ? 'replace' : 'push'),
      }),
      storage: browserExplorerStorage(),
      clock: Date,
      online: createBrowserOnlineAdapter(),
      rootLabel: props.shareInfo.name,
      initialViewMode: useBrowserViewModeStore
        .getState()
        .getViewMode(`share-viewmode-${props.token}`, props.shareInfo.adminViewMode),
      storageKey: `explorer:grant:${grantAdapter.scope.id}`,
    }),
  )
  const explorerSnapshot = explorer.snapshot
  const reportVisibleRange = (range: ExplorerVisibleRange) => {
    void explorer.dispatch({ type: 'visibleRange', range })
  }
  useDynamicFavicon(() => ({}), {
    rootName: () => props.shareInfo.name,
    getSearch: () => history().search,
  })

  const [rowMenu, setRowMenu] = createSignal<MenuState | null>(null)
  const [breadcrumbMenu, setBreadcrumbMenu] = createSignal<BreadcrumbMenuTarget | null>(null)
  const [deleteTarget, setDeleteTarget] = createSignal<FileItem | null>(null)
  const [showCreateFolder, setShowCreateFolder] = createSignal(false)
  const [showCreateFile, setShowCreateFile] = createSignal(false)
  const [newItemName, setNewItemName] = createSignal('')
  const [inlineMode, setInlineMode] = createSignal<'file' | 'folder' | null>(null)
  const [inlineName, setInlineName] = createSignal('')
  const [showRename, setShowRename] = createSignal(false)
  const [renamingItem, setRenamingItem] = createSignal<FileItem | null>(null)
  const [renameNewName, setRenameNewName] = createSignal('')
  const [moveTarget, setMoveTarget] = createSignal<FileItem | null>(null)
  const [uploadToast, setUploadToast] = createSignal<UploadToastState>({ kind: 'hidden' })
  const [externalUploadDragOver, setExternalUploadDragOver] = createSignal(false)
  const [shareSettingsOpen, setShareSettingsOpen] = createSignal(false)
  const [shareSettingsMenuPos, setShareSettingsMenuPos] = createSignal<{
    top: number
    right: number
  } | null>(null)
  let externalUploadDragDepth = 0
  let inlineFileInputEl: HTMLInputElement | undefined
  let inlineFolderInputEl: HTMLInputElement | undefined

  useInlineModeInputFocus(
    inlineMode,
    () => inlineFileInputEl,
    () => inlineFolderInputEl,
  )

  const currentSubDir = createMemo(() => explorerSnapshot().path)
  const playingPath = createMemo(() => urlSearchParams().get('playing') ?? '')
  const shareBrowserScrollScope = () => `share-file-browser:${props.token}`

  const shareContext = createMemo(
    (): TextViewerShareContext => ({
      token: props.token,
      sharePath: props.shareInfo.path,
      isDirectory: props.shareInfo.isDirectory,
    }),
  )

  const shareFileIconContext = createMemo(
    (): FileIconContext => ({
      ...EMPTY_FILE_ICON_CONTEXT,
      mediaShare: { token: props.token, sharePath: props.shareInfo.path },
    }),
  )

  const shareCanEdit = createMemo(
    () => props.shareInfo.editable && props.shareInfo.restrictions?.allowEdit !== false,
  )

  const canUpload = createMemo(() => explorerSnapshot().capabilities.includes('upload'))

  const capabilitiesForFile = (file: FileItem) =>
    explorerCapabilitiesForFile(explorerSnapshot(), file)
  const itemForFile = (file: FileItem) => explorerItemForFile(explorerSnapshot(), file)

  const filesQuery = {
    get data() {
      const snapshot = explorerSnapshot()
      return snapshot.status === 'idle' ||
        (snapshot.status === 'loading' && snapshot.items.length === 0)
        ? undefined
        : { files: snapshot.items.map((item) => item.file) }
    },
    get isPending() {
      const snapshot = explorerSnapshot()
      return snapshot.status === 'idle' || snapshot.status === 'loading'
    },
    get isError() {
      return explorerSnapshot().status === 'error'
    },
    get error() {
      const error = explorerSnapshot().error
      return error ? new Error(error.message) : null
    },
    refetch: () => explorer.dispatch({ type: 'refresh' }),
  }

  const files = createMemo(() => explorerSnapshot().items.map((item) => item.file))
  const isFilesLoadingInitial = createMemo(
    () => filesQuery.isPending && filesQuery.data === undefined,
  )
  const showFilesDeferredLoading = useDeferredLoading(() => isFilesLoadingInitial())

  const inKb = createMemo(() => !!props.shareInfo.isKnowledgeBase)
  const showEmptyFolder = createMemo(
    () => !filesQuery.isError && filesQuery.data !== undefined && files().length === 0,
  )
  const showInlineCreate = createMemo(() => canUpload() && inKb())

  createEffect(
    on(
      currentSubDir,
      () => {
        batch(() => {
          setInlineMode(null)
          setInlineName('')
        })
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    if (!shareSettingsOpen()) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShareSettingsOpen(false)
        setShareSettingsMenuPos(null)
      }
    }
    document.addEventListener('keydown', onKey)
    onCleanup(() => document.removeEventListener('keydown', onKey))
  })

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
    const fileStem = normalizeNewFilePath(stem, inKb())
    const subPath = currentSubDir() ? `${currentSubDir()}/${fileStem}` : fileStem
    const sharePathNorm = props.shareInfo.path.replace(/\\/g, '/')
    const fullPath = sharePathNorm ? `${sharePathNorm}/${subPath}` : subPath
    createFileMutation.mutate(
      { type: 'file', path: subPath, content: '' },
      {
        onSuccess: () => {
          setInlineMode(null)
          setInlineName('')
          createFileMutation.reset()
          if (inKb()) handleFileClick(fileItemFromPath(fullPath), false)
        },
      },
    )
  }

  function submitInlineFolder() {
    const name = inlineName().trim()
    if (!name || inlineFolderExists() || !showInlineCreate()) return
    const subPath = currentSubDir() ? `${currentSubDir()}/${name}` : name
    createFolderMutation.mutate(
      { type: 'folder', path: subPath },
      {
        onSuccess: () => {
          setInlineMode(null)
          setInlineName('')
          createFolderMutation.reset()
          if (inKb()) navigateShareBreadcrumb(subPath, name)
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

  function itemByRelativePath(path: string): ExplorerItem {
    const normalized = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    const item = explorerSnapshot().items.find(
      (candidate) =>
        stripSharePrefix(candidate.file.path, props.shareInfo.path).replace(/^\/+|\/+$/g, '') ===
        normalized,
    )
    if (!item) throw new Error('Resource is not in current Explorer page')
    return item
  }

  const createFolderMutation = createExplorerMutation(
    (vars: { type: string; path: string }) => {
      const parts = vars.path.split('/').filter(Boolean)
      return explorer.dispatch({
        type: 'command',
        command: {
          kind: 'createFolder',
          parentPath: parts.slice(0, -1).join('/'),
          name: parts.at(-1) ?? '',
        },
      })
    },
    {
      onSuccess: () => {
        setShowCreateFolder(false)
        setNewItemName('')
      },
    },
  )

  const createFileMutation = createExplorerMutation(
    (vars: { type: string; path: string; content?: string }) => {
      const parts = vars.path.split('/').filter(Boolean)
      return explorer.dispatch({
        type: 'command',
        command: {
          kind: 'createFile',
          parentPath: parts.slice(0, -1).join('/'),
          name: parts.at(-1) ?? '',
          content: vars.content ?? '',
        },
      })
    },
    {
      onSuccess: () => {
        setShowCreateFile(false)
        setNewItemName('')
      },
    },
  )

  const deleteItemMutation = createExplorerMutation(
    (relativePath: string) =>
      explorer.dispatch({
        type: 'command',
        command: { kind: 'delete', item: itemByRelativePath(relativePath) },
      }),
    { onSuccess: () => setDeleteTarget(null) },
  )

  const renameItemMutation = createExplorerMutation((vars: { oldPath: string; newPath: string }) =>
    explorer.dispatch({
      type: 'command',
      command: {
        kind: 'rename',
        item: itemByRelativePath(vars.oldPath),
        name: vars.newPath.split('/').filter(Boolean).at(-1) ?? '',
      },
    }),
  )

  const moveItemMutation = createExplorerMutation((vars: { oldPath: string; newPath: string }) =>
    explorer.dispatch({
      type: 'command',
      command: {
        kind: 'move',
        item: itemByRelativePath(vars.oldPath),
        destinationPath: vars.newPath.split('/').filter(Boolean).slice(0, -1).join('/'),
      },
    }),
  )

  const viewMode = createMemo(() => explorerSnapshot().viewMode)

  function setViewMode(mode: 'list' | 'grid') {
    void explorer.dispatch({ type: 'viewMode', viewMode: mode })
  }

  const renameTargetExists = createMemo(() => {
    const item = renamingItem()
    const name = renameNewName().trim()
    if (!item || !name || renameItemMutation.isPending) return false
    return files().some((f) => f.path !== item.path && f.name.toLowerCase() === name.toLowerCase())
  })

  const breadcrumbs = createMemo(() => {
    return explorerSnapshot().breadcrumbs
  })

  onMount(() => {
    useMediaPlayer.getState().setShareContext(props.token, props.shareInfo.path)
  })

  onCleanup(() => {
    useMediaPlayer.getState().clearShareContext()
  })

  function dismissMenu() {
    setRowMenu(null)
  }

  const shareBreadcrumbMenuActions = createMemo(() => {
    const m = breadcrumbMenu()
    if (!m) {
      return {
        showOpenInNewTab: false,
        showOpenInWorkspace: false,
        showDownloadAsZip: false,
        offlineActionLabel: undefined,
      }
    }
    const capabilities = capabilitiesForPath(m.serverPath)
    return {
      showOpenInNewTab: capabilities.includes('browse'),
      showOpenInWorkspace: props.shareInfo.isDirectory && capabilities.includes('browse'),
      showDownloadAsZip: capabilities.includes('download'),
      offlineActionLabel: capabilities.includes('removeOffline')
        ? 'Remove from offline'
        : capabilities.includes('keepOffline')
          ? 'Make available offline'
          : undefined,
    }
  })

  function shareBreadcrumbAsFolder(m: BreadcrumbMenuTarget): FileItem {
    const root = props.shareInfo.path.replace(/\\/g, '/').replace(/\/+$/, '')
    const path = m.serverPath.replace(/\\/g, '/').replace(/\/+$/, '')
    return {
      name: m.displayName,
      path: m.serverPath,
      type: MediaType.FOLDER,
      size: 0,
      extension: '',
      isDirectory: true,
      ...(path === root && props.shareInfo.resource ? { resource: props.shareInfo.resource } : {}),
    }
  }

  function breadcrumbForPath(path: string) {
    const relative = stripSharePrefix(path, props.shareInfo.path)
      .replace(/\\/g, '/')
      .replace(/^\/+|\/+$/g, '')
    return explorerSnapshot().breadcrumbs.find((breadcrumb) => breadcrumb.path === relative)
  }

  function capabilitiesForPath(path: string) {
    return breadcrumbForPath(path)?.capabilities ?? []
  }

  function externalShareItem(file: FileItem): ExplorerItem {
    const breadcrumbItem = breadcrumbForPath(file.path)?.item
    if (breadcrumbItem) return breadcrumbItem
    const resource = file.resource ?? resourceForFileItem(file)
    return {
      key: explorerItemKey(resource.ref),
      file: { ...file, resource },
      resource,
      capabilities: capabilitiesForPath(file.path),
    }
  }

  function canOpenShareFolder(file: FileItem, surface: 'share' | 'workspace'): boolean {
    if (!file.isDirectory) return false
    return (
      openResource(resourceForFileItem(file), 'browse', {
        surface,
        scope: grantOpenScope(props.token),
      }).kind === 'browse'
    )
  }

  function navigateShareBreadcrumb(path: string, name: string) {
    const shareRoot = props.shareInfo.path.replace(/\\/g, '/').replace(/\/+$/, '')
    const serverPath = path ? `${shareRoot}/${path}` : shareRoot
    const file: FileItem = {
      name,
      path: serverPath,
      type: MediaType.FOLDER,
      size: 0,
      extension: '',
      isDirectory: true,
      ...(!path && props.shareInfo.resource ? { resource: props.shareInfo.resource } : {}),
    }
    if (canOpenShareFolder(file, 'share')) {
      void explorer.dispatch({ type: 'navigate', path })
    }
  }

  function handleShareBreadcrumbOpenInNewTab() {
    const m = breadcrumbMenu()
    if (!m) return
    const file = shareBreadcrumbAsFolder(m)
    if (!canOpenShareFolder(file, 'share')) return
    const subPath = stripSharePrefix(m.serverPath, props.shareInfo.path)
    const params = new URLSearchParams()
    if (subPath) params.set('dir', subPath)
    const query = params.toString()
    const base = `/share/${encodeURIComponent(props.token)}`
    window.open(query ? `${base}?${query}` : base, '_blank')
  }

  function handleShareBreadcrumbOpenInWorkspace() {
    const m = breadcrumbMenu()
    if (!m || !props.shareInfo.isDirectory) return
    const file = shareBreadcrumbAsFolder(m)
    if (!canOpenShareFolder(file, 'workspace')) return
    const subPath = stripSharePrefix(m.serverPath, props.shareInfo.path)
    const params = new URLSearchParams()
    if (subPath) params.set('dir', subPath)
    const query = params.toString()
    const base = `/share/${encodeURIComponent(props.token)}/workspace`
    window.open(query ? `${base}?${query}` : base, '_blank')
  }

  function openShareWorkspaceSameTab() {
    const subDir = currentSubDir()
    const root = props.shareInfo.path.replace(/\\/g, '/').replace(/\/+$/, '')
    const file: FileItem = {
      name: subDir.split('/').filter(Boolean).at(-1) ?? props.shareInfo.name,
      path: subDir ? `${root}/${subDir}` : root,
      type: MediaType.FOLDER,
      size: 0,
      extension: '',
      isDirectory: true,
      ...(!subDir && props.shareInfo.resource ? { resource: props.shareInfo.resource } : {}),
    }
    if (!canOpenShareFolder(file, 'workspace')) return
    const qs = urlSearchParams().toString()
    window.location.href = `/share/${encodeURIComponent(props.token)}/workspace${qs ? `?${qs}` : ''}`
  }

  function openShareFolderInWorkspace(file: FileItem) {
    if (!canOpenShareFolder(file, 'workspace')) return
    const sharePathNorm = props.shareInfo.path.replace(/\\/g, '/')
    const pathNorm = file.path.replace(/\\/g, '/')
    const subPath =
      pathNorm === sharePathNorm ? '' : stripSharePrefix(file.path, props.shareInfo.path)
    const params = new URLSearchParams()
    if (subPath) params.set('dir', subPath)
    const query = params.toString()
    const base = `/share/${encodeURIComponent(props.token)}/workspace`
    window.open(query ? `${base}?${query}` : base, '_blank')
  }

  function handleShareBreadcrumbDownloadZip() {
    const m = breadcrumbMenu()
    if (!m) return
    handleDownload(shareBreadcrumbAsFolder(m))
  }

  function handleShareBreadcrumbMakeAvailableOffline() {
    const m = breadcrumbMenu()
    if (!m) return
    handleMakeAvailableOffline(shareBreadcrumbAsFolder(m))
  }

  function openRowMenu(e: MouseEvent, file: FileItem) {
    e.preventDefault()
    e.stopPropagation()
    setRowMenu({ x: e.clientX, y: e.clientY, file })
  }

  function openRowMenuButton(e: MouseEvent, file: FileItem) {
    e.preventDefault()
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setRowMenu({ x: rect.right, y: rect.bottom, file })
  }

  function prefetchShareParentDirectory() {
    const sub = currentSubDir()
    if (!sub) return
    const parts = sub.split('/').filter(Boolean)
    const parentSub = parts.length <= 1 ? '' : parts.slice(0, -1).join('/')
    void explorer.dispatch({ type: 'prefetch', path: parentSub })
  }

  function handleParentDirectory() {
    const sub = currentSubDir()
    if (!sub) return
    const parts = sub.split('/').filter(Boolean)
    const parent = parts.length <= 1 ? '' : parts.slice(0, -1).join('/')
    navigateShareBreadcrumb(
      parent,
      parent.split('/').filter(Boolean).at(-1) ?? props.shareInfo.name,
    )
  }

  function handleDownload(file: FileItem) {
    const item = itemForFile(file) ?? externalShareItem(file)
    void explorer
      .dispatch(
        itemForFile(file)
          ? { type: 'action', action: 'download', key: item.key }
          : { type: 'actionExternal', action: 'download', item },
      )
      .then((outcome) => {
        if (outcome.kind !== 'action' || outcome.plan.kind !== 'download') return
        const anchor = document.createElement('a')
        anchor.href = outcome.plan.href
        anchor.download = outcome.plan.fileName
        anchor.click()
      })
  }

  function handleMakeAvailableOffline(file: FileItem) {
    const item = itemForFile(file) ?? externalShareItem(file)
    const kind = item.capabilities.includes('removeOffline') ? 'removeOffline' : 'keepOffline'
    void explorer.dispatch({ type: 'command', command: { kind, item } })
  }

  function fileItemFromPath(filePath: string): FileItem {
    return legacyFileItemFromPath(filePath)
  }

  function handleFileClick(file: FileItem, countView = true) {
    const item = itemForFile(file)
    if (!item) return
    void explorer.dispatch({ type: 'open', key: item.key, surface: 'share' }).then((outcome) => {
      if (outcome.kind !== 'open') return
      executeOpenPlan(outcome.plan, (planned) => {
        if (planned.kind === 'browse') {
          void explorer.dispatch({
            type: 'navigate',
            path: stripSharePrefix(file.path, props.shareInfo.path),
          })
          return
        }
        if (planned.kind !== 'playback' && planned.kind !== 'viewer') return

        if (countView) {
          void explorer.dispatch({
            type: 'command',
            command: { kind: 'recordView', item },
          })
        }
        if (planned.kind === 'playback') {
          useMediaPlayer.getState().playFile(file.path, planned.media)
          playFile(file.path)
        } else {
          viewFile(file.path, undefined, planned.viewer.id)
        }
      })
    })
  }

  function submitCreateFolder(e: Event) {
    e.preventDefault()
    const name = newItemName().trim()
    if (!name) return
    const sub = currentSubDir() ? `${currentSubDir()}/${name}` : name
    createFolderMutation.mutate({ type: 'folder', path: sub })
  }

  function submitCreateFile(e: Event) {
    e.preventDefault()
    let name = newItemName().trim()
    if (!name) return
    name = normalizeNewFilePath(name, inKb())
    const sub = currentSubDir() ? `${currentSubDir()}/${name}` : name
    createFileMutation.mutate({ type: 'file', path: sub, content: '' })
  }

  function openContextRename(file: FileItem) {
    setRenamingItem(file)
    setRenameNewName(file.name)
    setShowRename(true)
    dismissMenu()
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
    const oldRel = stripSharePrefix(item.path, props.shareInfo.path)
    const parts = oldRel.split('/').filter(Boolean)
    const parent = parts.slice(0, -1).join('/')
    const newRel = parent ? `${parent}/${newName}` : newName
    renameItemMutation.mutate(
      { oldPath: oldRel, newPath: newRel },
      { onSuccess: () => cancelRename() },
    )
  }

  function openContextMove(file: FileItem) {
    setMoveTarget(file)
    moveItemMutation.reset()
    dismissMenu()
  }

  function closeMoveDialog() {
    setMoveTarget(null)
    moveItemMutation.reset()
  }

  function confirmMoveTo(destDir: string) {
    const target = moveTarget()
    if (!target) return
    const sourceRel = stripSharePrefix(target.path, props.shareInfo.path)
    const baseName = sourceRel.split('/').filter(Boolean).pop()!
    const newPath = destDir ? `${destDir}/${baseName}` : baseName
    moveItemMutation.mutate(
      { oldPath: sourceRel, newPath: newPath },
      { onSuccess: () => closeMoveDialog() },
    )
  }

  const moveDialogRelPath = createMemo(() => {
    const t = moveTarget()
    if (!t) return ''
    return stripSharePrefix(t.path, props.shareInfo.path)
  })

  const isUploading = createMemo(() => uploadToast().kind === 'uploading')

  async function uploadFilesToServer(files: File[]) {
    if (files.length === 0 || !canUpload()) return
    setUploadToast({ kind: 'uploading', fileCount: files.length })
    try {
      const outcome = await explorer.dispatch({
        type: 'command',
        command: { kind: 'upload', parentPath: currentSubDir(), files },
      })
      if (outcome.kind === 'unavailable') throw new Error(outcome.error.message)
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
    return !!(dtr && dtr.types.includes('Files'))
  }

  function onExternalUploadDragEnter(e: globalThis.DragEvent) {
    if (!canUpload() || !isOsFileUploadDrag(e)) return
    e.preventDefault()
    externalUploadDragDepth++
    if (externalUploadDragDepth === 1) setExternalUploadDragOver(true)
  }

  function onExternalUploadDragLeave(e: globalThis.DragEvent) {
    if (!canUpload()) return
    e.preventDefault()
    externalUploadDragDepth--
    if (externalUploadDragDepth <= 0) {
      externalUploadDragDepth = 0
      setExternalUploadDragOver(false)
    }
  }

  function onExternalUploadDragOver(e: globalThis.DragEvent) {
    if (!canUpload() || !isOsFileUploadDrag(e)) return
    e.preventDefault()
    const dtr = e.dataTransfer
    if (dtr) dtr.dropEffect = 'copy'
  }

  async function onExternalUploadDrop(e: globalThis.DragEvent) {
    e.preventDefault()
    externalUploadDragDepth = 0
    setExternalUploadDragOver(false)
    if (!canUpload()) return
    const dtr = e.dataTransfer
    if (!dtr || dtr.files.length === 0) return
    const dropped = await collectDroppedUploadFiles(dtr)
    if (dropped.length > 0) void uploadFilesToServer(dropped)
  }

  function focusExplorerItem(key: string | undefined) {
    if (!key || !browserRootEl) return
    const item = explorerSnapshot().items.find((candidate) => candidate.key === key)
    if (!item) return
    const findElement = () =>
      [...browserRootEl!.querySelectorAll<HTMLElement>('[data-explorer-key]')].find(
        (candidate) => candidate.dataset.explorerKey === key,
      )
    const mounted = findElement()
    if (mounted) {
      mounted.focus()
      return
    }
    const scroller = getVirtualFileScroller(shareBrowserScrollScope())
    if (!scroller?.hasPath(item.file.path)) return
    scroller.scrollToPath(item.file.path)
    let attempts = 0
    const focusWhenMounted = () => {
      const element = findElement()
      if (element) {
        element.focus()
        return
      }
      attempts += 1
      if (attempts < 4) window.requestAnimationFrame(focusWhenMounted)
    }
    window.requestAnimationFrame(focusWhenMounted)
  }

  async function handleExplorerKeyDown(event: KeyboardEvent) {
    const target = event.target
    if (
      target instanceof Element &&
      target.closest('input, textarea, select, button, a, [contenteditable="true"]')
    ) {
      return
    }
    if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault()
      await explorer.dispatch({ type: event.key === 'ArrowLeft' ? 'back' : 'forward' })
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      await explorer.dispatch({
        type: 'focusMove',
        delta: event.key === 'ArrowDown' ? 1 : -1,
      })
      focusExplorerItem(explorerSnapshot().focusedKey)
      return
    }
    const focusedKey = explorerSnapshot().focusedKey
    if (event.key === 'Escape') {
      event.preventDefault()
      void explorer.dispatch({ type: 'clearSelection' })
    } else if ((event.key === ' ' || event.key === 'Spacebar') && focusedKey) {
      event.preventDefault()
      void explorer.dispatch({ type: 'select', key: focusedKey, mode: 'toggle' })
    } else if (event.key === 'Enter' && focusedKey) {
      event.preventDefault()
      const item = explorerSnapshot().items.find((candidate) => candidate.key === focusedKey)
      if (item) handleFileClick(item.file)
    }
  }

  function handleParentKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return
    event.preventDefault()
    event.stopPropagation()
    handleParentDirectory()
  }

  return (
    <>
      <MainMediaPlayers
        shareContext={shareContext()}
        shareCanEdit={shareCanEdit()}
        shareCanUpload={canUpload()}
        editableFolders={[]}
        explorerFiles={files()}
        knowledgeBases={
          props.shareInfo.knowledgeBaseRoot ? [props.shareInfo.knowledgeBaseRoot] : []
        }
      />
      <div
        ref={(element) => (browserRootEl = element)}
        class='min-h-screen'
        data-testid='share-file-browser'
        onKeyDown={(event) => void handleExplorerKeyDown(event)}
      >
        <BreadcrumbContextMenu
          target={breadcrumbMenu}
          onDismiss={() => setBreadcrumbMenu(null)}
          showOpenInNewTab={shareBreadcrumbMenuActions().showOpenInNewTab}
          onOpenInNewTab={handleShareBreadcrumbOpenInNewTab}
          showOpenInWorkspace={shareBreadcrumbMenuActions().showOpenInWorkspace}
          onOpenInWorkspace={handleShareBreadcrumbOpenInWorkspace}
          showDownloadAsZip={shareBreadcrumbMenuActions().showDownloadAsZip}
          onDownloadAsZip={handleShareBreadcrumbDownloadZip}
          offlineActionLabel={shareBreadcrumbMenuActions().offlineActionLabel}
          onMakeAvailableOffline={handleShareBreadcrumbMakeAvailableOffline}
        />
        <FloatingContextMenu
          state={rowMenu}
          anchor={(ctx) => ({ x: ctx.x, y: ctx.y })}
          onDismiss={dismissMenu}
          zIndex={FLOATING_Z_ROW_MENU}
          data-slot='share-row-context-menu'
        >
          {(ctx) => (
            <>
              <Show when={capabilitiesForFile(ctx.file).includes('download')}>
                <button
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => {
                    handleDownload(ctx.file)
                    dismissMenu()
                  }}
                >
                  {ctx.file.isDirectory ? 'Download as ZIP' : 'Download'}
                </button>
              </Show>
              <Show
                when={
                  capabilitiesForFile(ctx.file).includes('keepOffline') ||
                  capabilitiesForFile(ctx.file).includes('removeOffline')
                }
              >
                <button
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => {
                    handleMakeAvailableOffline(ctx.file)
                    dismissMenu()
                  }}
                >
                  {capabilitiesForFile(ctx.file).includes('removeOffline')
                    ? 'Remove from offline'
                    : 'Make available offline'}
                </button>
              </Show>
              <Show when={capabilitiesForFile(ctx.file).includes('rename')}>
                <button
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => openContextRename(ctx.file)}
                >
                  Rename
                </button>
              </Show>
              <Show when={capabilitiesForFile(ctx.file).includes('move')}>
                <button
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => openContextMove(ctx.file)}
                >
                  Move to…
                </button>
              </Show>
              <Show when={capabilitiesForFile(ctx.file).includes('browse')}>
                <button
                  type='button'
                  data-slot='context-menu-item'
                  class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => {
                    openShareFolderInWorkspace(ctx.file)
                    dismissMenu()
                  }}
                >
                  <AppWindow class='h-4 w-4 shrink-0' stroke-width={2} />
                  Open in Workspace
                </button>
              </Show>
              <Show when={capabilitiesForFile(ctx.file).includes('delete')}>
                <button
                  type='button'
                  data-slot='context-menu-item'
                  class='text-destructive flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                  role='menuitem'
                  onClick={() => {
                    setDeleteTarget(ctx.file)
                    dismissMenu()
                  }}
                >
                  Delete
                </button>
              </Show>
            </>
          )}
        </FloatingContextMenu>

        <DeleteFileDialog
          item={deleteTarget}
          isPending={deleteItemMutation.isPending}
          onDismiss={() => setDeleteTarget(null)}
          onConfirm={() => {
            const it = deleteTarget()
            if (!it) return
            const rel = stripSharePrefix(it.path, props.shareInfo.path)
            void deleteItemMutation.mutateAsync(rel)
          }}
        />

        <RenameDialog
          isOpen={showRename()}
          itemName={renamingItem()?.name ?? ''}
          newName={renameNewName()}
          onNewNameChange={setRenameNewName}
          onRename={submitRename}
          onCancel={cancelRename}
          isPending={renameItemMutation.isPending}
          error={renameItemMutation.error as Error | undefined}
          nameExists={renameTargetExists()}
          isDirectory={renamingItem()?.isDirectory ?? false}
        />

        <Show when={moveTarget()}>
          <MoveToDialog
            onClose={closeMoveDialog}
            fileName={moveTarget()!.name}
            filePath={moveDialogRelPath()}
            onConfirm={confirmMoveTo}
            isPending={moveItemMutation.isPending}
            error={moveItemMutation.error as Error | undefined}
            editableFolders={[]}
            browseDirectories={(path, signal) =>
              grantAdapter
                .browse({ path, pageSize: 500 }, signal)
                .then((page) => page.items.map((item) => item.file))
            }
            resolveDirectoryPath={(file) => stripSharePrefix(file.path, props.shareInfo.path)}
          />
        </Show>

        <Show when={showCreateFolder()}>
          <div
            class='fixed inset-0 z-[600000] flex items-center justify-center bg-black/50 p-4'
            role='presentation'
            onClick={() => setShowCreateFolder(false)}
          >
            <div
              role='dialog'
              aria-modal='true'
              aria-labelledby='share-create-folder-title'
              class='bg-card w-full max-w-md rounded-lg border border-border p-6 shadow-lg'
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id='share-create-folder-title' class='text-lg font-semibold'>
                Create folder
              </h2>
              <form class='mt-4 space-y-4' onSubmit={submitCreateFolder}>
                <input
                  type='text'
                  placeholder='Folder name'
                  class='border-input bg-background flex h-10 w-full rounded-md border px-3 text-sm'
                  value={newItemName()}
                  onInput={(e) => setNewItemName(e.currentTarget.value)}
                />
                <div class='flex justify-end gap-2'>
                  <button
                    type='button'
                    class='h-9 rounded-md border border-input px-4 text-sm'
                    onClick={() => setShowCreateFolder(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type='submit'
                    class='bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium'
                    disabled={createFolderMutation.isPending}
                  >
                    Create
                  </button>
                </div>
              </form>
            </div>
          </div>
        </Show>

        <Show when={showCreateFile()}>
          <div
            class='fixed inset-0 z-[600000] flex items-center justify-center bg-black/50 p-4'
            role='presentation'
            onClick={() => setShowCreateFile(false)}
          >
            <div
              role='dialog'
              aria-modal='true'
              aria-labelledby='share-create-file-title'
              class='bg-card w-full max-w-md rounded-lg border border-border p-6 shadow-lg'
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id='share-create-file-title' class='text-lg font-semibold'>
                Create file
              </h2>
              <form class='mt-4 space-y-4' onSubmit={submitCreateFile}>
                <input
                  type='text'
                  class='border-input bg-background flex h-10 w-full rounded-md border px-3 text-sm'
                  value={newItemName()}
                  placeholder='File name (e.g., notes.txt)'
                  onInput={(e) => setNewItemName(e.currentTarget.value)}
                />
                <div class='flex justify-end gap-2'>
                  <button
                    type='button'
                    class='h-9 rounded-md border border-input px-4 text-sm'
                    onClick={() => setShowCreateFile(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type='submit'
                    class='bg-primary text-primary-foreground h-9 rounded-md px-4 text-sm font-medium'
                    disabled={createFileMutation.isPending}
                  >
                    Create
                  </button>
                </div>
              </form>
            </div>
          </div>
        </Show>

        <div class='container mx-auto lg:p-4'>
          <div class='ring-foreground/10 bg-card text-card-foreground flex flex-col gap-0 overflow-hidden rounded-none py-0 text-sm shadow-xs ring-1 lg:rounded-xl'>
            <div class='shrink-0 border-b border-border bg-muted/30 p-2'>
              <div class='flex flex-wrap items-center justify-between gap-2'>
                <nav
                  class='flex min-w-0 flex-1 flex-wrap items-center gap-1'
                  aria-label='Breadcrumb'
                >
                  <For each={breadcrumbs()}>
                    {(crumb, index) => (
                      <div class='flex items-center gap-2'>
                        <Show when={index() > 0}>
                          <ChevronRight
                            class='h-4 w-4 shrink-0 text-muted-foreground'
                            size={16}
                            stroke-width={2}
                          />
                        </Show>
                        <button
                          type='button'
                          data-breadcrumb-segment={index() === 0 ? 'share-root' : 'crumb'}
                          data-breadcrumb-path={crumb.path}
                          class={cn(
                            'inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                            index() === breadcrumbs().length - 1
                              ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90'
                              : 'text-foreground hover:bg-accent hover:text-accent-foreground',
                          )}
                          onClick={() => navigateShareBreadcrumb(crumb.path, crumb.name)}
                          onContextMenu={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            const shareNorm = props.shareInfo.path.replace(/\\/g, '/')
                            const subDir = crumb.path
                            const serverPath = subDir ? `${shareNorm}/${subDir}` : shareNorm
                            setBreadcrumbMenu({
                              x: e.clientX,
                              y: e.clientY,
                              serverPath,
                              displayName: crumb.name,
                              isHome: index() === 0,
                            })
                          }}
                        >
                          <Show when={index() === 0}>
                            <Folder class='h-4 w-4 shrink-0' size={16} stroke-width={2} />
                          </Show>
                          {crumb.name}
                        </button>
                      </div>
                    )}
                  </For>
                </nav>
                <div class='flex flex-wrap items-center justify-end gap-1'>
                  <Show when={canUpload()}>
                    <div class='flex items-center gap-1'>
                      <button
                        type='button'
                        title='Create new file'
                        class='inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-sm font-medium shadow-xs transition-colors hover:bg-muted hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50'
                        onClick={() => {
                          setNewItemName('')
                          setShowCreateFile(true)
                        }}
                      >
                        <FilePlus class='h-4 w-4' stroke-width={2} />
                      </button>
                      <button
                        type='button'
                        title='Create new folder'
                        class='inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-sm font-medium shadow-xs transition-colors hover:bg-muted hover:text-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50'
                        onClick={() => {
                          setNewItemName('')
                          setShowCreateFolder(true)
                        }}
                      >
                        <FolderPlus class='h-4 w-4' stroke-width={2} />
                      </button>
                      <UploadMenu
                        mode='MediaServer'
                        disabled={isUploading()}
                        onUpload={(files) => void uploadFilesToServer(files)}
                      />
                      <div class='bg-border mx-1 h-5 w-px shrink-0' />
                    </div>
                  </Show>
                  <ViewModeToggle viewMode={viewMode()} onChange={setViewMode} />
                  <div class='relative shrink-0'>
                    <button
                      type='button'
                      title='Share settings (theme, workspace view)'
                      aria-label='Open share settings'
                      aria-expanded={shareSettingsOpen()}
                      class='inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-sm font-medium text-foreground shadow-xs transition-colors hover:bg-muted dark:bg-input/30 dark:border-input dark:hover:bg-input/50'
                      onClick={(e) => {
                        const open = !shareSettingsOpen()
                        setShareSettingsOpen(open)
                        if (open) {
                          const r = e.currentTarget.getBoundingClientRect()
                          setShareSettingsMenuPos({
                            top: r.bottom + 6,
                            right: Math.max(8, window.innerWidth - r.right),
                          })
                        } else {
                          setShareSettingsMenuPos(null)
                        }
                      }}
                    >
                      <Settings class='h-4 w-4' stroke-width={2} aria-hidden='true' />
                    </button>
                    <Show when={shareSettingsOpen() && shareSettingsMenuPos()}>
                      <div
                        class='fixed inset-0 z-[100000]'
                        role='presentation'
                        onClick={() => {
                          setShareSettingsOpen(false)
                          setShareSettingsMenuPos(null)
                        }}
                      />
                      <div
                        class='ring-foreground/10 fixed z-[100001] max-h-[min(85vh,28rem)] w-52 overflow-y-auto overflow-x-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg ring-1'
                        style={{
                          top: `${shareSettingsMenuPos()!.top}px`,
                          right: `${shareSettingsMenuPos()!.right}px`,
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type='button'
                          role='menuitem'
                          class='hover:bg-accent hover:text-accent-foreground flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none select-none'
                          onClick={() => {
                            openShareWorkspaceSameTab()
                            setShareSettingsOpen(false)
                            setShareSettingsMenuPos(null)
                          }}
                        >
                          <AppWindow class='h-4 w-4 shrink-0' stroke-width={2} />
                          Workspace view
                        </button>
                        <div class='bg-border my-1 h-px' />
                        <ThemeSwitcherMenuContent closeOnPick={false} />
                      </div>
                    </Show>
                  </div>
                </div>
              </div>
            </div>
            <div
              class='relative flex flex-col'
              onDragEnter={onExternalUploadDragEnter}
              onDragLeave={onExternalUploadDragLeave}
              onDragOver={onExternalUploadDragOver}
              onDrop={(e) => void onExternalUploadDrop(e)}
            >
              <Show when={externalUploadDragOver() && canUpload()}>
                <div class='pointer-events-none absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-primary bg-primary/10'>
                  <p class='text-primary text-sm font-medium'>Drop files to upload</p>
                </div>
              </Show>
              <Show when={filesQuery.isError}>
                <DirectoryListingErrorPanel
                  onRetry={() => void filesQuery.refetch()}
                  detail={filesQuery.error?.message}
                />
              </Show>
              <Show when={!filesQuery.isError}>
                <div>
                  <DirectoryListingLoading
                    show={isFilesLoadingInitial() && showFilesDeferredLoading()}
                  />
                  <Show when={!isFilesLoadingInitial()}>
                    <Switch>
                      <Match when={viewMode() === 'grid'}>
                        <div class='px-4 py-4'>
                          <VirtualDirectoryGrid
                            files={files}
                            includeParent={() => !!currentSubDir()}
                            scrollTarget={{ kind: 'window' }}
                            scrollScope={shareBrowserScrollScope}
                            onVisibleRangeChange={reportVisibleRange}
                            class='gap-4'
                            renderParentCard={() => (
                              <div
                                class='ring-foreground/10 bg-card text-card-foreground flex cursor-pointer flex-col overflow-hidden rounded-xl py-0 text-left shadow-xs ring-1 transition-colors select-none hover:bg-muted/50'
                                onClick={handleParentDirectory}
                                onKeyDown={handleParentKeyDown}
                                onPointerEnter={prefetchShareParentDirectory}
                                role='button'
                                tabindex={0}
                              >
                                <div class='flex aspect-video flex-col items-center justify-center bg-muted/80 p-4'>
                                  <ArrowUp
                                    class='mb-2 h-12 w-12 text-muted-foreground'
                                    size={48}
                                    stroke-width={2}
                                  />
                                  <p class='text-center text-sm font-medium'>..</p>
                                </div>
                              </div>
                            )}
                            renderFileCard={(file) => {
                              const item = () => itemForFile(file)
                              const selected = () =>
                                !!item() && explorerSnapshot().selection.includes(item()!.key)
                              return (
                                <div
                                  data-file-path={file.path}
                                  data-explorer-key={item()?.key}
                                  aria-selected={selected()}
                                  class={cn(
                                    'ring-foreground/10 bg-card text-card-foreground flex cursor-pointer flex-col overflow-hidden rounded-xl py-0 text-left shadow-xs ring-1 transition-colors select-none hover:bg-muted/50',
                                    playingPath() === file.path ? 'bg-primary/10' : '',
                                    selected() ? 'ring-2 ring-primary' : '',
                                  )}
                                  onClick={() => handleFileClick(file)}
                                  onPointerEnter={() =>
                                    void explorer.dispatch({
                                      type: 'prefetch',
                                      path: stripSharePrefix(file.path, props.shareInfo.path),
                                    })
                                  }
                                  onContextMenu={(e) => openRowMenu(e, file)}
                                  {...createLongPressContextMenuHandlers()}
                                  role='button'
                                  tabindex={
                                    !explorerSnapshot().focusedKey ||
                                    explorerSnapshot().focusedKey === item()?.key
                                      ? 0
                                      : -1
                                  }
                                  onFocus={() =>
                                    item() &&
                                    void explorer.dispatch({ type: 'focus', key: item()!.key })
                                  }
                                >
                                  <div class='relative flex aspect-video items-center justify-center overflow-hidden bg-muted'>
                                    <button
                                      type='button'
                                      aria-label={`More actions for ${file.name}`}
                                      class='absolute right-1.5 bottom-1.5 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full bg-background/90 shadow-sm'
                                      onClick={(e) => openRowMenuButton(e, file)}
                                    >
                                      <Ellipsis class='h-5 w-5' />
                                    </button>
                                    <div class='text-muted-foreground'>
                                      {gridHeroIcon(file, shareFileIconContext())}
                                    </div>
                                  </div>
                                  <div class='flex flex-col gap-1 p-3'>
                                    <p class='truncate text-sm font-medium' title={file.name}>
                                      {file.name}
                                      <OfflineBadge path={file.path} />
                                    </p>
                                    <div class='flex items-center justify-end text-xs text-muted-foreground'>
                                      <span>
                                        {file.isDirectory ? '' : formatFileSize(file.size)}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              )
                            }}
                          />
                          <DirectoryListingEmpty show={showEmptyFolder()} canUpload={canUpload()} />
                        </div>
                      </Match>
                      <Match when={viewMode() === 'list'}>
                        <div class='py-2 sm:px-4'>
                          <VirtualDirectoryList
                            files={files}
                            includeParent={() => !!currentSubDir()}
                            scrollTarget={{ kind: 'window' }}
                            scrollScope={shareBrowserScrollScope}
                            onVisibleRangeChange={reportVisibleRange}
                            class='relative w-full overflow-x-auto'
                            colSpan={4}
                            renderParentRow={() => (
                              <tr
                                class='hover:bg-muted/50 cursor-pointer select-none border-b border-border transition-colors'
                                onClick={handleParentDirectory}
                                onKeyDown={handleParentKeyDown}
                                tabindex={0}
                                onPointerEnter={prefetchShareParentDirectory}
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
                                <td />
                              </tr>
                            )}
                            renderFileRow={(file) => {
                              const item = () => itemForFile(file)
                              const selected = () =>
                                !!item() && explorerSnapshot().selection.includes(item()!.key)
                              return (
                                <tr
                                  data-file-path={file.path}
                                  data-explorer-key={item()?.key}
                                  aria-selected={selected()}
                                  class={cn(
                                    'hover:bg-muted/50 group cursor-pointer select-none border-b border-border transition-colors',
                                    playingPath() === file.path ? 'bg-primary/10' : '',
                                    selected() ? 'bg-primary/10' : '',
                                  )}
                                  onClick={() => handleFileClick(file)}
                                  onPointerEnter={() =>
                                    void explorer.dispatch({
                                      type: 'prefetch',
                                      path: stripSharePrefix(file.path, props.shareInfo.path),
                                    })
                                  }
                                  onContextMenu={(e) => openRowMenu(e, file)}
                                  {...createLongPressContextMenuHandlers()}
                                  tabindex={
                                    !explorerSnapshot().focusedKey ||
                                    explorerSnapshot().focusedKey === item()?.key
                                      ? 0
                                      : -1
                                  }
                                  onFocus={() =>
                                    item() &&
                                    void explorer.dispatch({ type: 'focus', key: item()!.key })
                                  }
                                >
                                  <td class='w-[40px] min-w-[40px] max-w-[40px] box-border p-2 align-middle'>
                                    <div class='flex items-center justify-center'>
                                      {fileIcon(file)}
                                    </div>
                                  </td>
                                  <td class='min-w-0 p-2 align-middle font-medium'>
                                    <span class='truncate'>
                                      {file.name}
                                      <OfflineBadge path={file.path} />
                                    </span>
                                  </td>
                                  <td class='min-w-0 p-2 align-middle text-right text-muted-foreground tabular-nums'>
                                    <span class='inline-block w-20'>
                                      {file.isDirectory ? '' : formatFileSize(file.size)}
                                    </span>
                                  </td>
                                  <td class='p-1 align-middle'>
                                    <button
                                      type='button'
                                      aria-label={`More actions for ${file.name}`}
                                      class='inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-muted'
                                      onClick={(e) => openRowMenuButton(e, file)}
                                    >
                                      <Ellipsis class='h-5 w-5' />
                                    </button>
                                  </td>
                                </tr>
                              )
                            }}
                            renderEmptyRow={() => (
                              <DirectoryListingEmptyTableRow
                                show={showEmptyFolder()}
                                canUpload={canUpload()}
                              />
                            )}
                          />
                        </div>
                      </Match>
                    </Switch>
                  </Show>
                </div>
              </Show>
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
            </div>
          </div>
        </div>
      </div>
      <UploadToastStack
        state={uploadToast}
        onDismissError={() => setUploadToast({ kind: 'hidden' })}
      />
      <FloatingScrollActions playingPath={playingPath} scrollScope={shareBrowserScrollScope} />
    </>
  )
}
