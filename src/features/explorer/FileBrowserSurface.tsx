import type { JSX } from '@solidjs/web'
import type { Accessor } from 'solid-js'
import { Show, createEffect, createSignal } from 'solid-js'
import BookOpenText from 'lucide-solid/icons/book-open-text'
import FilePlus from 'lucide-solid/icons/file-plus'
import FolderPlus from 'lucide-solid/icons/folder-plus'
import Upload from 'lucide-solid/icons/upload'
import { cn } from '@/lib/ui/cn'
import type { FileItem } from '@/lib/files/types'
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

export type FileBrowserSurfaceRowMenu = ExplorerFileRowMenuApi & {
  openRowContextMenu: (event: MouseEvent, file: FileItem) => void
  openRowMenuFromButton: (event: MouseEvent, file: FileItem) => void
}

export type FileBrowserSurfaceRows = Readonly<{
  renderGridIcon: (file: FileItem) => JSX.Element
  renderListIcon: (file: FileItem) => JSX.Element
  renderGridOverlay?: (file: FileItem) => JSX.Element
  renderGridDetails?: (file: FileItem) => JSX.Element
  renderListName?: (file: FileItem) => JSX.Element
  renderListNameTrailing?: (file: FileItem) => JSX.Element
  renderListSize?: (file: FileItem) => JSX.Element
  renderListActions?: (file: FileItem) => JSX.Element
  renderParentRowEnd?: () => JSX.Element
  parentGridSubtitle?: JSX.Element
  fileGridClass?: (file: FileItem) => string | undefined
  fileRowClass?: (file: FileItem) => string | undefined
  onFilePointerEnter?: (file: FileItem) => void
  onParentPointerEnter?: () => void
  canDropOnParent?: Accessor<boolean>
  dragGrid?: boolean
  highlightGridDrop?: boolean
}>

type VirtualCreateToolbar = Readonly<{
  canCreateFolder: Accessor<boolean>
  canCreateFile: Accessor<boolean>
  onCreateFolder: () => void
  onCreateFile: () => void
}>

type FileBrowserSurfaceToolbar = Readonly<{
  canCreate: Accessor<boolean>
  onCreateFolder: () => void
  onCreateFile: () => void
  virtualCreate?: VirtualCreateToolbar
  extras?: () => JSX.Element
}>

export type FileBrowserSurfaceProps = Readonly<{
  layout: 'workspace' | 'media'
  controller: FileBrowserController
  currentPath: Accessor<string>
  files: Accessor<FileItem[]>
  displayedFiles: Accessor<FileItem[]>
  viewMode: Accessor<'list' | 'grid'>
  isVirtualFolder: Accessor<boolean>
  sortingDisabled?: Accessor<boolean>
  isFilesLoadingInitial: Accessor<boolean>
  showFilesDeferredLoading: Accessor<boolean>
  error: Accessor<string | undefined>
  onRetry: () => void
  showEmpty: Accessor<boolean>
  scrollTarget: FileExplorerScrollTarget
  scrollScope?: Accessor<string | undefined>
  setScrollElement?: (element: HTMLDivElement | undefined) => void
  onScroll?: (event: UIEvent & { currentTarget: HTMLDivElement }) => void
  onParentClick: () => void
  onFileClick: (file: FileItem) => void
  onViewModeChange: (mode: 'list' | 'grid') => void
  onBreadcrumbNavigate: (path: string) => void
  onBreadcrumbContextMenu?: (
    event: MouseEvent,
    info: { navigatePath: string; displayName: string; isHome: boolean },
  ) => void
  onKbResultClick: (path: string, displayName?: string) => void
  recentDragCanMove?: (path: string) => boolean
  canUpload: Accessor<boolean>
  toolbar: FileBrowserSurfaceToolbar
  fileRowMenu: FileBrowserSurfaceRowMenu
  rows: FileBrowserSurfaceRows
  noWindowDrag?: boolean
  children?: JSX.Element
}>

