import type { JSX } from '@solidjs/web'
import { useMutation, useQueryClient } from '@tanstack/solid-query'
import { createMemo, createSignal, For, untrack, type Accessor } from 'solid-js'
import { post } from '@/lib/api/client'
import { queryKeys } from '@/lib/api/query-keys'
import { VIRTUAL_FOLDERS } from '@/lib/files/constants'
import { fileDownloadHref } from '@/lib/files/download-urls'
import { isPathEditable, type ClientMediaRoot } from '@/lib/files/path-utils'
import type { FileItem } from '@/lib/files/types'
import type { VirtualOpenTarget } from '@/lib/files/virtual-directory'
import { getMediaExtensionFromPath, getMediaTypeFromPath } from '@/lib/media/media-utils'
import { useStoreSync } from '@/lib/state/solid-store-sync'
import {
  prefetchFolderContentsOnHover,
  prefetchParentDirectoryHover,
  type PrefetchFolderHoverContext,
} from './prefetch-folder-hover'
import { createFileSortMetadata, sortFilesForPath } from './file-display-settings'
import { useBrowserViewModeStore } from './browser-view-mode-store'
import { FileBrowserModalLayer } from './FileBrowserModalLayer'
import { FileBrowserView } from './FileBrowserSurface'
import { useFileBrowserActions } from './use-file-browser-actions'
import { useFileBrowserChrome } from './use-file-browser-chrome'
import { useFileBrowserController } from './use-file-browser-controller'
import { useFileBrowserListing } from './use-file-browser-listing'
import { useViewStats } from './use-view-stats'
import type { FileIconContext } from './use-file-icon'

export type FileBrowserHostActions = Readonly<{
  otherSurfaceLabel: string
  openNewTab?: (file: FileItem | null, sourceDir: string) => void
  openOtherSurface?: (file: FileItem | null) => void
  addToTaskbar?: (file: FileItem) => void
  openInSplitView?: (file: FileItem) => void
  beginOpenTargetPick?: () => void
  openInNewWindow?: (file: FileItem) => void
  fileHover?: (file: FileItem) => void
  newTabLabel?: string
  defaultFileOpen?: Accessor<'new-tab' | 'new-window'>
}>

export type FileBrowserListingContext = Readonly<{
  files: Accessor<FileItem[]>
  orderedFiles: Accessor<FileItem[]>
}>

export type FileBrowserPresentation = Readonly<{
  file: FileItem
  sourceDir: string
  orderedFiles: readonly FileItem[]
}> &
  ({ kind: 'default' } | { kind: 'reader' } | { kind: 'virtual'; target: VirtualOpenTarget })

export type FileBrowserHost = Readonly<{
  layout: 'media' | 'workspace'
  currentPath: Accessor<string>
  editableFolders: Accessor<string[]>
  mediaRoots?: Accessor<ClientMediaRoot[]>
  active?: Accessor<boolean>
  iconContext: Accessor<FileIconContext>
  navigate: (path: string) => void
  present: (request: FileBrowserPresentation) => void
  actions: FileBrowserHostActions
  toolbarExtras?: () => JSX.Element
  renderExtras?: (listing: FileBrowserListingContext) => JSX.Element
}>

function fileItemFromPath(path: string, displayName?: string): FileItem {
  const name = displayName ?? path.split(/[/\\]/).filter(Boolean).pop() ?? 'file'
  return {
    path,
    name,
    isDirectory: false,
    size: 0,
    extension: getMediaExtensionFromPath(path),
    type: getMediaTypeFromPath(path),
  }
}

function parentPath(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean)
  return parts.length <= 1 ? '' : parts.slice(0, -1).join('/')
}

function downloadLocalFile(file: FileItem) {
  const link = document.createElement('a')
  link.href = fileDownloadHref(file.path)
  link.download = file.isDirectory ? `${file.name}.zip` : file.name
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
}

export function FileBrowser(props: { host: FileBrowserHost }) {
  const host = untrack(() => props.host)
  return (
    <For each={[host.currentPath()]}>
      {(path) => <FileBrowserInstance host={host} currentPath={() => path} />}
    </For>
  )
}

