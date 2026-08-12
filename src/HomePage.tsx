import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { useVideoPlaybackTime } from '@/lib/use-video-playback-time'
import { useQuery } from '@tanstack/solid-query'
import Download from 'lucide-solid/icons/download'
import FolderHeart from 'lucide-solid/icons/folder-heart'
import FolderOpen from 'lucide-solid/icons/folder-open'
import LayoutGrid from 'lucide-solid/icons/layout-grid'
import Play from 'lucide-solid/icons/play'
import TrendingUp from 'lucide-solid/icons/trending-up'
import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { offlineJobObserver, type OfflineJob } from './lib/offline-job-observer'
import { readRecentOwnerLocations, type RecentOwnerLocation } from './lib/recent-owner-locations'
import { hrefFor, hrefForLibraryFile } from './lib/routes'

function basename(path: string) {
  return path.split(/[/\\]/).filter(Boolean).at(-1) || path
}

function formatResumeTime(seconds: number) {
  const rounded = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(rounded / 60)
  return `${minutes}:${String(rounded % 60).padStart(2, '0')}`
}

export function HomePage() {
  const [recent, setRecent] = createSignal<RecentOwnerLocation[]>([])
  const [offlineJobs, setOfflineJobs] = createSignal<readonly OfflineJob[]>([])
  const [playbackTick, setPlaybackTick] = createSignal(0)

  const statsQuery = useQuery(() => ({
    queryKey: queryKeys.stats(),
    queryFn: ({ signal }) =>
      api<{ views: Record<string, number>; shareViews: Record<string, number> }>(
        '/api/stats/views',
        { signal },
      ),
  }))

  onMount(() => {
    setRecent(readRecentOwnerLocations(localStorage))
    const unsubscribePlayback = useVideoPlaybackTime.subscribe(() =>
      setPlaybackTick((tick) => tick + 1),
    )
    const unsubscribeOffline = offlineJobObserver.subscribe('owner', setOfflineJobs)
    onCleanup(() => {
      unsubscribePlayback()
      unsubscribeOffline()
    })
  })

  const continueItems = createMemo(() => {
    void playbackTick()
    return Object.entries(useVideoPlaybackTime.getState().playbackTimes)
      .filter(([, time]) => Number.isFinite(time) && time > 0)
      .slice(-6)
      .reverse()
  })

  const popular = createMemo(() =>
    Object.entries(statsQuery.data?.views ?? {})
      .filter(([, count]) => Number.isFinite(count) && count > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 6),
  )

  const activeOffline = createMemo(() =>
    offlineJobs().filter((job) => job.state === 'queued' || job.state === 'running'),
  )

  return (
    <main class='mx-auto w-full max-w-6xl p-4 pb-24 md:p-8' data-testid='home-page'>
      <div class='mb-6'>
        <p class='text-primary text-sm font-semibold'>Derp Desk</p>
        <h1 class='text-3xl font-semibold tracking-tight'>Pick up where you left off</h1>
      </div>

      <section aria-labelledby='home-quick-heading'>
        <h2 id='home-quick-heading' class='text-sm font-semibold uppercase tracking-wide'>
          Quick actions
        </h2>
        <div class='mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4'>
          <a
            href={hrefFor({ kind: 'library' })}
            class='bg-card hover:bg-muted flex min-h-24 flex-col justify-between rounded-xl border border-border p-4'
          >
            <FolderOpen class='size-5' aria-hidden='true' />
            <span class='font-medium'>Library</span>
          </a>
          <a
            href={hrefFor({ kind: 'spaces' })}
            class='bg-card hover:bg-muted flex min-h-24 flex-col justify-between rounded-xl border border-border p-4'
          >
            <LayoutGrid class='size-5' aria-hidden='true' />
            <span class='font-medium'>Spaces</span>
          </a>
          <a
            href={hrefFor({ kind: 'library' }, { dir: 'Shares' })}
            class='bg-card hover:bg-muted flex min-h-24 flex-col justify-between rounded-xl border border-border p-4'
          >
            <FolderHeart class='size-5' aria-hidden='true' />
            <span class='font-medium'>Shared</span>
          </a>
          <a
            href={hrefFor({ kind: 'offline' })}
            class='bg-card hover:bg-muted flex min-h-24 flex-col justify-between rounded-xl border border-border p-4'
          >
            <Download class='size-5' aria-hidden='true' />
            <span class='font-medium'>Offline</span>
          </a>
        </div>
      </section>

      <Show when={continueItems().length > 0}>
        <section class='mt-8' aria-labelledby='home-continue-heading'>
          <h2 id='home-continue-heading' class='flex items-center gap-2 text-lg font-semibold'>
            <Play class='size-5' aria-hidden='true' /> Continue
          </h2>
          <div class='mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3'>
            <For each={continueItems()}>
              {([path, time]) => (
                <a
                  href={hrefFor({ kind: 'library' }, { playing: path })}
                  class='bg-card hover:bg-muted min-w-0 rounded-lg border border-border p-3'
                >
                  <span class='block truncate font-medium'>{basename(path)}</span>
                  <span class='text-muted-foreground mt-1 block truncate text-xs'>
                    {path} · {formatResumeTime(time)}
                  </span>
                </a>
              )}
            </For>
          </div>
        </section>
      </Show>

      <Show when={recent().length > 0}>
        <section class='mt-8' aria-labelledby='home-recent-heading'>
          <h2 id='home-recent-heading' class='text-lg font-semibold'>
            Recent locations
          </h2>
          <div class='mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3'>
            <For each={recent()}>
              {(item) => (
                <a
                  href={item.href}
                  class='bg-card hover:bg-muted min-w-0 rounded-lg border border-border p-3'
                >
                  <span class='block truncate font-medium'>{item.label}</span>
                  <span class='text-muted-foreground mt-1 block text-xs capitalize'>
                    {item.kind}
                  </span>
                </a>
              )}
            </For>
          </div>
        </section>
      </Show>

      <Show when={popular().length > 0}>
        <section class='mt-8' aria-labelledby='home-popular-heading'>
          <h2 id='home-popular-heading' class='flex items-center gap-2 text-lg font-semibold'>
            <TrendingUp class='size-5' aria-hidden='true' /> Most viewed
          </h2>
          <div class='mt-3 divide-y divide-border rounded-lg border border-border bg-card'>
            <For each={popular()}>
              {([path, count]) => (
                <a
                  href={hrefForLibraryFile(path)}
                  class='hover:bg-muted flex min-h-11 items-center justify-between gap-3 px-3 text-sm'
                >
                  <span class='min-w-0 truncate'>{basename(path)}</span>
                  <span class='text-muted-foreground shrink-0'>{count} views</span>
                </a>
              )}
            </For>
          </div>
        </section>
      </Show>

      <Show when={activeOffline().length > 0}>
        <section class='mt-8' aria-labelledby='home-offline-heading'>
          <h2 id='home-offline-heading' class='text-lg font-semibold'>
            Active offline work
          </h2>
          <div class='mt-3 space-y-2'>
            <For each={activeOffline()}>
              {(job) => (
                <div class='bg-card rounded-lg border border-border p-3 text-sm'>
                  <span class='font-medium'>{job.name ?? job.path ?? 'Offline item'}</span>
                  <span class='text-muted-foreground ml-2 capitalize'>{job.state}</span>
                </div>
              )}
            </For>
          </div>
        </section>
      </Show>
    </main>
  )
}
