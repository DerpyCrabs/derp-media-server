import { domBinding, entities, list, component, view, type Snapshot } from 'effectweb'
import type { RenderedBook } from './book-sanitize'
import type { BookAppearance } from '../../reader-state-client'
type ChapterProps = {
  chapter: RenderedBook['chapters'][number]
  index: number
  currentIndex: number
  viewport: HTMLElement
  estimatedHeight: number
  onMeasure: (index: number, height: number) => void
}
const chapterObserver = (
  element: HTMLElement,
  current: () => {
    props: Snapshot<ChapterProps>
    near: boolean
    changed: (visible: boolean) => void
    measured: (height: number) => void
  },
) => {
  const observer = new IntersectionObserver(
    ([entry]) => current().changed(Boolean(entry?.isIntersecting)),
    { root: current().props.viewport, rootMargin: '1200px 0px', threshold: 0.01 },
  )
  observer.observe(element)
  let frame = 0
  const resize = new ResizeObserver(() => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      const model = current()
      if (model.near && element.offsetHeight > 80) {
        model.measured(element.offsetHeight)
        model.props.onMeasure(model.props.index, element.offsetHeight)
      }
    })
  })
  resize.observe(element)
  return () => {
    observer.disconnect()
    resize.disconnect()
    cancelAnimationFrame(frame)
  }
}
const chapterHtml = (element: HTMLDivElement, current: () => string) => {
  let previous: string | undefined
  const update = () => {
    const html = current()
    if (previous === html) return
    previous = html
    const template = document.createElement('template')
    template.innerHTML = html
    element.replaceChildren(template.content.cloneNode(true))
  }
  update()
  return { update, dispose: () => {} }
}
const Chapter = component<ChapterProps, { intersecting: boolean; height: number | undefined }>(
  {
    init: () => ({ intersecting: false, height: undefined }),
    identity: (props) => props.chapter.id,
  },
  view((model, patch) => {
    const props = model.props
    const near = Math.abs(props.index - props.currentIndex) <= 2 || model.intersecting
    return (
      <article
        use={domBinding(
          {
            props,
            near,
            changed: (intersecting: boolean) => patch({ intersecting }),
            measured: (height: number) => patch({ height }),
          },
          chapterObserver,
        )}
        id={`reader-${props.chapter.id}`}
        data-book-chapter={props.chapter.id}
        aria-label={props.chapter.title}
        class='book-chapter mx-auto w-full scroll-mt-3 px-5 py-8 sm:px-10'
        style={{ 'min-height': near ? undefined : `${model.height ?? props.estimatedHeight}px` }}
      >
        {near ? <div use={domBinding(props.chapter.html, chapterHtml)} /> : null}
      </article>
    )
  }),
)
type Props = {
  document: RenderedBook
  appearance: BookAppearance
  currentChapterId: string
  positionReady: boolean
  viewport: HTMLElement
  onNavigate: (chapterId: string, anchor?: string, recordHistory?: boolean) => void
}
export const BookContent = component<Props, { measured: Record<number, number> }>(
  { init: () => ({ measured: {} }) },
  view((model, patch) => {
    const props = model.props
    let height = 0,
      characters = 0
    for (const [rawIndex, measuredHeight] of Object.entries(model.measured)) {
      const chapter = props.document.chapters[Number(rawIndex)]
      if (chapter && chapter.textLength >= 100) {
        height += Math.max(0, measuredHeight - 64)
        characters += chapter.textLength
      }
    }
    const fontScale = props.appearance.fontScale ?? 1
    const pixelsPerCharacter =
      characters > 0
        ? height / characters
        : (16 * fontScale * (props.appearance.lineHeight ?? 1.65) * 8 * fontScale) / 688
    const currentIndex = Math.max(
      0,
      props.document.chapters.findIndex((chapter) => chapter.id === props.currentChapterId),
    )
    const className = [
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
        aria-busy={props.positionReady ? 'false' : 'true'}
        class={className}
        style={{
          '--book-font-scale': String(fontScale),
          '--book-line-height': String(props.appearance.lineHeight ?? 1.65),
          '--book-content-width': props.appearance.contentWidth === 'narrow' ? '48rem' : '64rem',
        }}
        onClick={(event) => {
          const link = (event.target as Element).closest<HTMLAnchorElement>('a')
          if (!link || link.dataset.external === 'true' || !link.dataset.chapterId) return
          event.preventDefault()
          props.onNavigate(link.dataset.chapterId, link.dataset.anchor, true)
        }}
      >
        <style>{props.document.css}</style>
        {list(entities(props.document.chapters), (chapter) => {
          const index = props.document.chapters.indexOf(chapter)
          return (
            <Chapter
              chapter={chapter}
              index={index}
              currentIndex={currentIndex}
              viewport={props.viewport}
              estimatedHeight={
                model.measured[index] ??
                Math.max(680, Math.ceil(64 + chapter.textLength * pixelsPerCharacter))
              }
              onMeasure={(index, height) => {
                if (model.measured[index] !== height)
                  patch({ measured: { ...model.measured, [index]: height } })
              }}
            />
          )
        })}
      </div>
    )
  }),
)
