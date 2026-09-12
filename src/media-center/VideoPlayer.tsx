import StepBack from 'lucide-solid/icons/step-back'
import StepForward from 'lucide-solid/icons/step-forward'
import {
  getDefaultPosition,
  floatingVideoPositionStore,
  validatePosition,
} from '@/media-center/floating-video-position'
import Headphones from 'lucide-solid/icons/headphones'
import Maximize2 from 'lucide-solid/icons/maximize-2'
import Minimize2 from 'lucide-solid/icons/minimize-2'
import X from 'lucide-solid/icons/x'
import { Show, createEffect, createMemo, createSignal, untrack } from 'solid-js'
import {
  usePlaybackMediaHost,
  usePlaybackSession,
  usePlaybackSnapshot,
} from '@/features/playback/PlaybackProvider'
import { closePlayer, setAudioOnly } from '@/lib/browser/url-state-actions'
import { VideoControls } from '@/features/playback/VideoControls'
import { useStoreSync } from '@/lib/state/solid-store-sync'

export function VideoPlayer() {
  const session = usePlaybackSession()
  const snapshot = usePlaybackSnapshot()
  const mediaHost = usePlaybackMediaHost()
  const currentItem = createMemo(() => snapshot().currentItem)
  const isVideoFile = createMemo(
    () => currentItem()?.media === 'video' && snapshot().mode === 'video',
  )
  const fileName = createMemo(() => currentItem()?.name ?? '')

  const [isMinimized, setIsMinimized] = createSignal(false)
  const positionTick = useStoreSync(floatingVideoPositionStore)
  const position = createMemo(() => {
    void positionTick()
    return { ...floatingVideoPositionStore.getState().position }
  })
  const [videoEl, setVideoEl] = createSignal<HTMLVideoElement>()
  const [containerEl, setContainerEl] = createSignal<HTMLDivElement>()

  createEffect(
    () => ({ element: containerEl(), minimized: isMinimized() }),
    ({ element, minimized }) => {
      if (!element || !minimized) return undefined
      const constrain = () =>
        untrack(() => {
          const store = floatingVideoPositionStore.getState()
          const current = store.position
          const next = validatePosition(current, element.getBoundingClientRect())
          if (next.x !== current.x || next.y !== current.y) store.setPosition(next)
        })
      const resize = new ResizeObserver(constrain)
      resize.observe(element)
      window.addEventListener('resize', constrain)
      constrain()
      return () => {
        resize.disconnect()
        window.removeEventListener('resize', constrain)
      }
    },
  )

  createEffect(
    () => {
      const element = videoEl()
      return element && isVideoFile() ? element : null
    },
    (element) => {
      if (!element) return undefined
      const detach = mediaHost.attach(element, 'video')
      // eslint-disable-next-line solid/reactivity
      return detach
    },
  )

  function checkpointVideo() {
    const element = videoEl()
    const state = session.getSnapshot()
    if (!element || !state.source || state.mode !== 'video') return
    session.dispatch({
      type: 'mediaTime',
      generation: state.source.generation,
      position: element.currentTime,
      ...(Number.isFinite(state.duration) ? { duration: state.duration } : {}),
    })
    session.dispatch({ type: 'checkpoint' })
  }

  function toggleMinimize() {
    const next = !isMinimized()
    setIsMinimized(next)

    if (next && typeof window !== 'undefined') {
      const store = floatingVideoPositionStore.getState()
      const current = store.position
      const validated = validatePosition(current)
      if (current.x === 0 && current.y === 0) {
        store.setPosition(getDefaultPosition())
      } else if (validated.x !== current.x || validated.y !== current.y) {
        store.setPosition(validated)
      }
    } else if (!next && typeof window !== 'undefined') {
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
    }
  }

  function handleAudioOnly() {
    if (!currentItem()) return
    checkpointVideo()
    session.dispatch({ type: 'setMode', mode: 'audio' })
    session.dispatch({ type: 'play' })
    setAudioOnly(true)
  }

  function handleClose() {
    session.dispatch({ type: 'stop' })
    closePlayer()
    setIsMinimized(false)
  }

  const containerClass = () =>
    isMinimized() ? 'fixed z-40 w-80 max-w-[calc(100vw-2rem)]' : 'w-full bg-background'

  const containerStyle = (): Record<string, string | undefined> => {
    if (!isMinimized()) return {}
    const current = position()
    return { left: `${current.x}px`, top: `${current.y}px` }
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
  createEffect(
    () => {
      const path = currentItem()?.locator ?? null
      return path && isVideoFile() && !isMinimized() ? path : null
    },
    (path) => {
      if (!path || lastScrolledPlayingPath === path) return
      lastScrolledPlayingPath = path
      requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
    },
  )

  return (
    <Show when={isVideoFile() && currentItem()}>
      <div
        ref={setContainerEl}
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
                <Show when={snapshot().queue.length > 1}>
                  <button
                    type='button'
                    class='inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted disabled:opacity-40'
                    aria-label='Previous video'
                    disabled={snapshot().currentIndex === 0 && snapshot().position <= 20}
                    onClick={() => session.dispatch({ type: 'previous' })}
                  >
                    <StepBack size={16} />
                  </button>
                  <button
                    type='button'
                    class='inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted disabled:opacity-40'
                    aria-label='Next video'
                    disabled={snapshot().currentIndex >= snapshot().queue.length - 1}
                    onClick={() => session.dispatch({ type: 'next' })}
                  >
                    <StepForward size={16} />
                  </button>
                </Show>
                <button
                  type='button'
                  class='inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted'
                  onClick={handleAudioOnly}
                  aria-label='Audio only mode'
                >
                  <Headphones class='h-4 w-4' size={16} stroke-width={2} />
                </button>
                <button
                  type='button'
                  class='inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted'
                  onClick={toggleMinimize}
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
                  onClick={handleClose}
                  aria-label='Close player'
                >
                  <X class='h-4 w-4' size={16} stroke-width={2} />
                </button>
              </div>
            </div>
            <div class='video-surface relative w-full bg-black' style={videoAreaStyle()}>
              <video
                data-playback-source={snapshot().source?.url}
                ref={setVideoEl}
                playsinline
                tabindex='0'
                class='h-full w-full bg-black object-contain'
              />
              <VideoControls
                path={() => currentItem()?.locator ?? ''}
                video={videoEl}
                active={isVideoFile}
              />
            </div>
          </div>
        </div>
      </div>
    </Show>
  )
}
