import { Show, createEffect, createMemo, createSignal, onCleanup, type JSX } from 'solid-js'
import { createMarkdownRenderer, preprocessObsidianImages } from './text-viewer-markdown'

type Props = {
  content: string
  resolveImageUrl: (src: string) => string | null
}

export function MarkdownPane(props: Props): JSX.Element {
  const [mountEl, setMountEl] = createSignal<HTMLDivElement | null>(null)
  const [expandedSrc, setExpandedSrc] = createSignal<string | null>(null)

  const html = createMemo(() => {
    const md = createMarkdownRenderer(props.resolveImageUrl)
    return md.render(preprocessObsidianImages(props.content))
  })

  createEffect(() => {
    const el = mountEl()
    const h = html()
    if (el) el.innerHTML = h
  })

  createEffect(() => {
    if (!expandedSrc()) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpandedSrc(null)
    }
    window.addEventListener('keydown', onKeyDown)
    onCleanup(() => window.removeEventListener('keydown', onKeyDown))
  })

  return (
    <div class='relative h-full min-h-full overflow-auto p-4'>
      <Show when={expandedSrc()}>
        {(src) => (
          <div
            role='dialog'
            aria-modal='true'
            aria-label='View image fullscreen'
            tabindex={0}
            class='absolute inset-0 z-[100] flex cursor-zoom-out items-center justify-center bg-black/90 p-4'
            onClick={(e) => e.target === e.currentTarget && setExpandedSrc(null)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setExpandedSrc(null)
              }
            }}
          >
            <button
              type='button'
              class='absolute top-4 right-4 z-10 rounded-md p-2 text-white/80 transition-colors hover:bg-white/10 hover:text-white'
              onClick={() => setExpandedSrc(null)}
              aria-label='Close'
            >
              ×
            </button>
            <img
              src={src()}
              alt=''
              class='max-h-full max-w-full cursor-default object-contain'
              draggable={false}
              loading='eager'
            />
          </div>
        )}
      </Show>
      <div
        ref={setMountEl}
        class='prose prose-neutral dark:prose-invert max-w-none [&_img]:max-h-48 [&_img]:max-w-sm [&_img]:cursor-zoom-in [&_img]:object-contain'
        onClick={(e) => {
          const t = e.target
          if (t instanceof HTMLImageElement) {
            e.preventDefault()
            setExpandedSrc(t.currentSrc || t.src)
          }
        }}
      />
    </div>
  )
}
