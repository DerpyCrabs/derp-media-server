import { MediaType } from '@/lib/types'
import type { ResourceKey } from '@/lib/domain/resource'
import { queryKeys } from '@/lib/query-keys'
import { filesystemResourcesQueryOptions } from '@/src/integrations/filesystem/query-options'
import {
  filesystemPathForResourceKey,
  filesystemResourceMediaType,
} from '@/src/integrations/filesystem/resource'
import { useQuery } from '@tanstack/solid-query'
import Headphones from 'lucide-solid/icons/headphones'
import Monitor from 'lucide-solid/icons/monitor'
import Pause from 'lucide-solid/icons/pause'
import Play from 'lucide-solid/icons/play'
import Repeat from 'lucide-solid/icons/repeat'
import StepBack from 'lucide-solid/icons/step-back'
import StepForward from 'lucide-solid/icons/step-forward'
import Volume2 from 'lucide-solid/icons/volume-2'
import VolumeX from 'lucide-solid/icons/volume-x'
import X from 'lucide-solid/icons/x'
import { Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import { buildAudioMetadataUrl, buildMediaUrl, buildThumbnailUrl } from '@/lib/api-media-urls'
import { usePlaybackSession, usePlaybackSnapshot } from '../features/playback/PlaybackProvider'
import { applicationContentRegistry } from '../integrations/registry'

async function fetchAudioMetadata(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Failed to fetch audio metadata')
  return response.json() as Promise<{
    title?: string
    artist?: string
    album?: string
    coverArt?: string | null
    duration?: number
  }>
}

function parentPath(path: string): string {
  return path.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
}

function formatTime(time: number) {
  if (!Number.isFinite(time) || Number.isNaN(time)) return '0:00'
  const minutes = Math.floor(time / 60)
  const seconds = Math.floor(time % 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

type Props = {
  onShowVideo: (resource: ResourceKey) => void
  onStopPlayback: () => void
  suppressTaskbarAudioChrome?: () => boolean
}

export function WorkspaceTaskbarAudio(props: Props) {
  const session = usePlaybackSession()
  const playback = usePlaybackSnapshot()
  const [detailsOpen, setDetailsOpen] = createSignal(false)
  const item = createMemo(() => playback().currentItem)
  const playingPath = createMemo(() => {
    const current = item()
    return current ? filesystemPathForResourceKey(current.resource) : null
  })
  const currentDir = createMemo(() => parentPath(playingPath() ?? ''))
  const isVideoFile = createMemo(() => item()?.media === 'video')
  const shouldHandleAudio = createMemo(
    () =>
      !!item() && playback().mode === 'audio' && !(props.suppressTaskbarAudioChrome?.() ?? false),
  )

  createEffect(() => {
    if (!shouldHandleAudio()) setDetailsOpen(false)
  })

  const filesQuery = useQuery(() => ({
    ...filesystemResourcesQueryOptions({ dir: currentDir() }),
    enabled: shouldHandleAudio() && !!playingPath(),
  }))
  const resources = createMemo(() => filesQuery.data?.resources ?? [])
  let queuedSignature = ''
  createEffect(() => {
    const current = item()
    if (!current || !shouldHandleAudio() || filesQuery.isPending) return
    const queue = applicationContentRegistry.playbackQueue(resources(), current)
    const signature = queue
      .map((candidate) => `${candidate.resource.provider}\0${candidate.resource.id}`)
      .join('\x01')
    if (signature === queuedSignature) return
    queuedSignature = signature
    session.dispatch({ type: 'setQueue', queue, current })
  })
  const coverArtUrl = createMemo(() => {
    const cover = resources().find(
      (resource) =>
        filesystemResourceMediaType(resource) === MediaType.IMAGE &&
        resource.name.toLowerCase().replace(/\.[^.]+$/, '') === 'cover',
    )
    const path = cover ? filesystemPathForResourceKey(cover.key) : null
    return path ? buildMediaUrl(path) : null
  })
  const metadataUrl = createMemo(() => {
    const path = playingPath()
    return path ? buildAudioMetadataUrl(path) : ''
  })
  const metadataQuery = useQuery(() => ({
    queryKey: queryKeys.audioMetadata(playingPath() ?? ''),
    queryFn: () => fetchAudioMetadata(metadataUrl()),
    enabled: shouldHandleAudio() && !!metadataUrl(),
    refetchOnWindowFocus: false,
  }))
  const audioMetadata = createMemo(() => metadataQuery.data)
  const displayImageUrl = createMemo(() => {
    const path = playingPath()
    if (isVideoFile() && path) return buildThumbnailUrl(path)
    return audioMetadata()?.coverArt || coverArtUrl()
  })
  const fileName = createMemo(() => item()?.name ?? '')
  const displayDuration = createMemo(() => playback().duration || audioMetadata()?.duration || 0)
  const hasPreviousAudio = createMemo(() => playback().currentIndex > 0 || playback().position > 20)
  const hasNextAudio = createMemo(
    () => playback().currentIndex >= 0 && playback().currentIndex + 1 < playback().queue.length,
  )

  createEffect(() => {
    if (!detailsOpen()) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      const root = document.querySelector('[data-workspace-taskbar-audio-root]')
      if (root && target && !root.contains(target)) setDetailsOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDetailsOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    onCleanup(() => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    })
  })

  function handleShowVideo() {
    const current = item()
    if (!current || !isVideoFile()) return
    session.dispatch({ type: 'setMode', mode: 'video' })
    props.onShowVideo(current.resource)
  }

  return (
    <Show when={shouldHandleAudio()}>
      <div class='relative' data-workspace-taskbar-audio-root>
        <div class='text-muted-foreground flex h-8 items-center gap-1 border-l border-border bg-muted/50 px-2'>
          <button
            type='button'
            class='hover:opacity-90 flex min-w-0 cursor-pointer items-center gap-1.5 pr-1 text-left transition-opacity'
            onClick={() => setDetailsOpen(!detailsOpen())}
            aria-label='Open audio controls'
            aria-expanded={detailsOpen()}
          >
            <div class='bg-muted flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded'>
              <Show
                when={displayImageUrl()}
                fallback={
                  <Headphones class='text-muted-foreground h-3.5 w-3.5 shrink-0' stroke-width={2} />
                }
              >
                <img
                  src={displayImageUrl()!}
                  alt=''
                  class='block size-full object-cover object-center'
                  loading='eager'
                />
              </Show>
            </div>
            <div class='hidden max-w-52 min-w-52 min-[1150px]:block'>
              <div class='text-foreground truncate text-[12px] leading-none font-medium'>
                {audioMetadata()?.title || fileName()}
              </div>
              <div class='text-muted-foreground truncate text-[11px] leading-none'>
                {audioMetadata()?.artist || currentDir() || '\u00A0'}
              </div>
            </div>
          </button>
        </div>

        <Show when={detailsOpen()}>
          <div class='bg-popover absolute right-0 bottom-full z-100001 mb-2 w-80 border border-border shadow-xl'>
            <button
              type='button'
              class='text-muted-foreground hover:bg-accent hover:text-foreground absolute top-2 right-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md'
              title='Stop playback'
              aria-label='Stop playback'
              onClick={() => {
                props.onStopPlayback()
                setDetailsOpen(false)
              }}
            >
              <X class='h-4 w-4' stroke-width={2} />
            </button>
            <div class='space-y-3 p-3'>
              <div class='flex items-center gap-3 pr-10'>
                <div class='flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded bg-neutral-800'>
                  <Show
                    when={displayImageUrl()}
                    fallback={<Headphones class='text-muted-foreground h-5 w-5' stroke-width={2} />}
                  >
                    <img
                      src={displayImageUrl()!}
                      alt='Album art'
                      class='h-full w-full object-cover object-center'
                    />
                  </Show>
                </div>
                <div class='min-w-0 flex-1'>
                  <div class='text-foreground truncate text-sm font-medium'>
                    {audioMetadata()?.title || fileName()}
                  </div>
                  <div class='text-muted-foreground truncate text-xs'>
                    {audioMetadata()?.artist || currentDir() || '\u00A0'}
                  </div>
                </div>
              </div>

              <div class='text-muted-foreground flex items-center gap-2 text-[11px]'>
                <span class='w-9 text-right tabular-nums'>{formatTime(playback().position)}</span>
                <input
                  type='range'
                  aria-label='Playback position'
                  aria-valuetext={`${formatTime(playback().position)} of ${formatTime(displayDuration())}`}
                  min={0}
                  max={displayDuration() || 0}
                  value={playback().position}
                  onInput={(event) =>
                    session.dispatch({
                      type: 'seek',
                      position: Number.parseFloat(event.currentTarget.value),
                    })
                  }
                  class='[&::-webkit-slider-thumb]:bg-primary h-1.5 flex-1 cursor-pointer appearance-none rounded-none bg-secondary [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full'
                />
                <span class='w-9 tabular-nums'>{formatTime(displayDuration())}</span>
              </div>

              <div class='grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3'>
                <div class='flex shrink-0 items-center gap-1'>
                  <button
                    type='button'
                    class='hover:bg-accent inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md disabled:opacity-50'
                    disabled={!hasPreviousAudio()}
                    aria-label='Previous track'
                    onClick={() => session.dispatch({ type: 'previous' })}
                  >
                    <StepBack class='h-4 w-4' stroke-width={2} />
                  </button>
                  <button
                    type='button'
                    aria-label={playback().desiredPlaying ? 'Pause' : 'Play'}
                    class='bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md'
                    onClick={() => session.dispatch({ type: 'toggle' })}
                  >
                    <Show when={playback().desiredPlaying} fallback={<Play class='h-4 w-4' />}>
                      <Pause class='h-4 w-4' />
                    </Show>
                  </button>
                  <button
                    type='button'
                    class='hover:bg-accent inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md disabled:opacity-50'
                    disabled={!hasNextAudio()}
                    aria-label='Next track'
                    onClick={() => session.dispatch({ type: 'next' })}
                  >
                    <StepForward class='h-4 w-4' stroke-width={2} />
                  </button>
                  <button
                    type='button'
                    aria-label={playback().repeat ? 'Disable repeat' : 'Enable repeat'}
                    aria-pressed={playback().repeat}
                    class={
                      playback().repeat
                        ? 'bg-primary text-primary-foreground inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md'
                        : 'hover:bg-accent inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md'
                    }
                    onClick={() => session.dispatch({ type: 'toggleRepeat' })}
                  >
                    <Repeat class='h-4 w-4' stroke-width={2} />
                  </button>
                </div>

                <div class='flex min-w-0 items-center justify-end gap-2'>
                  <Show when={isVideoFile()}>
                    <button
                      type='button'
                      class='border-input bg-background hover:bg-accent inline-flex h-8 shrink-0 items-center gap-1 rounded-md border px-2 text-xs'
                      onClick={handleShowVideo}
                    >
                      <Monitor class='h-4 w-4' stroke-width={2} />
                      Show video
                    </button>
                  </Show>

                  <div class='ml-1 flex min-w-0 max-w-32 flex-1 items-center gap-2'>
                    <button
                      type='button'
                      aria-label={playback().muted ? 'Unmute' : 'Mute'}
                      class='hover:bg-accent inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md'
                      onClick={() =>
                        session.dispatch({ type: 'setMuted', muted: !playback().muted })
                      }
                    >
                      <Show when={playback().muted} fallback={<Volume2 class='h-4 w-4' />}>
                        <VolumeX class='h-4 w-4' />
                      </Show>
                    </button>
                    <input
                      type='range'
                      aria-label='Volume'
                      aria-valuetext={`${Math.round((playback().muted ? 0 : playback().volume) * 100)} percent`}
                      min={0}
                      max={1}
                      step={0.01}
                      value={playback().muted ? 0 : playback().volume}
                      onInput={(event) =>
                        session.dispatch({
                          type: 'setVolume',
                          volume: Number.parseFloat(event.currentTarget.value),
                        })
                      }
                      class='[&::-webkit-slider-thumb]:bg-primary h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-none bg-secondary [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full'
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </Show>
  )
}
