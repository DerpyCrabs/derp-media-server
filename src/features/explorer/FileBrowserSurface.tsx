import type { JSX } from '@solidjs/web'
import type { Accessor } from 'solid-js'
import { Show, createEffect, createSignal } from 'solid-js'
import BookOpenText from 'lucide-solid/icons/book-open-text'
import Ellipsis from 'lucide-solid/icons/ellipsis'
import Eye from 'lucide-solid/icons/eye'
import FilePlus from 'lucide-solid/icons/file-plus'
import FolderPlus from 'lucide-solid/icons/folder-plus'
import Star from 'lucide-solid/icons/star'
import Upload from 'lucide-solid/icons/upload'
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
import { createLongPressContextMenuHandlers } from './long-press-context-menu'
import type { FileBrowserController } from './use-file-browser-controller'
import { UploadMenu } from './UploadMenu'
import { useInlineModeInputFocus } from './use-inline-mode-input-focus'
import { fileItemIcon, GridHeroIcon, type FileIconContext } from './use-file-icon'
import { virtualAppearanceForPath } from './virtual-directory-appearance'

type FileBrowserViewRowMenu = ExplorerFileRowMenuApi & {
  openRowContextMenu: (event: MouseEvent, file: FileItem) => void
  openRowMenuFromButton: (event: MouseEvent, file: FileItem) => void
}

type FileBrowserViewRows = Readonly<{
  iconContext: Accessor<FileIconContext>
  virtualEntry: (file: FileItem) => VirtualEntry | undefined
  isKnowledgeBase: (file: FileItem) => boolean
  isFavorite: (file: FileItem) => boolean
  toggleFavorite: (file: FileItem) => void
  viewCount: (path: string) => number
  onFilePointerEnter?: (file: FileItem) => void
  onParentPointerEnter?: () => void
  canDropOnParent?: Accessor<boolean>
}>

type VirtualCreateToolbar = Readonly<{
  canCreateFolder: Accessor<boolean>
  canCreateFile: Accessor<boolean>
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
  displayedFiles: Accessor<FileItem[]>
  viewMode: Accessor<'list' | 'grid'>
  isVirtualFolder: Accessor<boolean>
  sortingDisabled?: Accessor<boolean>
  loading: Accessor<boolean>
  deferredLoading: Accessor<boolean>
  error: Accessor<string | undefined>
  retry: () => void
  empty: Accessor<boolean>
  scrollTarget: FileExplorerScrollTarget
  scrollScope?: Accessor<string | undefined>
  setScrollElement?: (element: HTMLDivElement | undefined) => void
  onScroll?: (event: UIEvent & { currentTarget: HTMLDivElement }) => void
  loadMore?: () => void
}>

