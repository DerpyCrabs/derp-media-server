import { available, modelOwner, view, controllerView, type JSX } from 'effectweb'
import { Effect } from 'effect'
import { breadcrumbFloating } from './breadcrumb-floating-store'
import { createVirtualDirectoryFeature } from './virtual-directory-feature'
import { VIRTUAL_FOLDERS } from '@/lib/files/constants'
import { fileDownloadHref } from '@/lib/files/download-urls'
import { isPathEditable, type ClientMediaRoot } from '@/lib/files/path-utils'
import { MediaType, type FileItem } from '@/lib/files/types'
import type { VirtualOpenTarget } from '@/lib/files/virtual-directory'
import { getMediaExtensionFromPath, getMediaTypeFromPath } from '@/lib/media/media-utils'
import {
  prefetchFolderContentsOnHover,
  prefetchParentDirectoryHover,
  type PrefetchFolderHoverContext,
} from './prefetch-folder-hover'
import { createFileSortMetadata, sortFilesForPath } from './file-display-settings'
import { browserViewModes } from './browser-view-mode-store'
import { FileBrowserModalLayer } from './FileBrowserModalLayer'
import { FileBrowserView } from './FileBrowserSurface'
import { createFileBrowserActions } from './file-browser-actions'
import { createFileBrowserChrome } from './file-browser-chrome'
import { createFileBrowserController } from './file-browser-controller'
import { createFileBrowserListing, fileListingSnapshot } from './file-browser-listing'
import { createViewStats } from './view-stats'
import type { FileIconContext } from './file-icon'
import { createExplorerRowMenu } from './explorer-row-menu'
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
  defaultFileOpen?: 'new-tab' | 'new-window'
  copyToClipboard?: (file: FileItem) => void
}>
export type FileBrowserListingContext = Readonly<{
  files: readonly FileItem[]
  orderedFiles: readonly FileItem[]
}>
export type FileBrowserPresentation = Readonly<{
  file: FileItem
  sourceDir: string
  orderedFiles: readonly FileItem[]
}> &
  ({ kind: 'default' } | { kind: 'reader' } | { kind: 'virtual'; target: VirtualOpenTarget })
