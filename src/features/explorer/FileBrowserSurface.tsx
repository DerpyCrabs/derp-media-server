import { type Snapshot, localComponent, view, domBinding, type JSX } from 'effectweb'
import { operationError } from './file-browser-mutations'
import { AsyncResult } from 'effect/unstable/reactivity'
import { runDesktopOperation } from '@/desktop/operations'
import BookOpenText from '@effectweb/lucide/icons/book-open-text'
import Ellipsis from '@effectweb/lucide/icons/ellipsis'
import Eye from '@effectweb/lucide/icons/eye'
import FilePlus from '@effectweb/lucide/icons/file-plus'
import FolderPlus from '@effectweb/lucide/icons/folder-plus'
import Star from '@effectweb/lucide/icons/star'
import Upload from '@effectweb/lucide/icons/upload'
import { cn } from '@/lib/ui/cn'
import type { FileItem } from '@/lib/files/types'
import {
  virtualEntrySubtitle,
  virtualFileSizeVisible,
  type VirtualEntry,
} from '@/lib/files/virtual-directory'
import { formatFileSize } from '@/lib/media/media-utils'
import { Breadcrumbs } from './Breadcrumbs'
import type { ExplorerFileRowMenuApi } from './ExplorerCommonModalLayer'
import { DirectoryBackgroundContextMenu } from './DirectoryBackgroundContextMenu'
import { ExplorerDisplayOptions } from './ExplorerDisplayOptions'
import { FileBrowserPane, type FileBrowserElementAttributes } from './FileBrowserPane'
import { FileExplorerView, type FileExplorerScrollTarget } from './FileExplorerView'
import { KbDashboard } from './KbDashboard'
import { KbInlineCreateFooter } from './KbInlineCreateFooter'
import { KbSearchResults } from './KbSearchResults'
import { longPressContextMenu } from './long-press-context-menu'
import type { FileBrowserController } from './file-browser-controller'
import { UploadMenu } from './UploadMenu'
import { fileItemIcon, GridHeroIcon, type FileIconContext } from './file-icon'
import { virtualAppearanceForPath } from './virtual-directory-appearance'
type FileBrowserViewRowMenu = ExplorerFileRowMenuApi & {
  openRowContextMenu: (event: MouseEvent, file: FileItem) => void
  openRowMenuFromButton: (event: MouseEvent, file: FileItem) => void
}
type FileBrowserViewRows = Readonly<{
  iconContext: FileIconContext
  virtualEntry: (file: FileItem) => VirtualEntry | undefined
  isKnowledgeBase: (file: FileItem) => boolean
  isFavorite: (file: FileItem) => boolean
  toggleFavorite: (file: FileItem) => void
  viewCount: (path: string) => number
  onFilePointerEnter?: (file: FileItem) => void
  onParentPointerEnter?: () => void
  canDropOnParent?: boolean
}>
type VirtualCreateToolbar = Readonly<{
  canCreateFolder: boolean
  canCreateFile: boolean
  onCreateFolder: () => void
  onCreateFile: () => void
}>
type FileBrowserSurfaceToolbar = Readonly<{
  onCreateFolder: () => void
  onCreateFile: () => void
  virtualCreate?: VirtualCreateToolbar
  extras?: () => JSX.Element
}>
type FileBrowserViewListing = Readonly<{
  displayedFiles: readonly FileItem[]
  viewMode: 'list' | 'grid'
  isVirtualFolder: boolean
  sortingDisabled?: boolean
  loading: boolean
  deferredLoading: boolean
  error: string | undefined
  retry: () => void
  empty: boolean
  scrollTarget: FileExplorerScrollTarget
  scrollScope?: string | undefined
  setScrollElement?: (element: HTMLDivElement | undefined) => void
  onScroll?: (event: UIEvent & { currentTarget: HTMLDivElement }) => void
  loadMore?: () => void
}>
type FileBrowserViewHost = Readonly<{
  openParent: () => void
  openFile: (file: FileItem, event?: MouseEvent | KeyboardEvent) => void
  activateFile?: (file: FileItem) => void
  selected?: (file: FileItem) => boolean
  selectionKeyDown?: (event: KeyboardEvent) => void
  setViewMode: (mode: 'list' | 'grid') => void
  navigateBreadcrumb: (path: string) => void
  openBreadcrumbMenu?: (
    event: MouseEvent,
    info: { navigatePath: string; displayName: string; isHome: boolean },
  ) => void
  onOpenKnowledgeBaseResult: (path: string, displayName?: string) => void
  recentDragCanMove?: (path: string) => boolean
}>
type FileBrowserViewProps = Readonly<{
  layout: 'workspace' | 'media'
  controller: FileBrowserController
  listing: FileBrowserViewListing
  host: FileBrowserViewHost
  toolbar: FileBrowserSurfaceToolbar
  fileRowMenu: FileBrowserViewRowMenu
  rows: FileBrowserViewRows
  children?: JSX.Element
}>
const listingScrollBinding = (_element: HTMLDivElement, current: () => FileBrowserViewListing) => {
  const listener = () => {
    const props = current()
    if (
      props.scrollTarget.kind === 'window' &&
      document.documentElement.scrollHeight - window.scrollY - window.innerHeight < 320
    )
      props.loadMore?.()
  }
  window.addEventListener('scroll', listener, { passive: true })
  return () => window.removeEventListener('scroll', listener)
}
const directoryElementBinding = (
  element: HTMLDivElement,
  current: () => ((element: HTMLDivElement | undefined) => void) | undefined,
) => {
  current()?.(element)
  return () => current()?.(undefined)
}
const searchInputBinding = (
  element: HTMLInputElement,
  current: () => (element: HTMLInputElement | undefined) => void,
) => {
  current()(element)
  return () => current()(undefined)
}
export const FileBrowserView = localComponent({
  init: (_props: Snapshot<FileBrowserViewProps>) => ({
    directoryBackgroundMenu: null as { x: number; y: number } | null,
  }),
  view: view((local, patch) => {
    const props = local.props
    const directoryBackgroundMenu = () => local.directoryBackgroundMenu,
      setDirectoryBackgroundMenu = (value: { x: number; y: number } | null) =>
        patch({ directoryBackgroundMenu: value })
    const isWorkspace = () => props.layout === 'workspace'
    const parentPath = (path: string) => {
      const parts = path.split(/[/\\]/).filter(Boolean)
      return parts.length <= 1 ? '' : parts.slice(0, -1).join('/')
    }
    const canMoveFile = () => !!props.controller.allowMoveFile
    const canDropOnParent = () => canMoveFile() && (props.rows.canDropOnParent ?? true)
    const canCreateVirtualFolder = () => props.toolbar.virtualCreate?.canCreateFolder ?? false
    const canCreateVirtualFile = () => props.toolbar.virtualCreate?.canCreateFile ?? false
    const favoriteButton = (file: FileItem) => (
      <button
        type='button'
        class='inline-flex shrink-0 opacity-50 transition-opacity hover:opacity-100 group-hover:opacity-100'
        title={props.rows.isFavorite(file) ? 'Remove from favorites' : 'Add to favorites'}
        onClick={(event) => {
          event.stopPropagation()
          props.rows.toggleFavorite(file)
        }}
      >
        <Star
          class={cn(
            'h-4 w-4',
            props.rows.isFavorite(file)
              ? 'fill-yellow-400 text-yellow-400 opacity-100'
              : 'text-muted-foreground',
          )}
          stroke-width={2}
        />
      </button>
    )
    const virtualSubtitle = (file: FileItem) =>
      virtualEntrySubtitle(props.rows.virtualEntry(file)) ||
      (props.listing.isVirtualFolder && !file.isDirectory ? parentPath(file.path) || '/' : '')
    const renderGridIcon = (file: FileItem) => (
      <GridHeroIcon
        file={file}
        context={props.rows.iconContext}
        appearance={
          props.rows.virtualEntry(file)?.appearance ?? virtualAppearanceForPath(file.path)
        }
      />
    )
    const renderGridOverlay = (file: FileItem) => (
      <>
        <button
          type='button'
          aria-label={`More actions for ${file.name}`}
          class='absolute right-1.5 bottom-1.5 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm sm:hidden'
          onClick={(event) => props.fileRowMenu.openRowMenuFromButton(event, file)}
        >
          <Ellipsis class='h-5 w-5' aria-hidden='true' />
        </button>
        {!file.isDirectory && props.controller.displaySettings.fileColumns.favorite ? (
          <div class='absolute top-1.5 left-1.5 z-10'>{favoriteButton(file)}</div>
        ) : null}
        {!file.isDirectory && props.controller.displaySettings.fileColumns.views ? (
          props.rows.viewCount(file.path) > 0 ? (
            <div
              class='absolute top-1.5 right-1.5 z-10 flex items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 shadow-sm backdrop-blur-sm'
              title={`${props.rows.viewCount(file.path)} views`}
            >
              <Eye class='h-3 w-3 text-muted-foreground' stroke-width={2} />
              <span class='text-xs font-medium text-muted-foreground'>
                {props.rows.viewCount(file.path)}
              </span>
            </div>
          ) : null
        ) : null}
      </>
    )
    const renderGridDetails = (file: FileItem) => (
      <div class='flex flex-col gap-1 p-3'>
        <p class='truncate text-sm font-medium' title={file.name}>
          {file.name}
        </p>
        {((subtitle) =>
          subtitle ? <p class='truncate text-xs text-muted-foreground'>{subtitle}</p> : null)(
          virtualSubtitle(file),
        )}
        <div class='flex items-center justify-end text-xs text-muted-foreground'>
          <span>
            {virtualFileSizeVisible(file, props.rows.virtualEntry(file))
              ? formatFileSize(file.size)
              : ''}
          </span>
        </div>
      </div>
    )
    const renderListIcon = (file: FileItem) => (
      <span {...(props.rows.isKnowledgeBase(file) ? { 'data-kb-root-icon': '' } : {})}>
        {fileItemIcon(
          file,
          props.rows.iconContext,
          'md',
          props.rows.virtualEntry(file)?.appearance ?? virtualAppearanceForPath(file.path),
        )}
      </span>
    )
    const renderListName = (file: FileItem) => (
      <div class='flex min-w-0 items-center gap-2'>
        {!file.isDirectory && props.controller.displaySettings.fileColumns.favorite
          ? favoriteButton(file)
          : null}
        <div class='min-w-0 flex-1'>
          <span class='block truncate'>{file.name}</span>
          {((subtitle) =>
            subtitle ? (
              <span class='block truncate text-xs text-muted-foreground'>{subtitle}</span>
            ) : null)(virtualSubtitle(file))}
        </div>
      </div>
    )
    const renderListNameTrailing = (file: FileItem) =>
      !file.isDirectory &&
      props.controller.displaySettings.fileColumns.views &&
      props.rows.viewCount(file.path) > 0 ? (
        <span
          class='flex shrink-0 items-center gap-1 text-xs text-muted-foreground'
          title={`${props.rows.viewCount(file.path)} views`}
          data-testid='file-view-count'
        >
          <Eye class='h-3.5 w-3.5 shrink-0' stroke-width={2} />
          <span>{props.rows.viewCount(file.path)}</span>
        </span>
      ) : null
    const renderListSize = (file: FileItem) => (
      <span class='inline-block w-20 shrink-0 tabular-nums'>
        {virtualFileSizeVisible(file, props.rows.virtualEntry(file))
          ? formatFileSize(file.size)
          : ''}
      </span>
    )
    const renderListActions = (file: FileItem) => (
      <td class='p-1 align-middle sm:hidden'>
        <button
          type='button'
          aria-label={`More actions for ${file.name}`}
          class='inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-muted'
          onClick={(event) => props.fileRowMenu.openRowMenuFromButton(event, file)}
        >
          <Ellipsis class='h-5 w-5' aria-hidden='true' />
        </button>
      </td>
    )
    // Controller handlers are stable functions. Surface invokes them from row event handlers.
    const onFileDragStart = props.controller.drag.onFileDragStart
    const onFileDragEnd = props.controller.drag.onFileDragEnd
    const onFolderDragOver = props.controller.drag.onFolderDragOver
    const onFolderDragLeave = props.controller.drag.onFolderDragLeave
    const onFolderDrop = props.controller.drag.onFolderDrop
    function parentAttributes<Element extends HTMLElement>(kind: 'grid' | 'list') {
      const canDragParent = kind === 'list' || isWorkspace()
      return {
        ...(isWorkspace() ? { 'data-no-window-drag': '' } : {}),
        class: cn(props.controller.drag.dragOverPath === '__parent__' ? 'bg-primary/20' : ''),
        onPointerEnter: props.rows.onParentPointerEnter,
        ...(canDragParent && canDropOnParent()
          ? {
              onDragOver: props.controller.drag.parentRowDragOver,
              onDragLeave: props.controller.drag.parentRowDragLeave,
              onDrop: props.controller.drag.parentRowDrop,
            }
          : {}),
      } as unknown as FileBrowserElementAttributes<Element>
    }
    function fileAttributes<Element extends HTMLElement>(file: FileItem, kind: 'grid' | 'list') {
      const dragGrid = kind === 'grid' && (isWorkspace() || !!window.derpDesktop)
      const highlightGrid = isWorkspace() && kind === 'grid'
      return {
        ...(isWorkspace() ? { 'data-no-window-drag': '' } : {}),
        'aria-selected': props.host.selected?.(file),
        class: cn(
          props.host.selected?.(file) ? 'bg-accent text-accent-foreground' : '',
          props.rows.iconContext.playingPath === file.path ? 'bg-primary/10' : '',
          highlightGrid && file.isDirectory && props.controller.drag.dragOverPath === file.path
            ? 'bg-primary/20'
            : '',
          props.controller.drag.draggedPath === file.path ? 'opacity-50' : '',
        ),
        draggable:
          dragGrid || kind === 'list'
            ? props.controller.drag.enableDrag
              ? 'true'
              : 'false'
            : undefined,
        tabindex: window.derpDesktop ? 0 : undefined,
        onKeyDown: (event: KeyboardEvent) => {
          props.host.selectionKeyDown?.(event)
          if (event.defaultPrevented) return
          if (props.host.activateFile && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            if (event.key === 'Enter') props.host.activateFile(file)
            else props.host.openFile(file, event)
            return
          }
          if (
            window.derpDesktop &&
            event.ctrlKey &&
            event.key.toLowerCase() === 'c' &&
            !file.isVirtual
          ) {
            event.preventDefault()
            runDesktopOperation(() => window.derpDesktop!.copy([file.path]))
          }
        },
        onPointerEnter: () => props.rows.onFilePointerEnter?.(file),
        onContextMenu: (event: MouseEvent) => {
          setDirectoryBackgroundMenu(null)
          props.fileRowMenu.openRowContextMenu(event, file)
        },
        use: longPressContextMenu(),
        onDragStart:
          dragGrid || kind === 'list'
            ? (event: globalThis.DragEvent) => onFileDragStart(file, event)
            : undefined,
        onDragEnd: dragGrid || kind === 'list' ? onFileDragEnd : undefined,
        onDragOver:
          (dragGrid || kind === 'list') && (canMoveFile() || !!window.derpDesktop)
            ? (event: globalThis.DragEvent) => {
                if (file.isDirectory) onFolderDragOver(file, event)
              }
            : undefined,
        onDragLeave:
          (dragGrid || kind === 'list') && (canMoveFile() || !!window.derpDesktop)
            ? (event: globalThis.DragEvent) => {
                if (file.isDirectory) onFolderDragLeave(file, event)
              }
            : undefined,
        onDrop:
          (dragGrid || kind === 'list') && (canMoveFile() || !!window.derpDesktop)
            ? (event: globalThis.DragEvent) => {
                if (file.isDirectory) onFolderDrop(file, event)
              }
            : undefined,
      } as unknown as FileBrowserElementAttributes<Element>
    }
    const listing = () =>
      props.controller.search.showingResults ? (
        <KbSearchResults
          results={props.controller.search.results}
          query={props.controller.search.debouncedQuery}
          isLoading={props.controller.search.loading}
          error={props.controller.search.error}
          currentPath={props.controller.currentPath}
          onResultClick={(path) =>
            props.host.onOpenKnowledgeBaseResult(
              path,
              props.controller.search.results.find((result) => result.path === path)?.name,
            )
          }
        />
      ) : (
        <>
          {props.controller.inKb && !!props.controller.currentPath ? (
            <KbDashboard
              compact={isWorkspace()}
              mode={isWorkspace() ? 'Workspace' : undefined}
              scopePath={props.controller.currentPath}
              onFileClick={props.host.onOpenKnowledgeBaseResult}
              recentDragCanMove={props.host.recentDragCanMove}
            />
          ) : null}
          {!props.listing.loading ? (
            <FileBrowserPane
              listing={{
                files: props.listing.displayedFiles,
                viewMode: props.listing.viewMode,
                columns: props.controller.displaySettings.fileColumns,
                includeParent: !!props.controller.currentPath,
                scrollTarget: props.listing.scrollTarget,
                scrollScope: props.listing.scrollScope,
                showEmpty: props.listing.empty,
                canUpload: props.controller.editable,
              }}
              layout={{
                gridContainerClass: 'p-2 max-sm:p-4',
                listContainerClass: 'max-sm:py-2',
                gridClass: 'gap-4',
                listClass: isWorkspace()
                  ? 'relative w-full'
                  : 'relative w-full overflow-x-auto overflow-y-hidden',
                listSizeColumnClass: 'w-28',
              }}
              rows={{
                onParentClick: props.host.openParent,
                onFileClick: props.host.openFile,
                onFileActivate: props.host.activateFile,
                parentGridAttributes: parentAttributes<HTMLDivElement>('grid'),
                parentRowAttributes: parentAttributes<HTMLTableRowElement>('list'),
                fileGridAttributes: (file) => fileAttributes<HTMLDivElement>(file, 'grid'),
                fileRowAttributes: (file) => fileAttributes<HTMLTableRowElement>(file, 'list'),
                renderGridIcon,
                renderGridOverlay,
                renderGridDetails,
                renderListIcon,
                renderListName,
                renderListNameTrailing,
                renderListSize,
                renderListActions,
                renderParentRowEnd: () => <td class='sm:hidden' />,
              }}
            />
          ) : null}
        </>
      )
    const scrollableListing = () =>
      props.listing.scrollTarget.kind === 'element' ? (
        <div
          use={domBinding(props.listing.setScrollElement, directoryElementBinding)}
          class='min-h-0 flex-1 overflow-auto'
          onScroll={(event) =>
            props.listing.onScroll?.(
              event as unknown as UIEvent & { currentTarget: HTMLDivElement },
            )
          }
        >
          {listing()}
        </div>
      ) : (
        listing()
      )
    const toolbarExtras = () => props.toolbar.extras?.()
    return (
      <div
        data-explorer-surface
        use={domBinding(props.listing, listingScrollBinding)}
        data-testid={props.layout === 'media' ? 'file-browser' : undefined}
        class={
          isWorkspace()
            ? 'relative flex h-full min-h-0 flex-1 flex-col overflow-hidden'
            : 'flex min-h-0 flex-1 flex-col outline-none'
        }
        tabindex={isWorkspace() ? undefined : 0}
        title={
          !isWorkspace() && props.controller.editable && props.controller.inKb
            ? 'Focus here and paste (Ctrl+V) to create a file from the clipboard.'
            : undefined
        }
        onPaste={(event) => props.controller.paste.capture(event)}
      >
        <div
          class={
            isWorkspace() ? 'flex min-h-0 flex-1 flex-col' : 'container mx-auto lg:px-4 lg:pb-4'
          }
        >
          <div
            class={
              isWorkspace()
                ? 'flex min-h-0 flex-1 flex-col'
                : 'ring-foreground/10 bg-card text-card-foreground flex flex-col gap-0 overflow-hidden rounded-none py-0 text-sm shadow-xs ring-1 lg:rounded-xl'
            }
          >
            <div
              data-no-window-drag={isWorkspace() ? '' : undefined}
              class={
                isWorkspace()
                  ? 'relative flex h-9 shrink-0 items-center bg-muted/50 px-2 py-0'
                  : 'shrink-0 border-b border-border bg-muted/30 p-1.5 lg:p-2'
              }
            >
              {isWorkspace() ? (
                <div
                  class='pointer-events-none absolute inset-x-0 bottom-0 h-px bg-border'
                  aria-hidden='true'
                />
              ) : null}
              <div
                class={
                  isWorkspace()
                    ? 'flex w-full min-w-0 flex-wrap items-center justify-between gap-1'
                    : 'flex flex-wrap items-center justify-between w-full gap-1.5 lg:gap-2'
                }
              >
                <div
                  data-breadcrumb-slot
                  data-testid={isWorkspace() ? undefined : 'breadcrumb-slot'}
                  class={
                    isWorkspace()
                      ? 'relative flex min-h-0 min-w-0 max-w-full flex-1 overflow-hidden'
                      : 'relative flex min-h-0 min-w-0 flex-1 overflow-hidden'
                  }
                >
                  <Breadcrumbs
                    currentPath={props.controller.currentPath}
                    onNavigate={props.host.navigateBreadcrumb}
                    mode={isWorkspace() ? 'Workspace' : undefined}
                    onCrumbContextMenu={props.host.openBreadcrumbMenu}
                  />
                </div>
                {props.controller.inKb ? (
                  <div
                    class={
                      isWorkspace()
                        ? 'flex shrink-0 flex-wrap items-center justify-end gap-1 md:justify-start'
                        : 'order-last flex basis-full items-center justify-end md:order-0 md:basis-auto md:justify-start'
                    }
                  >
                    <button
                      type='button'
                      aria-label='Search note contents'
                      title='Search note contents (Ctrl+K)'
                      aria-pressed={props.controller.search.open ? 'true' : 'false'}
                      class={
                        isWorkspace()
                          ? `inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md outline-none transition-colors ${
                              props.controller.search.open
                                ? 'bg-accent text-accent-foreground shadow-sm'
                                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                            }`
                          : `inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent transition-colors ${
                              props.controller.search.open
                                ? 'bg-accent text-accent-foreground shadow-sm'
                                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                            }`
                      }
                      onClick={() => props.controller.search.setOpen(!props.controller.search.open)}
                    >
                      <BookOpenText
                        class={isWorkspace() ? 'h-3.5 w-3.5' : 'h-4 w-4'}
                        aria-hidden='true'
                        stroke-width={2}
                      />
                    </button>
                  </div>
                ) : null}
                <div
                  class={
                    isWorkspace()
                      ? 'flex shrink-0 flex-wrap items-center justify-end gap-1 md:justify-start'
                      : 'flex items-center gap-1'
                  }
                >
                  {props.controller.editable ? (
                    <>
                      <button
                        type='button'
                        title='Create new folder'
                        aria-label='New folder toolbar'
                        class={
                          isWorkspace()
                            ? 'inline-flex h-7 w-7 shrink-0 items-center justify-center text-sm font-medium transition-colors hover:bg-muted hover:text-foreground dark:hover:bg-input/50'
                            : 'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-muted hover:text-foreground dark:hover:bg-input/50'
                        }
                        onClick={() => props.toolbar.onCreateFolder()}
                      >
                        <FolderPlus
                          class={isWorkspace() ? 'h-3.5 w-3.5' : 'h-4 w-4'}
                          aria-hidden='true'
                          stroke-width={2}
                        />
                      </button>
                      <button
                        type='button'
                        title='Create new file'
                        aria-label='New file toolbar'
                        class={
                          isWorkspace()
                            ? 'inline-flex h-7 w-7 shrink-0 items-center justify-center text-sm font-medium transition-colors hover:bg-muted hover:text-foreground dark:hover:bg-input/50'
                            : 'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-muted hover:text-foreground dark:hover:bg-input/50'
                        }
                        onClick={() => props.toolbar.onCreateFile()}
                      >
                        <FilePlus
                          class={isWorkspace() ? 'h-3.5 w-3.5' : 'h-4 w-4'}
                          aria-hidden='true'
                          stroke-width={2}
                        />
                      </button>
                      <UploadMenu
                        compact={isWorkspace()}
                        disabled={props.controller.upload.uploading}
                        onUpload={(files) =>
                          props.controller.upload.upload(files, props.controller.currentPath)
                        }
                      />
                      {props.toolbar.virtualCreate ? (
                        canCreateVirtualFolder() || canCreateVirtualFile() ? (
                          <div class='bg-border mx-1 h-5 w-px shrink-0' />
                        ) : null
                      ) : null}
                    </>
                  ) : null}
                  {props.toolbar.virtualCreate && !props.controller.editable ? (
                    canCreateVirtualFolder() || canCreateVirtualFile() ? (
                      <div class='bg-border mx-1 h-5 w-px shrink-0' />
                    ) : null
                  ) : null}
                  {canCreateVirtualFolder() ? (
                    <button
                      type='button'
                      title='Create new project'
                      aria-label='Create new project'
                      class='inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground'
                      onClick={() => props.toolbar.virtualCreate?.onCreateFolder()}
                    >
                      <FolderPlus class='h-3.5 w-3.5' stroke-width={2} />
                    </button>
                  ) : null}
                  {canCreateVirtualFile() ? (
                    <button
                      type='button'
                      title='Create new session'
                      aria-label='Create new session'
                      class='inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground'
                      onClick={() => props.toolbar.virtualCreate?.onCreateFile()}
                    >
                      <FilePlus class='h-3.5 w-3.5' stroke-width={2} />
                    </button>
                  ) : null}
                  {toolbarExtras()}
                  <ExplorerDisplayOptions
                    sortOrder={props.controller.displaySettings.sortOrder}
                    columns={props.controller.displaySettings.fileColumns}
                    sortingDisabled={props.listing.sortingDisabled ?? props.listing.isVirtualFolder}
                    compact={isWorkspace()}
                    viewMode={props.listing.viewMode}
                    onSortChange={props.controller.displaySettings.setSortOrder}
                    onColumnsChange={props.controller.displaySettings.setFileColumns}
                    onViewModeChange={props.host.setViewMode}
                  />
                </div>
              </div>
              {props.controller.inKb && props.controller.search.open ? (
                <div
                  class={
                    isWorkspace() ? 'shrink-0 border-b border-border bg-muted/20 p-2' : 'pt-1.5'
                  }
                  data-testid='kb-search-bar'
                >
                  <input
                    use={domBinding(props.controller.search.setInputElement, searchInputBinding)}
                    type='text'
                    placeholder='Search notes...'
                    autocomplete='off'
                    class='border-input bg-background focus-visible:ring-ring h-10 w-full rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none'
                    value={props.controller.search.query}
                    onInput={(event) => props.controller.search.setQuery(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                        event.preventDefault()
                        const buttons = event.currentTarget
                          .closest('[data-explorer-surface]')
                          ?.querySelectorAll<HTMLButtonElement>('[data-kb-search-result]')
                        const target =
                          event.key === 'ArrowDown' ? buttons?.[0] : buttons?.[buttons.length - 1]
                        target?.focus()
                      } else if (event.key === 'Enter') {
                        const first = event.currentTarget
                          .closest('[data-explorer-surface]')
                          ?.querySelector<HTMLButtonElement>('[data-kb-search-result]')
                        if (first) {
                          event.preventDefault()
                          first.click()
                        }
                      }
                    }}
                  />
                </div>
              ) : null}
            </div>

            <FileExplorerView
              files={props.controller.files}
              viewMode={props.listing.viewMode}
              includeParent={!!props.controller.currentPath}
              scrollTarget={props.listing.scrollTarget}
              scrollScope={props.listing.scrollScope}
              loading={props.listing.loading}
              deferredLoading={props.listing.deferredLoading}
              error={props.listing.error}
              onRetry={props.listing.retry}
              showEmpty={props.listing.empty}
              canUpload={props.controller.editable}
            >
              <div
                class={
                  isWorkspace()
                    ? 'relative flex min-h-0 flex-1 flex-col overflow-hidden outline-none'
                    : 'relative flex flex-col'
                }
                data-testid={isWorkspace() ? 'workspace-upload-drop-zone' : 'upload-drop-zone'}
                tabindex={isWorkspace() ? 0 : undefined}
                title={
                  isWorkspace() && props.controller.editable && props.controller.inKb
                    ? 'Focus this pane and paste (Ctrl+V) to create a file from the clipboard.'
                    : undefined
                }
                onDragEnter={(event) => props.controller.upload.enter(event)}
                onDragLeave={(event) => props.controller.upload.leave(event)}
                onDragOver={(event) => props.controller.upload.over(event)}
                onDrop={(event) => props.controller.upload.drop(event)}
                onContextMenu={(event) => {
                  if (!props.controller.inline.visible) return
                  const target = event.target
                  if (!(target instanceof Element) || target.closest('[data-file-path]')) return
                  event.preventDefault()
                  event.stopPropagation()
                  props.fileRowMenu.dismiss()
                  setDirectoryBackgroundMenu({ x: event.clientX, y: event.clientY })
                }}
              >
                {scrollableListing()}
                {props.controller.inline.visible ? (
                  <KbInlineCreateFooter
                    noWindowDrag={isWorkspace()}
                    inlineMode={props.controller.inline.mode}
                    setInlineMode={props.controller.inline.setMode}
                    inlineName={props.controller.inline.name}
                    setInlineName={props.controller.inline.setName}
                    inlineFileExists={props.controller.inline.fileExists}
                    inlineFolderExists={props.controller.inline.folderExists}
                    createFilePending={props.controller.mutations.createFileMutation.result.waiting}
                    createFileIsError={AsyncResult.isFailure(
                      props.controller.mutations.createFileMutation.result,
                    )}
                    createFileError={
                      operationError(props.controller.mutations.createFileMutation.result) as
                        | Error
                        | undefined
                    }
                    createFolderPending={
                      props.controller.mutations.createFolderMutation.result.waiting
                    }
                    createFolderIsError={AsyncResult.isFailure(
                      props.controller.mutations.createFolderMutation.result,
                    )}
                    createFolderError={
                      operationError(props.controller.mutations.createFolderMutation.result) as
                        | Error
                        | undefined
                    }
                    submitInlineFile={props.controller.inline.submitFile}
                    submitInlineFolder={props.controller.inline.submitFolder}
                    resetInlineCreate={props.controller.inline.reset}
                    onFileInputRef={() => {}}
                    onFolderInputRef={() => {}}
                  />
                ) : null}
                {props.controller.upload.dragOver ? (
                  <div class='pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10'>
                    <div class='text-primary flex flex-col items-center gap-2'>
                      <Upload class='h-10 w-10' stroke-width={2} />
                      <span class='text-lg font-medium'>Drop files to upload</span>
                    </div>
                  </div>
                ) : null}
              </div>
            </FileExplorerView>
          </div>
        </div>
        <DirectoryBackgroundContextMenu
          menu={directoryBackgroundMenu()}
          onDismiss={() => setDirectoryBackgroundMenu(null)}
          onNewFile={props.toolbar.onCreateFile}
          onNewFolder={props.toolbar.onCreateFolder}
        />
        {props.children}
      </div>
    )
  }),
})
