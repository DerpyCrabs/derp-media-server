import { view, list } from 'effectweb'
import { Button } from '@/lib/ui/button'
import { Progress } from '@effectweb/shadcn/progress'
import X from '@effectweb/lucide/icons/x'
import { formatFileSize } from '@/lib/media/media-utils'
import { fileJobs, type FileJob } from './file-jobs'
const labels: Record<string, string> = {
  copy: 'Copying',
  move: 'Moving',
  delete: 'Deleting',
  trash: 'Moving to trash',
  createArchive: 'Creating archive',
  extractArchive: 'Extracting',
}
export const FileOperationRow = view<{ job: FileJob }>((props) => {
  const { job } = props
  const active = fileJobs.active(job)
  return (
    <article class='space-y-3 py-4 first:pt-0 last:pb-0'>
      <div class='flex items-center gap-3'>
        <div class='min-w-0 flex-1'>
          <h3 class='text-sm font-medium'>{labels[job.operation] ?? job.operation}</h3>
          <p class='truncate text-xs text-muted-foreground' title={job.current}>
            {job.current || job.status}
          </p>
        </div>
        <span class='shrink-0 text-xs tabular-nums text-muted-foreground'>
          {job.completed}/{job.total}
        </span>
        {active ? (
          <Button
            variant='ghost'
            size='icon-sm'
            aria-label='Cancel operation'
            onClick={() => fileJobs.cancel(job.id)}
          >
            <X />
          </Button>
        ) : null}
      </div>
      {active && !job.conflict ? (
        <Progress
          value={job.total ? job.completed : null}
          max={job.total || 1}
          aria-label='File operation progress'
        />
      ) : null}
      <p class='text-xs text-muted-foreground'>
        {job.conflict ? 'Waiting for your decision' : active ? formatFileSize(job.bytes) : 'Failed'}
        {job.skipped ? ` · ${job.skipped} skipped` : ''}
      </p>
      {list(
        job.errors,
        (error) => error.path,
        (error) => (
          <p role='alert' class='break-words text-xs text-destructive'>
            {error.path}: {error.message}
          </p>
        ),
      )}
    </article>
  )
})
