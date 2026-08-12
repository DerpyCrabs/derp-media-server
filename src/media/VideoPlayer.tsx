import {
  getDefaultPosition,
  useVideoPlayerPosition,
  validatePosition,
} from '@/lib/use-video-player-position'
import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  untrack,
} from 'solid-js'
import Headphones from 'lucide-solid/icons/headphones'
import Maximize2 from 'lucide-solid/icons/maximize-2'
import Minimize2 from 'lucide-solid/icons/minimize-2'
import X from 'lucide-solid/icons/x'
import { createUrlSearchParamsMemo, useBrowserHistory } from '../browser-history'
import { closePlayer, setAudioOnly } from '../lib/url-state-actions'
import { usePlaybackSession, usePlaybackSnapshot } from './playback/PlaybackProvider'

type Props = {
  shareContext?: { token: string; sharePath: string } | null
}

const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'm4v']

export function VideoPlayer(props: Props) {
  void props.shareContext
  const playbackSession = usePlaybackSession()
  const playbackSnapshot = usePlaybackSnapshot()
  const history = useBrowserHistory()
  const urlSearchParams = createUrlSearchParamsMemo(history)

  const playingPath = createMemo(
    () => playbackSnapshot().currentItem?.locator ?? urlSearchParams().get('playing'),
  )

  const audioOnly = createMemo(() => urlSearchParams().get('audioOnly') === 'true')

  const extension = createMemo(() => (playingPath() || '').split('.').pop()?.toLowerCase() || '')
  const isVideoFile = createMemo(() => {
    const item = playbackSnapshot().currentItem
    if (item) return item.media === 'video' && playbackSnapshot().mode === 'video'
    return !!playingPath() && VIDEO_EXTENSIONS.includes(extension()) && !audioOnly()
  })

  const mediaUrl = createMemo(() => {
    return playbackSnapshot().source?.url ?? ''
  })
  const recovery = createMemo(() => {
    const state = playbackSnapshot()
    return state.phase === 'recoverable' || state.phase === 'error' ? state : null
  })

  const fileName = createMemo(() => (playingPath() || '').split('/').pop() || '')

  const [isMinimized, setIsMinimized] = createSignal(false)
  const [position, setPositionView] = createSignal(useVideoPlayerPosition.getState().position)

  onMount(() => {
    const unsub = useVideoPlayerPosition.subscribe((s) => {
      setPositionView(s.position)
    })
    onCleanup(unsub)
  })

  const [videoEl, setVideoEl] = createSignal<HTMLVideoElement | undefined>()
  let boundGeneration = 0
  let boundHref = ''
  let bindingReady = false
  let suppressPause = false
  let suppressPauseTimer: number | undefined

  const sourceBindingKey = createMemo(() => {
    const source = playbackSnapshot().source
    return `${videoEl() ? 1 : 0}|${isVideoFile() ? 1 : 0}|${source?.generation ?? 0}|${source?.url ?? ''}`
  })

  function pauseForHandoff(video: HTMLVideoElement) {
    if (video.paused) return
    suppressPause = true
    video.pause()
    if (suppressPauseTimer !== undefined) window.clearTimeout(suppressPauseTimer)
    suppressPauseTimer = window.setTimeout(() => {
      suppressPause = false
      suppressPauseTimer = undefined
    }, 250)
  }

  createEffect(
    on(sourceBindingKey, () => {
      const vid = videoEl()
      const state = untrack(playbackSnapshot)
      const source = state.source
      if (!vid) return
      if (!untrack(isVideoFile) || !source) {
        persistPlaybackTime(vid)
        pauseForHandoff(vid)
        if (vid.src) {
          vid.removeAttribute('src')
          vid.load()
        }
        boundGeneration = 0
        boundHref = ''
        bindingReady = false
        return
      }

      const targetHref = new URL(source.url, window.location.origin).href
      if (boundGeneration === source.generation && vid.src === targetHref) return
      persistPlaybackTime(vid)
      pauseForHandoff(vid)
      boundGeneration = source.generation
      boundHref = targetHref
      bindingReady = false

      const onCanPlay = () => {
        if (boundGeneration !== source.generation || !matchesBoundSource(vid)) return
        const position = playbackSession.getSnapshot().position
        if (position > 0) {
          try {
            vid.currentTime = position
          } catch {}
        }
        bindingReady = true
        playbackSession.dispatch({ type: 'mediaReady', generation: source.generation })
        if (playbackSession.getSnapshot().desiredPlaying) void vid.play().catch(() => {})
      }
      vid.addEventListener('canplay', onCanPlay, { once: true })
      vid.src = source.url
      vid.load()
      if (state.desiredPlaying) void vid.play().catch(() => {})
      onCleanup(() => vid.removeEventListener('canplay', onCanPlay))
    }),
  )

  createEffect(() => {
    const state = playbackSnapshot()
    const vid = videoEl()
    if (!vid || !isVideoFile() || !state.source || boundGeneration !== state.source.generation) {
      return
    }
    vid.volume = state.volume
    vid.muted = state.muted
    if (state.desiredPlaying && vid.paused) void vid.play().catch(() => {})
    if (!state.desiredPlaying && !vid.paused) pauseForHandoff(vid)
  })

  function toggleMinimize() {
    const next = !isMinimized()
    setIsMinimized(next)

    if (next && typeof window !== 'undefined') {
      const store = useVideoPlayerPosition.getState()
      const pos = store.position
      const validatedPos = validatePosition(pos)
      if (pos.x === 0 && pos.y === 0) {
        store.setPosition(getDefaultPosition())
      } else if (validatedPos.x !== pos.x || validatedPos.y !== pos.y) {
        store.setPosition(validatedPos)
      }
    } else if (!next && typeof window !== 'undefined') {
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
    }
  }

  function handleAudioOnly() {
    const vid = videoEl()
    const path = playingPath()
    if (!path) return
    if (vid) {
      persistPlaybackTime(vid)
      bindingReady = false
      pauseForHandoff(vid)
    }
    setAudioOnly(true)
    playbackSession.dispatch({ type: 'setMode', mode: 'audio' })
  }

  function handleClose() {
    const vid = videoEl()
    if (vid) {
      persistPlaybackTime(vid)
      bindingReady = false
      pauseForHandoff(vid)
      vid.removeAttribute('src')
      vid.load()
    }
    playbackSession.dispatch({ type: 'stop' })
    closePlayer()
    setIsMinimized(false)
  }

  function recoverPlayback() {
    playbackSession.dispatch({
      type: playbackSnapshot().issue === 'versionChanged' ? 'acceptVersion' : 'retry',
    })
  }

  function persistPlaybackTime(video: HTMLVideoElement) {
    if (!bindingReady || !boundGeneration || !matchesBoundSource(video)) return
    playbackSession.dispatch({
      type: 'time',
      generation: boundGeneration,
      position: video.currentTime,
      ...(Number.isFinite(video.duration) ? { duration: video.duration } : {}),
    })
  }

  function matchesBoundSource(video: HTMLVideoElement) {
    return !!boundHref && (video.currentSrc || video.src) === boundHref
  }

  onCleanup(() => {
    const vid = videoEl()
    if (vid) {
      persistPlaybackTime(vid)
      bindingReady = false
      pauseForHandoff(vid)
      vid.removeAttribute('src')
      vid.load()
    }
    boundGeneration = 0
    boundHref = ''
    if (suppressPauseTimer !== undefined) window.clearTimeout(suppressPauseTimer)
  })

  const containerClass = () => (isMinimized() ? 'fixed z-40 w-80' : 'w-full bg-background')

  const containerStyle = (): Record<string, string | undefined> => {
    if (!isMinimized()) return {}
    const p = position()
    return { left: `${p.x}px`, top: `${p.y}px` }
  }

  const videoAreaStyle = (): Record<string, string | undefined> => {
    if (isMinimized()) {
      return {
        'max-height': '180px',
        'min-height': '180px',
        height: '180px',
      }
    }
    return { 'max-height': '70vh', 'aspect-ratio': '16 / 9' }
  }

  let lastScrolledPlayingPath: string | null = null

  createEffect(() => {
    const path = playingPath()
    if (!path || !isVideoFile() || isMinimized()) return
    if (lastScrolledPlayingPath === path) return
    lastScrolledPlayingPath = path
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
  })

  return (
    <Show when={isVideoFile() && playingPath()}>
      <div
        class={containerClass()}
        style={containerStyle()}
        data-video-player-inline={isMinimized() ? undefined : 'true'}
      >
        <div
          class={isMinimized() ? 'overflow-hidden rounded-lg border border-border shadow-lg' : ''}
        >
          <div class='bg-black'>
            <div class='border-border z-10 flex items-center justify-between border-b bg-background/90 p-2 backdrop-blur-sm'>
              <span class='flex-1 truncate px-2 text-sm font-medium'>{fileName()}</span>
              <div class='flex items-center gap-1'>
                <button
                  type='button'
                  class='inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted'
                  onClick={() => handleAudioOnly()}
                  aria-label='Audio only mode'
                >
                  <Headphones class='h-4 w-4' size={16} stroke-width={2} />
                </button>
                <button
                  type='button'
                  class='inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted'
                  onClick={() => toggleMinimize()}
                  aria-label={isMinimized() ? 'Maximize player' : 'Minimize player'}
                >
                  <Show
                    when={isMinimized()}
                    fallback={<Minimize2 class='h-4 w-4' size={16} stroke-width={2} />}
                  >
                    <Maximize2 class='h-4 w-4' size={16} stroke-width={2} />
                  </Show>
                </button>
                <button
                  type='button'
                  class='inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted'
                  onClick={() => handleClose()}
                  aria-label='Close player'
                >
                  <X class='h-4 w-4' size={16} stroke-width={2} />
                </button>
              </div>
            </div>
            <video
              ref={(el) => {
                setVideoEl(el ?? undefined)
              }}
              controls
              class='w-full bg-black'
              style={videoAreaStyle()}
              onTimeUpdate={(event) => persistPlaybackTime(event.currentTarget)}
              onVolumeChange={(event) => {
                if (!boundGeneration || !matchesBoundSource(event.currentTarget)) return
                playbackSession.dispatch({
                  type: 'setVolume',
                  volume: event.currentTarget.volume,
                })
                playbackSession.dispatch({
                  type: 'setMuted',
                  muted: event.currentTarget.muted,
                })
              }}
              onPause={(event) => {
                persistPlaybackTime(event.currentTarget)
                if (suppressPause) {
                  suppressPause = false
                  return
                }
                if (boundGeneration && matchesBoundSource(event.currentTarget)) {
                  playbackSession.dispatch({ type: 'mediaPause', generation: boundGeneration })
                }
              }}
              onPlay={(event) => {
                suppressPause = false
                if (boundGeneration && matchesBoundSource(event.currentTarget)) {
                  playbackSession.dispatch({ type: 'mediaPlay', generation: boundGeneration })
                }
              }}
              onEnded={(event) => {
                if (boundGeneration && matchesBoundSource(event.currentTarget)) {
                  playbackSession.dispatch({ type: 'mediaEnded', generation: boundGeneration })
                }
              }}
              onError={(event) => {
                if (boundGeneration && matchesBoundSource(event.currentTarget)) {
                  playbackSession.dispatch({
                    type: 'mediaError',
                    generation: boundGeneration,
                    message: 'Video playback failed.',
                  })
                }
              }}
            >
              Your browser does not support the video tag.
            </video>
            <Show when={recovery()} keyed>
              {(state) => (
                <div
                  role='alert'
                  data-testid='video-playback-recoverable'
                  class='flex items-center justify-between gap-3 border-t border-border bg-card px-3 py-2 text-sm'
                >
                  <span>{state.error ?? 'Playback is temporarily unavailable.'}</span>
                  <button type='button' class='shrink-0 underline' onClick={recoverPlayback}>
                    {state.issue === 'versionChanged' ? 'Play updated file' : 'Retry'}
                  </button>
                </div>
              )}
            </Show>
          </div>
        </div>
      </div>
    </Show>
  )
}