function FileBrowserInstance(props: { host: FileBrowserHost; currentPath: Accessor<string> }) {
  const host = untrack(() => props.host)
  const currentPath = untrack(() => props.currentPath)
  const queryClient = useQueryClient()
  const [directoryScrollElement, setDirectoryScrollElement] = createSignal<HTMLDivElement>()
  const listing = useFileBrowserListing({ currentPath })
  const files = listing.files
  const isVirtualFolder = createMemo(() =>
    (Object.values(VIRTUAL_FOLDERS) as string[]).includes(currentPath()),
  )
  const editable = createMemo(
    () =>
      !isVirtualFolder() &&
      !listing.virtualDirectory() &&
      isPathEditable(currentPath(), host.editableFolders(), host.mediaRoots?.()),
  )

  function openFile(file: FileItem, sourceDir = currentPath()) {
    if (file.isDirectory) {
      host.navigate(file.path)
      return
    }
    if (fileActions.virtual?.open(file)) return
    viewStats.incrementView(file.path)
    host.present({ kind: 'default', file, sourceDir, orderedFiles: displayedFiles() })
  }

  function openPath(path: string, displayName?: string) {
    openFile(fileItemFromPath(path, displayName))
  }

  const browser = useFileBrowserController({
    currentPath,
    layout: host.layout,
    files,
    editable,
    editableFolders: host.editableFolders,
    isActive: host.active,
    virtualEntry: listing.virtualEntry,
    onFileCreated: openPath,
    onFileSaved: openPath,
    onInlineFileCreated: openPath,
    onInlineFolderCreated: host.navigate,
  })
  const fileActions = useFileBrowserActions({
    controller: browser,
    currentPath,
    files,
    inKnowledgeBase: browser.inKb,
    editableFolders: host.editableFolders,
    copyEnabled: true,
    virtual: {
      currentPath,
      files,
      directory: listing.virtualDirectory,
      entry: listing.virtualEntry,
      setError: browser.upload.setError,
      openTarget: (file, target) =>
        host.present({
          kind: 'virtual',
          file,
          target,
          sourceDir: currentPath(),
          orderedFiles: displayedFiles(),
        }),
    },
  })
  const viewStats = useViewStats()
  const sortMetadata = createMemo(() =>
    createFileSortMetadata(browser.settingsQuery.data?.favorites, viewStats.viewCounts()),
  )
  const isFavorite = (file: FileItem) => sortMetadata().isFavorite(file)
  const favoriteMutation = useMutation(() => ({
    mutationFn: (vars: { filePath: string }) => post('/api/settings/favorite', vars),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
      void queryClient.invalidateQueries({
        queryKey: queryKeys.files(VIRTUAL_FOLDERS.FAVORITES),
      })
    },
  }))
  const toggleFavorite = (file: FileItem) => favoriteMutation.mutate({ filePath: file.path })
  const viewModeTick = useStoreSync(useBrowserViewModeStore)
  const viewMode = createMemo(() => {
    void viewModeTick()
    return useBrowserViewModeStore
      .getState()
      .getViewMode(
        `file-browser-viewmode-${currentPath()}`,
        browser.settingsQuery.data?.viewModes?.[currentPath()] ?? 'list',
      )
  })
  const sortingDisabled = createMemo(() => isVirtualFolder() || !!listing.virtualDirectory())
  const displayedFiles = createMemo(() =>
    sortFilesForPath(
      files(),
      currentPath(),
      browser.settingsQuery.data?.sortOrders,
      sortingDisabled(),
      sortMetadata(),
    ),
  )
  const empty = createMemo(
    () =>
      !listing.query.isError &&
      listing.query.data !== undefined &&
      files().length === 0 &&
      !browser.search.showingResults(),
  )
  const isKnowledgeBase = (file: FileItem) =>
    file.isDirectory && browser.knowledgeBases().includes(file.path.replace(/\\/g, '/'))

  function setViewMode(mode: 'list' | 'grid') {
    useBrowserViewModeStore.getState().setViewMode(`file-browser-viewmode-${currentPath()}`, mode)
    browser.mutations.viewModeMutation.mutate({ path: currentPath(), viewMode: mode })
  }

  function download(file: FileItem) {
    if (fileActions.virtual?.download(file)) return
    downloadLocalFile(file)
  }

  function prefetchContext(): PrefetchFolderHoverContext {
    return { queryClient, knowledgeBases: browser.knowledgeBases() }
  }

  const chrome = useFileBrowserChrome({
    controller: browser,
    otherSurfaceLabel: host.actions.otherSurfaceLabel,
    openBreadcrumbInNewTab: host.actions.openNewTab
      ? (file) => host.actions.openNewTab?.(file, currentPath())
      : undefined,
    openBreadcrumbInOtherSurface: host.actions.openOtherSurface,
    createRowMenu: (setIcon) => ({
      api: fileActions.rowMenu,
      editableFolders: host.editableFolders,
      currentDirectoryEditable: editable,
      hasEditableFolders: () => host.editableFolders().length > 0,
      download,
      setIcon,
      get addToTaskbar() {
        return host.actions.addToTaskbar
      },
      get openInNewTab() {
        return host.actions.openNewTab
          ? (file: FileItem) => host.actions.openNewTab?.(file, currentPath())
          : undefined
      },
      get openInNewTabLabel() {
        return host.actions.newTabLabel
      },
      get showOpenInNewTabForFiles() {
        return !!host.actions.openNewTab
      },
      get openInSplitView() {
        return host.actions.openInSplitView
      },
      openInOtherSurface: host.actions.openOtherSurface,
      openInOtherSurfaceLabel: host.actions.otherSurfaceLabel,
      openWithBrowser: openFile,
      openWithReader: (file) =>
        host.present({
          kind: 'reader',
          file,
          sourceDir: currentPath(),
          orderedFiles: displayedFiles(),
        }),
      toggleFavorite,
      isFavorite,
      rename: fileActions.requestRename,
      move: fileActions.requestMove,
      copy: fileActions.requestCopy,
      toggleKnowledgeBase: (file) =>
        browser.mutations.knowledgeBaseMutation.mutate(file.path.replace(/\\/g, '/')),
      isKnowledgeBase,
      get pickNewTabTarget() {
        return host.actions.beginOpenTargetPick
      },
      get defaultFileOpen() {
        return host.actions.defaultFileOpen
      },
      get openFileInNewWindow() {
        return host.actions.openInNewWindow
      },
      getVirtualEntry: listing.virtualEntry,
      runVirtualAction: (action, file) =>
        fileActions.virtual?.handleAction(action, file, {
          rename: fileActions.requestRename,
          remove: fileActions.dialogs.remove.setTarget,
        }),
    }),
  })

  const rows = {
    onParentPointerEnter: () =>
      prefetchParentDirectoryHover(prefetchContext(), {
        currentPath: currentPath(),
        isVirtualFolder: isVirtualFolder(),
      }),
    canDropOnParent: browser.drag.canDropOnParent,
    onFilePointerEnter: (file: FileItem) => {
      prefetchFolderContentsOnHover(prefetchContext(), file)
      host.actions.fileHover?.(file)
    },
    iconContext: host.iconContext,
    virtualEntry: listing.virtualEntry,
    isKnowledgeBase,
    isFavorite,
    toggleFavorite,
    viewCount: viewStats.getViewCount,
  }

  const windowScroll = host.layout === 'media'
  const listingProps = {
    displayedFiles,
    viewMode,
    isVirtualFolder,
    sortingDisabled,
    loading: listing.loading,
    deferredLoading: listing.deferredLoading,
    error: () => (listing.query.isError ? listing.query.error?.message : undefined),
    retry: () => void listing.query.refetch(),
    empty,
    scrollTarget: windowScroll
      ? ({ kind: 'window' } as const)
      : ({ kind: 'element', getScrollElement: directoryScrollElement } as const),
    setScrollElement: windowScroll ? undefined : setDirectoryScrollElement,
    onScroll: windowScroll
      ? undefined
      : (event: UIEvent & { currentTarget: HTMLDivElement }) => {
          const element = event.currentTarget
          if (element.scrollHeight - element.scrollTop - element.clientHeight < 320) {
            listing.loadNextPage()
          }
        },
    loadMore: windowScroll ? listing.loadNextPage : undefined,
    scrollScope: windowScroll ? () => 'main-file-browser' : undefined,
  }

  return (
    <>
      <FileBrowserView
        layout={host.layout}
        controller={browser}
        listing={listingProps}
        host={{
          openParent: () => host.navigate(isVirtualFolder() ? '' : parentPath(currentPath())),
          openFile,
          setViewMode,
          navigateBreadcrumb: host.navigate,
          openBreadcrumbMenu: chrome.openBreadcrumbMenu,
          openKnowledgeBaseResult: (path, displayName) => {
            browser.search.clear()
            openPath(path, displayName)
          },
          recentDragCanMove: (path) =>
            !!browser.allowMoveFile() && isPathEditable(path, host.editableFolders()),
        }}
        toolbar={{
          onCreateFolder: fileActions.openCreateFolder,
          onCreateFile: fileActions.openCreateFile,
          virtualCreate: {
            canCreateFolder: () => fileActions.virtual?.canCreateFolder() ?? false,
            canCreateFile: () => fileActions.virtual?.canCreateFile() ?? false,
            onCreateFolder: fileActions.openCreateFolder,
            onCreateFile: fileActions.openCreateFile,
          },
          extras: host.toolbarExtras,
        }}
        fileRowMenu={fileActions.rowMenu}
        rows={rows}
      >
        {host.renderExtras?.({ files, orderedFiles: displayedFiles })}
      </FileBrowserView>
      <FileBrowserModalLayer
        overlayScope={host.layout === 'workspace' ? 'window' : 'viewport'}
        chrome={chrome.modal}
        dialogs={fileActions.dialogs}
      />
    </>
  )
}
