import { For, createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import type { RenderedBook } from './book-sanitize'
import type { BookAppearance } from './reader-state-client'

function Chapter(props: {
  chapter: RenderedBook['chapters'][number]
  index: number
  currentIndex: number
  viewport: HTMLElement
}) {
  let host!: HTMLElement
  let content!: HTMLDivElement
  const [near, setNear] = createSignal(Math.abs(props.index - props.currentIndex) <= 2)
  const [height, setHeight] = createSignal(680)

  onMount(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        if (entry.isIntersecting) {
          setNear(true)
        } else if (Math.abs(props.index - props.currentIndex) > 2) setNear(false)
      },
      { root: props.viewport, rootMargin: '1200px 0px', threshold: 0.01 },
    )
    observer.observe(host)
    const resize = new ResizeObserver(() => {
      if (near() && host.offsetHeight > 80) setHeight(host.offsetHeight)
    })
    resize.observe(host)
    onCleanup(() => {
      observer.disconnect()
      resize.disconnect()
    })
  })

  createEffect(() => {
    if (Math.abs(props.index - props.currentIndex) <= 2) setNear(true)
  })

  createEffect(() => {
    if (!near() || !content) return
    const template = document.createElement('template')
    template.innerHTML = props.chapter.html
    content.replaceChildren(template.content.cloneNode(true))
  })

  return (
    <article
      ref={host}
      id={`reader-${props.chapter.id}`}
      data-book-chapter={props.chapter.id}
      aria-label={props.chapter.title}
      class='book-chapter mx-auto w-full scroll-mt-3 px-5 py-8 sm:px-10'
      style={{ 'min-height': near() ? undefined : `${height()}px` }}
    >
      {near() ? <div ref={content} /> : null}
    </article>
  )
}

export function BookContent(props: {
  document: RenderedBook
  appearance: BookAppearance
  currentChapterId: string
  viewport: HTMLElement
  onNavigate: (chapterId: string, anchor?: string, recordHistory?: boolean) => void
}) {
  let publisherStyle!: HTMLStyleElement
  createEffect(() => {
    if (publisherStyle) publisherStyle.textContent = props.document.css
  })
  const currentIndex = () =>
    Math.max(
      0,
      props.document.chapters.findIndex((chapter) => chapter.id === props.currentChapterId),
    )
  return (
    <div
      data-testid='reader-book'
      class={`book-document book-theme-${props.appearance.theme} min-h-full`}
      classList={{
        'font-serif': props.appearance.fontFamily === 'serif',
        'font-sans': props.appearance.fontFamily === 'sans',
        'book-custom-font-size': props.appearance.fontScale !== null,
        'book-custom-line-height': props.appearance.lineHeight !== null,
        'book-custom-width': props.appearance.contentWidth !== null,
      }}
      style={{
        '--book-font-scale': String(props.appearance.fontScale ?? 1),
        '--book-line-height': String(props.appearance.lineHeight ?? 1.65),
        '--book-content-width': `${props.appearance.contentWidth ?? 48}rem`,
      }}
      onClick={(event) => {
        const link = (event.target as Element).closest<HTMLAnchorElement>('a')
        if (!link || link.dataset.external === 'true') return
        const chapterId = link.dataset.chapterId
        if (!chapterId) return
        event.preventDefault()
        props.onNavigate(chapterId, link.dataset.anchor, true)
      }}
    >
      <style ref={publisherStyle} />
      <For each={props.document.chapters}>
        {(chapter, index) => (
          <Chapter
            chapter={chapter}
            index={index()}
            currentIndex={currentIndex()}
            viewport={props.viewport}
          />
        )}
      </For>
    </div>
  )
}