export function FileBrowserSurface(props: FileBrowserSurfaceProps) {
  const compact = () => props.layout === 'workspace'
  const [rootElement, setRootElement] = createSignal<HTMLDivElement>()
  const [directoryBackgroundMenu, setDirectoryBackgroundMenu] = createSignal<{
    x: number
    y: number
  } | null>(null)
  let inlineFileInputElement: HTMLInputElement | undefined
  let inlineFolderInputElement: HTMLInputElement | undefined

  useInlineModeInputFocus(
    () => props.controller.inlineMode(),
    () => inlineFileInputElement,
    () => inlineFolderInputElement,
  )

  createEffect(
    () => props.fileRowMenu.menu(),
    (menu) => {
      if (menu) setDirectoryBackgroundMenu(null)
    },
  )

  const canMoveFile = () => !!props.controller.allowMoveFile()
  const canDropOnParent = () => canMoveFile() && (props.rows.canDropOnParent?.() ?? true)
  const canCreateVirtualFolder = () => props.toolbar.virtualCreate?.canCreateFolder() ?? false
  const canCreateVirtualFile = () => props.toolbar.virtualCreate?.canCreateFile() ?? false
  // Controller handlers are stable functions. Surface invokes them from row event handlers.
  // eslint-disable-next-line solid/reactivity
  const onFileDragStart = props.controller.onFileDragStart
  // eslint-disable-next-line solid/reactivity
  const onFileDragEnd = props.controller.onFileDragEnd
  // eslint-disable-next-line solid/reactivity
  const onFolderDragOver = props.controller.onFolderDragOver
  // eslint-disable-next-line solid/reactivity
  const onFolderDragLeave = props.controller.onFolderDragLeave
  // eslint-disable-next-line solid/reactivity
  const onFolderDrop = props.controller.onFolderDrop

  function parentAttributes<Element extends HTMLElement>(kind: 'grid' | 'list') {
    const canDragParent = kind === 'list' || props.rows.dragGrid === true
    return {
      ...(props.noWindowDrag ? { 'data-no-window-drag': '' } : {}),
      class: cn(props.controller.dragOverPath() === '__parent__' ? 'bg-primary/20' : ''),
      onPointerEnter: props.rows.onParentPointerEnter,
      ...(canDragParent && canDropOnParent()
        ? {
            onDragOver: props.controller.parentRowDragOver,
            onDragLeave: props.controller.parentRowDragLeave,
            onDrop: props.controller.parentRowDrop,
          }
        : {}),
    } as FileBrowserElementAttributes<Element>
  }

  function fileAttributes<Element extends HTMLElement>(file: FileItem, kind: 'grid' | 'list') {
    const dragGrid = kind === 'grid' && props.rows.dragGrid === true
    const highlightGrid = props.rows.highlightGridDrop === true && kind === 'grid'
    return {
      ...(props.noWindowDrag ? { 'data-no-window-drag': '' } : {}),
      class: cn(
        kind === 'grid' ? props.rows.fileGridClass?.(file) : props.rows.fileRowClass?.(file),
        highlightGrid && file.isDirectory && props.controller.dragOverPath() === file.path
          ? 'bg-primary/20'
          : '',
        props.controller.draggedPath() === file.path ? 'opacity-50' : '',
      ),
      draggable:
        dragGrid || kind === 'list'
          ? props.controller.enableDrag()
            ? 'true'
            : 'false'
          : undefined,
      onPointerEnter: () => props.rows.onFilePointerEnter?.(file),
      onContextMenu: (event: MouseEvent) => props.fileRowMenu.openRowContextMenu(event, file),
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
      when={props.controller.showKbSearchResults()}
      fallback={
        <>
          <Show when={props.controller.inKb() && !!props.currentPath()}>
            <KbDashboard
              compact={compact()}
              mode={compact() ? 'Workspace' : undefined}
              scopePath={props.currentPath()}
              onFileClick={props.onKbResultClick}
              recentDragCanMove={props.recentDragCanMove}
            />
          </Show>
          <Show when={!props.isFilesLoadingInitial()}>
            <FileBrowserPane
              files={props.displayedFiles}
              viewMode={props.viewMode}
              columns={props.controller.displaySettings.fileColumns}
              includeParent={() => !!props.currentPath()}
              scrollTarget={props.scrollTarget}
              scrollScope={props.scrollScope}
              gridContainerClass={compact() ? 'px-2 py-2' : 'py-4 px-4'}
              listContainerClass={compact() ? undefined : 'sm:px-4 py-2'}
              gridClass='gap-4'
              listClass={
                compact() ? 'relative w-full' : 'relative w-full overflow-x-auto overflow-y-hidden'
              }
              listSizeColumnClass={compact() ? undefined : 'w-28'}
              showEmpty={props.showEmpty}
              canUpload={props.canUpload}
              onParentClick={props.onParentClick}
              onFileClick={props.onFileClick}
              parentGridAttributes={parentAttributes<HTMLDivElement>('grid')}
              parentRowAttributes={parentAttributes<HTMLTableRowElement>('list')}
              fileGridAttributes={(file) => fileAttributes<HTMLDivElement>(file, 'grid')}
              fileRowAttributes={(file) => fileAttributes<HTMLTableRowElement>(file, 'list')}
              renderGridIcon={props.rows.renderGridIcon}
              renderGridOverlay={props.rows.renderGridOverlay}
              renderGridDetails={props.rows.renderGridDetails}
              renderListIcon={props.rows.renderListIcon}
              renderListName={props.rows.renderListName}
              renderListNameTrailing={props.rows.renderListNameTrailing}
              renderListSize={props.rows.renderListSize}
              renderListActions={props.rows.renderListActions}
              parentGridSubtitle={props.rows.parentGridSubtitle}
              renderParentRowEnd={props.rows.renderParentRowEnd}
            />
          </Show>
        </>
      }
    >
      <KbSearchResults
        results={props.controller.kbSearchResults()}
        query={props.controller.debouncedSearch()}
        isLoading={props.controller.kbSearchLoading()}
        currentPath={props.currentPath()}
        onResultClick={(path) =>
          props.onKbResultClick(
            path,
            props.controller.kbSearchResults().find((result) => result.path === path)?.name,
          )
        }
      />
    </Show>
  )

  const scrollableListing = () => (
    <Show when={props.scrollTarget.kind === 'element'} fallback={listing()}>
      <div
        ref={(element) => props.setScrollElement?.(element)}
        class='min-h-0 flex-1 overflow-auto'
        onScroll={(event) =>
          props.onScroll?.(event as unknown as UIEvent & { currentTarget: HTMLDivElement })
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
        !compact() && props.canUpload() && props.controller.inKb()
          ? 'Focus here and paste (Ctrl+V) to create a file from the clipboard.'
          : undefined
      }
      onPaste={(event) => props.controller.handlePasteEvent(event)}
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
                  currentPath={props.currentPath()}
                  onNavigate={props.onBreadcrumbNavigate}
                  mode={compact() ? 'Workspace' : undefined}
                  onCrumbContextMenu={props.onBreadcrumbContextMenu}
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
                    aria-pressed={props.controller.searchPopoverOpen() ? 'true' : 'false'}
                    class={
                      compact()
                        ? `inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md outline-none transition-colors ${
                            props.controller.searchPopoverOpen()
                              ? 'bg-accent text-accent-foreground shadow-sm'
                              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                          }`
                        : `inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent transition-colors ${
                            props.controller.searchPopoverOpen()
                              ? 'bg-accent text-accent-foreground shadow-sm'
                              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                          }`
                    }
                    onClick={() =>
                      props.controller.setKbSearchOpen(!props.controller.searchPopoverOpen())
                    }
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
                <Show when={props.toolbar.canCreate()}>
                  <button
                    type='button'
                    title='Create new folder'
                    aria-label={compact() ? undefined : 'New folder'}
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
                    aria-label={compact() ? undefined : 'New file'}
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
                    disabled={props.controller.isUploading()}
                    onUpload={(files) =>
                      void props.controller.uploadFilesToServer(files, props.currentPath())
                    }
                  />
                  <Show when={!!props.toolbar.virtualCreate}>
                    <Show when={canCreateVirtualFolder() || canCreateVirtualFile()}>
                      <div class='bg-border mx-1 h-5 w-px shrink-0' />
                    </Show>
                  </Show>
                </Show>
                <Show when={props.toolbar.virtualCreate && !props.toolbar.canCreate()}>
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
                  sortingDisabled={props.sortingDisabled?.() ?? props.isVirtualFolder()}
                  compact={compact()}
                  viewMode={props.viewMode()}
                  onSortChange={props.controller.displaySettings.setSortOrder}
                  onColumnsChange={props.controller.displaySettings.setFileColumns}
                  onViewModeChange={props.onViewModeChange}
                />
              </div>
            </div>
            <Show when={props.controller.inKb() && props.controller.searchPopoverOpen()}>
              <div
                class={compact() ? 'shrink-0 border-b border-border bg-muted/20 p-2' : 'pt-1.5'}
                data-testid='kb-search-bar'
              >
                <input
                  ref={props.controller.setSearchInputElement}
                  type='text'
                  placeholder='Search notes...'
                  autocomplete='off'
                  class='border-input bg-background focus-visible:ring-ring h-10 w-full rounded-md border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none'
                  value={props.controller.searchQuery()}
                  onInput={(event) => props.controller.setSearchQuery(event.currentTarget.value)}
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
            files={props.files}
            viewMode={props.viewMode}
            includeParent={() => !!props.currentPath()}
            scrollTarget={props.scrollTarget}
            scrollScope={props.scrollScope}
            loading={props.isFilesLoadingInitial}
            deferredLoading={props.showFilesDeferredLoading}
            error={props.error}
            onRetry={props.onRetry}
            showEmpty={props.showEmpty}
            canUpload={props.canUpload}
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
                compact() && props.canUpload() && props.controller.inKb()
                  ? 'Focus this pane and paste (Ctrl+V) to create a file from the clipboard.'
                  : undefined
              }
              onDragEnter={(event) => props.controller.onExternalUploadDragEnter(event)}
              onDragLeave={(event) => props.controller.onExternalUploadDragLeave(event)}
              onDragOver={(event) => props.controller.onExternalUploadDragOver(event)}
              onDrop={(event) => void props.controller.onExternalUploadDrop(event)}
              onContextMenu={(event) => {
                if (!props.controller.showInlineCreate()) return
                const target = event.target
                if (!(target instanceof Element) || target.closest('[data-file-path]')) return
                event.preventDefault()
                event.stopPropagation()
                props.fileRowMenu.dismiss()
                setDirectoryBackgroundMenu({ x: event.clientX, y: event.clientY })
              }}
            >
              {scrollableListing()}
              <Show when={props.controller.showInlineCreate()}>
                <KbInlineCreateFooter
                  noWindowDrag={compact()}
                  inlineMode={props.controller.inlineMode}
                  setInlineMode={props.controller.setInlineMode}
                  inlineName={props.controller.inlineName}
                  setInlineName={props.controller.setInlineName}
                  inlineFileExists={props.controller.inlineFileExists}
                  inlineFolderExists={props.controller.inlineFolderExists}
                  createFilePending={() => props.controller.createFileMutation.isPending}
                  createFileIsError={() => props.controller.createFileMutation.isError}
                  createFileError={() =>
                    props.controller.createFileMutation.error as Error | undefined
                  }
                  createFolderPending={() => props.controller.createFolderMutation.isPending}
                  createFolderIsError={() => props.controller.createFolderMutation.isError}
                  createFolderError={() =>
                    props.controller.createFolderMutation.error as Error | undefined
                  }
                  submitInlineFile={props.controller.submitInlineFile}
                  submitInlineFolder={props.controller.submitInlineFolder}
                  resetInlineCreate={props.controller.resetInlineCreate}
                  onFileInputRef={(element) => {
                    inlineFileInputElement = element
                  }}
                  onFolderInputRef={(element) => {
                    inlineFolderInputElement = element
                  }}
                />
              </Show>
              <Show when={props.controller.externalUploadDragOver()}>
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
