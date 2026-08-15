import { For, Show, createEffect, createSignal, onSettled } from 'solid-js'
import type { RenderedBook } from './book-sanitize'
import type { BookAppearance } from './reader-state-client'

function Chapter(props: {
  chapter: RenderedBook['chapters'][number]
  index: number
  currentIndex: number
  viewport: HTMLElement
}) {
  let host: HTMLElement | undefined
  const [contentElement, setContentElement] = createSignal<HTMLDivElement>()
  const [near, setNear] = createSignal(false)
  const [height, setHeight] = createSignal(680)

  const isNear = () => Math.abs(props.index - props.currentIndex) <= 2

  createEffect(
    () => isNear(),
    (nearEnough) => {
      if (nearEnough) setNear(true)
    },
  )

  onSettled(() => {
    if (!host) return undefined
    const chapterHost = host
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        if (entry.isIntersecting) {
          setNear(true)
        } else if (Math.abs(props.index - props.currentIndex) > 2) setNear(false)
      },
      { root: props.viewport, rootMargin: '1200px 0px', threshold: 0.01 },
    )
    observer.observe(chapterHost)
    const resize = new ResizeObserver(() => {
      if (near() && chapterHost.offsetHeight > 80) setHeight(chapterHost.offsetHeight)
    })
    resize.observe(host)
    return () => {
      observer.disconnect()
      resize.disconnect()
    }
  })

  createEffect(
    () => {
      const element = contentElement()
      return near() && element ? { element, html: props.chapter.html } : null
    },
    (content) => {
      if (!content) return
      const template = document.createElement('template')
      template.innerHTML = content.html
      content.element.replaceChildren(template.content.cloneNode(true))
    },
  )

  return (
    <article
      ref={(element) => {
        host = element
      }}
      id={`reader-${props.chapter.id}`}
      data-book-chapter={props.chapter.id}
      aria-label={props.chapter.title}
      class='book-chapter mx-auto w-full scroll-mt-3 px-5 py-8 sm:px-10'
      style={{ 'min-height': near() ? undefined : `${height()}px` }}
    >
      <Show when={near()}>
        <div
          ref={(element) => {
            setContentElement(element)
          }}
        />
      </Show>
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
  let publisherStyle: HTMLStyleElement | undefined
  createEffect(
    () => props.document.css,
    (css) => {
      if (publisherStyle) publisherStyle.textContent = css
    },
  )
  const currentIndex = () =>
    Math.max(
      0,
      props.document.chapters.findIndex((chapter) => chapter.id === props.currentChapterId),
    )
  const documentClass = () =>
    [
      'book-document',
      `book-theme-${props.appearance.theme}`,
      'min-h-full',
      props.appearance.fontFamily === 'serif' && 'font-serif',
      props.appearance.fontFamily === 'sans' && 'font-sans',
      props.appearance.fontScale !== null && 'book-custom-font-size',
      props.appearance.lineHeight !== null && 'book-custom-line-height',
      props.appearance.contentWidth !== null && 'book-custom-width',
    ]
      .filter(Boolean)
      .join(' ')
  return (
    <div
      data-testid='reader-book'
      class={documentClass()}
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
      <style
        ref={(element) => {
          publisherStyle = element
        }}
      />
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
