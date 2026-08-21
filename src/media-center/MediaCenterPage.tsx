import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import { useServerConfigQuery } from '@/lib/api/use-app-data'
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
import { VIRTUAL_FOLDERS, isVirtualFolderPath } from '@/lib/files/constants'
import { MediaType, type FileItem } from '@/lib/files/types'
import { normalizeNewFilePath } from '@/lib/files/new-file-name'
import { formatFileSize } from '@/lib/media/media-utils'
import { cn } from '@/lib/ui/cn'
import { isPathEditable } from '@/lib/files/path-utils'
import Star from 'lucide-solid/icons/star'
import Eye from 'lucide-solid/icons/eye'
import Ellipsis from 'lucide-solid/icons/ellipsis'
import { createEffect, createMemo, createSignal, Show } from 'solid-js'
import type { FileIconContext } from '@/features/explorer/use-file-icon'
import {
  fileIconContextEquals,
  fileItemIcon,
  GridHeroIcon,
} from '@/features/explorer/use-file-icon'
import { createUrlSearchParamsMemo, useBrowserHistory } from '@/lib/browser/browser-history'
import type { BreadcrumbMenuTarget } from '@/features/explorer/BreadcrumbContextMenu'
import { FileBrowserModalLayer } from '@/features/explorer/FileBrowserModalLayer'
import { navigateToFolder } from '@/features/explorer/navigate-folder'
import { useFileRowContextMenu } from '@/features/explorer/use-file-row-context-menu'
import { FloatingScrollActions } from '@/features/explorer/FloatingScrollActions'
import { sortFilesForPath } from '@/features/explorer/file-display-settings'
import { useFileBrowserController } from '@/features/explorer/use-file-browser-controller'
import {
  FileBrowserSurface,
  type FileBrowserSurfaceRows,
} from '@/features/explorer/FileBrowserSurface'
import { ThemeSwitcher } from './ThemeSwitcher'
import { useAdminEventsStream } from '@/lib/api/use-admin-events-stream'
import { MainMediaPlayers } from './MainMediaPlayers'
import { useDynamicFavicon } from '@/media-center/use-dynamic-favicon'
import { useStoreSync } from '@/lib/state/solid-store-sync'
import { useBrowserViewModeStore } from '@/features/explorer/browser-view-mode-store'
import { openInReader } from '@/features/reader/reader-url'
import { useViewStats } from '@/features/explorer/use-view-stats'
import { useDeferredLoading } from '@/lib/ui/use-deferred-loading'
import { applyPathMutationToUrl, playFile, viewFile } from '@/lib/browser/url-state-actions'
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
  useAdminEventsStream(true, applyPathMutationToUrl)

  const currentPath = createMemo(() => urlSearchParams().get('dir') ?? '')

  const playingParam = createMemo(() => urlSearchParams().get('playing'))

  const playingPath = createMemo(() => playingParam() ?? '')

  const isVirtualFolder = createMemo(() =>
    (Object.values(VIRTUAL_FOLDERS) as string[]).includes(currentPath()),
  )

  const serverConfigQuery = useServerConfigQuery()

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

  const files = createMemo(() => filesQuery.data?.files ?? [])
  const browser = useFileBrowserController({
    currentPath,
    files,
    editable: isEditable,
    editableFolders,
    onFileCreated: (path) => viewFile(path, currentPath()),
    onFileSaved: (path) => viewFile(path, currentPath()),
    onInlineFolderCreated: navigateToFolder,
  })
  const {
    settingsQuery,
    knowledgeBases,
    customIcons,
    inKb,
    hasEditableFolders,
    clearSearch,
    showKbSearchResults,
    uploadToast,
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
    copyMutation,
    viewModeMutation,
    knowledgeBaseMutation,
    setCustomIconMutation,
    removeCustomIconMutation,
  } = browser
  const fileBrowserScrollScope = () => 'main-file-browser'
  const isFilesLoadingInitial = createMemo(
    () => filesQuery.isPending && filesQuery.data === undefined,
  )
  const showFilesDeferredLoading = useDeferredLoading(() => isFilesLoadingInitial())

  const viewStats = useViewStats(() => ({}))
  useDynamicFavicon(() => customIcons(), { getSearch: () => history().search })

  const viewModeTick = useStoreSync(useBrowserViewModeStore)

  const isAudioPlayingBar = createMemo(() => {
    const state = playbackSnapshot()
    return !!state.currentItem && state.mode === 'audio'
  })

  const fileIconCtx = createMemo(
    (): FileIconContext => {
      const state = playbackSnapshot()
      return {
        customIcons: customIcons(),
        knowledgeBases: knowledgeBases(),
        playingPath: playingParam(),
        currentFile: state.currentItem?.locator ?? null,
        mediaPlayerIsPlaying: state.phase === 'playing',
        mediaType: state.currentItem ? state.mode : null,
      }
    },
    { equals: fileIconContextEquals },
  )

  function filesInActiveSortOrder(): FileItem[] {
    return sortFilesForPath(
      files(),
      currentPath(),
      settingsQuery.data?.sortOrders,
      isVirtualFolder(),
    )
  }

  function playbackItemForPath(path: string): PlaybackItem | null {
    const normalizedPath = playbackPathKey(path)
    const listed = files().find((file) => playbackPathKey(file.path) === normalizedPath)
    return listed ? playbackItemFromFileItem(listed) : playbackItemFromPath(path)
  }

  function playbackQueueFor(item: PlaybackItem): PlaybackItem[] {
    if (item.media === 'video') return [item]
    const queue = audioPlaybackQueueFromFiles(filesInActiveSortOrder(), item)
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

  const [iconEditTarget, setIconEditTarget] = createSignal<FileItem | null>(null)
  const breadcrumbMenu = () => breadcrumbFloating.folderMenu

  const viewMode = createMemo(() => {
    void viewModeTick()
    const s = settingsQuery.data
    return useBrowserViewModeStore
      .getState()
      .getViewMode(`admin-viewmode-${currentPath()}`, s?.viewModes?.[currentPath()] ?? 'list')
  })

  const displayedFiles = createMemo(filesInActiveSortOrder)

  const favorites = createMemo(() => settingsQuery.data?.favorites ?? [])
  const favoriteSet = createMemo(() => new Set(favorites()))

  const favoriteMutation = useMutation(() => ({
    mutationFn: (vars: { filePath: string }) => post('/api/settings/favorite', vars),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.files(VIRTUAL_FOLDERS.FAVORITES) })
    },
  }))

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

  const fileRowMenu = useFileRowContextMenu({
    onDeleteRequest: (f) => setDeleteTarget(f),
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
      { path: folderPath },
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
      { path: filePath, content: '' },
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
    clearSearch()
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

  const showEmptyFolder = createMemo(
    () =>
      !filesQuery.isError &&
      filesQuery.data !== undefined &&
      files().length === 0 &&
      !showKbSearchResults(),
  )

  const surfaceRows: FileBrowserSurfaceRows = {
    onParentPointerEnter: () =>
      prefetchParentDirectoryHover(fileBrowserPrefetchCtx(), {
        currentPath: currentPath(),
        isVirtualFolder: isVirtualFolder(),
      }),
    canDropOnParent: browser.canDropOnParent,
    onFilePointerEnter: (file) => prefetchFolderContentsOnHover(fileBrowserPrefetchCtx(), file),
    fileGridClass: (file) => (playingParam() === file.path ? 'bg-primary/10' : ''),
    fileRowClass: (file) => (playingParam() === file.path ? 'bg-primary/10' : ''),
    renderGridIcon: (file) => <GridHeroIcon file={file} context={fileIconCtx} />,
    renderGridOverlay: (file) => {
      const isFav = () => favoriteSet().has(file.path)
      return (
        <>
          <button
            type='button'
            aria-label={'More actions for ' + file.name}
            class='absolute right-1.5 bottom-1.5 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm lg:hidden'
            onClick={(event) => fileRowMenu.openRowMenuFromButton(event, file)}
          >
            <Ellipsis class='h-5 w-5' aria-hidden='true' />
          </button>
          <Show when={!file.isDirectory}>
            <button
              type='button'
              class={cn(
                'absolute top-1.5 left-1.5 z-10 rounded-full p-1 transition-all',
                isFav()
                  ? 'pointer-events-auto bg-background/90 opacity-100 shadow-sm hover:bg-background'
                  : 'pointer-events-none bg-background/70 opacity-0',
              )}
              title={isFav() ? 'Remove from favorites' : 'Add to favorites'}
              onClick={(event) => {
                event.stopPropagation()
                favoriteMutation.mutate({ filePath: file.path })
              }}
            >
              <Star
                class={cn(
                  'h-3.5 w-3.5',
                  isFav() ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground',
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
                <Eye class='h-3 w-3 text-muted-foreground' stroke-width={2} />
                <span class='text-xs font-medium text-muted-foreground'>
                  {viewStats.getViewCount(file.path)}
                </span>
              </div>
            </Show>
          </Show>
        </>
      )
    },
    renderGridDetails: (file) => (
      <div class='flex flex-col gap-1 p-3'>
        <p class='truncate text-sm font-medium' title={file.name}>
          {file.name}
        </p>
        <Show
          when={isVirtualFolder() && !file.isDirectory}
          fallback={
            <div class='flex items-center justify-end text-xs text-muted-foreground'>
              <span>{file.isDirectory ? '' : formatFileSize(file.size)}</span>
            </div>
          }
        >
          <p
            class='truncate text-xs text-muted-foreground'
            title={file.path.split(/[/\\]/).slice(0, -1).join('/') || '/'}
          >
            {file.path.split(/[/\\]/).slice(0, -1).join('/') || '/'}
          </p>
        </Show>
      </div>
    ),
    renderListIcon: (file) => (
      <span {...(isRowKnowledgeBase(file) ? { 'data-kb-root-icon': '' } : {})}>
        {fileItemIcon(file, fileIconCtx())}
      </span>
    ),
    renderListName: (file) => {
      const isFav = () => favoriteSet().has(file.path)
      return (
        <div class='flex items-center gap-2 min-w-0'>
          <Show when={!file.isDirectory}>
            <button
              type='button'
              class='shrink-0 opacity-50 hover:opacity-100 group-hover:opacity-100 transition-opacity inline-flex'
              title={isFav() ? 'Remove from favorites' : 'Add to favorites'}
              onClick={(event) => {
                event.stopPropagation()
                favoriteMutation.mutate({ filePath: file.path })
              }}
            >
              <Star
                class={cn(
                  'h-4 w-4',
                  isFav() ? 'fill-yellow-400 text-yellow-400 opacity-100' : 'text-muted-foreground',
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
                {file.path.split(/[/\\]/).slice(0, -1).join('/') || '/'}
              </span>
            </Show>
          </div>
        </div>
      )
    },
    renderListNameTrailing: (file) => (
      <Show when={!file.isDirectory && viewStats.getViewCount(file.path) > 0}>
        <span
          class='text-muted-foreground flex shrink-0 items-center gap-1 text-xs'
          title={viewStats.getViewCount(file.path) + ' views'}
          data-testid='file-view-count'
        >
          <Eye class='h-3.5 w-3.5 shrink-0' stroke-width={2} />
          <span>{viewStats.getViewCount(file.path)}</span>
        </span>
      </Show>
    ),
    renderListSize: (file) => (
      <span class='inline-block w-20 tabular-nums shrink-0'>
        {file.isDirectory ? '' : formatFileSize(file.size)}
      </span>
    ),
    renderListActions: (file) => (
      <td class='p-1 align-middle'>
        <button
          type='button'
          aria-label={'More actions for ' + file.name}
          class='inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-muted'
          onClick={(event) => fileRowMenu.openRowMenuFromButton(event, file)}
        >
          <Ellipsis class='h-5 w-5' aria-hidden='true' />
        </button>
      </td>
    ),
    renderParentRowEnd: () => <td />,
    dragGrid: false,
  }

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
        <FileBrowserSurface
          layout='media'
          controller={browser}
          currentPath={currentPath}
          files={files}
          displayedFiles={displayedFiles}
          viewMode={viewMode}
          isVirtualFolder={isVirtualFolder}
          sortingDisabled={isVirtualFolder}
          isFilesLoadingInitial={isFilesLoadingInitial}
          showFilesDeferredLoading={showFilesDeferredLoading}
          error={() => (filesQuery.isError ? filesQuery.error?.message : undefined)}
          onRetry={() => void filesQuery.refetch()}
          showEmpty={showEmptyFolder}
          scrollTarget={{ kind: 'window' }}
          scrollScope={fileBrowserScrollScope}
          onParentClick={handleParentDirectory}
          onFileClick={handleFileClick}
          onViewModeChange={setViewMode}
          onBreadcrumbNavigate={handleBreadcrumbNavigate}
          onBreadcrumbContextMenu={handleBreadcrumbCrumbContextMenu}
          onKbResultClick={handleKbResultClick}
          recentDragCanMove={(path) =>
            !!browser.allowMoveFile() && isPathEditable(path, editableFolders())
          }
          canUpload={isEditable}
          toolbar={{
            canCreate: isEditable,
            onCreateFolder: openCreateFolder,
            onCreateFile: openCreateFile,
            extras: () => (
              <>
                <FileSearchButton
                  title='Search library'
                  testId='classic-file-search-trigger'
                  onSelect={handleLibrarySearchResult}
                />
                <ThemeSwitcher />
              </>
            ),
          }}
          fileRowMenu={fileRowMenu}
          rows={surfaceRows}
        />
        <FileBrowserModalLayer
          iconEditTarget={iconEditTarget}
          setIconEditTarget={setIconEditTarget}
          customIcons={customIcons}
          onSaveCustomIcon={handleSaveCustomIcon}
          setCustomIconPending={setCustomIconMutation.isPending}
          removeCustomIconPending={removeCustomIconMutation.isPending}
          uploadToast={uploadToast}
          setUploadToastHidden={setUploadToastHidden}
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
  )
}
