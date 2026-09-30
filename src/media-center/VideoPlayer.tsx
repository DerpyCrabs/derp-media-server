import StepBack from '@effectweb/lucide/icons/step-back'
import StepForward from '@effectweb/lucide/icons/step-forward'
import {
  getDefaultPosition,
  floatingVideoPosition,
  validatePosition,
} from '@/media-center/floating-video-position'
import Headphones from '@effectweb/lucide/icons/headphones'
import Maximize2 from '@effectweb/lucide/icons/maximize-2'
import Minimize2 from '@effectweb/lucide/icons/minimize-2'
import X from '@effectweb/lucide/icons/x'
import { domBinding, modelOwner, view, controllerView } from 'effectweb'
import {
  getPlaybackMediaHost,
  getPlaybackSession,
  playbackSource,
} from '@/features/playback/PlaybackProvider'
import { closePlayer, setAudioOnly } from '@/lib/browser/url-state-actions'
import { VideoControls } from '@/features/playback/VideoControls'
const videoBinding = (
  element: HTMLVideoElement,
  data: () => { set: (element: HTMLVideoElement | undefined) => void },
) => {
  const detach = getPlaybackMediaHost().attach(element, 'video')
  data().set(element)
  return () => {
    detach()
    data().set(undefined)
  }
}
const containFloating = (element: HTMLDivElement, data: () => { minimized: boolean }) => {
  const constrain = () => {
    if (!data().minimized) return
    const state = floatingVideoPosition.read()
    const next = validatePosition(state.position, element.getBoundingClientRect())
    if (next.x !== state.position.x || next.y !== state.position.y)
      floatingVideoPosition.setPosition(next)
  }
  const observer = new ResizeObserver(constrain)
  observer.observe(element)
  window.addEventListener('resize', constrain)
  constrain()
  return {
    update: constrain,
    dispose() {
      observer.disconnect()
      window.removeEventListener('resize', constrain)
    },
  }
}
export const VideoPlayer = controllerView({
  create: (_props: Record<string, never>) => {
    const owner = modelOwner({
      snapshot: playbackSource.model(),
      position: floatingVideoPosition.source.model().position,
      minimized: false,
      video: undefined as HTMLVideoElement | undefined,
    })
    const actions = {
      toggleMinimize,
      handleAudioOnly,
      handleClose,
      setVideo: (video: HTMLVideoElement | undefined): void => owner.patch({ video }),
    }
    const session = getPlaybackSession()
    let lastPath: string | null = null
    let scrollFrame = 0
    function update() {
      const state = playbackSource.model()
      owner.patch({ snapshot: state })
      const path = state.currentItem?.locator ?? null
      if (path && state.mode === 'video' && !owner.read().minimized && path !== lastPath) {
        lastPath = path
        cancelAnimationFrame(scrollFrame)
        scrollFrame = requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
      }
    }
    owner.own(playbackSource.subscribe(update))
    owner.own(floatingVideoPosition.source.subscribe(({ position }) => owner.patch({ position })))
    owner.own(() => cancelAnimationFrame(scrollFrame))
    function toggleMinimize() {
      const next = !owner.read().minimized
      owner.patch({ minimized: next })
      if (next) {
        const store = floatingVideoPosition.read()
        const current = store.position
        const validated = validatePosition(current)
        if (current.x === 0 && current.y === 0)
          floatingVideoPosition.setPosition(getDefaultPosition())
        else if (validated.x !== current.x || validated.y !== current.y)
          floatingVideoPosition.setPosition(validated)
      } else {
        cancelAnimationFrame(scrollFrame)
        scrollFrame = requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }))
      }
    }
    function handleAudioOnly() {
      const element = owner.read().video
      const state = session.getSnapshot()
      if (element && state.source && state.mode === 'video') {
        session.dispatch({
          type: 'mediaTime',
          generation: state.source.generation,
          position: element.currentTime,
          ...(Number.isFinite(state.duration) ? { duration: state.duration } : {}),
        })
        session.dispatch({ type: 'checkpoint' })
      }
      session.dispatch({ type: 'setMode', mode: 'audio' })
      session.dispatch({ type: 'play' })
      setAudioOnly(true)
    }
    function handleClose() {
      session.dispatch({ type: 'stop' })
      closePlayer()
      owner.patch({ minimized: false })
    }
    update()
    return { source: owner.source, actions, dispose: owner.dispose, close: owner.close }
  },
  view: view((model) => {
    const snapshot = () => model.snapshot
    const currentItem = () => model.snapshot.currentItem
    const isVideoFile = () => currentItem()?.media === 'video' && model.snapshot.mode === 'video'
    const fileName = () => currentItem()?.name ?? ''
    const position = () => model.position
    const { toggleMinimize, handleAudioOnly, handleClose } = model.actions
    const session = {
      dispatch: (command: Parameters<ReturnType<typeof getPlaybackSession>['dispatch']>[0]) =>
        void getPlaybackSession().dispatch(command),
    }
    const containerClass = () =>
      model.minimized ? 'fixed z-40 w-80 max-w-[calc(100vw-2rem)]' : 'w-full bg-background'
    const containerStyle = (): Record<string, string | undefined> => {
      if (!model.minimized) return {}
      const current = position()
      return { left: `${current.x}px`, top: `${current.y}px` }
    }
    const videoAreaStyle = (): Record<string, string | undefined> => {
      if (model.minimized) {
        return { 'max-height': '180px', 'min-height': '180px', height: '180px' }
      }
      return { 'max-height': '70vh', 'aspect-ratio': '16 / 9' }
    }
    return isVideoFile() && currentItem() ? (
      <div
        use={domBinding({ minimized: model.minimized }, containFloating)}
        class={containerClass()}
        style={containerStyle()}
        data-video-player-inline={model.minimized ? undefined : 'true'}
      >
        <div
          class={model.minimized ? 'overflow-hidden rounded-lg border border-border shadow-lg' : ''}
        >
          <div class='bg-black'>
            <div class='border-border z-10 flex items-center justify-between border-b bg-background/90 p-2 backdrop-blur-sm'>
              <span class='flex-1 truncate px-2 text-sm font-medium'>{fileName()}</span>
              <div class='flex items-center gap-1'>
                {snapshot().queue.length > 1 ? (
                  <>
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
                  </>
                ) : null}
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
                  aria-label={model.minimized ? 'Maximize player' : 'Minimize player'}
                >
                  {model.minimized ? (
                    <Maximize2 class='h-4 w-4' size={16} stroke-width={2} />
                  ) : (
                    <Minimize2 class='h-4 w-4' size={16} stroke-width={2} />
                  )}
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
                use={domBinding({ set: model.actions.setVideo }, videoBinding)}
                playsinline
                tabindex={0}
                class='h-full w-full bg-black object-contain'
              />
              <VideoControls
                path={currentItem()?.locator ?? ''}
                video={model.video}
                active={isVideoFile()}
              />
            </div>
          </div>
        </div>
      </div>
    ) : null
  }),
})
