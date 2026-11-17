import { cn } from '@/lib/ui/cn'
import { Button } from '@/lib/ui/button'
import { DropdownMenu } from '@/lib/ui/menu'
import Ellipsis from '@effectweb/lucide/icons/ellipsis'
import { ArchiveEntryPreview } from '@/features/viewer/ArchiveEntryPreview'
import { Breadcrumbs } from './Breadcrumbs'
import { FolderFilter } from './FolderFilter'
import { FileOperationRow } from './FileOperationRow'
import Search from '@effectweb/lucide/icons/search'
import ArrowLeft from '@effectweb/lucide/icons/arrow-left'
import { Effect, Schema } from 'effect'
import {
  available,
  controllerView,
  domBinding,
  modelOwner,
  ownerController,
  view,
  type JSX,
} from 'effectweb'
import { observeQuery } from '@effectweb/query'
import { queryCache } from '@/lib/api/cache'
import { postSchemaEffect } from '@/lib/api/client'
import {
  archiveChildren,
  archiveQuery,
  type ArchiveEntry,
} from '@/features/explorer/archive-contents'
import { fileJobs } from '@/features/explorer/file-jobs'
import { MoveToDialog } from '@/features/explorer/MoveToDialog'
import { formatFileSize } from '@/lib/media/media-utils'
import { FileBrowserPane } from './FileBrowserPane'
import { fileIcon, gridHeroIcon } from './file-icon'
import { DEFAULT_FILE_COLUMNS, DEFAULT_FILE_SORT, sortFileItems } from './file-display-settings'
import { selectFiles } from './file-selection'
import { MediaType, type FileItem } from '@/lib/files/types'
import { getMediaType } from '@/lib/media/media-utils'
import type { FileColumnVisibility, FileSortOrder } from '@/lib/models/settings-types'

function archiveFiles(
  entries: readonly ArchiveEntry[],
  directory: string,
  filter: string,
): FileItem[] {
  return archiveChildren(entries, directory, filter).map((entry) => {
    const name = entry.path.slice(directory ? directory.length + 1 : 0)
    const extension = entry.directory ? '' : (name.split('.').pop() ?? '')
    return {
      name,
      path: entry.path,
      extension,
      size: entry.size,
      isDirectory: entry.directory,
      type: entry.directory ? MediaType.FOLDER : getMediaType(extension),
    }
  })
}
const scrollBinding = (
  element: HTMLDivElement,
  current: () => (element: HTMLDivElement | undefined) => void,
) => {
  current()(element)
  return { update: () => current()(element), dispose: () => current()(undefined) }
}

