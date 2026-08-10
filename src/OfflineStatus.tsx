import { formatFileSize } from '@/lib/media-utils'
import { Show, Suspense, createEffect, createSignal, lazy, onCleanup } from 'solid-js'
import {
  offlineJobObserver,
  type OfflineJob,
  type OfflineJobScope,
} from './lib/offline-job-observer'

const OfflineManager = lazy(() =>
  import('./offline/OfflineManager').then((module) => ({ default: module.OfflineManager })),
)

const errorLabels = {
  quota: 'Storage quota exceeded',
  network: 'Network connection failed',
  auth: 'Sign-in is required',
  'unsupported-format': 'Unsupported format',
  cancelled: 'Download cancelled',
}

export function offlineJobMessage(job: OfflineJob): string {
  if (job.state === 'queued') {
    return `Waiting to save ${job.name ?? 'item'}${job.totalBytes ? ` (${formatFileSize(job.totalBytes)})` : ''}…`
  }
  if (job.state === 'running') return `Saving ${job.name ?? 'item'}…`
  if (job.state === 'succeeded') return `${job.name ?? 'Item'} is available offline`
  if (job.state === 'removed') return `${job.name ?? 'Item'} was removed from offline files`
  return `${errorLabels[job.errorKind ?? 'unsupported-format']}: ${job.name ?? 'item'}`
}

type Props = {
  scope?: OfflineJobScope
}

export function OfflineStatus(props: Props) {
  const [jobs, setJobs] = createSignal<readonly OfflineJob[]>([])
  const [managerOpen, setManagerOpen] = createSignal(false)
  const scope = () => props.scope ?? 'owner'

  createEffect(() => {
    const unsubscribe = offlineJobObserver.subscribe(scope(), setJobs)
    onCleanup(unsubscribe)
  })

  return (
    <>
      <Show when={jobs()[0]} keyed>
        {(job) => (
          <button
            type='button'
            class='fixed right-3 bottom-[calc(0.75rem+var(--owner-shell-mobile-nav-height,0px)+env(safe-area-inset-bottom,0px))] z-10020 min-h-11 max-w-[calc(100vw-1.5rem)] rounded-lg border border-border bg-popover px-4 py-3 text-left text-sm shadow-lg'
            onClick={() => setManagerOpen(true)}
          >
            <span class='block font-medium'>{offlineJobMessage(job)}</span>
            <span class='text-muted-foreground mt-0.5 block text-xs'>Manage offline downloads</span>
          </button>
        )}
      </Show>
      <Show when={managerOpen()}>
        <Suspense>
          <OfflineManager
            scope={scope()}
            message={offlineJobMessage}
            onOpenCatalog={
              scope() === 'owner'
                ? () =>
                    void import('./lib/offline-files').then(({ openOfflineFiles }) =>
                      openOfflineFiles(),
                    )
                : undefined
            }
            onClose={() => setManagerOpen(false)}
          />
        </Suspense>
      </Show>
    </>
  )
}
