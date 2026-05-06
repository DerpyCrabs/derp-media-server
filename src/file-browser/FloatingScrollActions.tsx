import type { Accessor } from 'solid-js'
import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js'
import ArrowUp from 'lucide-solid/icons/arrow-up'
import LocateFixed from 'lucide-solid/icons/locate-fixed'

type Props = {
  playingPath: Accessor<string>
}

function isOutsideViewport(el: HTMLElement) {
  const rect = el.getBoundingClientRect()
  return (
    rect.bottom < 0 ||
    rect.top > window.innerHeight ||
    rect.right < 0 ||
    rect.left > window.innerWidth
  )
}

function playingFileElement(path: string) {
  if (!path || typeof CSS === 'undefined' || typeof CSS.escape !== 'function') return null
  return document.querySelector<HTMLElement>(`[data-file-path="${CSS.escape(path)}"]`)
}

export function FloatingScrollActions(props: Props) {
  const [showPlayingFile, setShowPlayingFile] = createSignal(false)
  const [showVideoTop, setShowVideoTop] = createSignal(false)
  let raf = 0
  let observer: MutationObserver | undefined

  function updateVisibility() {
    cancelAnimationFrame(raf)
    raf = requestAnimationFrame(() => {
      const path = props.playingPath()
      const fileEl = playingFileElement(path)
      setShowPlayingFile(!!path && !!fileEl && isOutsideViewport(fileEl))

      const videoEl = document.querySelector<HTMLElement>('[data-video-player-inline="true"]')
      setShowVideoTop(!!videoEl && isOutsideViewport(videoEl))
    })
  }

  function scrollPlayingFileIntoView() {
    playingFileElement(props.playingPath())?.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
      inline: 'nearest',
    })
  }

  function scrollToVideoPlayer() {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  createEffect(() => {
    props.playingPath()
    updateVisibility()
  })

  onMount(() => {
    window.addEventListener('scroll', updateVisibility, { passive: true })
    window.addEventListener('resize', updateVisibility)
    observer = new MutationObserver(updateVisibility)
    observer.observe(document.body, {
      attributeFilter: ['data-video-player-inline'],
      attributes: true,
      childList: true,
      subtree: true,
    })
    updateVisibility()
  })

  onCleanup(() => {
    cancelAnimationFrame(raf)
    window.removeEventListener('scroll', updateVisibility)
    window.removeEventListener('resize', updateVisibility)
    observer?.disconnect()
  })

  return (
    <Show when={showPlayingFile() || showVideoTop()}>
      <div class='fixed right-3 top-1/2 z-30 flex -translate-y-1/2 flex-col gap-2 sm:right-5'>
        <Show when={showVideoTop()}>
          <button
            type='button'
            class='inline-flex size-10 items-center justify-center rounded-full border border-border bg-background/95 text-foreground shadow-lg backdrop-blur transition-colors hover:bg-muted'
            title='Scroll to video player'
            aria-label='Scroll to video player'
            onClick={scrollToVideoPlayer}
          >
            <ArrowUp class='h-4 w-4' aria-hidden='true' stroke-width={2} />
          </button>
        </Show>
        <Show when={showPlayingFile()}>
          <button
            type='button'
            class='inline-flex size-10 items-center justify-center rounded-full border border-border bg-background/95 text-foreground shadow-lg backdrop-blur transition-colors hover:bg-muted'
            title='Scroll to playing file'
            aria-label='Scroll to playing file'
            onClick={scrollPlayingFileIntoView}
          >
            <LocateFixed class='h-4 w-4' aria-hidden='true' stroke-width={2} />
          </button>
        </Show>
      </div>
    </Show>
  )
}