export type FileBrowserHost = Readonly<{
  layout: 'media' | 'workspace'
  currentPath: string
  editableFolders: readonly string[]
  mediaRoots?: readonly ClientMediaRoot[]
  active?: boolean
  iconContext: FileIconContext
  navigate: (path: string) => void
  present: (request: FileBrowserPresentation) => void
  actions: FileBrowserHostActions
  toolbarExtras?: () => JSX.Element
  selection?: {
    includes: (file: FileItem) => boolean
    click: (
      file: FileItem,
      event: MouseEvent | KeyboardEvent | undefined,
      ordered: readonly FileItem[],
    ) => void
    activate: (file: FileItem) => void
    keyDown: (event: KeyboardEvent, ordered: readonly FileItem[]) => void
    visible: (file: FileItem) => boolean
  }
  onListingChange?: (listing: FileBrowserListingContext) => void
  children?: JSX.Element
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
const hoverSlots = (key: string | number) => ['folder-hover', key] as const
export const FileBrowser = controllerView(
  {
    identity: (props: { host: FileBrowserHost }) => props.host.currentPath,
    controller: (props: { host: FileBrowserHost }) => {
      let currentHost = props.host
      let scrollElement: HTMLDivElement | undefined
      const path = currentHost.currentPath
      const listing = createFileBrowserListing(path)
      const currentListing = () => fileListingSnapshot(listing.read())
      const editable = () =>
        !(Object.values(VIRTUAL_FOLDERS) as string[]).includes(path) &&
        !currentListing().virtualDirectory &&
        isPathEditable(path, currentHost.editableFolders, currentHost.mediaRoots)
      const stats = createViewStats()
      const presentCreated = (filePath: string, displayName?: string) => {
        const file = fileItemFromPath(filePath, displayName)
        const settings = browser.current().settings
        const ordered = sortFilesForPath(
          currentListing().files,
          path,
          settings?.sortOrders,
          false,
          createFileSortMetadata(settings?.favorites, available(stats.read().result)?.views ?? {}),
        )
        void stats.incrementView(file.path)
        currentHost.present({ kind: 'default', file, sourceDir: path, orderedFiles: ordered })
      }
      const browser = createFileBrowserController({
        currentPath: () => path,
        layout: currentHost.layout,
        files: () => currentListing().files,
        editable,
        editableFolders: () => currentHost.editableFolders,
        isActive: () => currentHost.active ?? true,
        virtualEntry: (file) => currentListing().virtualEntry(file),
        onFileCreated: presentCreated,
        onFileSaved: presentCreated,
        onInlineFileCreated: presentCreated,
        onInlineFolderCreated: (path) => currentHost.navigate(path),
      })
      const actions = createFileBrowserActions()
      const chrome = createFileBrowserChrome()
      const virtual = createVirtualDirectoryFeature({
        currentPath: () => path,
        files: () => currentListing().files,
        directory: () => currentListing().virtualDirectory,
        entry: (file) => currentListing().virtualEntry(file),
        setError: browser.setError,
        openTarget: (file, target) =>
          currentHost.present({
            kind: 'virtual',
            file,
            target,
            sourceDir: path,
            orderedFiles: currentListing().files,
          }),
      })
      let presentationInputs: readonly unknown[] = []
      let previousPresentation:
        | (FileBrowserListingContext & { metadata: ReturnType<typeof createFileSortMetadata> })
        | undefined
      const presentation = () => {
        const settings = browser.current().settings
        const views = available(stats.read().result)?.views
        const inputs = [
          available(listing.read().result)?.pages,
          settings?.sortOrders?.[path],
          settings?.favorites,
          views,
          currentHost.selection?.visible,
        ]
        if (
          previousPresentation &&
          inputs.every((value, index) => value === presentationInputs[index])
        )
          return previousPresentation
        const data = currentListing()
        const metadata = createFileSortMetadata(settings?.favorites, views)
        const sortingDisabled =
          (Object.values(VIRTUAL_FOLDERS) as string[]).includes(path) || !!data.virtualDirectory
        const files = data.files
        const orderedFiles = sortFilesForPath(
          files.filter((file) => currentHost.selection?.visible(file) ?? true),
          path,
          settings?.sortOrders,
          sortingDisabled,
          metadata,
        )
        presentationInputs = inputs
        return (previousPresentation = { files, orderedFiles, metadata })
      }
      const owner = modelOwner({
        host: props.host,
        listing: listing.read(),
        presentation: presentation(),
        browser: browser.read(),
        actions: actions.read(),
        chrome: chrome.read(),
        virtual: virtual.read(),
        stats: stats.read(),
        viewModes: browserViewModes.source.model(),
        breadcrumbs: breadcrumbFloating.read(),
        projectBrowser: browser.snapshot,
        projectActions: actions.snapshot,
        projectChrome: chrome.snapshot,
        projectVirtual: virtual.snapshot,
        incrementView: stats.incrementView,
        loadNextPage: listing.loadNextPage,
        refresh: listing.refresh,
        getScrollElement: () => scrollElement,
        setScrollElement: (element: HTMLDivElement | undefined) => {
          scrollElement = element
        },
        prefetch: (path: string, effect: Effect.Effect<unknown, Error>) =>
          owner.run(hoverSlots(path), effect.pipe(Effect.catch(() => Effect.void)), 'drop'),
      })
      for (const child of [listing, browser, actions, chrome, virtual, stats]) owner.own(child)
      const publishPresentation = (changes: Partial<ReturnType<typeof owner.read>> = {}) => {
        const next = presentation()
        owner.patch({ ...changes, presentation: next })
        currentHost.onListingChange?.(next)
      }
      owner.own(listing.source.subscribe((listing) => publishPresentation({ listing })))
      owner.own(browser.source.subscribe((browser) => publishPresentation({ browser })))
      owner.own(actions.source.subscribe((actions) => owner.patch({ actions })))
      owner.own(chrome.source.subscribe((chrome) => owner.patch({ chrome })))
      owner.own(virtual.source.subscribe((virtual) => owner.patch({ virtual })))
      owner.own(stats.source.subscribe((stats) => publishPresentation({ stats })))
      owner.own(browserViewModes.source.subscribe((viewModes) => owner.patch({ viewModes })))
      owner.own(breadcrumbFloating.source.subscribe((breadcrumbs) => owner.patch({ breadcrumbs })))
      currentHost.onListingChange?.(owner.read().presentation)
      return {
        source: owner.source,
        receive: (next: { host: FileBrowserHost }) => {
          currentHost = next.host
          publishPresentation({ host: next.host })
        },
        lifetime: owner,
      }
    },
  },
  view((model) => {
    const host = model.host
    const currentPath = () => host.currentPath
    const data = fileListingSnapshot(model.listing)
    const listing = {
      files: () => data.files,
      virtualDirectory: () => data.virtualDirectory,
      virtualEntry: data.virtualEntry,
      loading: () => data.loading,
      deferredLoading: () => data.deferredLoading,
      error: () => data.error,
      loadNextPage: model.loadNextPage,
    }
    const files = model.presentation.files
    const isVirtualFolder = () =>
      (Object.values(VIRTUAL_FOLDERS) as string[]).includes(currentPath())
    const editable = () =>
      !isVirtualFolder() &&
      !listing.virtualDirectory() &&
      isPathEditable(currentPath(), host.editableFolders, host.mediaRoots)
    function openFile(file: FileItem, sourceDir = currentPath()) {
      if (file.isDirectory) {
        host.navigate(file.path)
        return
      }
      if (fileActions.virtual?.open(file)) return
      if (![MediaType.AUDIO, MediaType.VIDEO, MediaType.IMAGE].includes(file.type))
        void model.incrementView(file.path)
      host.present({ kind: 'default', file, sourceDir, orderedFiles: displayedFiles })
    }
    function openPath(path: string, displayName?: string) {
      openFile(fileItemFromPath(path, displayName))
    }
    const browser = model.projectBrowser(model.browser, {
      currentPath: currentPath(),
      files: [...files],
      editable: editable(),
      editableFolders: host.editableFolders,
      active: host.active ?? true,
    })
    const fileActions = model.projectActions(
      model.actions,
      {
        controller: browser,
        currentPath: currentPath(),
        files: files,
        inKnowledgeBase: browser.inKb,
        editableFolders: host.editableFolders,
        copyEnabled: true,
      },
      model.projectVirtual(model.virtual, listing.virtualDirectory(), files, listing.virtualEntry),
    )
    const viewStats = {
      incrementView: model.incrementView,
      getViewCount: (path: string) => available(model.stats.result)?.views[path] ?? 0,
    }
    const sortMetadata = model.presentation.metadata
    const isFavorite = (file: FileItem) => sortMetadata.isFavorite(file)
    const toggleFavorite = (file: FileItem) => browser.mutations.favorite.run(file.path)
    const viewMode = () =>
      model.viewModes.byKey[`file-browser-viewmode-${currentPath()}`] ??
      browser.settings?.viewModes?.[currentPath()] ??
      'list'
    const sortingDisabled = () => isVirtualFolder() || !!listing.virtualDirectory()
    const displayedFiles = model.presentation.orderedFiles
    const empty = () =>
      !listing.error() && !listing.loading() && files.length === 0 && !browser.search.showingResults
    const isKnowledgeBase = (file: FileItem) =>
      file.isDirectory && browser.knowledgeBases.includes(file.path.replace(/\\/g, '/'))
    function setViewMode(mode: 'list' | 'grid') {
      browserViewModes.setViewMode(`file-browser-viewmode-${currentPath()}`, mode)
      void browser.mutations.viewModeMutation.run({ path: currentPath(), viewMode: mode })
    }
    function download(file: FileItem) {
      if (fileActions.virtual?.download(file)) return
      downloadLocalFile(file)
    }
    function prefetchContext(): PrefetchFolderHoverContext {
      return { run: model.prefetch, knowledgeBases: browser.knowledgeBases }
    }
    const chrome = model.projectChrome(model.chrome, model.breadcrumbs.folderMenu, {
      controller: browser,
      otherSurfaceLabel: host.actions.otherSurfaceLabel,
      openBreadcrumbInNewTab: host.actions.openNewTab
        ? (file) => host.actions.openNewTab?.(file, currentPath())
        : undefined,
      openBreadcrumbInOtherSurface: host.actions.openOtherSurface,
      createRowMenu: (setIcon) =>
        createExplorerRowMenu({
          api: fileActions.rowMenu,
          permissions: {
            editableFolders: host.editableFolders,
            currentDirectoryEditable: editable(),
            hasEditableFolders: host.editableFolders.length > 0,
          },
          edit: {
            download,
            setIcon,
            get addToTaskbar() {
              return host.actions.addToTaskbar
            },
            rename: fileActions.requestRename,
            move: fileActions.requestMove,
            copy: fileActions.requestCopy,
            copyToClipboard: host.actions.copyToClipboard,
          },
          open: {
            get newTab() {
              return host.actions.openNewTab
                ? (file: FileItem) => host.actions.openNewTab?.(file, currentPath())
                : undefined
            },
            get newTabLabel() {
              return host.actions.newTabLabel
            },
            get showNewTabForFiles() {
              return !!host.actions.openNewTab
            },
            get splitView() {
              return host.actions.openInSplitView
            },
            otherSurface: host.actions.openOtherSurface,
            otherSurfaceLabel: host.actions.otherSurfaceLabel,
            withBrowser: openFile,
            withReader: (file) =>
              host.present({
                kind: 'reader',
                file,
                sourceDir: currentPath(),
                orderedFiles: displayedFiles,
              }),
            get pickNewTabTarget() {
              return host.actions.beginOpenTargetPick
            },
            get defaultFileOpen() {
              return host.actions.defaultFileOpen
            },
            get fileInNewWindow() {
              return host.actions.openInNewWindow
            },
          },
          metadata: {
            toggleFavorite,
            isFavorite,
            toggleKnowledgeBase: (file) =>
              browser.mutations.knowledgeBaseMutation.run(file.path.replace(/\\/g, '/')),
            isKnowledgeBase,
          },
          virtual: {
            entry: listing.virtualEntry,
            run: (action, file) =>
              fileActions.virtual?.handleAction(action, file, {
                rename: fileActions.requestRename,
                remove: fileActions.dialogs.remove.setTarget,
              }),
          },
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
      displayedFiles: displayedFiles,
      viewMode: viewMode(),
      isVirtualFolder: isVirtualFolder(),
      sortingDisabled: sortingDisabled(),
      loading: listing.loading(),
      deferredLoading: listing.deferredLoading(),
      error: listing.error(),
      retry: model.refresh,
      empty: empty(),
      scrollTarget: windowScroll
        ? ({ kind: 'window' } as const)
        : ({ kind: 'element', getScrollElement: model.getScrollElement } as const),
      setScrollElement: windowScroll ? undefined : model.setScrollElement,
      onScroll: windowScroll
        ? undefined
        : (event: UIEvent & { currentTarget: HTMLDivElement }) => {
            const element = event.currentTarget
            if (element.scrollHeight - element.scrollTop - element.clientHeight < 320) {
              listing.loadNextPage()
            }
          },
      loadMore: windowScroll ? listing.loadNextPage : undefined,
      scrollScope: windowScroll ? 'main-file-browser' : undefined,
    }
    return (
      <>
        <FileBrowserView
          layout={host.layout}
          controller={browser}
          listing={listingProps}
          host={{
            openParent: () => host.navigate(isVirtualFolder() ? '' : parentPath(currentPath())),
            openFile: (file, event) =>
              host.selection ? host.selection.click(file, event, displayedFiles) : openFile(file),
            activateFile: host.selection?.activate,
            selected: host.selection?.includes,
            selectionKeyDown: host.selection
              ? (event) => host.selection?.keyDown(event, displayedFiles)
              : undefined,
            setViewMode,
            navigateBreadcrumb: host.navigate,
            openBreadcrumbMenu: chrome.openBreadcrumbMenu,
            onOpenKnowledgeBaseResult: (path, displayName) => {
              browser.search.onClear()
              openPath(path, displayName)
            },
            recentDragCanMove: (path) =>
              !!browser.allowMoveFile && isPathEditable(path, host.editableFolders),
          }}
          toolbar={{
            onCreateFolder: fileActions.openCreateFolder,
            onCreateFile: fileActions.openCreateFile,
            virtualCreate: {
              canCreateFolder: fileActions.virtual?.canCreateFolder ?? false,
              canCreateFile: fileActions.virtual?.canCreateFile ?? false,
              onCreateFolder: fileActions.openCreateFolder,
              onCreateFile: fileActions.openCreateFile,
            },
            extras: host.toolbarExtras,
          }}
          fileRowMenu={fileActions.rowMenu}
          rows={rows}
        >
          {host.children}
        </FileBrowserView>
        <FileBrowserModalLayer
          overlayScope={host.layout === 'workspace' ? 'window' : 'viewport'}
          chrome={chrome.modal}
          dialogs={fileActions.dialogs}
        />
      </>
    )
  }),
)
