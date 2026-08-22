import ChevronLeft from 'lucide-solid/icons/chevron-left'
import ChevronRight from 'lucide-solid/icons/chevron-right'
import { Show, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js'
import { createStore } from 'solid-js'
import { buildMediaUrl } from '@/lib/media/build-media-url'
import { ReaderFrame } from '../../ReaderFrame'
import { ReaderOutline, type ReaderOutlineItem } from '../../ReaderOutline'
import { BookAppearanceSettings } from '../../ReaderSettings'
import { useReaderPreferences } from '../../ReaderPreferences'
import { normalizeBookReaderPosition, type BookReaderPosition } from '../../reader-position'
import { createReaderPositionSync } from '../../reader-position-sync'
import type { ReaderSyncedState } from '../../reader-state-client'
import { basename, type ReaderContentProps } from '../../reader-types'
import { BookContent } from './BookContent'
import { parseBook } from './book-parser'
import { renderBook, type RenderedBook } from './book-sanitize'
import { createAsyncValue } from '../../create-async-value'

type LoadedBook = {
  document: RenderedBook
  outline: ReaderOutlineItem[]
}

const allOutlineIds = (items: ReaderOutlineItem[]): string[] =>
  items.flatMap((item) => [item.id, ...allOutlineIds(item.children)])

const firstOutlineTarget = (items: ReaderOutlineItem[]): string | undefined => {
  for (const item of items) {
    if (typeof item.target === 'string') return item.target
    const child = firstOutlineTarget(item.children)
    if (child) return child
  }
  return undefined
}

async function loadBook(path: string, signal: AbortSignal): Promise<LoadedBook> {
  const response = await fetch(buildMediaUrl(path.replace(/\\/g, '/')), {
    credentials: 'include',
    signal,
  })
  if (!response.ok) throw new Error(`Could not open book (${response.status})`)
  const parsed = await parseBook(await response.arrayBuffer(), basename(path))
  const document = renderBook(parsed)
  const map = (items: typeof document.outline): ReaderOutlineItem[] =>
    items.map((item) => ({
      id: item.id,
      label: item.label,
      target: item.chapterId,
      anchor: item.anchor,
      children: map(item.children),
    }))
  return { document, outline: map(document.outline) }
}

export default function BookReader(props: ReaderContentProps) {
  const preferences = useReaderPreferences()
  const book = createAsyncValue(
    () => props.sourcePath,
    loadBook,
    (loaded) => loaded.document.release(),
  )
  const [viewport, setViewport] = createSignal<HTMLDivElement>()
  const [state, setState] = createStore({
    chapterId: '',
    chapterProgress: 0,
    outlineExpanded: [] as string[],
  })
  let restored = false
  let saveTimer: number | undefined
  let blockedUntil = 0

  const positionSync = createReaderPositionSync(
    () => props.sourcePath,
    normalizeBookReaderPosition,
    (position) =>
      ({
        kind: 'book',
        pageIndex: 0,
        scrollTop: viewport()?.scrollTop ?? 0,
        zoom: 1,
        viewMode: 'continuous',
        fitMode: 'manual',
        chapterId: position.chapterId,
        anchor: position.anchor,
        chapterProgress: position.chapterProgress,
        outlineExpanded: position.outlineExpanded,
      }) satisfies ReaderSyncedState,
  )
  const title = createMemo(
    () => book.value()?.document.metadata.title || basename(props.sourcePath),
  )
  const navigationChapterIds = createMemo(() => {
    const targets: string[] = []
    const collect = (items: ReaderOutlineItem[]) => {
      for (const item of items) {
        if (typeof item.target === 'string' && !targets.includes(item.target))
          targets.push(item.target)
        collect(item.children)
      }
    }
    collect(book.value()?.outline ?? [])
    return targets.length
      ? targets
      : (book.value()?.document.chapters.map((chapter) => chapter.id) ?? [])
  })
  const chapterElement = (chapterId: string) =>
    viewport()?.querySelector<HTMLElement>(`[data-book-chapter="${CSS.escape(chapterId)}"]`) ?? null
  const scrollToChapter = (
    chapterId: string,
    anchor?: string,
    behavior: ScrollBehavior = 'auto',
  ) => {
    const element = viewport()
    if (!element) return null
    const chapter = chapterElement(chapterId)
    const target = anchor ? chapter?.querySelector<HTMLElement>(`#${CSS.escape(anchor)}`) : chapter
    if (!target) return chapter
    const viewportRect = element.getBoundingClientRect()
    const targetRect = target.getBoundingClientRect()
    element.scrollTo({
      top: element.scrollTop + targetRect.top - viewportRect.top,
      behavior,
    })
    return target
  }
  const capture = (): BookReaderPosition => {
    const element = viewport()
    const chapter = chapterElement(state.chapterId)
    const viewportTop = element?.getBoundingClientRect().top ?? 0
    const chapterRect = chapter?.getBoundingClientRect()
    const chapterProgress = chapterRect
      ? Math.max(0, Math.min(1, (viewportTop - chapterRect.top) / Math.max(1, chapterRect.height)))
      : state.chapterProgress
    const anchor = chapter
      ? [...chapter.querySelectorAll<HTMLElement>('[id]')].find((candidate) => {
          const top = candidate.getBoundingClientRect().top
          return top >= viewportTop - 4 && top <= viewportTop + 24
        })?.id
      : undefined
    return {
      kind: 'book',
      chapterId: state.chapterId,
      anchor,
      chapterProgress,
      outlineExpanded: [...state.outlineExpanded],
    }
  }
  const applyPosition = (position: BookReaderPosition, smooth = false) => {
    const loaded = book.value()
    if (!loaded) return
    const chapterId =
      position.chapterId ||
      firstOutlineTarget(loaded.outline) ||
      loaded.document.chapters[0]?.id ||
      ''
    setState((draft) => {
      draft.chapterId = chapterId
      draft.chapterProgress = position.chapterProgress
      draft.outlineExpanded = position.outlineExpanded.length
        ? position.outlineExpanded
        : allOutlineIds(loaded.outline)
    })
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const restoreByProgress = position.chapterProgress > 0
        const target = scrollToChapter(
          chapterId,
          restoreByProgress ? undefined : position.anchor,
          smooth ? 'smooth' : 'auto',
        )
        if (restoreByProgress && target && viewport()) {
          viewport()!.scrollTop += target.offsetHeight * position.chapterProgress
        }
      }),
    )
  }
  const persist = async () => {
    window.clearTimeout(saveTimer)
    if (!restored || Date.now() < blockedUntil) return
    const remote = await positionSync.save(capture())
    if (remote) {
      blockedUntil = Date.now() + 1_500
      applyPosition(remote)
    }
  }
  const schedulePersist = () => {
    if (!restored || Date.now() < blockedUntil) return
    window.clearTimeout(saveTimer)
    saveTimer = window.setTimeout(() => untrack(() => void persist()), 1_000)
  }
  const goToChapter = (chapterId: string, anchor?: string) => {
    if (!chapterId) return
    setState((draft) => {
      draft.chapterId = chapterId
      draft.chapterProgress = 0
    })
    requestAnimationFrame(() =>
      requestAnimationFrame(() => scrollToChapter(chapterId, anchor, 'smooth')),
    )
    schedulePersist()
  }
  const adjacentChapter = (offset: number) => {
    const loaded = book.value()
    const navigationIds = navigationChapterIds()
    if (!loaded || !navigationIds.length) return
    const currentIndex = navigationIds.indexOf(state.chapterId)
    let targetIndex = currentIndex + offset
    if (currentIndex < 0) {
      const spineIndex = loaded.document.chapters.findIndex(
        (chapter) => chapter.id === state.chapterId,
      )
      const navigationSpineIndexes = navigationIds.map((id) =>
        loaded.document.chapters.findIndex((chapter) => chapter.id === id),
      )
      targetIndex =
        offset > 0
          ? navigationSpineIndexes.findIndex((index) => index > spineIndex)
          : navigationSpineIndexes.findLastIndex((index) => index < spineIndex)
      if (targetIndex < 0) targetIndex = offset > 0 ? 0 : navigationIds.length - 1
    }
    const target = navigationIds[Math.max(0, Math.min(navigationIds.length - 1, targetIndex))]
    if (target) goToChapter(target)
  }

  createEffect(
    () => ({ ready: positionSync.ready(), position: positionSync.loaded(), loaded: book.value() }),
    ({ ready, position, loaded }) => {
      if (!ready || !loaded || restored) return
      applyPosition(
        position ?? {
          kind: 'book',
          chapterId: '',
          chapterProgress: 0,
          outlineExpanded: allOutlineIds(loaded.outline),
        },
      )
      restored = true
    },
  )
  onCleanup(() => {
    window.clearTimeout(saveTimer)
  })

  const outline = createMemo(() => {
    const items = book.value()?.outline ?? []
    if (!items.length) return undefined
    return (
      <ReaderOutline
        title='Contents'
        items={items}
        active={state.chapterId}
        onNavigate={(target, anchor) => typeof target === 'string' && goToChapter(target, anchor)}
        onClose={() => preferences.setOutlineOpen(false)}
        expanded={state.outlineExpanded}
        onToggle={(id) => {
          setState((draft) => {
            draft.outlineExpanded = draft.outlineExpanded.includes(id)
              ? draft.outlineExpanded.filter((item) => item !== id)
              : [...draft.outlineExpanded, id]
          })
          schedulePersist()
        }}
      />
    )
  })

  return (
    <ReaderFrame
      {...props}
      title={title()}
      selectionModes={['text']}
      settingsWide
      toolbar={
        <div class='flex items-center gap-1'>
          <button
            type='button'
            aria-label='Previous chapter'
            class='grid h-8 w-8 place-items-center rounded-lg border border-[#3a3a3a] bg-[#202020] hover:border-[#777]'
            onClick={() => adjacentChapter(-1)}
          >
            <ChevronLeft size={17} />
          </button>
          <button
            type='button'
            data-testid='reader-book-progress'
            class='flex h-8 w-[clamp(72px,28vw,260px)] min-w-0 items-center justify-center truncate rounded-lg border border-[#3a3a3a] bg-[#181818] px-2 text-sm hover:border-[#777]'
            onClick={() => preferences.setOutlineOpen(true)}
          >
            <span class='truncate'>
              {book.value()?.document.chapters.find((chapter) => chapter.id === state.chapterId)
                ?.title ?? 'Book'}
            </span>
          </button>
          <button
            type='button'
            aria-label='Next chapter'
            class='grid h-8 w-8 place-items-center rounded-lg border border-[#3a3a3a] bg-[#202020] hover:border-[#777]'
            onClick={() => adjacentChapter(1)}
          >
            <ChevronRight size={17} />
          </button>
        </div>
      }
      settings={() => (
        <BookAppearanceSettings
          value={preferences.bookAppearance()}
          onChange={preferences.setBookAppearance}
        />
      )}
      outline={outline()}
      onViewport={setViewport}
      onScroll={(element) => {
        const top = element.getBoundingClientRect().top + 8
        const chapters = [...element.querySelectorAll<HTMLElement>('[data-book-chapter]')]
        const atEnd = element.scrollHeight - element.clientHeight - element.scrollTop <= 2
        const current = atEnd
          ? chapters.at(-1)
          : chapters.find((chapter) => chapter.getBoundingClientRect().bottom > top)
        if (current?.dataset.bookChapter) {
          setState((draft) => {
            draft.chapterId = current.dataset.bookChapter!
          })
          const rect = current.getBoundingClientRect()
          setState((draft) => {
            draft.chapterProgress = Math.max(
              0,
              Math.min(1, (top - rect.top) / Math.max(1, rect.height)),
            )
          })
        }
        schedulePersist()
      }}
      onKeyDown={(event, element) => {
        if (event.key !== 'PageUp' && event.key !== 'PageDown') return false
        event.preventDefault()
        element.scrollBy({
          top: (event.key === 'PageDown' ? 1 : -1) * element.clientHeight,
        })
        return true
      }}
      beforeClose={persist}
      content={() => (
        <>
          <Show when={book.loading()}>
            <div class='flex h-full items-center justify-center text-sm text-white/60'>
              Opening...
            </div>
          </Show>
          <Show when={book.error()}>
            <div
              role='alert'
              class='flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-red-300'
            >
              <p>
                {book.error() instanceof Error
                  ? (book.error() as Error).message
                  : 'Could not open document'}
              </p>
              <a
                class='rounded border border-white/25 px-3 py-1.5 text-sm text-white hover:border-white/60'
                href={buildMediaUrl(props.sourcePath.replace(/\\/g, '/'))}
                download
              >
                Download original
              </a>
            </div>
          </Show>
          <Show when={book.value()}>
            {(loaded) => (
              <Show when={viewport()}>
                {(activeViewport) => (
                  <BookContent
                    document={loaded().document}
                    appearance={preferences.bookAppearance()}
                    currentChapterId={state.chapterId}
                    viewport={activeViewport()}
                    onNavigate={goToChapter}
                  />
                )}
              </Show>
            )}
          </Show>
        </>
      )}
    />
  )
}
