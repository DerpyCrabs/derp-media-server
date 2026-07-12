import { formatFileSize } from '@/lib/media-utils'
import X from 'lucide-solid/icons/x'
import { For, Show, createSignal, onCleanup, onMount } from 'solid-js'
import { openAndroidOffline, removeOfflineInAndroid } from './lib/android-bridge'
import { cancelWebOffline, retryWebOffline, webOfflineUsage } from './lib/web-offline-storage'

type OfflineEvent = {
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'removed'
  name?: string
  path?: string
  completed?: number
  downloadedBytes?: number
  totalBytes?: number
  errorKind?: 'quota' | 'network' | 'auth' | 'unsupported-format' | 'cancelled'
}

const errorLabels = {
  quota: 'Storage quota exceeded',
  network: 'Network connection failed',
  auth: 'Sign-in is required',
  'unsupported-format': 'Unsupported format',
  cancelled: 'Download cancelled',
}

export function OfflineStatus() {
  const [jobs, setJobs] = createSignal<OfflineEvent[]>([])
  const [managerOpen, setManagerOpen] = createSignal(false)
  const [used, setUsed] = createSignal(0)
  const [quota, setQuota] = createSignal(0)

  async function refreshUsage() {
    const local = await webOfflineUsage().catch(() => ({ used: 0 }))
    const estimate = await navigator.storage?.estimate?.().catch(() => undefined)
    setUsed(Math.max(local.used, estimate?.usage ?? 0))
    setQuota(estimate?.quota ?? 0)
  }

  onMount(() => {
    void refreshUsage()
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<OfflineEvent>).detail
      setJobs((current) => [detail, ...current.filter((job) => job.path !== detail.path)].slice(0, 20))
      if (detail.state === 'succeeded' || detail.state === 'removed') void refreshUsage()
    }
    window.addEventListener('derp-offline-status', listener)
    onCleanup(() => window.removeEventListener('derp-offline-status', listener))
  })

  function message(job: OfflineEvent) {
    if (job.state === 'queued') return `Waiting to save ${job.name ?? 'item'}${job.totalBytes ? ` (${formatFileSize(job.totalBytes)})` : ''}…`
    if (job.state === 'running') return `Saving ${job.name ?? 'item'}…`
    if (job.state === 'succeeded') return `${job.name ?? 'Item'} is available offline`
    if (job.state === 'removed') return `${job.name ?? 'Item'} was removed from offline files`
    return `${errorLabels[job.errorKind ?? 'unsupported-format']}: ${job.name ?? 'item'}`
  }

  return (
    <>
      <Show when={jobs()[0]} keyed>
        {(job) => <button type='button' class='fixed right-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px))] z-10020 min-h-11 max-w-[calc(100vw-1.5rem)] rounded-lg border border-border bg-popover px-4 py-3 text-left text-sm shadow-lg' onClick={() => setManagerOpen(true)}><span class='block font-medium'>{message(job)}</span><span class='text-muted-foreground mt-0.5 block text-xs'>Manage offline downloads</span></button>}
      </Show>
      <Show when={managerOpen()}>
        <div class='fixed inset-0 z-10030 flex items-end bg-black/50 sm:items-center sm:justify-center' role='dialog' aria-modal='true' aria-label='Offline manager'>
          <section class='max-h-[85dvh] w-full overflow-auto rounded-t-2xl bg-background p-4 sm:max-w-lg sm:rounded-2xl'>
            <header class='flex items-center justify-between'><h2 class='text-lg font-semibold'>Offline manager</h2><button aria-label='Close offline manager' class='inline-flex h-11 w-11 items-center justify-center rounded-md' onClick={() => setManagerOpen(false)}><X /></button></header>
            <p class='text-muted-foreground text-sm' data-testid='offline-storage-usage'>{formatFileSize(used())} used{quota() ? ` of ${formatFileSize(quota())}` : ''}</p>
            <div class='mt-3 space-y-2'>
              <For each={jobs()}>{(job) => <article class='rounded-lg border p-3'><div class='flex items-center justify-between gap-2'><div class='min-w-0'><p class='truncate font-medium'>{job.name}</p><p class='text-muted-foreground text-xs'>{message(job)}</p></div><div class='flex shrink-0 gap-1'><Show when={job.state === 'queued' || job.state === 'running'}><button class='min-h-11 rounded-md px-3' onClick={() => job.path && cancelWebOffline(job.path)}>Cancel</button></Show><Show when={job.state === 'failed' || job.state === 'cancelled'}><button class='min-h-11 rounded-md px-3' onClick={() => job.path && retryWebOffline(job.path)}>Retry</button></Show><Show when={job.state === 'succeeded'}><button class='min-h-11 rounded-md px-3' onClick={() => job.path && removeOfflineInAndroid({ path: job.path, name: job.name ?? job.path } as never)}>Remove</button></Show></div></div><Show when={job.state === 'running'}><progress class='mt-2 h-2 w-full' max={job.totalBytes || 1} value={job.downloadedBytes || 0} /></Show></article>}</For>
            </div>
            <button class='mt-4 min-h-11 w-full rounded-md border px-4' onClick={() => openAndroidOffline()}>Open offline files</button>
          </section>
        </div>
      </Show>
    </>
  )
}
