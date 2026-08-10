import { formatFileSize } from '@/lib/media-utils'
import X from 'lucide-solid/icons/x'
import { For, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import {
  offlineJobObserver,
  type OfflineJob,
  type OfflineJobScope,
} from '../lib/offline-job-observer'
import {
  cancelWebOffline,
  removeWebOffline,
  retryWebOffline,
  webOfflineUsage,
} from '../lib/web-offline-storage'

type Props = {
  scope: OfflineJobScope
  message: (job: OfflineJob) => string
  onOpenCatalog?: () => void
  onClose: () => void
}

export function OfflineManager(props: Props) {
  const [jobs, setJobs] = createSignal<readonly OfflineJob[]>([])
  const [used, setUsed] = createSignal(0)
  const [quota, setQuota] = createSignal(0)

  async function refreshUsage() {
    const local = await webOfflineUsage().catch(() => ({ used: 0 }))
    const estimate = await navigator.storage?.estimate?.().catch(() => undefined)
    setUsed(Math.max(local.used, estimate?.usage ?? 0))
    setQuota(estimate?.quota ?? 0)
  }

  onMount(() => void refreshUsage())
  createEffect(() => {
    const unsubscribe = offlineJobObserver.subscribe(props.scope, (snapshot) => {
      setJobs(snapshot)
      const state = snapshot[0]?.state
      if (state === 'succeeded' || state === 'removed') void refreshUsage()
    })
    onCleanup(unsubscribe)
  })

  return (
    <div
      class='fixed inset-0 z-10030 flex items-end bg-black/50 sm:items-center sm:justify-center'
      role='dialog'
      aria-modal='true'
      aria-label='Offline manager'
    >
      <section class='max-h-[85dvh] w-full overflow-auto rounded-t-2xl bg-background p-4 sm:max-w-lg sm:rounded-2xl'>
        <header class='flex items-center justify-between'>
          <h2 class='text-lg font-semibold'>Offline manager</h2>
          <button
            type='button'
            aria-label='Close offline manager'
            class='inline-flex h-11 w-11 items-center justify-center rounded-md'
            onClick={props.onClose}
          >
            <X />
          </button>
        </header>
        <p class='text-muted-foreground text-sm' data-testid='offline-storage-usage'>
          {formatFileSize(used())} used{quota() ? ` of ${formatFileSize(quota())}` : ''}
        </p>
        <div class='mt-3 space-y-2'>
          <For each={jobs()}>
            {(job) => (
              <article class='rounded-lg border p-3'>
                <div class='flex items-center justify-between gap-2'>
                  <div class='min-w-0'>
                    <p class='truncate font-medium'>{job.name}</p>
                    <p class='text-muted-foreground text-xs'>{props.message(job)}</p>
                  </div>
                  <div class='flex shrink-0 gap-1'>
                    <Show when={job.state === 'queued' || job.state === 'running'}>
                      <button
                        type='button'
                        class='min-h-11 rounded-md px-3'
                        onClick={() => job.path && cancelWebOffline(job.path, props.scope)}
                      >
                        Cancel
                      </button>
                    </Show>
                    <Show when={job.state === 'failed' || job.state === 'cancelled'}>
                      <button
                        type='button'
                        class='min-h-11 rounded-md px-3'
                        onClick={() => job.path && retryWebOffline(job.path, props.scope)}
                      >
                        Retry
                      </button>
                    </Show>
                    <Show when={job.state === 'succeeded'}>
                      <button
                        type='button'
                        class='min-h-11 rounded-md px-3'
                        onClick={() =>
                          job.path && removeWebOffline(job.path, job.name ?? job.path, props.scope)
                        }
                      >
                        Remove
                      </button>
                    </Show>
                  </div>
                </div>
                <Show when={job.state === 'running'}>
                  <progress
                    class='mt-2 h-2 w-full'
                    max={job.totalBytes || 1}
                    value={job.downloadedBytes || 0}
                  />
                </Show>
              </article>
            )}
          </For>
          <Show when={jobs().length === 0}>
            <p class='text-muted-foreground py-4 text-center text-sm'>No recent downloads</p>
          </Show>
        </div>
        <Show when={props.onOpenCatalog} keyed>
          {(openCatalog) => (
            <button
              type='button'
              class='mt-4 min-h-11 w-full rounded-md border px-4'
              onClick={openCatalog}
            >
              Open offline files
            </button>
          )}
        </Show>
      </section>
    </div>
  )
}
