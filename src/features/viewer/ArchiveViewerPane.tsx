import { ArchiveEntryPreview } from './ArchiveEntryPreview'
import { Effect, Schema } from 'effect'
import { available, controllerView, list, modelOwner, view } from 'effectweb'
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
import { fileDownloadHref } from '@/lib/files/download-urls'
import { formatFileSize } from '@/lib/media/media-utils'
import Folder from '@effectweb/lucide/icons/folder'
import File from '@effectweb/lucide/icons/file'

type Props = {
  path: string
  embedded: boolean
  editableFolders: readonly string[]
  onClose?: () => void
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
    selected: [] as string[],
    destinationOpen: false,
    extracting: [] as string[],
    pending: false,
    jobId: '',
    jobs: fileJobs.read(),
    applyAll: false,
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
  const browse = (directory: string) => owner.patch({ directory, filter: '' })
  return {
    source: owner.source,
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
    filter: (filter: string) => owner.patch({ filter }),
    select: (path: string) => {
      const selected = owner.read().selected
      owner.patch({
        selected: selected.includes(path)
          ? selected.filter((item) => item !== path)
          : [...selected, path],
      })
    },
    clear: () => owner.patch({ selected: [] }),
    extract: (selected: boolean) =>
      owner.patch({ destinationOpen: true, extracting: selected ? owner.read().selected : [] }),
    closeDestination: () => {
      if (!owner.read().pending) owner.patch({ destinationOpen: false })
    },
    applyAll: (applyAll: boolean) => owner.patch({ applyAll }),
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
    receive: (props: Props) => owner.patch({ props }),
    lifetime: owner,
  }
}
const button =
  'rounded-md border border-input px-2.5 py-1.5 text-sm hover:bg-accent disabled:opacity-40'
