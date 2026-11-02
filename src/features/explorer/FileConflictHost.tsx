import { available, controllerView, list, modelOwner, view } from 'effectweb'
import { Schema } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { observeQuery, query } from '@effectweb/query'
import { apiSchemaEffect } from '@/lib/api/client'
import { groups, queryCache } from '@/lib/api/cache'
import { formatFileSize } from '@/lib/media/media-utils'
import { Button } from '@/lib/ui/button'
import { Checkbox } from '@/lib/ui/checkbox'
import { Dialog } from '@/lib/ui/dialog'
import { fileJobs, type FileJob } from './file-jobs'

const metadataSchema = Schema.Struct({
  size: Schema.Number,
  modified: Schema.NullOr(Schema.Number),
  directory: Schema.Boolean,
})
type Metadata = typeof metadataSchema.Type
const metadataQuery = query({
  name: 'conflict-file-details',
  groups: [groups.files],
  load: (path: string) =>
    apiSchemaEffect(metadataSchema, `/api/files/properties?path=${encodeURIComponent(path)}`),
})
const FileDetails = view<{ label: string; path: string; metadata: Metadata | undefined }>(
  (props) => (
    <div class='min-w-0 space-y-1'>
      <h3 class='text-xs text-muted-foreground'>{props.label}</h3>
      <p class='break-all text-sm font-medium'>{props.path}</p>
      {props.metadata ? (
        <p class='text-xs text-muted-foreground'>
          {props.metadata.directory ? 'Folder' : formatFileSize(props.metadata.size)}
          {props.metadata.modified
            ? ` · ${new Date(props.metadata.modified).toLocaleString()}`
            : ''}
        </p>
      ) : null}
    </div>
  ),
)
type Props = { job: FileJob; busy: boolean; error: string }
const ConflictDialog = controllerView(
  {
    controller: (props: Props) => {
      const owner = modelOwner({
        props,
        applyAll: false,
        source: AsyncResult.initial<Metadata, Error>(),
        destination: AsyncResult.initial<Metadata, Error>(),
      })
      const source = observeQuery(owner, queryCache, metadataQuery, 'source')
      const destination = observeQuery(owner, queryCache, metadataQuery, 'destination')
      source.select(['copy', 'move'].includes(props.job.operation) ? props.job.current : undefined)
      destination.select(props.job.conflict ?? undefined)
      return {
        source: owner.source,
        lifetime: owner,
        receive: (props: Props) => owner.patch({ props }),
        applyAll: (applyAll: boolean) => owner.patch({ applyAll }),
      }
    },
  },
  view((model) => {
    const { job, busy, error } = model.props
    const cancel = () => {
      if (!busy) fileJobs.cancel(job.id)
    }
    const decide = (choice: 'skip' | 'replace' | 'keepBoth') =>
      fileJobs.decide(job.id, choice, model.applyAll)
    const name = job.conflict?.split(/[/\\]/).pop() ?? ''
    return (
      <Dialog
        open
        title={`“${name}” already exists`}
        showCloseButton={false}
        onOpenChange={(open) => {
          if (!open) cancel()
        }}
        class='sm:max-w-lg'
        footer={
          <>
            <Button variant='outline' disabled={busy} onClick={cancel}>
              Cancel
            </Button>
            <Button variant='outline' disabled={busy} onClick={() => decide('skip')}>
              Skip
            </Button>
            <Button variant='outline' disabled={busy} onClick={() => decide('keepBoth')}>
              Keep both
            </Button>
            <Button variant='destructive' disabled={busy} onClick={() => decide('replace')}>
              Replace
            </Button>
          </>
        }
      >
        <div class='space-y-4 divide-y divide-border'>
          <div class='pb-4'>
            <FileDetails
              label={
                job.operation === 'move'
                  ? 'Moving'
                  : job.operation === 'extractArchive'
                    ? 'Extracting archive entry'
                    : job.operation === 'createArchive'
                      ? 'New archive'
                      : 'Copying'
              }
              path={job.operation === 'createArchive' ? name : job.current}
              metadata={available(model.source)}
            />
          </div>
          <FileDetails
            label='Existing file at destination'
            path={job.conflict ?? ''}
            metadata={available(model.destination)}
          />
        </div>
        {job.total - job.completed > 1 ? (
          <label class='flex items-center gap-2 text-sm'>
            <Checkbox
              checked={model.applyAll}
              disabled={busy}
              onCheckedChange={model.actions.applyAll}
            />
            Apply to remaining conflicts
          </label>
        ) : null}
        {error ? (
          <p role='alert' class='text-sm text-destructive'>
            {error}
          </p>
        ) : null}
      </Dialog>
    )
  }),
)
export const FileConflictHost = controllerView(
  {
    controller: () => {
      const owner = modelOwner(fileJobs.read())
      owner.own(fileJobs.source.subscribe((state) => owner.patch(state)))
      fileJobs.refresh()
      return { source: owner.source, lifetime: owner }
    },
  },
  view((model) =>
    list(
      model.jobs.filter((job) => job.status === 'conflict' && job.conflict).slice(0, 1),
      (job) => `${job.id}:${job.conflict}`,
      (job) => <ConflictDialog job={job} busy={model.resolving === job.id} error={model.error} />,
    ),
  ),
)