type FileBrowserViewHost = Readonly<{
  openParent: () => void
  openFile: (file: FileItem) => void
  setViewMode: (mode: 'list' | 'grid') => void
  navigateBreadcrumb: (path: string) => void
  openBreadcrumbMenu?: (
    event: MouseEvent,
    info: { navigatePath: string; displayName: string; isHome: boolean },
  ) => void
  openKnowledgeBaseResult: (path: string, displayName?: string) => void
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

export function FileBrowserView(props: FileBrowserViewProps) {
  const compact = () => props.layout === 'workspace'
  const parentPath = (path: string) => {
    const parts = path.split(/[/\\]/).filter(Boolean)
    return parts.length <= 1 ? '' : parts.slice(0, -1).join('/')
  }
  const [rootElement, setRootElement] = createSignal<HTMLDivElement>()
  const [directoryBackgroundMenu, setDirectoryBackgroundMenu] = createSignal<{
    x: number
    y: number
  } | null>(null)
  let inlineFileInputElement: HTMLInputElement | undefined
  let inlineFolderInputElement: HTMLInputElement | undefined

  createEffect(
    () => props.listing.scrollTarget.kind === 'window' && !!props.listing.loadMore,
    (enabled) => {
      if (!enabled) return undefined
      const loadMore = props.listing.loadMore!
      const loadNearBottom = () => {
        const root = document.documentElement
        if (root.scrollHeight - window.scrollY - window.innerHeight < 320) {
          loadMore()
        }
      }
      window.addEventListener('scroll', loadNearBottom, { passive: true })
      return () => window.removeEventListener('scroll', loadNearBottom)
    },
  )

  useInlineModeInputFocus(
    () => props.controller.inline.mode(),
    () => inlineFileInputElement,
    () => inlineFolderInputElement,
  )

  const canMoveFile = () => !!props.controller.allowMoveFile()
  const canDropOnParent = () => canMoveFile() && (props.rows.canDropOnParent?.() ?? true)
  const canCreateVirtualFolder = () => props.toolbar.virtualCreate?.canCreateFolder() ?? false
  const canCreateVirtualFile = () => props.toolbar.virtualCreate?.canCreateFile() ?? false

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
    (props.listing.isVirtualFolder() && !file.isDirectory ? parentPath(file.path) || '/' : '')

  const renderGridIcon = (file: FileItem) => (
    <GridHeroIcon
      file={file}
      context={props.rows.iconContext}
      appearance={() =>
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
      <Show when={!file.isDirectory && props.controller.displaySettings.fileColumns().favorite}>
        <div class='absolute top-1.5 left-1.5 z-10'>{favoriteButton(file)}</div>
      </Show>
      <Show when={!file.isDirectory && props.controller.displaySettings.fileColumns().views}>
        <Show when={props.rows.viewCount(file.path) > 0}>
          <div
            class='absolute top-1.5 right-1.5 z-10 flex items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 shadow-sm backdrop-blur-sm'
            title={`${props.rows.viewCount(file.path)} views`}
          >
            <Eye class='h-3 w-3 text-muted-foreground' stroke-width={2} />
            <span class='text-xs font-medium text-muted-foreground'>
              {props.rows.viewCount(file.path)}
            </span>
          </div>
        </Show>
      </Show>
    </>
  )

  const renderGridDetails = (file: FileItem) => (
    <div class='flex flex-col gap-1 p-3'>
      <p class='truncate text-sm font-medium' title={file.name}>
        {file.name}
      </p>
      <Show when={virtualSubtitle(file)}>
        {(subtitle) => <p class='truncate text-xs text-muted-foreground'>{subtitle()}</p>}
      </Show>
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
        props.rows.iconContext(),
        'md',
        props.rows.virtualEntry(file)?.appearance ?? virtualAppearanceForPath(file.path),
      )}
    </span>
  )

  const renderListName = (file: FileItem) => (
    <div class='flex min-w-0 items-center gap-2'>
      <Show when={!file.isDirectory && props.controller.displaySettings.fileColumns().favorite}>
        {favoriteButton(file)}
      </Show>
      <div class='min-w-0 flex-1'>
        <span class='block truncate'>{file.name}</span>
        <Show when={virtualSubtitle(file)}>
          {(subtitle) => (
            <span class='block truncate text-xs text-muted-foreground'>{subtitle()}</span>
          )}
        </Show>
      </div>
    </div>
  )

  const renderListNameTrailing = (file: FileItem) => (
    <Show
      when={
        !file.isDirectory &&
        props.controller.displaySettings.fileColumns().views &&
        props.rows.viewCount(file.path) > 0
      }
    >
      <span
        class='flex shrink-0 items-center gap-1 text-xs text-muted-foreground'
        title={`${props.rows.viewCount(file.path)} views`}
        data-testid='file-view-count'
      >
        <Eye class='h-3.5 w-3.5 shrink-0' stroke-width={2} />
        <span>{props.rows.viewCount(file.path)}</span>
      </span>
    </Show>
  )

  const renderListSize = (file: FileItem) => (
    <span class='inline-block w-20 shrink-0 tabular-nums'>
      {virtualFileSizeVisible(file, props.rows.virtualEntry(file)) ? formatFileSize(file.size) : ''}
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
  // eslint-disable-next-line solid/reactivity
  const onFileDragStart = props.controller.drag.onFileDragStart
  // eslint-disable-next-line solid/reactivity
  const onFileDragEnd = props.controller.drag.onFileDragEnd
  // eslint-disable-next-line solid/reactivity
  const onFolderDragOver = props.controller.drag.onFolderDragOver
  // eslint-disable-next-line solid/reactivity
  const onFolderDragLeave = props.controller.drag.onFolderDragLeave
  // eslint-disable-next-line solid/reactivity
  const onFolderDrop = props.controller.drag.onFolderDrop

  function parentAttributes<Element extends HTMLElement>(kind: 'grid' | 'list') {
    const canDragParent = kind === 'list' || compact()
    return {
      ...(compact() ? { 'data-no-window-drag': '' } : {}),
      class: cn(props.controller.drag.dragOverPath() === '__parent__' ? 'bg-primary/20' : ''),
      onPointerEnter: props.rows.onParentPointerEnter,
      ...(canDragParent && canDropOnParent()
        ? {
            onDragOver: props.controller.drag.parentRowDragOver,
            onDragLeave: props.controller.drag.parentRowDragLeave,
            onDrop: props.controller.drag.parentRowDrop,
          }
        : {}),
    } as FileBrowserElementAttributes<Element>
  }

  function fileAttributes<Element extends HTMLElement>(file: FileItem, kind: 'grid' | 'list') {
    const dragGrid = kind === 'grid' && compact()
    const highlightGrid = compact() && kind === 'grid'
    return {
      ...(compact() ? { 'data-no-window-drag': '' } : {}),
      class: cn(
        props.rows.iconContext().playingPath === file.path ? 'bg-primary/10' : '',
        highlightGrid && file.isDirectory && props.controller.drag.dragOverPath() === file.path
          ? 'bg-primary/20'
          : '',
        props.controller.drag.draggedPath() === file.path ? 'opacity-50' : '',
      ),
      draggable:
        dragGrid || kind === 'list'
          ? props.controller.drag.enableDrag()
            ? 'true'
            : 'false'
          : undefined,
      onPointerEnter: () => props.rows.onFilePointerEnter?.(file),
      onContextMenu: (event: MouseEvent) => {
        setDirectoryBackgroundMenu(null)
        props.fileRowMenu.openRowContextMenu(event, file)
      },
      ...createLongPressContextMenuHandlers(),
      onDragStart:
        dragGrid || kind === 'list'
          ? (event: globalThis.DragEvent) => onFileDragStart(file, event)
          : undefined,
      onDragEnd: dragGrid || kind === 'list' ? onFileDragEnd : undefined,
      onDragOver:
        (dragGrid || kind === 'list') && canMoveFile()
          ? (event: globalThis.DragEvent) => {
              if (file.isDirectory) onFolderDragOver(file, event)
            }
          : undefined,
      onDragLeave:
        (dragGrid || kind === 'list') && canMoveFile()
          ? (event: globalThis.DragEvent) => {
              if (file.isDirectory) onFolderDragLeave(file, event)
            }
          : undefined,
      onDrop:
        (dragGrid || kind === 'list') && canMoveFile()
          ? (event: globalThis.DragEvent) => {
              if (file.isDirectory) onFolderDrop(file, event)
            }
          : undefined,
    } as FileBrowserElementAttributes<Element>
  }

  const listing = () => (
    <Show
      when={props.controller.search.showingResults()}
      fallback={
        <>
          <Show when={props.controller.inKb() && !!props.controller.currentPath()}>
            <KbDashboard
              compact={compact()}
              mode={compact() ? 'Workspace' : undefined}
              scopePath={props.controller.currentPath()}
              onFileClick={props.host.openKnowledgeBaseResult}
              recentDragCanMove={props.host.recentDragCanMove}
            />
          </Show>
          <Show when={!props.listing.loading()}>
            <FileBrowserPane
              files={props.listing.displayedFiles}
              viewMode={props.listing.viewMode}
              columns={props.controller.displaySettings.fileColumns}
              includeParent={() => !!props.controller.currentPath()}
              scrollTarget={props.listing.scrollTarget}
              scrollScope={props.listing.scrollScope}
              gridContainerClass='p-2 max-sm:p-4'
              listContainerClass='max-sm:py-2'
              gridClass='gap-4'
              listClass='relative w-full overflow-x-auto overflow-y-hidden'
              listSizeColumnClass='w-28'
              showEmpty={props.listing.empty}
              canUpload={props.controller.editable}
              onParentClick={props.host.openParent}
              onFileClick={props.host.openFile}
              parentGridAttributes={parentAttributes<HTMLDivElement>('grid')}
              parentRowAttributes={parentAttributes<HTMLTableRowElement>('list')}
              fileGridAttributes={(file) => fileAttributes<HTMLDivElement>(file, 'grid')}
              fileRowAttributes={(file) => fileAttributes<HTMLTableRowElement>(file, 'list')}
              renderGridIcon={renderGridIcon}
              renderGridOverlay={renderGridOverlay}
              renderGridDetails={renderGridDetails}
              renderListIcon={renderListIcon}
              renderListName={renderListName}
              renderListNameTrailing={renderListNameTrailing}
              renderListSize={renderListSize}
              renderListActions={renderListActions}
              renderParentRowEnd={() => <td class='sm:hidden' />}
            />
          </Show>
        </>
      }
    >
      <KbSearchResults
        results={props.controller.search.results()}
        query={props.controller.search.debouncedQuery()}
        isLoading={props.controller.search.loading()}
        currentPath={props.controller.currentPath()}
        onResultClick={(path) =>
          props.host.openKnowledgeBaseResult(
            path,
            props.controller.search.results().find((result) => result.path === path)?.name,
          )
        }
      />
    </Show>
  )

  const scrollableListing = () => (
    <Show when={props.listing.scrollTarget.kind === 'element'} fallback={listing()}>
      <div
        ref={(element) => props.listing.setScrollElement?.(element)}
        class='min-h-0 flex-1 overflow-auto'
        onScroll={(event) =>
          props.listing.onScroll?.(event as unknown as UIEvent & { currentTarget: HTMLDivElement })
        }
      >
        {listing()}
      </div>
    </Show>
  )

  const toolbarExtras = () => props.toolbar.extras?.()

  return (
    <div
      ref={setRootElement}
      data-testid={props.layout === 'media' ? 'file-browser' : undefined}
      class={
        compact()
          ? 'relative flex h-full min-h-0 flex-1 flex-col overflow-hidden'
          : 'flex min-h-0 flex-1 flex-col'
      }
      tabindex={compact() ? undefined : 0}
      title={
        !compact() && props.controller.editable() && props.controller.inKb()
          ? 'Focus here and paste (Ctrl+V) to create a file from the clipboard.'
          : undefined
      }
      onPaste={(event) => props.controller.paste.capture(event)}
    >
      <div class={compact() ? undefined : 'container mx-auto lg:p-4'}>
        <div
          class={
            compact()
              ? undefined
              : 'ring-foreground/10 bg-card text-card-foreground flex flex-col gap-0 overflow-hidden rounded-none py-0 text-sm shadow-xs ring-1 lg:rounded-xl'
          }
        >
          <div
            data-no-window-drag={compact() ? '' : undefined}
            class={
              compact()
                ? 'relative flex h-9 shrink-0 items-center bg-muted/50 px-2 py-0'
                : 'shrink-0 border-b border-border bg-muted/30 p-1.5 lg:p-2'
            }
          >
            <Show when={compact()}>
              <div
                class='pointer-events-none absolute inset-x-0 bottom-0 h-px bg-border'
                aria-hidden='true'
              />
            </Show>
            <div
              class={
                compact()
                  ? 'flex w-full min-w-0 flex-wrap items-center justify-between gap-1'
                  : 'flex flex-wrap items-center justify-between w-full gap-1.5 lg:gap-2'
              }
            >
              <div
                data-breadcrumb-slot
                data-testid={compact() ? undefined : 'breadcrumb-slot'}
                class={
                  compact()
                    ? 'relative flex min-h-0 min-w-0 max-w-full flex-1 overflow-hidden'
                    : 'relative flex min-h-0 min-w-0 flex-1 overflow-hidden'
                }
              >
                <Breadcrumbs
                  currentPath={props.controller.currentPath()}
                  onNavigate={props.host.navigateBreadcrumb}
                  mode={compact() ? 'Workspace' : undefined}
                  onCrumbContextMenu={props.host.openBreadcrumbMenu}
                />
              </div>
              <Show when={props.controller.inKb()}>
                <div
                  class={
                    compact()
                      ? 'flex shrink-0 flex-wrap items-center justify-end gap-1 md:justify-start'
                      : 'order-last flex basis-full items-center justify-end md:order-0 md:basis-auto md:justify-start'
                  }
                >
                  <button
                    type='button'
                    aria-label='Search note contents'
                    title='Search note contents (Ctrl+K)'
                    aria-pressed={props.controller.search.open() ? 'true' : 'false'}
                    class={
                      compact()
                        ? `inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md outline-none transition-colors ${
                            props.controller.search.open()
                              ? 'bg-accent text-accent-foreground shadow-sm'
                              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                          }`
                        : `inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent transition-colors ${
                            props.controller.search.open()
                              ? 'bg-accent text-accent-foreground shadow-sm'
                              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                          }`
                    }
                    onClick={() => props.controller.search.setOpen(!props.controller.search.open())}
                  >
                    <BookOpenText
                      class={compact() ? 'h-3.5 w-3.5' : 'h-4 w-4'}
                      aria-hidden='true'
                      stroke-width={2}
                    />
                  </button>
                </div>
              </Show>
              <div
                class={
                  compact()
                    ? 'flex shrink-0 flex-wrap items-center justify-end gap-1 md:justify-start'
                    : 'flex items-center gap-1'
                }
              >
                <Show when={props.controller.editable()}>
                  <button
                    type='button'
                    title='Create new folder'
                    aria-label='New folder toolbar'
                    class={
                      compact()
                        ? 'inline-flex h-7 w-7 shrink-0 items-center justify-center text-sm font-medium transition-colors hover:bg-muted hover:text-foreground dark:hover:bg-input/50'
                        : 'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-muted hover:text-foreground dark:hover:bg-input/50'
                    }
                    onClick={() => props.toolbar.onCreateFolder()}
                  >
                    <FolderPlus
                      class={compact() ? 'h-3.5 w-3.5' : 'h-4 w-4'}
                      aria-hidden='true'
                      stroke-width={2}
                    />
                  </button>
                  <button
                    type='button'
                    title='Create new file'
                    aria-label='New file toolbar'
                    class={
                      compact()
                        ? 'inline-flex h-7 w-7 shrink-0 items-center justify-center text-sm font-medium transition-colors hover:bg-muted hover:text-foreground dark:hover:bg-input/50'
                        : 'inline-flex size-8 shrink-0 items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-muted hover:text-foreground dark:hover:bg-input/50'
                    }
                    onClick={() => props.toolbar.onCreateFile()}
                  >
                    <FilePlus
                      class={compact() ? 'h-3.5 w-3.5' : 'h-4 w-4'}
                      aria-hidden='true'
                      stroke-width={2}
                    />
                  </button>
                  <UploadMenu
                    compact={compact()}
                    disabled={props.controller.upload.uploading()}
                    onUpload={(files) =>
                      void props.controller.upload.upload(files, props.controller.currentPath())
                    }
                  />
                  <Show when={!!props.toolbar.virtualCreate}>
                    <Show when={canCreateVirtualFolder() || canCreateVirtualFile()}>
                      <div class='bg-border mx-1 h-5 w-px shrink-0' />
                    </Show>
                  </Show>
                </Show>
                <Show when={props.toolbar.virtualCreate && !props.controller.editable()}>
                  <Show when={canCreateVirtualFolder() || canCreateVirtualFile()}>
                    <div class='bg-border mx-1 h-5 w-px shrink-0' />
                  </Show>
                </Show>
                <Show when={canCreateVirtualFolder()}>
                  <button
                    type='button'
                    title='Create new project'
                    aria-label='Create new project'
                    class='inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground'
                    onClick={() => props.toolbar.virtualCreate?.onCreateFolder()}
                  >
                    <FolderPlus class='h-3.5 w-3.5' stroke-width={2} />
                  </button>
                </Show>
                <Show when={canCreateVirtualFile()}>
                  <button
                    type='button'
                    title='Create new session'
                    aria-label='Create new session'
                    class='inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground'
                    onClick={() => props.toolbar.virtualCreate?.onCreateFile()}
                  >
                    <FilePlus class='h-3.5 w-3.5' stroke-width={2} />
                  </button>
                </Show>
                {toolbarExtras()}
                <ExplorerDisplayOptions
                  sortOrder={props.controller.displaySettings.sortOrder()}
                  columns={props.controller.displaySettings.fileColumns()}
                  sortingDisabled={
                    props.listing.sortingDisabled?.() ?? props.listing.isVirtualFolder()
                  }
                  compact={compact()}
                  viewMode={props.listing.viewMode()}
                  onSortChange={props.controller.displaySettings.setSortOrder}
                  onColumnsChange={props.controller.displaySettings.setFileColumns}
                  onViewModeChange={props.host.setViewMode}
                />
              </div>
            </div>
            <Show when={props.controller.inKb() && props.controller.search.open()}>
              <div
                class={compact() ? 'shrink-0 border-b border-border bg-muted/20 p-2' : 'pt-1.5'}
                data-testid='kb-search-bar'
              >
                <input
                  ref={props.controller.search.setInputElement}
                  type='text'
                  placeholder='Search notes...'
                  autocomplete='off'
                  class='border-input bg-background focus-visible:ring-ring h-10 w-full rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none'
                  value={props.controller.search.query()}
                  onInput={(event) => props.controller.search.setQuery(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                      event.preventDefault()
                      const buttons =
                        rootElement()?.querySelectorAll<HTMLButtonElement>(
                          '[data-kb-search-result]',
                        )
                      const target =
                        event.key === 'ArrowDown' ? buttons?.[0] : buttons?.[buttons.length - 1]
                      target?.focus()
                    } else if (event.key === 'Enter') {
                      const first =
                        rootElement()?.querySelector<HTMLButtonElement>('[data-kb-search-result]')
                      if (first) {
                        event.preventDefault()
                        first.click()
                      }
                    }
                  }}
                />
              </div>
            </Show>
          </div>

          <FileExplorerView
            files={props.controller.files}
            viewMode={props.listing.viewMode}
            includeParent={() => !!props.controller.currentPath()}
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
                compact()
                  ? 'relative flex min-h-0 flex-1 flex-col overflow-hidden outline-none'
                  : 'relative flex flex-col'
              }
              data-testid={compact() ? 'workspace-upload-drop-zone' : 'upload-drop-zone'}
              tabindex={compact() ? 0 : undefined}
              title={
                compact() && props.controller.editable() && props.controller.inKb()
                  ? 'Focus this pane and paste (Ctrl+V) to create a file from the clipboard.'
                  : undefined
              }
              onDragEnter={(event) => props.controller.upload.enter(event)}
              onDragLeave={(event) => props.controller.upload.leave(event)}
              onDragOver={(event) => props.controller.upload.over(event)}
              onDrop={(event) => void props.controller.upload.drop(event)}
              onContextMenu={(event) => {
                if (!props.controller.inline.visible()) return
                const target = event.target
                if (!(target instanceof Element) || target.closest('[data-file-path]')) return
                event.preventDefault()
                event.stopPropagation()
                props.fileRowMenu.dismiss()
                setDirectoryBackgroundMenu({ x: event.clientX, y: event.clientY })
              }}
            >
              {scrollableListing()}
              <Show when={props.controller.inline.visible()}>
                <KbInlineCreateFooter
                  noWindowDrag={compact()}
                  inlineMode={props.controller.inline.mode}
                  setInlineMode={props.controller.inline.setMode}
                  inlineName={props.controller.inline.name}
                  setInlineName={props.controller.inline.setName}
                  inlineFileExists={props.controller.inline.fileExists}
                  inlineFolderExists={props.controller.inline.folderExists}
                  createFilePending={() => props.controller.mutations.createFileMutation.isPending}
                  createFileIsError={() => props.controller.mutations.createFileMutation.isError}
                  createFileError={() =>
                    props.controller.mutations.createFileMutation.error as Error | undefined
                  }
                  createFolderPending={() =>
                    props.controller.mutations.createFolderMutation.isPending
                  }
                  createFolderIsError={() =>
                    props.controller.mutations.createFolderMutation.isError
                  }
                  createFolderError={() =>
                    props.controller.mutations.createFolderMutation.error as Error | undefined
                  }
                  submitInlineFile={props.controller.inline.submitFile}
                  submitInlineFolder={props.controller.inline.submitFolder}
                  resetInlineCreate={props.controller.inline.reset}
                  onFileInputRef={(element) => {
                    inlineFileInputElement = element
                  }}
                  onFolderInputRef={(element) => {
                    inlineFolderInputElement = element
                  }}
                />
              </Show>
              <Show when={props.controller.upload.dragOver()}>
                <div class='pointer-events-none absolute inset-0 z-50 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/10'>
                  <div class='text-primary flex flex-col items-center gap-2'>
                    <Upload class='h-10 w-10' stroke-width={2} />
                    <span class='text-lg font-medium'>Drop files to upload</span>
                  </div>
                </div>
              </Show>
            </div>
          </FileExplorerView>
        </div>
      </div>
      <DirectoryBackgroundContextMenu
        menu={directoryBackgroundMenu}
        onDismiss={() => setDirectoryBackgroundMenu(null)}
        onNewFile={props.toolbar.onCreateFile}
        onNewFolder={props.toolbar.onCreateFolder}
      />
      {props.children}
    </div>
  )
}