export const ArchiveViewerPane = controllerView(
  { controller: archiveController, identity: (props) => props.path },
  view((model) => {
    const { props, actions } = model
    const rows = archiveChildren(model.entries, model.directory, model.filter)
    const previewFiles = rows.filter((entry) => !entry.directory)
    const previewIndex = previewFiles.findIndex((entry) => entry.path === model.preview)
    const job = model.jobs.jobs.find((item) => item.id === model.jobId)
    const busy = model.pending || (job ? fileJobs.active(job) : false)
    return (
      <section
        onKeyDown={(event) => {
          if (model.destinationOpen || model.preview || event.defaultPrevented) return
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
            event.preventDefault()
            event.stopPropagation()
            event.currentTarget
              .querySelector<HTMLInputElement>('input[aria-label="Filter archive"]')
              ?.focus()
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
        aria-label='Archive contents'
        role={props.embedded ? undefined : 'dialog'}
        aria-modal={props.embedded ? undefined : 'true'}
        class={
          props.embedded
            ? 'relative flex h-full min-h-0 flex-col bg-background'
            : 'fixed inset-0 z-50 flex flex-col bg-background'
        }
      >
        <div class='flex min-h-0 flex-1 flex-col' inert={!!model.preview}>
          <header class='flex shrink-0 flex-wrap items-center gap-2 border-b border-border p-2'>
            <span class='min-w-32 flex-1 truncate text-sm font-medium' title={props.path}>
              {props.path.split('/').pop()}
            </span>
            {props.editableFolders.length ? (
              <>
                <button
                  class={button}
                  disabled={model.loading || !model.entries.length || busy}
                  onClick={() => actions.extract(false)}
                >
                  Extract all…
                </button>
                {model.selected.length ? (
                  <button class={button} disabled={busy} onClick={() => actions.extract(true)}>
                    Extract selected…
                  </button>
                ) : null}
              </>
            ) : null}
            <a class={button} href={fileDownloadHref(props.path)} download>
              Download
            </a>
            {!props.embedded && props.onClose ? (
              <button class={button} onClick={props.onClose}>
                Close
              </button>
            ) : null}
          </header>
          <div class='flex shrink-0 flex-wrap items-center gap-2 border-b border-border p-2'>
            <button
              class={button}
              disabled={!model.directory}
              onClick={() => actions.browse(model.directory.split('/').slice(0, -1).join('/'))}
              aria-label='Parent archive folder'
            >
              Up
            </button>
            <button class={button} disabled={!model.directory} onClick={() => actions.browse('')}>
              Archive root
            </button>
            <span
              class='min-w-24 flex-1 truncate text-xs text-muted-foreground'
              title={model.directory}
            >
              /{model.directory}
            </span>
            <input
              class='min-w-0 w-40 grow rounded-md border border-input bg-background px-2 py-1.5 text-sm'
              aria-label='Filter archive'
              placeholder='Filter files…'
              value={model.filter}
              onInput={(event) => actions.filter(event.currentTarget.value)}
            />
          </div>
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
          <div class='min-h-0 flex-1 overflow-auto'>
            <table class='w-full text-left text-sm'>
              <thead class='sticky top-0 bg-muted'>
                <tr>
                  <th class='w-10 p-2'>
                    <span class='sr-only'>Select</span>
                  </th>
                  <th class='p-2'>Name</th>
                  <th class='p-2 text-right'>Size</th>
                </tr>
              </thead>
              <tbody>
                {list(
                  rows.slice(0, 1000),
                  (entry) => entry.path,
                  (entry) => (
                    <tr class='border-b border-border/50 hover:bg-muted/50'>
                      <td class='p-2'>
                        <input
                          type='checkbox'
                          aria-label={`Select ${entry.path}`}
                          checked={model.selected.includes(entry.path)}
                          onChange={() => actions.select(entry.path)}
                        />
                      </td>
                      <td class='p-2'>
                        {entry.directory ? (
                          <button
                            class='flex max-w-full items-center gap-2 text-left hover:underline'
                            onClick={() => actions.browse(entry.path)}
                          >
                            <Folder class='h-4 w-4 shrink-0' />
                            <span class='break-all'>
                              {entry.path.slice(model.directory ? model.directory.length + 1 : 0)}
                            </span>
                          </button>
                        ) : (
                          <button
                            class='flex max-w-full items-center gap-2 text-left hover:underline'
                            title={`Preview ${entry.path}`}
                            onClick={() => actions.preview(entry.path)}
                          >
                            <File class='h-4 w-4 shrink-0 text-muted-foreground' />
                            <span class='break-all'>
                              {entry.path.slice(model.directory ? model.directory.length + 1 : 0)}
                            </span>
                          </button>
                        )}
                      </td>
                      <td class='whitespace-nowrap p-2 text-right text-muted-foreground'>
                        {entry.directory ? '—' : formatFileSize(entry.size)}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
            {!model.loading && !rows.length && !model.error ? (
              <p class='p-4 text-sm text-muted-foreground'>
                {model.filter ? 'No matching files.' : 'This folder is empty.'}
              </p>
            ) : null}
            {rows.length > 1000 ? (
              <p class='p-3 text-sm text-muted-foreground'>
                Showing 1,000 of {rows.length} entries. Filter to narrow the list.
              </p>
            ) : null}
          </div>
          <footer class='flex shrink-0 items-center gap-2 border-t border-border p-2 text-xs text-muted-foreground'>
            <span>
              {model.entries.filter((entry) => !entry.directory).length} files ·{' '}
              {formatFileSize(model.entries.reduce((sum, entry) => sum + entry.size, 0))} unpacked
            </span>
            {model.selected.length ? (
              <>
                <span>· {model.selected.length} selected</span>
                <button class='underline' onClick={actions.clear}>
                  Clear selection
                </button>
              </>
            ) : null}
          </footer>
          {job ? (
            <div
              class='space-y-2 border-t border-border p-3 text-sm'
              role='status'
              aria-label='Extraction progress'
            >
              <div class='flex items-center gap-2'>
                <span class='flex-1'>
                  Extraction: {job.status} · {job.completed}/{job.total}
                </span>
                {fileJobs.active(job) ? (
                  <button class={button} onClick={() => fileJobs.cancel(job.id)}>
                    Cancel extraction
                  </button>
                ) : null}
              </div>
              {job.current && fileJobs.active(job) ? (
                <p class='truncate text-xs text-muted-foreground'>{job.current}</p>
              ) : null}
              {job.conflict ? (
                <div class='space-y-2'>
                  <p class='break-all'>Already exists: {job.conflict}</p>
                  <div class='flex flex-wrap items-center gap-2'>
                    <button
                      class={button}
                      onClick={() => fileJobs.decide(job.id, 'skip', model.applyAll)}
                    >
                      Skip
                    </button>
                    <button
                      class={button}
                      onClick={() => fileJobs.decide(job.id, 'keepBoth', model.applyAll)}
                    >
                      Keep both
                    </button>
                    <button
                      class={button}
                      onClick={() => fileJobs.decide(job.id, 'replace', model.applyAll)}
                    >
                      Replace
                    </button>
                    <label class='flex items-center gap-1'>
                      <input
                        type='checkbox'
                        checked={model.applyAll}
                        onChange={(event) => actions.applyAll(event.currentTarget.checked)}
                      />
                      Apply to all
                    </label>
                  </div>
                </div>
              ) : null}
              {job.errors.length ? (
                <p role='alert' class='text-destructive'>
                  {job.errors[0]?.message}
                  {job.errors.length > 1 ? ` (+${job.errors.length - 1} more)` : ''}
                </p>
              ) : null}
              {model.jobs.error ? (
                <p role='alert' class='text-destructive'>
                  {model.jobs.error}
                </p>
              ) : null}
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
