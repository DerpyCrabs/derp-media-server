import { domBinding, component, view } from 'effectweb'
import ArrowUp from '@effectweb/lucide/icons/arrow-up'
import LocateFixed from '@effectweb/lucide/icons/locate-fixed'
import { getVirtualFileScroller } from './virtual-directory-scroll'
type Props = { playingPath: string; scrollScope?: string }
const outside = (element: HTMLElement) => {
  const rect = element.getBoundingClientRect()
  return (
    rect.bottom < 0 ||
    rect.top > window.innerHeight ||
    rect.right < 0 ||
    rect.left > window.innerWidth
  )
}
const playingElement = (path: string) =>
  path ? document.querySelector<HTMLElement>(`[data-file-path="${CSS.escape(path)}"]`) : null
const visibilityBinding = (
  _element: HTMLDivElement,
  current: () => {
    path: string
    scope?: string
    playing: boolean
    video: boolean
    patch: (state: { playing: boolean; video: boolean }) => void
  },
) => {
  let frame = 0
  const update = () => {
    const state = current()
    const file = playingElement(state.path)
    const playing =
      !!state.path &&
      (file ? outside(file) : !!getVirtualFileScroller(state.scope)?.hasPath(state.path))
    const videoElement = document.querySelector<HTMLElement>('[data-video-player-inline="true"]')
    const video = !!videoElement && outside(videoElement)
    if (playing !== state.playing || video !== state.video) state.patch({ playing, video })
  }
  const schedule = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(update)
  }
  const observer = new MutationObserver(schedule)
  observer.observe(document.body, {
    attributeFilter: ['data-video-player-inline'],
    attributes: true,
    childList: true,
    subtree: true,
  })
  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule)
  schedule()
  return {
    update: schedule,
    dispose: () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
    },
  }
}
export const FloatingScrollActions = component(
  { init: (_props: Props) => ({ playing: false, video: false }) },
  view((model, patch) => {
    const path = model.props.playingPath
    const scope = model.props.scrollScope
    return (
      <div
        use={domBinding(
          { path, scope, playing: model.playing, video: model.video, patch },
          visibilityBinding,
        )}
        class='fixed right-3 top-1/2 z-30 flex -translate-y-1/2 flex-col gap-2 sm:right-5'
      >
        {model.video ? (
          <button
            type='button'
            class='inline-flex size-10 items-center justify-center rounded-full border border-border bg-background/95 text-foreground shadow-lg backdrop-blur transition-colors hover:bg-muted'
            title='Scroll to video player'
            aria-label='Scroll to video player'
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          >
            <ArrowUp class='h-4 w-4' aria-hidden='true' />
          </button>
        ) : null}
        {model.playing ? (
          <button
            type='button'
            class='inline-flex size-10 items-center justify-center rounded-full border border-border bg-background/95 text-foreground shadow-lg backdrop-blur transition-colors hover:bg-muted'
            title='Scroll to playing file'
            aria-label='Scroll to playing file'
            onClick={() => {
              const file = playingElement(path)
              if (file)
                file.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
              else getVirtualFileScroller(scope)?.scrollToPath(path)
            }}
          >
            <LocateFixed class='h-4 w-4' aria-hidden='true' />
          </button>
        ) : null}
      </div>
    )
  }),
)
