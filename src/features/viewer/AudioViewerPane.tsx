import { useQueries, useQuery } from '@tanstack/solid-query'
import Download from 'lucide-solid/icons/download'
import LoaderCircle from 'lucide-solid/icons/loader-circle'
import Music2 from 'lucide-solid/icons/music-2'
import Pause from 'lucide-solid/icons/pause'
import Play from 'lucide-solid/icons/play'
import Volume2 from 'lucide-solid/icons/volume-2'
import VolumeX from 'lucide-solid/icons/volume-x'
import { For, Match, Show, Switch, createEffect, createMemo, createSignal } from 'solid-js'
import type { Accessor } from 'solid-js'
import { MediaType, type FileItem } from '@/lib/files/types'
import { fileDownloadHref } from '@/lib/files/download-urls'
import { buildAdminMediaUrl, buildAudioMetadataUrl } from '@/lib/media/build-media-url'
import { queryKeys } from '@/lib/api/query-keys'
import {
  audioPlaybackQueueFromFiles,
  type AudioMetadata,
  fetchAudioMetadata,
  formatPlaybackTime,
  playbackItemFromPath,
  playbackPathKey,
  playbackPathMatches,
  playbackQueuesEqual,
  type PlaybackItem,
} from '@/features/playback'
import { usePlaybackSession, usePlaybackSnapshot } from '@/features/playback/PlaybackProvider'

type Props = {
  viewingPath: Accessor<string>
  directory: Accessor<string>
  files: Accessor<FileItem[]>
  contentVisible: Accessor<boolean>
  autoLoadPaused: boolean
  onNavigate: (path: string) => void
  onActivate?: () => void
}

