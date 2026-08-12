import { MediaType, type FileItem } from '@/lib/types'
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
import { Show, createEffect, createMemo, createSignal, on, onCleanup, untrack } from 'solid-js'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { stripSharePrefix } from '@/lib/source-context'
import { navigateSearchParams } from '../../browser-history'
import { buildAudioMetadataUrl, buildMediaUrl, buildThumbnailUrl } from '../../lib/build-media-url'
import { playbackResourceKey } from '../../../lib/playback-session'
import { closePlayer, setAudioOnly as setUrlAudioOnly } from '../../lib/url-state-actions'
import { usePlaybackSession, usePlaybackSnapshot } from './PlaybackProvider'
import { playbackQueueFromFiles } from './items'

let activeMediaSessionOwner: symbol | null = null

type AudioMetadata = {
  title?: string
  artist?: string
  album?: string
  coverArt?: string | null
  duration?: number
}

type Props = Readonly<{
  /** Kept in memory by the authorized presenter; never enters persisted playback state. */
  shareContext?: { token: string; sharePath: string } | null
  offline?: boolean
  files?: readonly FileItem[]
}>

async function fetchAudioMetadata(url: string): Promise<AudioMetadata> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Failed to fetch audio metadata')
  return response.json()
}

function formatTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0:00'
  const minutes = Math.floor(value / 60)
  const seconds = Math.floor(value % 60)
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function parentPath(path: string) {
  return path.replace(/\\/g, '/').split('/').slice(0, -1).join('/')
}

