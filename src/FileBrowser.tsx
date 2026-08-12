import {
  getFileDragData,
  hasFileDragData,
  isCompatibleSource,
  setFileDragData,
} from '@/lib/file-drag-data'
import {
  createExplorerModel,
  explorerItemKey,
  type ExplorerCapability,
  type ExplorerItem,
  type ExplorerResourceAdapter,
  type ExplorerVisibleRange,
} from '@/lib/explorer-model'
import { useQuery, useQueryClient } from '@tanstack/solid-query'
import type { GlobalSettings } from '@/lib/use-settings'
import { collectDroppedUploadFiles } from '@/lib/collect-dropped-upload-files'
import {
  finePointerDragEnabled,
  subscribeFinePointerDragEnabled,
} from '@/lib/enable-fine-pointer-drag'
import { extractPasteDataFromClipboardData } from '@/lib/extract-paste-data'
import { shouldOfferPasteAsNewFile } from '@/lib/should-offer-paste-as-new-file'
import {
  breadcrumbFloating,
  resetBreadcrumbFloating,
  setBreadcrumbFolderMenu,
} from '@/lib/breadcrumb-floating-store'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import type { ShareLink } from '@/lib/shares'
import type { DirectoryListing } from '@/lib/virtual-directory'
import { buildShareUrl, copyShareUrl, getShareUrlWarning } from '@/src/lib/share-url'
import type { PasteData } from '@/lib/paste-data'
import { MediaType, type FileItem } from '@/lib/types'
import { normalizeNewFilePath } from '@/lib/new-file-name'
import { formatFileSize } from '@/lib/media-utils'
import { cn, getKnowledgeBaseRoot, isPathEditable } from '@/lib/utils'
import ArrowUp from 'lucide-solid/icons/arrow-up'
import FilePlus from 'lucide-solid/icons/file-plus'
import FolderPlus from 'lucide-solid/icons/folder-plus'
import BookOpenText from 'lucide-solid/icons/book-open-text'
import Star from 'lucide-solid/icons/star'
import Upload from 'lucide-solid/icons/upload'
import Eye from 'lucide-solid/icons/eye'
import Share2 from 'lucide-solid/icons/share-2'
import LinkIcon from 'lucide-solid/icons/link'
import Ellipsis from 'lucide-solid/icons/ellipsis'
import {
  batch,
  createEffect,
  createMemo,
  createSignal,
  Match,
  on,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js'
import type { FileIconContext } from './lib/use-file-icon'
import { fileItemIcon, gridHeroIcon } from './lib/use-file-icon'
import {
  createUrlSearchParamsMemo,
  navigateSearchParams,
  useBrowserHistory,
} from './browser-history'
import type { BreadcrumbMenuTarget } from './file-browser/BreadcrumbContextMenu'
import { Breadcrumbs } from './file-browser/Breadcrumbs'
import { FileBrowserModalLayer } from './file-browser/FileBrowserModalLayer'
import { OfflineBadge } from './OfflineBadge'
import {
  isPathAvailableOffline,
  isOfflineFeatureAvailable,
  makeAvailableOffline,
} from './lib/offline-files'
import { DirectoryBackgroundContextMenu } from './file-browser/DirectoryBackgroundContextMenu'
import { KbDashboard } from './file-browser/KbDashboard'
import { KbInlineCreateFooter } from './file-browser/KbInlineCreateFooter'
import { KbSearchResults } from './file-browser/KbSearchResults'
import { useFileRowContextMenu } from './file-browser/use-file-row-context-menu'
import { UploadMenu } from './file-browser/UploadMenu'
import type { AuthConfig, UploadToastState } from './file-browser/types'
import {
  DirectoryListingEmpty,
  DirectoryListingEmptyTableRow,
  DirectoryListingErrorPanel,
  DirectoryListingLoading,
} from './file-browser/DirectoryListingFeedback'
import { FloatingScrollActions } from './file-browser/FloatingScrollActions'
import { useInlineModeInputFocus } from './file-browser/use-inline-mode-input-focus'
import { registerKbSearchHotkeys } from './file-browser/use-kb-search-hotkey'
import { VirtualDirectoryGrid } from './file-browser/VirtualDirectoryGrid'
import { VirtualDirectoryList } from './file-browser/VirtualDirectoryList'
import { getVirtualFileScroller } from './file-browser/virtual-directory-scroll'
import { ViewModeToggle } from './file-browser/ViewModeToggle'
import { ThemeSwitcher } from './ThemeSwitcher'
import { MainMediaPlayers } from './media/MainMediaPlayers'
import { useDynamicFavicon } from './lib/use-dynamic-favicon'
import { useBrowserViewModeStore } from '@/lib/browser-view-mode-store'
import { openInReader } from './reader/reader-url'
import { useViewStats } from './lib/use-view-stats'
import { createLongPressContextMenuHandlers } from './lib/long-press-context-menu'
import { useDeferredLoading } from './lib/use-deferred-loading'
import { playFile, viewFile } from './lib/url-state-actions'
import { FileSearchButton } from './FileSearchPalette'
import { fileSearchResultToFileItem, type FileSearchResult } from '@/lib/file-search'
import {
  legacyFileItemFromPath,
  OWNER_OPEN_SCOPE,
  resourceForFileItem,
} from './lib/legacy-resource-adapter'
import { executeOpenPlan, openResource } from './lib/open-resource'
import {
  browserExplorerStorage,
  createBrowserOnlineAdapter,
  createUrlExplorerHistory,
} from './explorer/browser-adapters'
import { createExplorerMutation } from './explorer/create-explorer-mutation'
import { explorerCapabilitiesForFile, explorerItemForFile } from './explorer/snapshot-items'
import { useExplorerModel } from './explorer/use-explorer-model'
import { createFallbackResourceAdapter } from './lib/resource-adapters/fallback'
import { createOfflineResourceAdapter } from './lib/resource-adapters/offline'
import { createOwnerExplorerAdapter } from './lib/resource-adapters/owner'
import { removeWebOfflineAndWait, subscribeWebOfflineCatalog } from './lib/web-offline-storage'
import { subscribeSseAdmin } from './lib/sse-shared-worker-client'
import { usePlaybackSession, usePlaybackSnapshot } from './media/playback/PlaybackProvider'
import { playbackItemFromFileItem, playbackQueueFromFiles } from './media/playback/items'

type FileBrowserProps = {
  forceOffline?: boolean
}

export function FileBrowser(props: FileBrowserProps = {}) {
  const playbackSession = usePlaybackSession()
  const playbackSnapshot = usePlaybackSnapshot()
  const history = useBrowserHistory()
  const urlSearchParams = createUrlSearchParamsMemo(history)
  const queryClient = useQueryClient()
  const initialPath = urlSearchParams().get('dir') ?? urlSearchParams().get('path') ?? ''
  const explicitOffline = props.forceOffline === true || urlSearchParams().get('offline') === '1'

  const playingParam = createMemo(() => urlSearchParams().get('playing'))

  const playingPath = createMemo(
    () => playbackSnapshot().currentItem?.locator ?? playingParam() ?? '',
  )

  const audioOnlyParam = createMemo(() => urlSearchParams().get('audioOnly') === 'true')

  const authQuery = useQuery(() => ({
    queryKey: queryKeys.authConfig(),
    queryFn: ({ signal }) => api<AuthConfig>('/api/auth/config', { signal }),
    staleTime: Infinity,
    enabled: !explicitOffline,
  }))

  const editableFolders = createMemo(() =>
    explicitOffline ? [] : (authQuery.data?.editableFolders ?? []),
  )

  const sharesQuery = useQuery(() => ({
    queryKey: queryKeys.shares(),
    queryFn: ({ signal }) => api<{ shares: ShareLink[] }>('/api/shares', { signal }),
    enabled: !explicitOffline,
  }))

  const shares = createMemo(() => (explicitOffline ? [] : (sharesQuery.data?.shares ?? [])))

  const sharedPathSet = createMemo(() => {
    const set = new Set<string>()
    for (const s of shares()) {
      set.add(s.path.replace(/\\/g, '/'))
    }
    return set
  })

  const shareLinkBase = createMemo(() => {
    const d = authQuery.data?.shareLinkDomain
    if (typeof d === 'string' && d.trim()) return d.trim().replace(/\/$/, '')
    if (typeof window !== 'undefined') return window.location.origin
    return ''
  })

  const settingsQuery = useQuery(() => ({
    queryKey: queryKeys.settings(),
    queryFn: ({ signal }) => api<GlobalSettings>('/api/settings', { signal }),
    staleTime: Infinity,
    enabled: !explicitOffline,
  }))
  const initialOwnerListing = explicitOffline
    ? undefined
    : queryClient.getQueryData<DirectoryListing>(queryKeys.files(initialPath))

  function subscribeOwnerExplorer(listener: () => void) {
    return subscribeSseAdmin((event) => {
      if (event.type === 'files-changed') {
        listener()
        void queryClient.invalidateQueries({ queryKey: queryKeys.shareFiles() })
        void queryClient.invalidateQueries({ queryKey: queryKeys.adminContent() })
        void queryClient.invalidateQueries({ queryKey: queryKeys.shareKbRecent() })
      } else if (event.type === 'settings-changed') {
        listener()
        void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
      } else if (event.type === 'mounts-changed') {
        listener()
        void queryClient.invalidateQueries({ queryKey: queryKeys.mounts() })
        void queryClient.invalidateQueries({ queryKey: queryKeys.authConfig() })
        void queryClient.invalidateQueries({ queryKey: queryKeys.shares() })
      } else if (event.type === 'connected') {
        console.log('[Admin SSE] Connected to events stream')
      }
    })
  }

  const offlineAdapter = createOfflineResourceAdapter()
  let fallbackAdapter: ReturnType<typeof createFallbackResourceAdapter> | undefined
  let explorerAdapter: ExplorerResourceAdapter
  if (explicitOffline) {
    explorerAdapter = offlineAdapter
  } else {
    const ownerAdapter = createOwnerExplorerAdapter({
      authConfig: () =>
        authQuery.data ?? {
          enabled: false,
          editableFolders: [],
        },
      ...(initialOwnerListing
        ? { initialListing: { path: initialPath, listing: initialOwnerListing } }
        : {}),
      surface: 'library',
      subscribe: subscribeOwnerExplorer,
      ...(isOfflineFeatureAvailable()
        ? {
            offline: {
              subscribe: subscribeWebOfflineCatalog,
              isKept: (item: ExplorerItem) => isPathAvailableOffline(item.file.path),
              keep: async (item: ExplorerItem, signal: AbortSignal) => {
                signal.throwIfAborted()
                const started = await makeAvailableOffline(item.file)
                signal.throwIfAborted()
                if (!started) throw new Error('Offline save is unavailable')
              },
              remove: (item: ExplorerItem, signal: AbortSignal) =>
                removeWebOfflineAndWait(item.file.path, item.file.name, 'owner', signal),
            },
          }
        : {}),
    })
    fallbackAdapter = createFallbackResourceAdapter(ownerAdapter, offlineAdapter, {
      isFallbackAvailable: (query, page) =>
        page.items.length > 0 || isPathAvailableOffline(query.path),
    })
    explorerAdapter = fallbackAdapter
  }

  const explorerStorage = browserExplorerStorage()
  const explorerStorageKey = explicitOffline
    ? 'explorer:offline:derp-offline-v1'
    : 'explorer:owner:owner'
  try {
    const stored = JSON.parse(explorerStorage.getItem(explorerStorageKey) ?? '{}') as {
      viewModes?: Record<string, 'list' | 'grid'>
      [key: string]: unknown
    }
    const legacyViewModes = Object.fromEntries(
      Object.entries(useBrowserViewModeStore.getState().byKey).flatMap(([key, mode]) =>
        key.startsWith('admin-viewmode-') ? [[key.slice('admin-viewmode-'.length), mode]] : [],
      ),
    )
    explorerStorage.setItem(
      explorerStorageKey,
      JSON.stringify({
        ...stored,
        viewModes: {
          ...(!explicitOffline ? (settingsQuery.data?.viewModes ?? {}) : {}),
          ...legacyViewModes,
          ...(stored.viewModes ?? {}),
        },
      }),
    )
  } catch {
    // Corrupt device-local preference state falls back to model defaults.
  }

  const explorer = useExplorerModel(
    createExplorerModel({
      adapter: explorerAdapter,
      opener: openResource,
      history: createUrlExplorerHistory({
        currentPath: () =>
          new URLSearchParams(window.location.search).get('dir') ??
          new URLSearchParams(window.location.search).get('path') ??
          '',
        navigate: (path, replace) =>
          navigateSearchParams({ dir: path || null, path: null }, replace ? 'replace' : 'push'),
      }),
      storage: explorerStorage,
      storageKey: explorerStorageKey,
      clock: Date,
      online: createBrowserOnlineAdapter(explicitOffline),
      paginationMode: 'all',
      rootLabel: explicitOffline ? 'Offline' : 'Library',
      initialViewMode: useBrowserViewModeStore
        .getState()
        .getViewMode(
          `admin-viewmode-${initialPath}`,
          settingsQuery.data?.viewModes?.[initialPath] ?? 'list',
        ),
    }),
  )
  const explorerSnapshot = explorer.snapshot
  const reportVisibleRange = (range: ExplorerVisibleRange) => {
    void explorer.dispatch({ type: 'visibleRange', range })
  }
  const currentPath = createMemo(() => explorerSnapshot().path)
  const isOfflineBrowser = createMemo(() => {
    void explorerSnapshot().revision
    return explicitOffline || fallbackAdapter?.isUsingFallback() === true
  })

  const syncPlaybackOnline = () => {
    playbackSession.dispatch({
      type: 'onlineChanged',
      online: navigator.onLine && !isOfflineBrowser(),
    })
  }

  createEffect(syncPlaybackOnline)

  onMount(() => {
    let mounted = true
    const handleConnectivityChange = () => {
      queueMicrotask(() => {
        if (mounted) syncPlaybackOnline()
      })
    }
    window.addEventListener('online', handleConnectivityChange)
    window.addEventListener('offline', handleConnectivityChange)
    onCleanup(() => {
      mounted = false
      window.removeEventListener('online', handleConnectivityChange)
      window.removeEventListener('offline', handleConnectivityChange)
    })
  })

  onCleanup(() => {
    playbackSession.dispatch({ type: 'onlineChanged', online: navigator.onLine })
  })

  const isEditable = createMemo(() => {
    const capabilities = explorerSnapshot().capabilities
    return (
      capabilities.includes('createFile') ||
      capabilities.includes('createFolder') ||
      capabilities.includes('upload')
    )
  })
  const capabilitiesForFile = (file: FileItem) =>
    explorerCapabilitiesForFile(explorerSnapshot(), file)
  const itemForFile = (file: FileItem) => explorerItemForFile(explorerSnapshot(), file)
  const virtualEntryForFile = (file: FileItem) => itemForFile(file)?.virtualEntry

  createEffect(
    on(
      () => authQuery.data,
      (config) => {
        if (config) void explorer.dispatch({ type: 'refresh' })
      },
      { defer: true },
    ),
  )

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

  async function tryReturnOnline() {
    if (!fallbackAdapter?.isUsingFallback()) return
    await explorer.dispatch({ type: 'refresh' })
  }

  createEffect(() => {
    void explorerSnapshot().revision
    if (!fallbackAdapter?.isUsingFallback()) return
    const interval = window.setInterval(() => void tryReturnOnline(), 5_000)
    onCleanup(() => window.clearInterval(interval))
  })

  onMount(() => {
    const handleFocus = () => void tryReturnOnline()
    window.addEventListener('focus', handleFocus)
    onCleanup(() => {
      window.removeEventListener('focus', handleFocus)
    })
  })

  const fileBrowserScrollScope = () => 'main-file-browser'
  const isFilesLoadingInitial = createMemo(
    () => filesQuery.isPending && filesQuery.data === undefined,
  )
  const showFilesDeferredLoading = useDeferredLoading(() => isFilesLoadingInitial())
  const pasteExistingFiles = createMemo(() => files())

  const knowledgeBases = createMemo(() =>
    explicitOffline ? [] : (settingsQuery.data?.knowledgeBases ?? []),
  )
  const kbRootPath = createMemo(() => getKnowledgeBaseRoot(currentPath(), knowledgeBases()))
  const inKb = createMemo(() => kbRootPath() !== null)
  const customIcons = createMemo(() =>
    explicitOffline ? {} : (settingsQuery.data?.customIcons ?? {}),
  )
  const viewStats = useViewStats(() => ({}), { includeCounts: !explicitOffline })
  useDynamicFavicon(() => customIcons(), { getSearch: () => history().search })

  const isAudioPlayingBar = createMemo(() => {
    const snapshot = playbackSnapshot()
    const item = snapshot.currentItem
    return !!item && (item.media === 'audio' || snapshot.mode === 'audio')
  })

  const fileIconCtx = createMemo((): FileIconContext => {
    const st = playbackSnapshot()
    return {
      customIcons: customIcons(),
      knowledgeBases: knowledgeBases(),
      playingPath: st.currentItem?.locator ?? null,
      currentFile: st.currentItem?.locator ?? null,
      mediaPlayerIsPlaying: st.desiredPlaying,
      mediaType: st.currentItem ? (st.mode === 'audio' ? 'audio' : 'video') : null,
      mediaShare: null,
    }
  })

  let bootstrappedPlayback = ''
  createEffect(() => {
    const path = playingParam()
    const listed = files()
    const requestedAudioOnly = audioOnlyParam()
    const requestedPlayback = path ? `${path}\0${requestedAudioOnly ? 'audio' : 'video'}` : ''
    if (!path || requestedPlayback === bootstrappedPlayback) return
    const existing = playbackSnapshot().currentItem
    const requestedMode =
      existing?.media === 'video' && requestedAudioOnly ? 'audio' : existing?.media
    if (existing?.locator === path && playbackSnapshot().mode === requestedMode) {
      bootstrappedPlayback = requestedPlayback
      return
    }
    const file = listed.find((candidate) => candidate.path === path) ?? fileItemFromPath(path)
    const item = playbackItemFromFileItem(file)
    if (!item) return
    bootstrappedPlayback = requestedPlayback
    const queue =
      item.media === 'audio'
        ? playbackQueueFromFiles(listed.filter((candidate) => candidate.type === MediaType.AUDIO))
        : [item]
    playbackSession.dispatch({
      type: 'load',
      item,
      queue,
      autoplay: true,
      mode: item.media === 'video' && requestedAudioOnly ? 'audio' : item.media,
    })
  })

  const [searchQuery, setSearchQuery] = createSignal('')
  const [debouncedSearch, setDebouncedSearch] = createSignal('')
  const [searchPopoverOpen, setSearchPopoverOpen] = createSignal(false)
  const [iconEditTarget, setIconEditTarget] = createSignal<FileItem | null>(null)
  const breadcrumbMenu = () => breadcrumbFloating.folderMenu

  createEffect(() => {
    const q = searchQuery()
    const id = window.setTimeout(() => setDebouncedSearch(q), 300)
    onCleanup(() => clearTimeout(id))
  })

  createEffect(
    on(
      currentPath,
      () => {
        batch(() => {
          setSearchQuery('')
          setDebouncedSearch('')
          setSearchPopoverOpen(false)
          setInlineMode(null)
          setInlineName('')
          resetBreadcrumbFloating()
        })
      },
      { defer: true },
    ),
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
    queryFn: ({ signal }) =>
      api<{ results: { path: string; name: string; snippet: string }[] }>(
        `/api/kb/search?root=${encodeURIComponent(kbRootPath()!)}&q=${encodeURIComponent(debouncedSearch())}`,
        { signal },
      ),
    enabled:
      !isOfflineBrowser() &&
      !!kbRootPath() &&
      searchPopoverOpen() &&
      debouncedSearch().trim().length > 0,
  }))

  const viewMode = createMemo(() => explorerSnapshot().viewMode)

  const favorites = createMemo(() => (explicitOffline ? [] : (settingsQuery.data?.favorites ?? [])))
  const favoriteSet = createMemo(() => new Set(favorites()))

  function requiredItem(file: FileItem): ExplorerItem {
    const item = itemForFile(file)
    if (!item) throw new Error('Resource is not in current Explorer page')
    return item
  }

  function breadcrumbForPath(path: string) {
    const normalized = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
    return explorerSnapshot().breadcrumbs.find((breadcrumb) => breadcrumb.path === normalized)
  }

  function capabilitiesForPath(path: string) {
    return breadcrumbForPath(path)?.capabilities ?? []
  }

  function externalItem(
    file: FileItem,
    capabilities: readonly ExplorerCapability[] = [],
  ): ExplorerItem {
    const resource = resourceForFileItem(file)
    return {
      key: explorerItemKey(resource.ref),
      file: { ...file, resource },
      resource,
      capabilities,
    }
  }

  const favoriteMutation = createExplorerMutation(
    (file: FileItem) =>
      explorer.dispatch({
        type: 'command',
        command: { kind: 'favorite', item: requiredItem(file) },
      }),
    {
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
      },
    },
  )

  const [uploadToast, setUploadToast] = createSignal<UploadToastState>({ kind: 'hidden' })
  const [deleteTarget, setDeleteTarget] = createSignal<FileItem | null>(null)
  const [shareTarget, setShareTarget] = createSignal<FileItem | null>(null)
  const [showCreateFolder, setShowCreateFolder] = createSignal(false)
  const [showCreateFile, setShowCreateFile] = createSignal(false)
  const [showRename, setShowRename] = createSignal(false)
  const [renameItem, setRenameItem] = createSignal<FileItem | null>(null)
  const [moveTarget, setMoveTarget] = createSignal<FileItem | null>(null)
  const [showMoveDialog, setShowMoveDialog] = createSignal(false)
  const [copyTarget, setCopyTarget] = createSignal<FileItem | null>(null)
  const [showCopyDialog, setShowCopyDialog] = createSignal(false)
  const [newItemName, setNewItemName] = createSignal('')
  const [draggedPath, setDraggedPath] = createSignal<string | null>(null)
  const [dragOverPath, setDragOverPath] = createSignal<string | null>(null)
  const [dragAllowsMove, setDragAllowsMove] = createSignal(false)
  const [enableDrag, setEnableDrag] = createSignal(finePointerDragEnabled())
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
  let fileBrowserEl: HTMLDivElement | undefined

  useInlineModeInputFocus(
    inlineMode,
    () => inlineFileInputEl,
    () => inlineFolderInputEl,
  )

  onMount(() => {
    setEnableDrag(finePointerDragEnabled())
    return subscribeFinePointerDragEnabled(setEnableDrag)
  })

  const fileRowMenu = useFileRowContextMenu({
    onDeleteRequest: (f) => setDeleteTarget(f),
  })

  createEffect(() => {
    if (fileRowMenu.menu()) setDirectoryBackgroundMenu(null)
  })

  const isUploading = createMemo(() => uploadToast().kind === 'uploading')
  const invalidateContent = () =>
    void queryClient.invalidateQueries({ queryKey: queryKeys.adminContent() })

  const deleteMutation = createExplorerMutation(
    (file: FileItem) =>
      explorer.dispatch({
        type: 'command',
        command: { kind: 'delete', item: requiredItem(file) },
      }),
    {
      onSettled: () => {
        invalidateContent()
      },
    },
  )

  const revokeShareMutation = createExplorerMutation(
    (file: FileItem) =>
      explorer.dispatch({
        type: 'command',
        command: { kind: 'revokeShare', item: requiredItem(file) },
      }),
    {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.shares() })
        invalidateContent()
      },
    },
  )

  function commandPath(path: string) {
    const parts = path.replace(/\\/g, '/').split('/').filter(Boolean)
    return { parentPath: parts.slice(0, -1).join('/'), name: parts.at(-1) ?? '' }
  }

  const createFolderMutation = createExplorerMutation(
    (vars: { type: 'folder'; path: string }) => {
      const { parentPath, name } = commandPath(vars.path)
      return explorer.dispatch({
        type: 'command',
        command: { kind: 'createFolder', parentPath, name },
      })
    },
    {
      onSettled: () => {
        invalidateContent()
      },
    },
  )

  const createFileMutation = createExplorerMutation(
    (vars: { type: 'file'; path: string; content: string }) => {
      const { parentPath, name } = commandPath(vars.path)
      return explorer.dispatch({
        type: 'command',
        command: { kind: 'createFile', parentPath, name, content: vars.content },
      })
    },
    {
      onSuccess: (_outcome, variables) => {
        invalidateContent()
        const created = files().find((file) => file.path.replace(/\\/g, '/') === variables.path)
        handleFileClick(created ?? fileItemFromPath(variables.path), currentPath(), false)
      },
    },
  )

  const renameMutation = createExplorerMutation(
    (vars: { oldPath: string; newPath: string }) =>
      explorer.dispatch({
        type: 'command',
        command: {
          kind: 'rename',
          item: requiredItem(fileItemFromPath(vars.oldPath)),
          name: commandPath(vars.newPath).name,
        },
      }),
    {
      onSettled: () => {
        invalidateContent()
      },
    },
  )

  const moveMutation = createExplorerMutation(
    (vars: { oldPath: string; newPath: string }) =>
      explorer.dispatch({
        type: 'command',
        command: {
          kind: 'move',
          item: requiredItem(fileItemFromPath(vars.oldPath)),
          destinationPath: commandPath(vars.newPath).parentPath,
        },
      }),
    {
      onSettled: () => {
        invalidateContent()
      },
    },
  )

  const externalMoveMutation = createExplorerMutation(
    (vars: { source: FileItem; destinationPath: string }) =>
      explorer.dispatch({
        type: 'command',
        command: {
          kind: 'moveExternal',
          source: externalItem(vars.source),
          destinationPath: vars.destinationPath,
        },
      }),
    { onSettled: invalidateContent },
  )

  type PasteMutationVariables = {
    path: string
    content?: string
    base64Content?: string
    mode: 'create' | 'replace'
    expectedVersion?: number
  }
  const pasteMutation = createExplorerMutation(
    (vars: PasteMutationVariables) => {
      if (vars.mode === 'replace') {
        return explorer.dispatch({
          type: 'command',
          command: {
            kind: 'replace',
            item: requiredItem(fileItemFromPath(vars.path)),
            ...(vars.content === undefined ? {} : { content: vars.content }),
            ...(vars.base64Content === undefined ? {} : { base64Content: vars.base64Content }),
            ...(vars.expectedVersion === undefined
              ? {}
              : { expectedVersion: vars.expectedVersion }),
          },
        })
      }
      const { parentPath, name } = commandPath(vars.path)
      return explorer.dispatch({
        type: 'command',
        command: {
          kind: 'createFile',
          parentPath,
          name,
          ...(vars.content === undefined ? {} : { content: vars.content }),
          ...(vars.base64Content === undefined ? {} : { base64Content: vars.base64Content }),
        },
      })
    },
    {
      onSuccess: (_outcome, variables) => {
        invalidateContent()
        setShowPasteDialog(false)
        setPasteData(null)
        const pasted = files().find((file) => file.path.replace(/\\/g, '/') === variables.path)
        handleFileClick(pasted ?? fileItemFromPath(variables.path), currentPath(), false)
      },
    },
  )

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

  const canDropOnParent = createMemo(
    () => !!currentPath() && explorerSnapshot().capabilities.includes('move'),
  )

  function canDropOn(targetPath: string, sourcePath?: string | null) {
    const src = sourcePath ?? draggedPath()
    if (!src || src === targetPath) return false
    if (targetPath.startsWith(src + '/')) return false
    return true
  }

  function parentDirFromCurrent(): string {
    const parts = currentPath().split(/[/\\]/).filter(Boolean)
    if (parts.length <= 1) return ''
    return parts.slice(0, -1).join('/')
  }

  function handleMoveFileFromDrag(
    sourcePath: string,
    destinationDir: string,
    externalSource?: FileItem,
  ) {
    const fileName = sourcePath.split(/[/\\]/).pop()!
    const newPath = destinationDir ? `${destinationDir}/${fileName}` : fileName
    if (externalSource) {
      externalMoveMutation.mutate({ source: externalSource, destinationPath: destinationDir })
    } else {
      moveMutation.mutate({ oldPath: sourcePath, newPath })
    }
  }

  const allowMoveFile = createMemo(() =>
    explorerSnapshot().capabilities.includes('move') ? handleMoveFileFromDrag : undefined,
  )

  function parentRowDragOver(e: globalThis.DragEvent) {
    const mv = allowMoveFile()
    const dtr = e.dataTransfer
    if (!mv || !canDropOnParent() || !dtr || (!draggedPath() && !hasFileDragData(dtr))) return
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
    const dest = parentDirFromCurrent()
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
      isCompatibleSource({ sourceKind: 'local', sourceToken: undefined }, data) &&
      canDropOn(dest, data.path)
    ) {
      mv(
        data.path,
        dest,
        legacyFileItemFromPath(data.path, {
          isDirectory: data.isDirectory,
          ...(data.resource ? { resource: data.resource } : {}),
        }),
      )
    }
  }

  function onFileDragStart(file: FileItem, e: globalThis.DragEvent) {
    const dtr = e.dataTransfer
    if (!dtr || !enableDrag()) return
    const canMove = !!allowMoveFile() && capabilitiesForFile(file).includes('move')
    setDragAllowsMove(canMove)
    setFileDragData(dtr, {
      path: file.path,
      isDirectory: file.isDirectory,
      sourceKind: 'local',
      resource: file.resource,
    })
    dtr.effectAllowed = canMove ? 'copyMove' : 'copy'
    setDraggedPath(file.path)
  }

  function onFileDragEnd() {
    setDraggedPath(null)
    setDragOverPath(null)
    setDragAllowsMove(false)
  }

  function onFolderDragOver(file: FileItem, e: globalThis.DragEvent) {
    const dtr = e.dataTransfer
    if (!file.isDirectory || !allowMoveFile() || !dtr) return
    const hasCross = !draggedPath() && hasFileDragData(dtr)
    if (!draggedPath() && !hasCross) return
    const dp = draggedPath()
    if (dp && !dragAllowsMove()) return
    if (dp && !canDropOn(file.path)) return
    if (!capabilitiesForFile(file).includes('move')) return
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
        isCompatibleSource({ sourceKind: 'local', sourceToken: undefined }, data) &&
        canDropOn(file.path, data.path)
      ) {
        mv(
          data.path,
          file.path,
          legacyFileItemFromPath(data.path, {
            isDirectory: data.isDirectory,
            ...(data.resource ? { resource: data.resource } : {}),
          }),
        )
      }
    }
  }

  const copyMutation = createExplorerMutation(
    (vars: { sourcePath: string; destinationDir: string }) =>
      explorer.dispatch({
        type: 'command',
        command: {
          kind: 'copy',
          item: requiredItem(fileItemFromPath(vars.sourcePath)),
          destinationPath: vars.destinationDir,
        },
      }),
  )

  const knowledgeBaseMutation = createExplorerMutation(
    (file: FileItem) =>
      explorer.dispatch({
        type: 'command',
        command: { kind: 'setKnowledgeBase', item: requiredItem(file) },
      }),
    {
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
      },
    },
  )

  function appearanceCommand(target: FileItem, iconName: string | null) {
    const item = itemForFile(target)
    return item
      ? { kind: 'setAppearance' as const, item, iconName }
      : {
          kind: 'setAppearanceExternal' as const,
          target:
            breadcrumbForPath(target.path)?.item ??
            externalItem(target, capabilitiesForPath(target.path)),
          iconName,
        }
  }

  const setCustomIconMutation = createExplorerMutation(
    (vars: { target: FileItem; iconName: string }) =>
      explorer.dispatch({
        type: 'command',
        command: appearanceCommand(vars.target, vars.iconName),
      }),
    {
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
      },
    },
  )

  const removeCustomIconMutation = createExplorerMutation(
    (target: FileItem) =>
      explorer.dispatch({
        type: 'command',
        command: appearanceCommand(target, null),
      }),
    {
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
      },
    },
  )

  function normPath(p: string) {
    return p.replace(/\\/g, '/')
  }

  const shareDialogExistingShares = createMemo(() => {
    const t = shareTarget()
    if (!t) return [] as ShareLink[]
    const np = normPath(t.path)
    return shares().filter((s) => normPath(s.path) === np)
  })

  const shareDialogIsEditable = createMemo(() => {
    const t = shareTarget()
    if (!t) return false
    return isPathEditable(t.path, editableFolders())
  })

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
          if (inKb()) handleBreadcrumbNavigate(folderPath)
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

  function handleContextShare(file: FileItem) {
    const item = itemForFile(file)
    if (!item) return
    void explorer.dispatch({ type: 'action', action: 'share', key: item.key }).then((outcome) => {
      if (outcome.kind === 'action' && outcome.plan.kind === 'share') {
        setShareTarget(outcome.plan.item.file)
      }
    })
  }

  async function handleCopyShareLink(file: FileItem) {
    if (!file.shareToken) return
    const share = shares().find((candidate) => candidate.token === file.shareToken)
    if (!share) return
    const url = buildShareUrl(share, shareLinkBase())
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

  function getPathHasShare(file: FileItem) {
    return sharedPathSet().has(normPath(file.path))
  }

  async function uploadFilesToServer(files: File[], targetDir: string) {
    if (files.length === 0) return
    setUploadToast({ kind: 'uploading', fileCount: files.length })
    try {
      const outcome = await explorer.dispatch({
        type: 'command',
        command: { kind: 'upload', parentPath: targetDir, files },
      })
      if (outcome.kind === 'unavailable') throw new Error(outcome.error.message)
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
    const parts = currentPath().split(/[/\\]/).filter(Boolean)
    if (parts.length > 0) {
      const parentPath = parts.slice(0, -1).join('/')
      handleBreadcrumbNavigate(parentPath)
    }
  }

  function prefetchParentDirectory() {
    if (!currentPath()) return
    const parts = currentPath().split(/[/\\]/).filter(Boolean)
    const path = parts.slice(0, -1).join('/')
    void explorer.dispatch({ type: 'prefetch', path })
  }

  function prefetchFile(file: FileItem) {
    if (file.isDirectory) void explorer.dispatch({ type: 'prefetch', path: file.path })
  }

  function handleBreadcrumbNavigate(path: string) {
    void explorer.dispatch({ type: 'navigate', path })
  }

  function breadcrumbAsFolderItem(m: BreadcrumbMenuTarget): FileItem {
    const item = breadcrumbForPath(m.serverPath)?.item
    if (item) return item.file
    const p = m.serverPath
    return {
      name: m.displayName,
      path: p,
      type: MediaType.FOLDER,
      size: 0,
      extension: '',
      isDirectory: true,
    }
  }

  function breadcrumbCapabilities(m: BreadcrumbMenuTarget) {
    return capabilitiesForPath(m.serverPath)
  }

  const breadcrumbMenuActions = createMemo(() => {
    const m = breadcrumbMenu()
    if (!m) {
      return { showOpenInNewTab: false, showOpenInWorkspace: false, showSetIcon: false }
    }
    const capabilities = breadcrumbCapabilities(m)
    return {
      showOpenInNewTab: !m.isHome && capabilities.includes('browse'),
      showOpenInWorkspace: !isOfflineBrowser() && capabilities.includes('browse'),
      showSetIcon: !m.isHome && capabilities.includes('setAppearance'),
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
      const plan = openResource(resourceForFileItem(breadcrumbAsFolderItem(m)), 'browse', {
        surface: 'library',
        scope: OWNER_OPEN_SCOPE,
      })
      if (plan.kind !== 'browse') return
      window.open(`${window.location.origin}${window.location.pathname || '/'}`, '_blank')
      return
    }
    handleContextOpenInNewTab(breadcrumbAsFolderItem(m))
  }

  function handleBreadcrumbOpenInWorkspace() {
    const m = breadcrumbMenu()
    if (!m) return
    if (m.isHome) {
      const plan = openResource(resourceForFileItem(breadcrumbAsFolderItem(m)), 'browse', {
        surface: 'workspace',
        scope: OWNER_OPEN_SCOPE,
      })
      if (plan.kind !== 'browse') return
      window.open('/workspace', '_blank')
      return
    }
    handleContextOpenInWorkspace(breadcrumbAsFolderItem(m))
  }

  function handleBreadcrumbSetIcon() {
    const m = breadcrumbMenu()
    if (!m || m.isHome || !breadcrumbCapabilities(m).includes('setAppearance')) return
    setIconEditTarget(breadcrumbAsFolderItem(m))
  }

  function handleContextDownload(file: FileItem) {
    const item = itemForFile(file)
    if (!item) return
    void explorer
      .dispatch({ type: 'action', action: 'download', key: item.key })
      .then((outcome) => {
        if (outcome.kind !== 'action' || outcome.plan.kind !== 'download') return
        const link = document.createElement('a')
        link.href = outcome.plan.href
        link.download = outcome.plan.fileName
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      })
  }

  function handleContextMakeAvailableOffline(file: FileItem) {
    const item = itemForFile(file)
    if (!item) return
    const kind = item.capabilities.includes('removeOffline') ? 'removeOffline' : 'keepOffline'
    void explorer.dispatch({ type: 'command', command: { kind, item } })
  }

  function handleContextOpenInNewTab(file: FileItem) {
    if (!file.isDirectory || file.isVirtual) return
    const open = (kind: string) => {
      if (kind !== 'browse') return
      const params = new URLSearchParams()
      if (file.path) params.set('dir', file.path)
      if (explicitOffline) params.set('offline', '1')
      const query = params.toString()
      const url = `${window.location.origin}${window.location.pathname || '/'}${query ? `?${query}` : ''}`
      window.open(url, '_blank')
    }
    const item = itemForFile(file)
    if (!item) {
      open(
        openResource(resourceForFileItem(file), 'browse', {
          surface: 'library',
          scope: OWNER_OPEN_SCOPE,
        }).kind,
      )
      return
    }
    void explorer
      .dispatch({ type: 'open', key: item.key, intent: 'browse', surface: 'library' })
      .then((outcome) => outcome.kind === 'open' && open(outcome.plan.kind))
  }

  function handleContextOpenInWorkspace(file: FileItem) {
    if (!file.isDirectory || file.isVirtual) return
    const open = (kind: string) => {
      if (kind !== 'browse') return
      const params = new URLSearchParams()
      if (file.path) params.set('dir', file.path)
      const query = params.toString()
      window.open(query ? `/workspace?${query}` : '/workspace', '_blank')
    }
    const item = itemForFile(file)
    if (!item) {
      open(
        openResource(resourceForFileItem(file), 'browse', {
          surface: 'workspace',
          scope: OWNER_OPEN_SCOPE,
        }).kind,
      )
      return
    }
    void explorer
      .dispatch({ type: 'open', key: item.key, intent: 'browse', surface: 'workspace' })
      .then((outcome) => outcome.kind === 'open' && open(outcome.plan.kind))
  }

  function handleContextToggleFavorite(file: FileItem) {
    favoriteMutation.mutate(file)
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

  function fileItemFromPath(filePath: string): FileItem {
    return legacyFileItemFromPath(filePath)
  }

  function executeFileOpen(
    file: FileItem,
    sourceDir: string,
    countView: boolean,
    offline: boolean,
    item: ExplorerItem | undefined,
    plan: ReturnType<typeof openResource>,
  ) {
    executeOpenPlan(plan, (planned) => {
      if (planned.kind === 'browse') {
        void explorer.dispatch({ type: 'navigate', path: file.path })
        return
      }
      if (planned.kind !== 'playback' && planned.kind !== 'viewer') return

      if (countView && !offline) {
        if (item) {
          void explorer
            .dispatch({ type: 'command', command: { kind: 'recordView', item } })
            .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.stats() }))
        } else {
          viewStats.incrementView(file.path)
        }
      }
      if (planned.kind === 'playback') {
        const playbackItem = playbackItemFromFileItem(file, planned)
        if (!playbackItem) return
        playbackSession.dispatch({
          type: 'load',
          item: playbackItem,
          queue:
            planned.media === 'audio'
              ? playbackQueueFromFiles(
                  files().filter((candidate) => candidate.type === MediaType.AUDIO),
                )
              : [playbackItem],
          autoplay: true,
          mode: planned.media,
        })
        playFile(file.path, sourceDir)
      } else {
        viewFile(file.path, sourceDir, planned.viewer.id)
      }
    })
  }

  function handleFileClick(file: FileItem, sourceDir = currentPath(), countView = true) {
    const offline = isOfflineBrowser()
    const item = itemForFile(file)
    if (!item) {
      executeFileOpen(
        file,
        sourceDir,
        countView,
        offline,
        undefined,
        openResource(resourceForFileItem(file), 'default', {
          surface: 'library',
          scope: OWNER_OPEN_SCOPE,
        }),
      )
      return
    }
    void explorer.dispatch({ type: 'open', key: item.key, surface: 'library' }).then((outcome) => {
      if (outcome.kind === 'open') {
        executeFileOpen(
          outcome.item.file,
          sourceDir,
          countView,
          offline,
          outcome.item,
          outcome.plan,
        )
      }
    })
  }

  function handleLibrarySearchResult(result: FileSearchResult) {
    handleFileClick(fileSearchResultToFileItem(result), result.parentPath)
  }

  function setViewMode(mode: 'list' | 'grid') {
    void explorer.dispatch({ type: 'viewMode', viewMode: mode })
  }

  function handleKbResultClick(filePath: string) {
    setSearchQuery('')
    setSearchPopoverOpen(false)
    handleFileClick(fileItemFromPath(filePath), currentPath(), false)
  }

  function handleContextOpenWithReader(file: FileItem) {
    const item = itemForFile(file)
    if (!item) return
    void explorer
      .dispatch({ type: 'open', key: item.key, intent: 'read', surface: 'library' })
      .then((outcome) => {
        if (outcome.kind !== 'open') return
        executeOpenPlan(outcome.plan, (planned) => {
          if (planned.kind === 'viewer') openInReader(outcome.item.file, planned.viewer.id)
        })
      })
  }

  function handleContextToggleKnowledgeBase(file: FileItem) {
    knowledgeBaseMutation.mutate(file)
  }

  function handleContextSetIcon(file: FileItem) {
    setIconEditTarget(file)
  }

  function handleSaveCustomIcon(iconName: string | null) {
    const t = iconEditTarget()
    if (!t) return
    if (iconName) {
      setCustomIconMutation.mutate(
        { target: t, iconName },
        { onSuccess: () => setIconEditTarget(null) },
      )
    } else {
      removeCustomIconMutation.mutate(t, { onSuccess: () => setIconEditTarget(null) })
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

  function focusExplorerItem(key: string | undefined) {
    if (!key) return
    const file = explorerSnapshot().items.find((item) => item.key === key)?.file
    if (!file) return
    const findElement = () =>
      [...(fileBrowserEl?.querySelectorAll<HTMLElement>('[data-file-path]') ?? [])].find(
        (candidate) => candidate.dataset.filePath === file.path,
      )
    const mountedElement = findElement()
    if (mountedElement) {
      mountedElement.focus()
      return
    }

    const scroller = getVirtualFileScroller(fileBrowserScrollScope())
    if (!scroller?.hasPath(file.path)) return
    scroller.scrollToPath(file.path)

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

  async function handleExplorerKeyDown(e: KeyboardEvent) {
    const target = e.target
    if (
      target instanceof Element &&
      target.closest('input, textarea, select, button, a, [contenteditable="true"]')
    ) {
      return
    }
    if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault()
      await explorer.dispatch({ type: e.key === 'ArrowLeft' ? 'back' : 'forward' })
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      await explorer.dispatch({ type: 'focusMove', delta: e.key === 'ArrowDown' ? 1 : -1 })
      focusExplorerItem(explorerSnapshot().focusedKey)
      return
    }
    const focusedKey = explorerSnapshot().focusedKey
    if (e.key === 'Escape') {
      e.preventDefault()
      void explorer.dispatch({ type: 'clearSelection' })
    } else if ((e.key === ' ' || e.key === 'Spacebar') && focusedKey) {
      e.preventDefault()
      void explorer.dispatch({ type: 'select', key: focusedKey, mode: 'toggle' })
    } else if (e.key === 'Enter' && focusedKey) {
      e.preventDefault()
      const item = explorerSnapshot().items.find((candidate) => candidate.key === focusedKey)
      if (item) handleFileClick(item.file)
    }
  }

  return (
    <div class='file-browser-page min-h-screen bg-background'>
      <MainMediaPlayers
        editableFolders={editableFolders()}
        knowledgeBases={knowledgeBases()}
        offline={isOfflineBrowser()}
        explorerFiles={files()}
      />
      <div
        class={cn(isAudioPlayingBar() && 'pb-[var(--playback-audio-chrome-height)]')}
        data-testid='media-chrome-pad-root'
        data-audio-active={isAudioPlayingBar() ? 'true' : undefined}
      >
        <div
          ref={(element) => {
            fileBrowserEl = element
          }}
          data-testid='file-browser'
          class='flex min-h-0 flex-1 flex-col'
          tabIndex={0}
          title={
            isEditable() && inKb()
              ? 'Focus here and paste (Ctrl+V) to create a file from the clipboard.'
              : undefined
          }
          onPaste={(e) => void handlePasteEvent(e)}
          onKeyDown={(e) => void handleExplorerKeyDown(e)}
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
                      breadcrumbs={explorerSnapshot().breadcrumbs}
                      homeLabel={isOfflineBrowser() ? 'Offline' : undefined}
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
                        aria-pressed={searchPopoverOpen()}
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
                    <Show when={!isOfflineBrowser()}>
                      <FileSearchButton
                        title='Search library'
                        testId='classic-file-search-trigger'
                        onSelect={handleLibrarySearchResult}
                      />
                    </Show>
                    <ViewModeToggle viewMode={viewMode()} onChange={setViewMode} />
                    <ThemeSwitcher scope='owner' />
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
                  <Show when={filesQuery.isError}>
                    <DirectoryListingErrorPanel
                      onRetry={() => void filesQuery.refetch()}
                      detail={filesQuery.error?.message}
                    />
                  </Show>

                  <Show when={!filesQuery.isError}>
                    <Show
                      when={showKbSearchResults()}
                      fallback={
                        <>
                          <Show when={inKb() && !!currentPath()}>
                            <KbDashboard
                              scopePath={currentPath()}
                              onFileClick={handleKbResultClick}
                              recentDragCanMove={() =>
                                explorerSnapshot().capabilities.includes('move')
                              }
                            />
                          </Show>
                          <DirectoryListingLoading
                            show={isFilesLoadingInitial() && showFilesDeferredLoading()}
                          />
                          <Show when={!isFilesLoadingInitial()}>
                            <Switch>
                              <Match when={viewMode() === 'grid'}>
                                <div class='py-4 px-4'>
                                  <VirtualDirectoryGrid
                                    files={files}
                                    includeParent={() => !!currentPath()}
                                    scrollTarget={{ kind: 'window' }}
                                    scrollScope={fileBrowserScrollScope}
                                    onVisibleRangeChange={reportVisibleRange}
                                    class='gap-4'
                                    renderParentCard={() => (
                                      <div
                                        class='ring-foreground/10 bg-card text-card-foreground cursor-pointer py-0 transition-colors select-none hover:bg-muted/50 rounded-xl text-left shadow-xs ring-1 overflow-hidden flex flex-col'
                                        onClick={handleParentDirectory}
                                        onFocus={() =>
                                          void explorer.dispatch({ type: 'focus', key: undefined })
                                        }
                                        onPointerEnter={prefetchParentDirectory}
                                        onKeyDown={(e) => {
                                          if (e.key !== 'Enter') return
                                          e.preventDefault()
                                          e.stopPropagation()
                                          handleParentDirectory()
                                        }}
                                        role='button'
                                        tabindex={0}
                                      >
                                        <div class='flex aspect-video flex-col items-center justify-center p-4 bg-muted/80'>
                                          <ArrowUp
                                            class='mb-2 h-12 w-12 text-muted-foreground'
                                            size={48}
                                            stroke-width={2}
                                          />
                                          <p class='text-center text-sm font-medium'>..</p>
                                          <p class='text-center text-xs text-muted-foreground'>
                                            Parent Folder
                                          </p>
                                        </div>
                                      </div>
                                    )}
                                    renderFileCard={(file) => {
                                      const isFav = () => favoriteSet().has(file.path)
                                      const itemKey = () => itemForFile(file)?.key
                                      const selected = () => {
                                        const key = itemKey()
                                        return !!key && explorerSnapshot().selection.includes(key)
                                      }
                                      return (
                                        <div
                                          data-file-path={file.path}
                                          class={cn(
                                            'ring-foreground/10 bg-card text-card-foreground cursor-pointer py-0 transition-colors select-none hover:bg-muted/50 rounded-xl text-left shadow-xs ring-1 overflow-hidden flex flex-col',
                                            playingPath() === file.path ? 'bg-primary/10' : '',
                                            selected() ? 'ring-2 ring-primary bg-primary/5' : '',
                                          )}
                                          onClick={() => handleFileClick(file)}
                                          onFocus={() =>
                                            void explorer.dispatch({
                                              type: 'focus',
                                              key: itemKey(),
                                            })
                                          }
                                          onPointerEnter={() => prefetchFile(file)}
                                          onContextMenu={(e) =>
                                            fileRowMenu.openRowContextMenu(e, file)
                                          }
                                          {...createLongPressContextMenuHandlers()}
                                          role='button'
                                          aria-pressed={selected()}
                                          tabindex={
                                            explorerSnapshot().focusedKey === itemKey() ? 0 : -1
                                          }
                                        >
                                          <div class='group relative flex aspect-video items-center justify-center overflow-hidden bg-muted'>
                                            <button
                                              type='button'
                                              aria-label={`More actions for ${file.name}`}
                                              class='absolute right-1.5 bottom-1.5 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm'
                                              onClick={(e) =>
                                                fileRowMenu.openRowMenuFromButton(e, file)
                                              }
                                            >
                                              <Ellipsis class='h-5 w-5' aria-hidden='true' />
                                            </button>
                                            <Show
                                              when={
                                                !file.isDirectory &&
                                                capabilitiesForFile(file).includes('favorite')
                                              }
                                            >
                                              <button
                                                type='button'
                                                class={cn(
                                                  'absolute top-1.5 left-1.5 z-10 rounded-full p-1 transition-all',
                                                  isFav()
                                                    ? 'bg-background/90 shadow-sm hover:bg-background'
                                                    : 'bg-background/70 opacity-60 hover:bg-background/90 group-hover:opacity-100',
                                                )}
                                                title={
                                                  isFav()
                                                    ? 'Remove from favorites'
                                                    : 'Add to favorites'
                                                }
                                                onClick={(e) => {
                                                  e.stopPropagation()
                                                  favoriteMutation.mutate(file)
                                                }}
                                              >
                                                <Star
                                                  class={cn(
                                                    'h-3.5 w-3.5',
                                                    isFav()
                                                      ? 'fill-yellow-400 text-yellow-400'
                                                      : 'text-muted-foreground',
                                                  )}
                                                  fill={isFav() ? 'currentColor' : 'none'}
                                                  stroke-width={2}
                                                />
                                              </button>
                                            </Show>
                                            <Show when={!file.isDirectory}>
                                              <div
                                                class={cn(
                                                  'absolute top-1.5 right-1.5 z-10 flex items-center gap-1',
                                                  viewStats.getViewCount(file.path) > 0 ||
                                                    viewStats.getShareViewCount(file.path) > 0
                                                    ? ''
                                                    : 'hidden',
                                                )}
                                              >
                                                <Show when={viewStats.getViewCount(file.path) > 0}>
                                                  <div
                                                    class='flex items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 shadow-sm backdrop-blur-sm'
                                                    title={`${viewStats.getViewCount(file.path)} views`}
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
                                                <Show
                                                  when={viewStats.getShareViewCount(file.path) > 0}
                                                >
                                                  <div
                                                    class='flex items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 shadow-sm backdrop-blur-sm'
                                                    title={`${viewStats.getShareViewCount(file.path)} shared views`}
                                                  >
                                                    <Share2
                                                      class='h-3 w-3 text-primary/70'
                                                      stroke-width={2}
                                                    />
                                                    <span class='text-xs font-medium text-primary/70'>
                                                      {viewStats.getShareViewCount(file.path)}
                                                    </span>
                                                  </div>
                                                </Show>
                                              </div>
                                            </Show>
                                            <div
                                              class='text-muted-foreground'
                                              {...(isRowKnowledgeBase(file)
                                                ? { 'data-kb-root-icon': '' }
                                                : {})}
                                            >
                                              {gridHeroIcon(file, fileIconCtx())}
                                            </div>
                                          </div>
                                          <div class='flex flex-col gap-1 p-3'>
                                            <p
                                              class='truncate text-sm font-medium'
                                              title={file.name}
                                            >
                                              {file.name}
                                              <OfflineBadge path={file.path} />
                                              <Show when={sharedPathSet().has(file.path)}>
                                                <LinkIcon
                                                  class='ml-1 inline h-3 w-3 text-primary opacity-70'
                                                  aria-hidden='true'
                                                  stroke-width={2}
                                                />
                                              </Show>
                                            </p>
                                            <Show
                                              when={
                                                !file.isDirectory &&
                                                file.path.split(/[/\\]/).slice(0, -1).join('/') !==
                                                  currentPath()
                                              }
                                              fallback={
                                                <div class='flex items-center justify-end text-xs text-muted-foreground'>
                                                  <span>
                                                    {file.isDirectory
                                                      ? ''
                                                      : formatFileSize(file.size)}
                                                  </span>
                                                </div>
                                              }
                                            >
                                              <p
                                                class='truncate text-xs text-muted-foreground'
                                                title={
                                                  file.path.split(/[/\\]/).slice(0, -1).join('/') ||
                                                  '/'
                                                }
                                              >
                                                {file.path.split(/[/\\]/).slice(0, -1).join('/') ||
                                                  '/'}
                                              </p>
                                            </Show>
                                          </div>
                                        </div>
                                      )
                                    }}
                                  />
                                  <DirectoryListingEmpty
                                    show={showEmptyFolder()}
                                    canUpload={isEditable()}
                                  />
                                </div>
                              </Match>
                              <Match when={viewMode() === 'list'}>
                                <div class='sm:px-4 py-2'>
                                  <VirtualDirectoryList
                                    files={files}
                                    includeParent={() => !!currentPath()}
                                    scrollTarget={{ kind: 'window' }}
                                    scrollScope={fileBrowserScrollScope}
                                    onVisibleRangeChange={reportVisibleRange}
                                    class='relative w-full overflow-x-auto'
                                    colSpan={4}
                                    sizeColumnClass='w-28'
                                    renderParentRow={() => (
                                      <tr
                                        class={cn(
                                          'border-b border-border transition-colors hover:bg-muted/50 cursor-pointer select-none',
                                          dragOverPath() === '__parent__' ? 'bg-primary/20' : '',
                                        )}
                                        onClick={handleParentDirectory}
                                        onPointerEnter={prefetchParentDirectory}
                                        onDragOver={
                                          allowMoveFile() && canDropOnParent()
                                            ? parentRowDragOver
                                            : undefined
                                        }
                                        onDragLeave={
                                          allowMoveFile() && canDropOnParent()
                                            ? parentRowDragLeave
                                            : undefined
                                        }
                                        onDrop={
                                          allowMoveFile() && canDropOnParent()
                                            ? parentRowDrop
                                            : undefined
                                        }
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
                                      const isFav = () => favoriteSet().has(file.path)
                                      const itemKey = () => itemForFile(file)?.key
                                      const selected = () => {
                                        const key = itemKey()
                                        return !!key && explorerSnapshot().selection.includes(key)
                                      }
                                      const canDragRow = enableDrag()
                                      return (
                                        <tr
                                          data-file-path={file.path}
                                          tabindex={
                                            explorerSnapshot().focusedKey === itemKey() ? 0 : -1
                                          }
                                          aria-selected={selected()}
                                          class={cn(
                                            'border-b border-border transition-colors hover:bg-muted/50 cursor-pointer select-none group',
                                            playingPath() === file.path ? 'bg-primary/10' : '',
                                            selected() ? 'bg-primary/10' : '',
                                            file.isDirectory && dragOverPath() === file.path
                                              ? 'bg-primary/20'
                                              : '',
                                            draggedPath() === file.path ? 'opacity-50' : '',
                                          )}
                                          draggable={canDragRow}
                                          onClick={() => handleFileClick(file)}
                                          onFocus={() =>
                                            void explorer.dispatch({
                                              type: 'focus',
                                              key: itemKey(),
                                            })
                                          }
                                          onPointerEnter={() => prefetchFile(file)}
                                          onContextMenu={(e) =>
                                            fileRowMenu.openRowContextMenu(e, file)
                                          }
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
                                            {...(isRowKnowledgeBase(file)
                                              ? { 'data-kb-root-icon': '' }
                                              : {})}
                                          >
                                            <div class='flex items-center justify-center'>
                                              {fileItemIcon(file, fileIconCtx())}
                                            </div>
                                          </td>
                                          <td class='min-w-0 p-2 align-middle font-medium'>
                                            <div class='flex items-center gap-2 min-w-0'>
                                              <Show
                                                when={
                                                  !file.isDirectory &&
                                                  capabilitiesForFile(file).includes('favorite')
                                                }
                                              >
                                                <button
                                                  type='button'
                                                  class='shrink-0 opacity-50 hover:opacity-100 group-hover:opacity-100 transition-opacity inline-flex'
                                                  title={
                                                    isFav()
                                                      ? 'Remove from favorites'
                                                      : 'Add to favorites'
                                                  }
                                                  onClick={(e) => {
                                                    e.stopPropagation()
                                                    favoriteMutation.mutate(file)
                                                  }}
                                                >
                                                  <Star
                                                    class={cn(
                                                      'h-4 w-4',
                                                      isFav()
                                                        ? 'fill-yellow-400 text-yellow-400 opacity-100'
                                                        : 'text-muted-foreground',
                                                    )}
                                                    fill={isFav() ? 'currentColor' : 'none'}
                                                    size={16}
                                                    stroke-width={2}
                                                  />
                                                </button>
                                              </Show>
                                              <div class='min-w-0 flex-1'>
                                                <span class='block truncate'>
                                                  {file.name}
                                                  <OfflineBadge path={file.path} />
                                                  <Show when={sharedPathSet().has(file.path)}>
                                                    <LinkIcon
                                                      class='ml-1.5 inline h-3 w-3 text-primary opacity-70'
                                                      aria-hidden='true'
                                                      stroke-width={2}
                                                    />
                                                  </Show>
                                                </span>
                                                <Show
                                                  when={
                                                    !file.isDirectory &&
                                                    file.path
                                                      .split(/[/\\]/)
                                                      .slice(0, -1)
                                                      .join('/') !== currentPath()
                                                  }
                                                >
                                                  <span class='block truncate text-xs text-muted-foreground'>
                                                    {file.path
                                                      .split(/[/\\]/)
                                                      .slice(0, -1)
                                                      .join('/') || '/'}
                                                  </span>
                                                </Show>
                                              </div>
                                            </div>
                                          </td>
                                          <td class='min-w-0 p-2 align-middle text-right text-muted-foreground'>
                                            <div class='flex items-center justify-end gap-2'>
                                              <Show when={!file.isDirectory}>
                                                <Show when={viewStats.getViewCount(file.path) > 0}>
                                                  <div
                                                    class='flex items-center gap-1 text-xs'
                                                    title={`${viewStats.getViewCount(file.path)} views`}
                                                    data-testid='file-view-count'
                                                  >
                                                    <Eye
                                                      class='h-3.5 w-3.5 shrink-0'
                                                      stroke-width={2}
                                                    />
                                                    <span>{viewStats.getViewCount(file.path)}</span>
                                                  </div>
                                                </Show>
                                                <Show
                                                  when={viewStats.getShareViewCount(file.path) > 0}
                                                >
                                                  <div
                                                    class='flex items-center gap-1 text-xs text-primary/70'
                                                    title={`${viewStats.getShareViewCount(file.path)} shared views`}
                                                  >
                                                    <Share2
                                                      class='h-3 w-3 shrink-0'
                                                      stroke-width={2}
                                                    />
                                                    <span>
                                                      {viewStats.getShareViewCount(file.path)}
                                                    </span>
                                                  </div>
                                                </Show>
                                              </Show>
                                              <span class='inline-block w-20 tabular-nums shrink-0'>
                                                {file.isDirectory ? '' : formatFileSize(file.size)}
                                              </span>
                                            </div>
                                          </td>
                                          <td class='p-1 align-middle'>
                                            <button
                                              type='button'
                                              aria-label={`More actions for ${file.name}`}
                                              class='inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-muted'
                                              onClick={(e) =>
                                                fileRowMenu.openRowMenuFromButton(e, file)
                                              }
                                            >
                                              <Ellipsis class='h-5 w-5' aria-hidden='true' />
                                            </button>
                                          </td>
                                        </tr>
                                      )
                                    }}
                                    renderEmptyRow={() => (
                                      <DirectoryListingEmptyTableRow
                                        show={showEmptyFolder()}
                                        canUpload={isEditable()}
                                      />
                                    )}
                                  />
                                </div>
                              </Match>
                            </Switch>
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
                  </Show>
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
            capabilities={() => explorerSnapshot().capabilities}
            menu={directoryBackgroundMenu}
            onDismiss={() => setDirectoryBackgroundMenu(null)}
            onNewFile={openCreateFile}
            onNewFolder={openCreateFolder}
          />

          <FileBrowserModalLayer
            getCapabilities={capabilitiesForFile}
            getVirtualEntry={virtualEntryForFile}
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
            onBreadcrumbOpenInWorkspace={handleBreadcrumbOpenInWorkspace}
            onBreadcrumbSetIcon={handleBreadcrumbSetIcon}
            fileRowMenu={fileRowMenu}
            onContextDownload={handleContextDownload}
            onContextMakeAvailableOffline={handleContextMakeAvailableOffline}
            onContextShare={handleContextShare}
            onCopyShareLink={handleCopyShareLink}
            getPathHasShare={getPathHasShare}
            onContextOpenInNewTab={handleContextOpenInNewTab}
            onContextOpenInWorkspace={isOfflineBrowser() ? undefined : handleContextOpenInWorkspace}
            onContextOpenWithBrowser={handleFileClick}
            onContextOpenWithReader={handleContextOpenWithReader}
            onContextToggleFavorite={handleContextToggleFavorite}
            isRowFavorite={isRowFavorite}
            onContextRename={handleContextRename}
            onContextMove={handleContextMove}
            onContextCopyTo={handleContextCopyTo}
            onContextSetIcon={handleContextSetIcon}
            onContextToggleKnowledgeBase={handleContextToggleKnowledgeBase}
            isRowKnowledgeBase={isRowKnowledgeBase}
            shareTarget={shareTarget}
            setShareTarget={setShareTarget}
            shareDialogIsEditable={shareDialogIsEditable}
            shareDialogExistingShares={shareDialogExistingShares}
            shareLinkBase={shareLinkBase}
            deleteTarget={deleteTarget}
            setDeleteTarget={setDeleteTarget}
            deletePending={deleteMutation.isPending}
            revokeSharePending={revokeShareMutation.isPending}
            onConfirmDelete={() => {
              const it = deleteTarget()
              if (!it) return
              if (it.shareToken) {
                void revokeShareMutation.mutateAsync(it).then(() => setDeleteTarget(null))
              } else {
                void deleteMutation.mutateAsync(it).then(() => setDeleteTarget(null))
              }
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
            browseDirectories={(path, signal) =>
              explorerAdapter
                .browse({ path, pageSize: 1_000 }, signal)
                .then((page) => page.items.map((item) => item.file))
            }
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