type Props = {
  class?: string
  path: string
  embedded: boolean
  viewMode?: 'list' | 'grid'
  columns?: FileColumnVisibility
  sortOrder?: FileSortOrder
  editableFolders: readonly string[]
  onClose?: () => void
  toolbarStart?: JSX.Element
  onNavigateOutside?: (path: string) => void
}
function archiveController(props: Props) {
  const owner = modelOwner({
    props,
    entries: [] as readonly ArchiveEntry[],
    loading: true,
    error: '',
    directory: '',
    preview: '',
    filter: '',
    filterOpen: false,
    selected: [] as string[],
    anchor: null as string | null,
    destinationOpen: false,
    extracting: [] as string[],
    pending: false,
    jobId: '',
    jobs: fileJobs.read(),
  })
  const observer = observeQuery(owner, queryCache, archiveQuery, (result) => {
    owner.patch({
      entries: available(result)?.entries ?? [],
      loading: result.waiting && !available(result),
      error:
        result._tag === 'Failure'
          ? 'Could not read this archive. It may be damaged, encrypted, or contain unsupported links or unsafe paths.'
          : '',
    })
  })
  observer.select(props.path)
  owner.own(fileJobs.source.subscribe((jobs) => owner.patch({ jobs })))
  let scrollElement: HTMLDivElement | undefined
  const scrollTarget = { kind: 'element' as const, getScrollElement: () => scrollElement }
  const browse = (directory: string) => owner.patch({ directory, filter: '' })
  const activate = (file: FileItem) =>
    file.isDirectory ? browse(file.path) : owner.patch({ preview: file.path })
  const orderedFiles = () => {
    const state = owner.read()
    return sortFileItems(
      archiveFiles(state.entries, state.directory, state.filter),
      state.props.sortOrder ?? DEFAULT_FILE_SORT,
    )
  }
  const select = (
    file: FileItem,
    event: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean },
    toggle = false,
  ) => {
    const state = owner.read()
    owner.patch(selectFiles(state.selected, state.anchor, file, orderedFiles(), event, toggle))
  }
  return {
    ...ownerController(owner),
    scrollTarget: () => scrollTarget,
    setScrollElement: (element: HTMLDivElement | undefined) => {
      scrollElement = element
    },
    activate,
    toggleSelection: (file: FileItem) => select(file, {}, true),
    click: (file: FileItem, event?: MouseEvent | KeyboardEvent) => {
      if (event?.currentTarget instanceof HTMLElement)
        event.currentTarget.focus({ preventScroll: true })
      if (event && (event.ctrlKey || event.metaKey || event.shiftKey)) select(file, event)
      else activate(file)
    },
    moveFocus: (_from: FileItem, to: FileItem, event: KeyboardEvent) => {
      if (event.shiftKey) select(to, event)
    },
    keyDown: (file: FileItem, event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('button')) return
      if (event.key === 'Enter') {
        event.preventDefault()
        activate(file)
      }
      if (event.key === ' ') {
        event.preventDefault()
        select(file, event, true)
      }
    },
    browse,
    preview: (preview: string) => owner.patch({ preview }),
    nextPreview: (offset: number) => {
      const state = owner.read()
      const files = archiveChildren(state.entries, state.directory, state.filter).filter(
        (entry) => !entry.directory,
      )
      const next = files[files.findIndex((entry) => entry.path === state.preview) + offset]
      if (next) owner.patch({ preview: next.path })
    },
    filterOpen: (filterOpen: boolean) => owner.patch({ filterOpen }),
    filter: (filter: string) => owner.patch({ filter }),
    clear: () => owner.patch({ selected: [] }),
    extract: (selected: boolean) =>
      owner.patch({ destinationOpen: true, extracting: selected ? owner.read().selected : [] }),
    closeDestination: () => {
      if (!owner.read().pending) owner.patch({ destinationOpen: false })
    },
    confirm: (destination: string) => {
      if (owner.read().pending) return
      owner.patch({ pending: true, error: '' })
      owner.run(
        'extract',
        postSchemaEffect(Schema.Struct({ id: Schema.String }), '/api/file-jobs', {
          operation: 'extractArchive',
          paths: [props.path],
          destination,
          entries: owner.read().extracting.length ? owner.read().extracting : undefined,
        }).pipe(
          Effect.tap(({ id }) =>
            Effect.sync(() => {
              owner.patch({ jobId: id, pending: false, destinationOpen: false })
              fileJobs.refresh()
            }),
          ),
          Effect.catch((error) =>
            Effect.sync(() => owner.patch({ error: error.message, pending: false })),
          ),
        ),
        'replace',
      )
    },
  }
}
export const ArchiveBrowser = controllerView(
  { controller: archiveController, identity: (props) => props.path },
  view((model) => {
    const { props, actions } = model
    const rows = archiveChildren(model.entries, model.directory, model.filter)
    const files = sortFileItems(
      archiveFiles(model.entries, model.directory, model.filter),
      props.sortOrder ?? DEFAULT_FILE_SORT,
    )
    const previewFiles = rows.filter((entry) => !entry.directory)
    const previewIndex = previewFiles.findIndex((entry) => entry.path === model.preview)
    const job = model.jobs.jobs.find((item) => item.id === model.jobId)
    const fileMenu = (file: FileItem) => (
      <DropdownMenu
        align='end'
        aria-label={`More actions for ${file.name}`}
        trigger={
          <Button
            variant='ghost'
            size='icon'
            class='h-11 w-11'
            aria-label={`More actions for ${file.name}`}
          >
            <Ellipsis class='h-5 w-5' />
          </Button>
        }
        items={[
          {
            kind: 'item',
            label: model.selected.includes(file.path) ? 'Deselect' : 'Select',
            onSelect: () => actions.toggleSelection(file),
          },
        ]}
      />
    )
    const busy = model.pending || (job ? fileJobs.active(job) : false)
    return (
      <section
        onKeyDown={(event) => {
          if (model.destinationOpen || model.preview || event.defaultPrevented) return
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
            event.preventDefault()
            event.stopPropagation()
            actions.filterOpen(true)
          } else if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === 'e' &&
            props.editableFolders.length &&
            !busy &&
            model.entries.length
          ) {
            event.preventDefault()
            event.stopPropagation()
            actions.extract(model.selected.length > 0)
          } else if (
            (event.ctrlKey || event.metaKey) &&
            event.key.toLowerCase() === 'p' &&
            model.selected.length === 1 &&
            model.entries.some((entry) => entry.path === model.selected[0] && !entry.directory)
          ) {
            event.preventDefault()
            event.stopPropagation()
            actions.preview(model.selected[0]!)
          } else if (event.key === 'Escape') {
            event.stopPropagation()
            event.preventDefault()
            if (model.filter) actions.filter('')
            else props.onClose?.()
          } else if (event.altKey && event.key === 'ArrowUp') {
            event.preventDefault()
            event.stopPropagation()
            actions.browse(model.directory.split('/').slice(0, -1).join('/'))
          }
        }}
        data-explorer-surface
        aria-label='Archive contents'
        role={props.embedded ? undefined : 'dialog'}
        aria-modal={props.embedded ? undefined : 'true'}
        class={cn(
          props.embedded
            ? 'relative @container/explorer flex h-full min-h-0 flex-col bg-background'
            : 'fixed inset-0 z-50 flex flex-col bg-background',
          props.class,
        )}
      >
        <div class='flex min-h-0 flex-1 flex-col' inert={!!model.preview}>
          <header class='flex h-12 shrink-0 items-center gap-1 border-b border-border bg-muted/30 px-2'>
            {props.toolbarStart}
            <Button
              variant='ghost'
              size='icon'
              aria-label='Back to folder'
              onClick={() =>
                model.directory
                  ? actions.browse(model.directory.split('/').slice(0, -1).join('/'))
                  : props.onClose?.()
              }
            >
              <ArrowLeft />
            </Button>
            <div class='min-w-0 flex-1 overflow-hidden'>
              <Breadcrumbs
                currentPath={`${props.path}${model.directory ? '/' + model.directory : ''}`}
                onNavigate={(path) => {
                  if (path === props.path) actions.browse('')
                  else if (path.startsWith(props.path + '/'))
                    actions.browse(path.slice(props.path.length + 1))
                  else if (props.onNavigateOutside) props.onNavigateOutside(path)
                  else props.onClose?.()
                }}
              />
            </div>
            <Button
              variant='ghost'
              size='icon'
              aria-label='Filter archive'
              onClick={() => actions.filterOpen(!model.filterOpen)}
            >
              <Search />
            </Button>
            {props.editableFolders.length ? (
              <Button
                variant='outline'
                disabled={model.loading || !model.entries.length || busy}
                onClick={() => actions.extract(model.selected.length > 0)}
              >
                {model.selected.length ? `Extract (${model.selected.length})…` : 'Extract…'}
              </Button>
            ) : null}
          </header>
          {model.filterOpen ? (
            <FolderFilter
              value={model.filter}
              onChange={actions.filter}
              onClose={() => {
                actions.filter('')
                actions.filterOpen(false)
              }}
            />
          ) : null}
          {model.error ? (
            <p role='alert' class='p-3 text-sm text-destructive'>
              {model.error}
            </p>
          ) : null}
          {model.loading ? (
            <p role='status' class='p-4 text-sm text-muted-foreground'>
              Reading archive…
            </p>
          ) : null}
          <div
            class='min-h-0 flex-1 overflow-auto'
            use={domBinding(actions.setScrollElement, scrollBinding)}
          >
            {!model.loading ? (
              <FileBrowserPane
                listing={{
                  files,
                  viewMode: props.viewMode ?? 'list',
                  columns: props.columns ?? DEFAULT_FILE_COLUMNS.workspace,
                  includeParent: !!model.directory,
                  scrollTarget: actions.scrollTarget(),
                  scrollScope: `${props.path}/${model.directory}/${model.filter}`,
                  showEmpty: !files.length && !model.error,
                  canUpload: false,
                  warmThumbnails: false,
                }}
                layout={{
                  gridContainerClass: 'p-2 max-sm:p-4',
                  listContainerClass: 'max-sm:py-2',
                  gridClass: 'gap-4',
                  listClass: 'relative w-full overflow-x-auto overflow-y-hidden',
                  listSizeColumnClass: 'w-20 @min-[560px]/explorer:w-28',
                }}
                rows={{
                  onParentClick: () =>
                    actions.browse(model.directory.split('/').slice(0, -1).join('/')),
                  onFileClick: actions.click,
                  onFileActivate: actions.activate,
                  onMoveFocus: actions.moveFocus,
                  fileRowAttributes: (file) => ({
                    tabindex: 0,
                    'aria-selected': model.selected.includes(file.path),
                    class: model.selected.includes(file.path)
                      ? 'bg-accent text-accent-foreground'
                      : '',
                    onKeyDown: (event: KeyboardEvent) => actions.keyDown(file, event),
                  }),
                  fileGridAttributes: (file) => ({
                    'aria-selected': model.selected.includes(file.path),
                    class: model.selected.includes(file.path)
                      ? 'bg-accent text-accent-foreground'
                      : '',
                    onKeyDown: (event: KeyboardEvent) => actions.keyDown(file, event),
                  }),
                  renderListActions: (file) => (
                    <td
                      class='p-1 align-middle sm:hidden'
                      onClick={(event) => event.stopPropagation()}
                    >
                      {fileMenu(file)}
                    </td>
                  ),
                  renderParentRowEnd: () => <td class='sm:hidden' />,
                  renderGridOverlay: (file) => (
                    <div
                      onClick={(event) => event.stopPropagation()}
                      class='absolute right-1.5 bottom-1.5 z-20 rounded-full bg-background/90 sm:hidden'
                    >
                      {fileMenu(file)}
                    </div>
                  ),
                  renderListIcon: fileIcon,
                  renderGridIcon: (file) => gridHeroIcon(file, undefined, undefined, false),
                  renderListSize: (file) => (
                    <span class='inline-block shrink-0 whitespace-nowrap tabular-nums text-xs @min-[560px]/explorer:text-sm'>
                      {file.isDirectory ? '' : formatFileSize(file.size)}
                    </span>
                  ),
                }}
              />
            ) : null}
          </div>
          {job && (fileJobs.active(job) || job.errors.length > 0 || job.status === 'failed') ? (
            <div class='border-t border-border p-3'>
              <FileOperationRow job={job} />
            </div>
          ) : null}
          {model.destinationOpen ? (
            <MoveToDialog
              mode='extract'
              overlayScope={props.embedded ? 'window' : 'viewport'}
              fileName={props.path.split('/').pop() ?? ''}
              filePath={props.path}
              editableFolders={props.editableFolders}
              onConfirm={actions.confirm}
              onClose={actions.closeDestination}
              isPending={model.pending}
              error={model.error ? new Error(model.error) : undefined}
            />
          ) : null}
        </div>
        {model.preview ? (
          <ArchiveEntryPreview
            archive={props.path}
            entry={model.preview}
            onClose={() => actions.preview('')}
            onNavigate={actions.nextPreview}
            previous={previewIndex > 0}
            next={previewIndex >= 0 && previewIndex < previewFiles.length - 1}
          />
        ) : null}
      </section>
    )
  }),
)