export function AudioViewerPane(props: Props) {
  const playbackSession = usePlaybackSession()
  const playback = usePlaybackSnapshot()
  const [surface, setSurface] = createSignal<HTMLDivElement>()
  const [surfaceSize, setSurfaceSize] = createSignal({ width: 576, height: 256 })

  createEffect(
    () => surface(),
    (element) => {
      if (!element) return undefined
      const update = () => {
        const rect = element.getBoundingClientRect()
        setSurfaceSize({ width: rect.width, height: rect.height })
      }
      update()
      const observer = new ResizeObserver(update)
      observer.observe(element)
      return () => observer.disconnect()
    },
  )

  const layout = createMemo<'compact' | 'standard' | 'expanded'>(() => {
    const size = surfaceSize()
    if (size.width >= 640 && size.height >= 236) return 'expanded'
    if (size.width < 480 || size.height < 230) return 'compact'
    return 'standard'
  })
  const audioFiles = createMemo(() => props.files().filter((file) => file.type === MediaType.AUDIO))
  const queue = createMemo(() => {
    const items = audioPlaybackQueueFromFiles(audioFiles())
    const path = props.viewingPath()
    if (!path || items.some((item) => playbackPathMatches(item, path))) return items
    return [...items, playbackItemFromPath(path, 'audio')]
  })
  const active = createMemo(() => {
    const state = playback()
    return (
      state.mode === 'audio' &&
      state.currentItem?.media === 'audio' &&
      playbackPathMatches(state.currentItem, props.viewingPath())
    )
  })
  const playing = createMemo(() => active() && playback().desiredPlaying)
  const currentTime = createMemo(() => (active() ? playback().position : 0))
  const duration = createMemo(() => (active() ? playback().duration : 0))
  const loading = createMemo(() => active() && playback().phase === 'resolving')
  const error = createMemo(() => (active() ? playback().error : null))
  const fileName = createMemo(() => props.viewingPath().split(/[/\\]/).pop() ?? 'file')
  const extension = createMemo(() => props.viewingPath().split('.').pop()?.toLowerCase() || '')
  const downloadHref = createMemo(() => fileDownloadHref(props.viewingPath()))

  function itemFor(path: string): PlaybackItem {
    return (
      queue().find((item) => playbackPathMatches(item, path)) ?? playbackItemFromPath(path, 'audio')
    )
  }

  function load(path: string, autoplay: boolean, position?: number) {
    playbackSession.dispatch({
      type: 'load',
      item: itemFor(path),
      queue: queue(),
      autoplay,
      mode: 'audio',
      ...(position === undefined ? {} : { position }),
    })
  }

  function togglePlayback() {
    const path = props.viewingPath()
    if (!path) return
    props.onActivate?.()
    if (active()) playbackSession.dispatch({ type: 'toggle' })
    else load(path, true)
  }

  function seek(time: number) {
    if (!Number.isFinite(time)) return
    const path = props.viewingPath()
    if (!path) return
    props.onActivate?.()
    if (active()) playbackSession.dispatch({ type: 'seek', position: time })
    else load(path, false, time)
  }

  function selectFile(file: FileItem) {
    const controlledCurrent = active()
    props.onActivate?.()
    props.onNavigate(file.path)
    if (!controlledCurrent) return
    const nextQueue = audioPlaybackQueueFromFiles(audioFiles())
    const item = nextQueue.find((candidate) => playbackPathMatches(candidate, file.path))
    if (item) {
      playbackSession.dispatch({
        type: 'load',
        item,
        queue: nextQueue,
        autoplay: false,
        mode: 'audio',
      })
    }
  }

  let offeredPath = ''
  createEffect(
    () => {
      const path = props.viewingPath()
      return {
        path,
        currentItem: playback().currentItem,
        visible: props.contentVisible(),
        key: path ? playbackPathKey(path) : '',
      }
    },
    ({ path, currentItem, visible, key }) => {
      if (!props.autoLoadPaused || !path || !visible || offeredPath === key) return
      offeredPath = key
      if (!currentItem) load(path, false)
    },
  )

  createEffect(
    () => {
      const state = playback()
      const items = queue()
      return active() && items.length > 0 && state.currentItem ? { state, items } : null
    },
    (next) => {
      if (!next || playbackQueuesEqual(next.state.queue, next.items)) return
      playbackSession.dispatch({
        type: 'setQueue',
        queue: next.items,
        current: next.state.currentItem!,
      })
    },
  )

  const metadataUrl = createMemo(() => buildAudioMetadataUrl(props.viewingPath()))
  const metadataQuery = useQuery(() => ({
    queryKey: queryKeys.audioMetadata(props.viewingPath()),
    queryFn: () => fetchAudioMetadata(metadataUrl()),
    enabled: !!metadataUrl(),
    refetchOnWindowFocus: false,
  }))
  const playlistMetadataQueries = useQueries(() => ({
    queries: audioFiles().map((file) => ({
      queryKey: queryKeys.audioMetadata(file.path),
      queryFn: () => fetchAudioMetadata(buildAudioMetadataUrl(file.path)),
      enabled: layout() === 'expanded',
      refetchOnWindowFocus: false,
    })),
  }))
  const folderCoverUrl = createMemo(() => {
    const cover = props.files().find((file) => {
      if (file.type !== MediaType.IMAGE) return false
      const stem = file.name.toLowerCase().replace(/\.[^.]+$/, '')
      return stem === 'cover' || stem === 'folder'
    })
    return cover ? buildAdminMediaUrl(cover.path) : null
  })
  const artworkUrl = createMemo(() => metadataQuery.data?.coverArt || folderCoverUrl())
  const displayDuration = createMemo(() => duration() || metadataQuery.data?.duration || 0)

  function Artwork(local: { class: string }) {
    return (
      <div
        class={`ring-border/70 relative shrink-0 overflow-hidden rounded-lg bg-neutral-900 shadow-md ring-1 ${local.class}`}
      >
        <Show
          when={artworkUrl()}
          fallback={
            <div class='flex h-full w-full items-center justify-center bg-gradient-to-br from-fuchsia-950 to-neutral-950'>
              <Music2 class='h-8 w-8 text-fuchsia-300/80' stroke-width={1.5} />
            </div>
          }
        >
          <img src={artworkUrl()!} alt='Album art' class='h-full w-full object-cover' />
        </Show>
      </div>
    )
  }

  function Info(local: { compact?: boolean }) {
    return (
      <div class='min-w-0'>
        <h2
          class={`truncate font-semibold leading-tight text-foreground ${local.compact ? 'text-sm' : 'text-lg'}`}
          title={metadataQuery.data?.title || fileName()}
        >
          {metadataQuery.data?.title || fileName()}
        </h2>
        <p class='mt-0.5 truncate text-xs text-muted-foreground'>
          {metadataQuery.data?.artist || 'Unknown artist'}
        </p>
        <Show when={!local.compact}>
          <p class='truncate text-[11px] text-muted-foreground/75'>
            {metadataQuery.data?.album || props.directory() || 'Unknown album'}
          </p>
          <div class='mt-1.5 flex gap-1.5 text-[10px] text-muted-foreground'>
            <span class='rounded bg-muted px-1.5 py-0.5 font-medium'>
              {extension().toUpperCase()}
            </span>
            <span class='rounded bg-muted px-1.5 py-0.5 tabular-nums'>
              {formatPlaybackTime(displayDuration())}
            </span>
          </div>
        </Show>
      </div>
    )
  }

  function Seek() {
    return (
      <div class='flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground'>
        <span class='w-8 text-right tabular-nums'>{formatPlaybackTime(currentTime())}</span>
        <input
          type='range'
          aria-label='Playback position'
          min={0}
          max={displayDuration()}
          step={0.1}
          value={currentTime()}
          onInput={(event) => seek(Number.parseFloat(event.currentTarget.value))}
          class='[&::-webkit-slider-thumb]:bg-primary h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-secondary [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full'
        />
        <span class='w-8 tabular-nums'>{formatPlaybackTime(displayDuration())}</span>
      </div>
    )
  }

  function Transport() {
    return (
      <div class='flex min-w-0 items-center gap-2'>
        <button
          type='button'
          aria-label={playing() ? 'Pause' : 'Play'}
          class='bg-primary text-primary-foreground hover:bg-primary/90 inline-flex size-9 shrink-0 items-center justify-center rounded-full shadow-sm'
          onClick={togglePlayback}
        >
          <Show when={playing()} fallback={<Play class='size-4 fill-current' />}>
            <Pause class='size-4 fill-current' />
          </Show>
        </button>
        <button
          type='button'
          aria-label={playback().muted ? 'Unmute' : 'Mute'}
          class='hover:bg-muted inline-flex size-8 shrink-0 items-center justify-center rounded-md'
          onClick={() => playbackSession.dispatch({ type: 'setMuted', muted: !playback().muted })}
        >
          <Show when={playback().muted} fallback={<Volume2 class='size-4' />}>
            <VolumeX class='size-4' />
          </Show>
        </button>
        <input
          type='range'
          aria-label='Volume'
          min={0}
          max={1}
          step={0.01}
          value={playback().muted ? 0 : playback().volume}
          onInput={(event) =>
            playbackSession.dispatch({
              type: 'setVolume',
              volume: Number.parseFloat(event.currentTarget.value),
            })
          }
          class='[&::-webkit-slider-thumb]:bg-foreground h-1.5 min-w-10 flex-1 cursor-pointer appearance-none rounded-full bg-secondary [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full'
        />
        <a
          href={downloadHref()}
          download={fileName()}
          aria-label='Download'
          title='Download'
          class='hover:bg-muted inline-flex size-8 shrink-0 items-center justify-center rounded-md'
        >
          <Download class='size-4' />
        </a>
      </div>
    )
  }

  function StandardPlayer() {
    return (
      <div class='grid h-full min-h-0 grid-cols-[112px_minmax(0,1fr)] items-center gap-4 p-4'>
        <Artwork class='size-28' />
        <div class='min-w-0 space-y-2.5'>
          <Info />
          <Seek />
          <Transport />
        </div>
      </div>
    )
  }

  function CompactPlayer() {
    return (
      <div class='flex h-full min-h-0 flex-col justify-center gap-2.5 p-3'>
        <div class='flex min-w-0 items-center gap-3'>
          <Artwork class='size-12' />
          <div class='min-w-0 flex-1'>
            <Info compact />
          </div>
        </div>
        <Seek />
        <Transport />
      </div>
    )
  }

  function Playlist() {
    return (
      <div
        data-testid='canvas-audio-playlist'
        class='flex h-full min-h-0 flex-col border-l border-border bg-muted/20'
      >
        <div class='border-b border-border px-3 py-2.5'>
          <p class='truncate text-[11px] text-muted-foreground'>{props.directory()}</p>
        </div>
        <div class='min-h-0 flex-1 overflow-auto p-1.5'>
          <For each={audioFiles()}>
            {(file, index) => {
              const label = () => {
                const metadata = playlistMetadataQueries[index()]?.data as AudioMetadata | undefined
                const title = metadata?.title?.trim() || file.name
                return metadata?.artist?.trim() ? `${metadata.artist} — ${title}` : title
              }
              return (
                <button
                  type='button'
                  data-audio-playlist-path={file.path}
                  class={[
                    'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted',
                    { 'bg-primary/10 text-primary': file.path === props.viewingPath() },
                  ]}
                  onClick={() => selectFile(file)}
                >
                  <Music2 class='size-3.5 shrink-0' />
                  <span class='min-w-0 flex-1 truncate text-xs' title={label()}>
                    {label()}
                  </span>
                </button>
              )
            }}
          </For>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={setSurface}
      data-testid='canvas-audio-player-ui'
      data-audio-layout={layout()}
      class='relative h-full min-h-0 overflow-hidden bg-gradient-to-br from-muted/45 via-background to-background'
    >
      <Show when={loading() && !error()}>
        <div class='pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/55 backdrop-blur-sm'>
          <LoaderCircle class='h-7 w-7 animate-spin text-muted-foreground' stroke-width={2} />
        </div>
      </Show>
      <Show when={error()}>
        {(message) => (
          <div class='absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-background/90 p-6 text-center'>
            <p class='text-destructive text-sm'>{message()}</p>
            <div class='flex gap-2'>
              <button
                type='button'
                class='rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground'
                onClick={() => playbackSession.dispatch({ type: 'retry' })}
              >
                Retry
              </button>
              <a
                href={downloadHref()}
                download={fileName()}
                class='rounded-md border border-input px-3 py-1.5 text-sm'
              >
                Download
              </a>
            </div>
          </div>
        )}
      </Show>
      <Switch>
        <Match when={layout() === 'compact'}>
          <CompactPlayer />
        </Match>
        <Match when={layout() === 'expanded'}>
          <div class='grid h-full min-h-0 grid-cols-[minmax(0,1fr)_272px]'>
            <StandardPlayer />
            <Playlist />
          </div>
        </Match>
        <Match when={layout() === 'standard'}>
          <StandardPlayer />
        </Match>
      </Switch>
    </div>
  )
}