export function PlaybackAudioHost(props: Props) {
  const session = usePlaybackSession()
  const snapshot = usePlaybackSnapshot()
  const [audioEl, setAudioEl] = createSignal<HTMLAudioElement>()
  const [repeatMediaCycle, setRepeatMediaCycle] = createSignal(false)
  const mediaSessionOwner = Symbol('playback-audio-host')
  let boundGeneration = 0
  let boundHref = ''
  let swappingSource = false

  const item = () => snapshot().currentItem
  const handlesAudio = () => {
    const current = item()
    return !!current && (current.media === 'audio' || snapshot().mode === 'audio')
  }
  const share = () => props.shareContext ?? null
  const metadataUrl = () => {
    const current = item()
    return current ? buildAudioMetadataUrl(current.locator, share()) : ''
  }
  const metadataQuery = useQuery(() => ({
    queryKey: [
      ...queryKeys.audioMetadata(item()?.locator ?? ''),
      snapshot().scope.kind,
      (() => {
        const scope = snapshot().scope
        return scope.kind === 'grantSession' ? scope.id : 'owner'
      })(),
      item()?.version ?? '',
    ] as const,
    queryFn: () => fetchAudioMetadata(metadataUrl()),
    enabled: !props.offline && snapshot().online && handlesAudio() && !!metadataUrl(),
    refetchOnWindowFocus: false,
  }))
  const metadata = () => metadataQuery.data
  const folderDir = () => parentPath(item()?.locator ?? '')
  const listingDir = () => {
    const context = share()
    return context ? stripSharePrefix(folderDir(), context.sharePath) : folderDir()
  }
  const folderQuery = useQuery(() => {
    const context = share()
    const dir = listingDir()
    return {
      queryKey: context ? queryKeys.shareFiles(context.token, dir) : queryKeys.files(dir),
      queryFn: () =>
        context
          ? api<{ files: FileItem[] }>(
              `/api/share/${encodeURIComponent(context.token)}/files?dir=${encodeURIComponent(dir)}`,
            )
          : api<{ files: FileItem[] }>(`/api/files?dir=${encodeURIComponent(dir)}`),
      enabled: !props.offline && snapshot().online && handlesAudio() && !!item(),
      refetchOnWindowFocus: false,
    }
  })
  const folderFiles = () =>
    props.files ?? (snapshot().online ? (folderQuery.data?.files ?? []) : [])
  const coverArt = createMemo(() => {
    const current = item()
    if (!current) return null
    if (current.media === 'video' && snapshot().mode === 'audio') {
      return buildThumbnailUrl(current.locator, share())
    }
    if (metadata()?.coverArt) return metadata()!.coverArt!
    const cover = folderFiles().find((file) => {
      if (file.type !== MediaType.IMAGE) return false
      return file.name.toLowerCase().replace(/\.[^.]+$/, '') === 'cover'
    })
    return cover ? buildMediaUrl(cover.path, share()) : null
  })

  function bindMediaSession(element: HTMLAudioElement) {
    if (!('mediaSession' in navigator)) return
    activeMediaSessionOwner = mediaSessionOwner
    navigator.mediaSession.setActionHandler('play', () => session.dispatch({ type: 'play' }))
    navigator.mediaSession.setActionHandler('pause', () => session.dispatch({ type: 'pause' }))
    navigator.mediaSession.setActionHandler('seekbackward', (details) =>
      session.dispatch({
        type: 'seek',
        position: Math.max(0, element.currentTime - (details.seekOffset || 10)),
      }),
    )
    navigator.mediaSession.setActionHandler('seekforward', (details) =>
      session.dispatch({
        type: 'seek',
        position: Math.min(
          element.duration || Number.POSITIVE_INFINITY,
          element.currentTime + (details.seekOffset || 10),
        ),
      }),
    )
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime != null) session.dispatch({ type: 'seek', position: details.seekTime })
    })
    navigator.mediaSession.setActionHandler('previoustrack', () =>
      session.dispatch({ type: 'previous' }),
    )
    navigator.mediaSession.setActionHandler('nexttrack', () => session.dispatch({ type: 'next' }))
  }

  function clearMediaSession() {
    if (!('mediaSession' in navigator) || activeMediaSessionOwner !== mediaSessionOwner) return
    activeMediaSessionOwner = null
    navigator.mediaSession.metadata = null
    try {
      navigator.mediaSession.playbackState = 'none'
    } catch {}
    for (const action of [
      'play',
      'pause',
      'seekbackward',
      'seekforward',
      'seekto',
      'previoustrack',
      'nexttrack',
    ] as const) {
      try {
        navigator.mediaSession.setActionHandler(action, null)
      } catch {}
    }
  }

  onCleanup(() => {
    const element = audioEl()
    const sourceGeneration = boundGeneration
    if (element && sourceGeneration && matchesBoundSource(element)) {
      session.dispatch({
        type: 'time',
        generation: sourceGeneration,
        position: element.currentTime,
        ...(Number.isFinite(element.duration) ? { duration: element.duration } : {}),
      })
    }
    boundGeneration = 0
    boundHref = ''
    swappingSource = true
    if (element) {
      if (!element.paused) element.pause()
      if (element.src) {
        element.removeAttribute('src')
        element.load()
      }
    }
    clearMediaSession()
  })

  const sourceBindingKey = createMemo(() => {
    const state = snapshot()
    return `${audioEl() ? 1 : 0}|${handlesAudio() ? 1 : 0}|${state.source?.generation ?? 0}|${state.source?.url ?? ''}`
  })

  createEffect(
    on(sourceBindingKey, () => {
      const element = audioEl()
      const state = untrack(snapshot)
      if (!element) return
      if (!untrack(handlesAudio) || !state.source) {
        clearMediaSession()
        swappingSource = true
        if (!element.paused) element.pause()
        if (element.src) {
          element.removeAttribute('src')
          element.load()
        }
        boundGeneration = 0
        boundHref = ''
        return
      }

      const source = state.source
      const href = new URL(source.url, window.location.origin).href
      if (boundGeneration === source.generation && element.src === href) return
      swappingSource = true
      if (!element.paused) element.pause()
      boundGeneration = source.generation
      boundHref = href
      const onReady = () => {
        if (boundGeneration !== source.generation) return
        const position = session.getSnapshot().position
        if (position > 0) {
          try {
            element.currentTime = position
          } catch {}
        }
        swappingSource = false
        session.dispatch({ type: 'mediaReady', generation: source.generation })
        if (session.getSnapshot().desiredPlaying) void element.play().catch(() => undefined)
      }
      element.addEventListener('canplay', onReady, { once: true })
      element.src = source.url
      element.load()
      if (state.desiredPlaying) void element.play().catch(() => undefined)
      bindMediaSession(element)
      onCleanup(() => element.removeEventListener('canplay', onReady))
    }),
  )

  createEffect(() => {
    const element = audioEl()
    const state = snapshot()
    if (!element) return
    element.volume = state.volume
    element.muted = state.muted
    if (
      swappingSource ||
      !handlesAudio() ||
      !state.source ||
      boundGeneration !== state.source.generation
    ) {
      return
    }
    const drift = Math.abs(element.currentTime - state.position)
    if (drift > 0.75) {
      try {
        element.currentTime = state.position
      } catch {}
    }
    if (state.desiredPlaying && element.paused) void element.play().catch(() => undefined)
    if (!state.desiredPlaying && !element.paused) element.pause()
  })

  createEffect(() => {
    const state = snapshot()
    const current = state.currentItem
    const listed = folderFiles()
    if (!current || current.media !== 'audio' || listed.length === 0) return
    const queue = playbackQueueFromFiles(
      listed.filter((candidate) => candidate.type === MediaType.AUDIO),
    )
    const currentIndex = queue.findIndex(
      (candidate) =>
        (candidate.ref.libraryId === current.ref.libraryId &&
          candidate.ref.resourceId === current.ref.resourceId) ||
        candidate.locator.replace(/\\/g, '/') === current.locator.replace(/\\/g, '/'),
    )
    if (currentIndex >= 0) queue[currentIndex] = current
    else queue.push(current)
    if (
      state.queue.length === queue.length &&
      state.queue.every((candidate, index) => {
        const next = queue[index]
        return (
          next !== undefined &&
          playbackResourceKey(candidate) === playbackResourceKey(next) &&
          candidate.version === next.version &&
          candidate.locator === next.locator &&
          candidate.name === next.name &&
          candidate.media === next.media
        )
      })
    ) {
      return
    }
    session.dispatch({ type: 'setQueue', queue, current })
  })

  createEffect(() => {
    const current = item()
    if (!current || !handlesAudio() || !('mediaSession' in navigator)) return
    activeMediaSessionOwner = mediaSessionOwner
    const data = metadata()
    const artwork = coverArt()
    navigator.mediaSession.metadata = new MediaMetadata({
      title:
        current.media === 'video' ? `${current.name} (Audio)` : data?.title?.trim() || current.name,
      artist:
        data?.artist?.trim() || (current.media === 'video' ? 'Video audio' : 'Unknown Artist'),
      album: data?.album?.trim() || parentPath(current.locator) || 'Unknown Album',
      ...(artwork
        ? {
            artwork: [
              {
                src: artwork.startsWith('data:') ? artwork : new URL(artwork, location.origin).href,
              },
            ],
          }
        : {}),
    })
  })

  let observedUrlPlayback = ''
  createEffect(() => {
    const current = item()
    if (!current) return
    const signature = `${playbackResourceKey(current)}|${current.version ?? ''}|${current.locator}|${snapshot().mode}`
    if (!observedUrlPlayback) {
      observedUrlPlayback = signature
      return
    }
    if (observedUrlPlayback === signature) return
    observedUrlPlayback = signature
    const params = new URLSearchParams(window.location.search)
    if (!params.has('playing')) return
    const audioOnly = current.media === 'video' && snapshot().mode === 'audio'
    if (
      params.get('playing') !== current.locator ||
      (params.get('audioOnly') === 'true') !== audioOnly
    ) {
      navigateSearchParams(
        { playing: current.locator, audioOnly: audioOnly ? 'true' : null },
        'replace',
      )
    }
  })

  function generation() {
    return boundGeneration
  }

  function matchesBoundSource(element: HTMLAudioElement) {
    if (!boundHref) return false
    return (element.currentSrc || element.src) === boundHref
  }

  function showVideo() {
    session.dispatch({ type: 'setMode', mode: 'video' })
    setUrlAudioOnly(false)
    window.dispatchEvent(new CustomEvent('derp-playback-show-video'))
  }

  function stop() {
    session.dispatch({ type: 'stop' })
    closePlayer()
  }

  return (
    <>
      <audio
        ref={setAudioEl}
        preload='auto'
        class='hidden'
        data-playback-audio-host
        data-workspace-taskbar-media-audio
        onTimeUpdate={(event) => {
          if (swappingSource || !generation() || !matchesBoundSource(event.currentTarget)) return
          const el = event.currentTarget
          session.dispatch({
            type: 'time',
            generation: generation(),
            position: el.currentTime,
            ...(Number.isFinite(el.duration) ? { duration: el.duration } : {}),
          })
        }}
        onDurationChange={(event) => {
          if (!generation() || !matchesBoundSource(event.currentTarget)) return
          session.dispatch({
            type: 'duration',
            generation: generation(),
            duration: event.currentTarget.duration,
          })
        }}
        onPlay={(event) => {
          if (!generation() || !matchesBoundSource(event.currentTarget)) return
          setRepeatMediaCycle(false)
          if ('mediaSession' in navigator && activeMediaSessionOwner === mediaSessionOwner) {
            navigator.mediaSession.playbackState = 'playing'
          }
          session.dispatch({ type: 'mediaPlay', generation: generation() })
        }}
        onPause={(event) => {
          if (
            swappingSource ||
            repeatMediaCycle() ||
            !generation() ||
            !matchesBoundSource(event.currentTarget)
          ) {
            return
          }
          if ('mediaSession' in navigator && activeMediaSessionOwner === mediaSessionOwner) {
            navigator.mediaSession.playbackState = 'paused'
          }
          session.dispatch({ type: 'mediaPause', generation: generation() })
        }}
        onEnded={(event) => {
          if (!generation() || !matchesBoundSource(event.currentTarget)) return
          const repeating = snapshot().repeat
          if (repeating) setRepeatMediaCycle(true)
          session.dispatch({ type: 'mediaEnded', generation: generation() })
          if (repeating) {
            const element = audioEl()
            if (element) {
              try {
                element.currentTime = 0
              } catch {}
              void element.play().catch(() => setRepeatMediaCycle(false))
            }
          }
        }}
        onError={(event) => {
          if (!generation() || !matchesBoundSource(event.currentTarget)) return
          swappingSource = false
          session.dispatch({
            type: 'mediaError',
            generation: generation(),
            message: 'Playback failed. Retry or choose another item.',
          })
        }}
      />

      <Show when={handlesAudio() && item()}>
        <div
          data-testid='audio-player-chrome'
          data-playback-audio-chrome
          data-workspace-taskbar-audio-root
          class='fixed right-0 bottom-0 left-0 z-[100015] border-t border-border bg-background pb-[env(safe-area-inset-bottom,0px)]'
        >
          <div class='relative h-3 min-[650px]:hidden'>
            <div
              class='pointer-events-none absolute top-[5px] left-0 h-px bg-primary'
              style={{
                width: `${snapshot().duration > 0 ? (snapshot().position / snapshot().duration) * 100 : 0}%`,
              }}
            />
            <input
              type='range'
              aria-label='Playback position'
              min={0}
              max={snapshot().duration || 0}
              value={snapshot().position}
              class='absolute inset-0 size-full cursor-pointer opacity-0'
              onInput={(event) =>
                session.dispatch({ type: 'seek', position: Number(event.currentTarget.value) })
              }
            />
          </div>
          <div class='bg-popover mx-auto flex min-h-11 max-w-screen-xl items-center gap-2 px-2 py-1.5 min-[650px]:gap-4 min-[650px]:px-4'>
            <div class='flex shrink-0 items-center gap-0.5'>
              <button
                type='button'
                aria-label='Previous track'
                disabled={snapshot().currentIndex <= 0 && snapshot().position <= 20}
                class='inline-flex size-8 items-center justify-center rounded-md hover:bg-accent disabled:opacity-50 min-[650px]:size-10'
                onClick={() => session.dispatch({ type: 'previous' })}
              >
                <StepBack class='size-4' />
              </button>
              <button
                type='button'
                aria-label={snapshot().desiredPlaying ? 'Pause' : 'Play'}
                class='inline-flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground min-[650px]:size-10'
                onClick={() => session.dispatch({ type: 'toggle' })}
              >
                <Show when={snapshot().desiredPlaying} fallback={<Play class='size-4' />}>
                  <Pause class='size-4' />
                </Show>
              </button>
              <button
                type='button'
                aria-label='Next track'
                disabled={
                  snapshot().currentIndex < 0 ||
                  snapshot().currentIndex + 1 >= snapshot().queue.length
                }
                class='inline-flex size-8 items-center justify-center rounded-md hover:bg-accent disabled:opacity-50 min-[650px]:size-10'
                onClick={() => session.dispatch({ type: 'next' })}
              >
                <StepForward class='size-4' />
              </button>
              <button
                type='button'
                aria-label='Repeat'
                class='inline-flex size-8 items-center justify-center rounded-md hover:bg-accent min-[650px]:size-10'
                classList={{ 'bg-primary text-primary-foreground': snapshot().repeat }}
                onClick={() => session.dispatch({ type: 'toggleRepeat' })}
              >
                <Repeat class='size-4' />
              </button>
              <Show when={item()!.media === 'video'}>
                <button
                  type='button'
                  aria-label='Show video'
                  class='inline-flex size-8 items-center justify-center rounded-md hover:bg-accent min-[650px]:size-10'
                  onClick={showVideo}
                >
                  <Monitor class='size-4' />
                </button>
              </Show>
            </div>

            <div class='hidden min-w-0 flex-1 items-center gap-3 min-[650px]:flex'>
              <span class='w-10 text-right text-xs tabular-nums'>
                {formatTime(snapshot().position)}
              </span>
              <input
                type='range'
                aria-label='Playback position'
                min={0}
                max={snapshot().duration || 0}
                value={snapshot().position}
                class='h-2 min-w-0 flex-1 cursor-pointer appearance-none rounded-lg bg-secondary'
                onInput={(event) =>
                  session.dispatch({ type: 'seek', position: Number(event.currentTarget.value) })
                }
              />
              <span class='w-10 text-xs tabular-nums'>{formatTime(snapshot().duration)}</span>
            </div>

            <button
              type='button'
              aria-label='Open audio controls'
              class='flex min-w-0 flex-1 items-center gap-2 text-left min-[650px]:max-w-72'
            >
              <div class='flex size-9 shrink-0 items-center justify-center overflow-hidden rounded bg-secondary min-[650px]:size-11'>
                <Show
                  when={coverArt()}
                  fallback={<Headphones class='size-4 text-muted-foreground' />}
                >
                  <img src={coverArt()!} alt='Album art' class='size-full object-cover' />
                </Show>
              </div>
              <div class='min-w-0 flex-1'>
                <div class='truncate text-xs font-medium min-[650px]:text-sm'>
                  {metadata()?.title || item()!.name}
                </div>
                <div class='truncate text-[11px] text-muted-foreground'>
                  {metadata()?.artist || 'Unknown Artist'}
                </div>
              </div>
            </button>

            <div class='hidden items-center gap-1 lg:flex'>
              <button
                type='button'
                aria-label={snapshot().muted ? 'Unmute' : 'Mute'}
                class='inline-flex size-9 items-center justify-center rounded-md hover:bg-accent'
                onClick={() => session.dispatch({ type: 'setMuted', muted: !snapshot().muted })}
              >
                <Show when={snapshot().muted} fallback={<Volume2 class='size-4' />}>
                  <VolumeX class='size-4' />
                </Show>
              </button>
              <input
                type='range'
                aria-label='Volume'
                min={0}
                max={1}
                step={0.01}
                value={snapshot().muted ? 0 : snapshot().volume}
                class='w-24'
                onInput={(event) =>
                  session.dispatch({ type: 'setVolume', volume: Number(event.currentTarget.value) })
                }
              />
            </div>
            <button
              type='button'
              aria-label='Stop playback'
              title='Stop playback'
              class='inline-flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent'
              onClick={stop}
            >
              <X class='size-4' />
            </button>
          </div>

          <Show when={snapshot().phase === 'recoverable' || snapshot().phase === 'error'}>
            <div
              role='alert'
              data-testid='playback-recoverable'
              class='border-t border-border bg-card px-3 py-2 text-sm'
            >
              <span>{snapshot().error || 'Playback is temporarily unavailable.'}</span>
              <Show
                when={snapshot().issue === 'versionChanged'}
                fallback={
                  <button
                    class='ml-3 underline'
                    onClick={() => session.dispatch({ type: 'retry' })}
                  >
                    Retry
                  </button>
                }
              >
                <button
                  class='ml-3 underline'
                  onClick={() => session.dispatch({ type: 'acceptVersion' })}
                >
                  Play updated file
                </button>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </>
  )
}
