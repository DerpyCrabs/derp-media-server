import { For, Show, createMemo, createSignal, onSettled } from 'solid-js'
import type { RenderedBook } from './book-sanitize'
import type { BookAppearance } from '../../reader-state-client'

function Chapter(props: {
  chapter: RenderedBook['chapters'][number]
  index: number
  currentIndex: number
  viewport: HTMLElement
  estimatedHeight: number
  onMeasure: (index: number, height: number) => void
}) {
  let host: HTMLElement | undefined
  const [intersecting, setIntersecting] = createSignal(false)
  const [height, setHeight] = createSignal<number>()

  const isNear = () => Math.abs(props.index - props.currentIndex) <= 2
  const near = () => isNear() || intersecting()

  onSettled(() => {
    if (!host) return undefined
    const chapterHost = host
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        setIntersecting(entry.isIntersecting)
      },
      { root: props.viewport, rootMargin: '1200px 0px', threshold: 0.01 },
    )
    observer.observe(chapterHost)
    let frame = 0
    const resize = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (near() && chapterHost.offsetHeight > 80) {
          const nextHeight = chapterHost.offsetHeight
          setHeight(nextHeight)
          props.onMeasure(props.index, nextHeight)
        }
      })
    })
    resize.observe(host)
    return () => {
      observer.disconnect()
      resize.disconnect()
      cancelAnimationFrame(frame)
    }
  })

  return (
    <article
      ref={(element) => {
        host = element
      }}
      id={`reader-${props.chapter.id}`}
      data-book-chapter={props.chapter.id}
      aria-label={props.chapter.title}
      class='book-chapter mx-auto w-full scroll-mt-3 px-5 py-8 sm:px-10'
      style={{ 'min-height': near() ? undefined : `${height() ?? props.estimatedHeight}px` }}
    >
      <Show when={near()}>
        <div
          ref={(element) => {
            const template = document.createElement('template')
            template.innerHTML = props.chapter.html
            element.replaceChildren(template.content.cloneNode(true))
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
  const [measuredHeights, setMeasuredHeights] = createSignal<Record<number, number>>({})
  const pixelsPerCharacter = createMemo(() => {
    let height = 0
    let characters = 0
    for (const [rawIndex, measuredHeight] of Object.entries(measuredHeights())) {
      const chapter = props.document.chapters[Number(rawIndex)]
      if (!chapter || chapter.textLength < 100) continue
      height += Math.max(0, measuredHeight - 64)
      characters += chapter.textLength
    }
    if (characters > 0) return height / characters

    const width = Math.min(
      props.viewport.clientWidth,
      props.appearance.contentWidth === 'narrow'
        ? 768
        : props.appearance.contentWidth === 'wide'
          ? 1024
          : props.viewport.clientWidth,
    )
    const fontScale = props.appearance.fontScale ?? 1
    const lineHeight = props.appearance.lineHeight ?? 1.65
    const usableWidth = Math.max(240, width - 80)
    return (16 * fontScale * lineHeight * 8 * fontScale) / usableWidth
  })
  const estimatedHeight = (index: number) => {
    const measured = measuredHeights()[index]
    if (measured !== undefined) return measured
    const textLength = props.document.chapters[index]?.textLength ?? 0
    return Math.max(680, Math.ceil(64 + textLength * pixelsPerCharacter()))
  }
  const recordHeight = (index: number, height: number) => {
    setMeasuredHeights((current) =>
      current[index] === height ? current : { ...current, [index]: height },
    )
  }
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
      props.appearance.contentWidth !== 'full' && 'book-custom-width',
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
        '--book-content-width': props.appearance.contentWidth === 'narrow' ? '48rem' : '64rem',
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
      <style>{props.document.css}</style>
      <For each={props.document.chapters}>
        {(chapter, index) => (
          <Chapter
            chapter={chapter}
            index={index()}
            currentIndex={currentIndex()}
            viewport={props.viewport}
            estimatedHeight={estimatedHeight(index())}
            onMeasure={recordHeight}
          />
        )}
      </For>
    </div>
  )
}
