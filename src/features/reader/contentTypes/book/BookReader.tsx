import { list } from 'effectweb'
import { readResponseBytes } from '@/lib/files/response-bytes'
import Search from '@effectweb/lucide/icons/search'
import { DocumentSearchBar } from '../../DocumentSearchBar'
import { findDocumentMatches, type DocumentMatch } from '../../document-search'
import { nextAnimationFrame } from '@/lib/browser/animation-frame'
import ChevronLeft from '@effectweb/lucide/icons/chevron-left'
import ChevronRight from '@effectweb/lucide/icons/chevron-right'
import { Effect, Semaphore } from 'effect'
import { modelOwner, view, controllerView } from 'effectweb'

import { buildMediaUrl } from '@/lib/media/build-media-url'
import { ReaderFrame } from '../../ReaderFrame'
import { ReaderOutline, type ReaderOutlineItem } from '../../ReaderOutline'
import { BookAppearanceSettings } from '../../ReaderSettings'
import { readerPreferences } from '../../ReaderPreferences'
import { normalizeBookReaderPosition, type BookReaderPosition } from '../../reader-position'
import { createReaderPositionSync } from '../../reader-position-sync'

import { basename, type ReaderContentProps } from '../../reader-types'
import { BookContent } from './BookContent'
import { parseBook } from './book-parser'
import { bookProgress } from './book-progress'
import { renderBook, type RenderedBook } from './book-sanitize'

type LoadedBook = { document: RenderedBook; outline: ReaderOutlineItem[] }

const allOutlineIds = (items: readonly ReaderOutlineItem[]): string[] =>
  items.flatMap((item) => [item.id, ...allOutlineIds(item.children)])

const firstOutlineTarget = (items: readonly ReaderOutlineItem[]): string | undefined => {
  for (const item of items) {
    if (typeof item.target === 'string') return item.target
    const child = firstOutlineTarget(item.children)
    if (child) return child
  }
  return undefined
}

function loadBook(path: string): Effect.Effect<LoadedBook, unknown> {
  return Effect.gen(function* () {
    const bytes = yield* Effect.tryPromise({
      try: async (signal) => {
        const response = await fetch(buildMediaUrl(path.replace(/\\/g, '/')), {
          credentials: 'include',
          signal,
        })
        if (!response.ok) throw new Error(`Could not open book (${response.status})`)
        return readResponseBytes(response, (/\.(docx|odt)$/i.test(path) ? 64 : 100) * 1024 * 1024)
      },
      catch: (error) => error,
    })
    const parsed = yield* parseBook(bytes, basename(path))
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
  })
}

const loadSlot = 'book-load'
const positionSlot = 'book-position-load'
const saveSlot = 'book-save'
const debounceSlot = 'book-save-debounce'
const navigateSlot = 'book-navigate'
function bookController(props: ReaderContentProps) {
  const saveGate = Semaphore.makeUnsafe(1)
  let released: (() => void) | undefined
  let viewport: HTMLDivElement | undefined
  let pendingPosition: BookReaderPosition | null = null
  let restored = false
  let loadedPosition: BookReaderPosition | null | undefined
  let closing = false
  let finalPosition: BookReaderPosition | undefined
  let version = 0
  const owner = modelOwner({
    props,
    book: null as LoadedBook | null,
    loading: true,
    error: '',
    searchOpen: false,
    searchQuery: '',
    matches: [] as DocumentMatch[],
    matchIndex: -1,
    searchTruncated: false,
    searching: false,
    position: normalizeBookReaderPosition({}),
    positionReady: false,
    viewport: undefined as HTMLDivElement | undefined,
    preferences: readerPreferences.read(),
  })
  const textCache = new Map<number, string>()
  const actions = {
    openSearch: () => {
      const query = owner.read().searchQuery
      owner.patch({ searchOpen: true })
      viewport
        ?.closest('[data-testid="reader-dialog"]')
        ?.querySelector<HTMLInputElement>('[role="search"] input')
        ?.focus()
      if (query) actions.search(query)
    },
    closeSearch: () => {
      owner.cancel('book-search')
      owner.patch({ searchOpen: false, searching: false, matches: [], matchIndex: -1 })
      viewport?.focus()
    },
    search: (query: string) => {
      owner.patch({
        searchQuery: query,
        matches: [],
        matchIndex: -1,
        searching: Boolean(query.trim()),
      })
      owner.run(
        'book-search',
        Effect.gen(function* () {
          if (!query.trim()) return
          yield* Effect.sleep(150)
          const chapters = owner.read().book?.document.chapters ?? []
          const matches: DocumentMatch[] = []
          for (let index = 0; index < chapters.length; index++) {
            let text = textCache.get(index)
            if (text === undefined) {
              const template = document.createElement('template')
              template.innerHTML = chapters[index]!.html
              text = template.content.textContent ?? ''
              textCache.set(index, text)
            }
            matches.push(...findDocumentMatches(text, query, index, 10001 - matches.length))
            if (matches.length > 10000) break
            if (index % 8 === 0) yield* nextAnimationFrame
          }
          owner.patch({
            matches: matches.slice(0, 10000),
            searchTruncated: matches.length > 10000,
            matchIndex: matches.length ? 0 : -1,
            searching: false,
          })
          if (matches[0]) actions.navigate(chapters[matches[0].page]!.id)
        }),
        'replace',
      )
    },
    nextMatch: (offset: number) => {
      const model = owner.read()
      if (!model.matches.length || !model.book) return
      const matchIndex = (model.matchIndex + offset + model.matches.length) % model.matches.length
      owner.patch({ matchIndex })
      actions.navigate(model.book.document.chapters[model.matches[matchIndex]!.page]!.id)
    },
    attach: (element: HTMLDivElement) => {
      if (viewport === element) return
      viewport = element
      owner.patch({ viewport: element })
      if (pendingPosition) apply(pendingPosition)
    },
    navigate: (chapterId: string, anchor?: string, progress = 0) => {
      if (chapterId)
        apply({
          kind: 'book',
          chapterId,
          anchor,
          chapterProgress: progress,
          outlineExpanded: [...owner.read().position.outlineExpanded],
        })
    },
    adjacent: (offset: number) => adjacent(offset),
    toggle: (id: string) => {
      const position = owner.read().position
      owner.patch({
        position: {
          ...position,
          outlineExpanded: position.outlineExpanded.includes(id)
            ? position.outlineExpanded.filter((item) => item !== id)
            : [...position.outlineExpanded, id],
        },
      })
      schedule()
    },
    scroll: (element: HTMLDivElement) => {
      if (!owner.read().positionReady) return
      version++
      const top = element.getBoundingClientRect().top + 8
      const chapters = [...element.querySelectorAll<HTMLElement>('[data-book-chapter]')]
      const atEnd = element.scrollHeight - element.clientHeight - element.scrollTop <= 2
      const current = atEnd
        ? chapters.at(-1)
        : chapters.find((chapter) => chapter.getBoundingClientRect().bottom > top)
      if (current?.dataset.bookChapter) {
        const rect = current.getBoundingClientRect()
        owner.patch({
          position: {
            ...owner.read().position,
            chapterId: current.dataset.bookChapter,
            chapterProgress: Math.max(0, Math.min(1, (top - rect.top) / Math.max(1, rect.height))),
          },
        })
      }
      schedule()
    },
    persist: () =>
      Effect.gen(function* () {
        owner.cancel(debounceSlot)
        yield* owner.awaitIdle(saveSlot)
        yield* persist()
      }),
  }
  const sync = createReaderPositionSync(
    props.sourcePath,
    normalizeBookReaderPosition,
    (position) => ({
      kind: 'book',
      pageIndex: 0,
      scrollTop: viewport?.scrollTop ?? 0,
      zoom: 1,
      viewMode: 'continuous',
      fitMode: 'manual',
      chapterId: position.chapterId,
      anchor: position.anchor,
      chapterProgress: position.chapterProgress,
      progress: bookProgress(
        owner.read().book?.document.chapters ?? [],
        position.chapterId,
        position.chapterProgress,
      ),
      outlineExpanded: position.outlineExpanded,
    }),
  )
  const capture = (): BookReaderPosition => {
    const state = owner.read().position
    if (pendingPosition) return { ...pendingPosition, outlineExpanded: [...state.outlineExpanded] }
    const chapters = viewport
      ? [...viewport.querySelectorAll<HTMLElement>('[data-book-chapter]')]
      : []
    const top = viewport?.getBoundingClientRect().top ?? 0
    const chapter =
      chapters.find((chapter) => chapter.getBoundingClientRect().bottom > top + 8) ??
      chapters.at(-1)
    const rect = chapter?.getBoundingClientRect()
    const anchor = chapter
      ? [...chapter.querySelectorAll<HTMLElement>('[id]')].find((candidate) => {
          const y = candidate.getBoundingClientRect().top
          return y >= top - 4 && y <= top + 24
        })?.id
      : undefined
    return {
      kind: 'book',
      chapterId: chapter?.dataset.bookChapter ?? state.chapterId,
      anchor,
      chapterProgress: rect
        ? Math.max(0, Math.min(1, (top - rect.top) / Math.max(1, rect.height)))
        : state.chapterProgress,
      outlineExpanded: [...state.outlineExpanded],
    }
  }
  const apply = (position: BookReaderPosition) => {
    const loaded = owner.read().book
    if (!loaded) return
    const chapterId =
      position.chapterId ||
      firstOutlineTarget(loaded.outline) ||
      loaded.document.chapters[0]?.id ||
      ''
    const next = {
      ...position,
      chapterId,
      outlineExpanded: position.outlineExpanded.length
        ? position.outlineExpanded
        : allOutlineIds(loaded.outline),
    }
    version++
    pendingPosition = next
    owner.patch({ position: next, positionReady: false })
    if (!viewport) return
    owner.run(
      navigateSlot,
      Effect.gen(function* () {
        yield* nextAnimationFrame
        viewport
          ?.querySelector<HTMLElement>(`[data-book-chapter="${CSS.escape(chapterId)}"]`)
          ?.getBoundingClientRect()
        yield* Effect.promise(() => document.fonts.ready)
        if (!viewport) return
        const chapter = viewport.querySelector<HTMLElement>(
          `[data-book-chapter="${CSS.escape(chapterId)}"]`,
        )
        const target =
          position.chapterProgress > 0 || !position.anchor
            ? chapter
            : chapter?.querySelector<HTMLElement>(`#${CSS.escape(position.anchor)}`)
        if (target)
          viewport.scrollTo({
            top:
              viewport.scrollTop +
              target.getBoundingClientRect().top -
              viewport.getBoundingClientRect().top +
              (position.chapterProgress > 0
                ? target.getBoundingClientRect().height * position.chapterProgress
                : 0),
            behavior: 'instant',
          })
        pendingPosition = null
        restored = true
        owner.patch({ positionReady: true })
        schedule()
      }),
      'replace',
    )
  }
  const persist = () => {
    return saveGate.withPermit(
      Effect.gen(function* () {
        if (!restored) return
        const position = finalPosition ?? capture()
        const savedVersion = version
        const remote = yield* sync.save(position)
        if (remote && !closing && !owner.disposed && version === savedVersion) apply(remote)
      }),
    )
  }
  const schedule = () => {
    if (!closing && restored && owner.read().positionReady)
      owner.run(
        debounceSlot,
        Effect.sleep(1000).pipe(
          Effect.andThen(Effect.sync(() => owner.run(saveSlot, persist(), 'latest-queued'))),
        ),
        'replace',
      )
  }
  const adjacent = (offset: number) => {
    const model = owner.read(),
      loaded = model.book
    if (!loaded) return
    const ids: string[] = []
    const collect = (items: readonly ReaderOutlineItem[]) => {
      for (const item of items) {
        if (typeof item.target === 'string' && !ids.includes(item.target)) ids.push(item.target)
        collect(item.children)
      }
    }
    collect(loaded.outline)
    if (!ids.length) ids.push(...loaded.document.chapters.map((chapter) => chapter.id))
    let index = ids.indexOf(model.position.chapterId)
    if (index < 0) {
      const spine = loaded.document.chapters.findIndex(
        (chapter) => chapter.id === model.position.chapterId,
      )
      const indexes = ids.map((id) =>
        loaded.document.chapters.findIndex((chapter) => chapter.id === id),
      )
      index =
        offset > 0
          ? indexes.findIndex((index) => index > spine) - offset
          : indexes.findLastIndex((index) => index < spine) - offset
    }
    const target = ids[Math.max(0, Math.min(ids.length - 1, index + offset))]
    if (target) actions.navigate(target)
  }
  owner.own(
    readerPreferences.source.subscribe((model) => owner.patch({ preferences: model.preferences })),
  )
  const restoreInitial = () => {
    const book = owner.read().book
    if (!book || loadedPosition === undefined || restored || pendingPosition) return
    apply(
      loadedPosition ?? {
        kind: 'book',
        chapterId: '',
        chapterProgress: 0,
        outlineExpanded: allOutlineIds(book.outline),
      },
    )
  }
  owner.run(
    positionSlot,
    sync.load.pipe(
      Effect.tap((position) =>
        Effect.sync(() => {
          loadedPosition = position
          restoreInitial()
        }),
      ),
    ),
    'replace',
  )
  owner.run(
    loadSlot,
    loadBook(props.sourcePath).pipe(
      Effect.tap((book) =>
        Effect.sync(() => {
          released = book.document.release
          owner.patch({ book, loading: false })
          restoreInitial()
        }),
      ),
      Effect.catch((error) =>
        Effect.sync(() => owner.patch({ loading: false, error: String(error) })),
      ),
    ),
    'replace',
  )
  return {
    source: owner.source,
    ...actions,
    receive: (next: ReaderContentProps) => owner.patch({ props: next }),
    beforeDispose: () => {
      finalPosition = capture()
    },
    lifetime: {
      close: () => {
        closing = true
        const save = persist()
        owner.cancel(debounceSlot)
        owner.cancel(navigateSlot)
        return owner
          .awaitIdle(saveSlot)
          .pipe(
            Effect.andThen(save),
            Effect.ensuring(owner.close().pipe(Effect.orDie)),
            Effect.ensuring(Effect.sync(() => released?.())),
          )
      },
      dispose: () => {
        owner.dispose()
        released?.()
      },
    },
  }
}
const BookReader = controllerView(
  { controller: bookController, identity: (props) => props.sourcePath },
  view((model) => {
    const props = model.props,
      actions = model.actions,
      state = model.position
    const loaded = model.book
    const officeDocument = /\.(docx|odt)$/i.test(props.sourcePath)
    return (
      <ReaderFrame
        {...props}
        title={loaded?.document.metadata.title || basename(props.sourcePath)}
        selectionModes={['text']}
        settingsWide
        toolbar={
          <div class='flex items-center gap-1'>
            <button
              type='button'
              aria-label='Previous chapter'
              class='grid h-8 w-8 place-items-center rounded-lg border border-[#3a3a3a] bg-[#202020] hover:border-[#777]'
              onClick={() => actions.adjacent(-1)}
            >
              <ChevronLeft size={17} />
            </button>
            <button
              type='button'
              data-testid='reader-book-progress'
              class='flex h-8 w-[clamp(72px,28vw,260px)] min-w-0 items-center justify-center truncate rounded-lg border border-[#3a3a3a] bg-[#181818] px-2 text-sm hover:border-[#777]'
              onClick={() => readerPreferences.patch({ outlineOpen: true })}
            >
              <span class='truncate'>
                {loaded?.document.chapters.find((chapter) => chapter.id === state.chapterId)
                  ?.title ?? (officeDocument ? 'Document' : 'Book')}
              </span>
            </button>
            <button
              type='button'
              aria-label='Next chapter'
              class='grid h-8 w-8 place-items-center rounded-lg border border-[#3a3a3a] bg-[#202020] hover:border-[#777]'
              onClick={() => actions.adjacent(1)}
            >
              <ChevronRight size={17} />
            </button>
            {loaded ? (
              <button
                type='button'
                aria-label='Find in document'
                title='Find in document (Ctrl/Cmd+F)'
                class='inline-flex size-8 shrink-0 items-center justify-center rounded hover:bg-white/10'
                onClick={actions.openSearch}
              >
                <Search size={17} />
              </button>
            ) : null}
          </div>
        }
        onFind={loaded ? actions.openSearch : undefined}
        onEscape={() => {
          if (!model.searchOpen) return false
          actions.closeSearch()
          return true
        }}
        search={
          <>
            {model.searchOpen ? (
              <DocumentSearchBar
                query={model.searchQuery}
                searching={model.searching}
                truncated={model.searchTruncated}
                matches={model.matches}
                index={model.matchIndex}
                location={
                  loaded?.document.chapters[model.matches[model.matchIndex]?.page ?? 0]?.title ??
                  'Chapter'
                }
                onSearch={actions.search}
                onNext={actions.nextMatch}
                onClose={actions.closeSearch}
              />
            ) : null}
            {officeDocument ? (
              <div class='flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-neutral-900 px-3 py-1.5 text-xs text-white/70'>
                <details>
                  <summary class='cursor-pointer'>Reading preview · Layout may differ</summary>
                  <div class='max-w-xl py-2'>
                    <p>
                      Text, tables and embedded images are shown in a reading layout. Page breaks,
                      headers, footers, comments and some formatting are omitted. Open the original
                      for exact layout or editing.
                    </p>
                    {list(loaded?.document.notices ?? [], (notice) => (
                      <p>{notice}</p>
                    ))}
                  </div>
                </details>
                <a
                  class='shrink-0 underline hover:text-white'
                  href={`/api/files/download?path=${encodeURIComponent(props.sourcePath)}`}
                  download
                >
                  Download original
                </a>
              </div>
            ) : null}
          </>
        }
        settings={() => (
          <BookAppearanceSettings
            value={model.preferences.bookAppearance}
            onChange={(bookAppearance) => readerPreferences.patch({ bookAppearance })}
          />
        )}
        outline={(navigation) => (
          <ReaderOutline
            title='Contents'
            navigation={navigation}
            items={loaded?.outline ?? []}
            active={state.chapterId}
            onNavigate={(target, anchor) =>
              typeof target === 'string' && actions.navigate(target, anchor)
            }
            onClose={() => readerPreferences.patch({ outlineOpen: false })}
            expanded={state.outlineExpanded}
            onToggle={actions.toggle}
          />
        )}
        hasContents={!!loaded?.outline.length}
        notePlace={(anchor) => {
          if (!loaded) return undefined
          const chapter = anchor?.closest<HTMLElement>('[data-book-chapter]')
          const chapterId = chapter?.dataset.bookChapter ?? state.chapterId
          const bounds = chapter?.getBoundingClientRect()
          const progress =
            anchor && bounds
              ? Math.max(
                  0,
                  Math.min(
                    1,
                    (anchor.getBoundingClientRect().top - bounds.top) / Math.max(1, bounds.height),
                  ),
                )
              : state.chapterProgress
          return {
            location: { kind: 'book', chapterId, progress, anchor: '' },
            label:
              loaded.document.chapters.find((item) => item.id === chapterId)?.title || 'Bookmark',
          }
        }}
        onNoteNavigate={(location) => {
          if (location.kind === 'book')
            actions.navigate(location.chapterId, location.anchor || undefined, location.progress)
        }}
        onViewport={actions.attach}
        onScroll={actions.scroll}
        beforeClose={actions.persist}
        onKeyDown={(event, element) => {
          if (event.key !== 'PageUp' && event.key !== 'PageDown') return false
          event.preventDefault()
          element.scrollBy({ top: (event.key === 'PageDown' ? 1 : -1) * element.clientHeight })
          return true
        }}
        content={() => (
          <>
            {model.loading ? (
              <div class='flex h-full items-center justify-center text-sm text-white/60'>
                Opening...
              </div>
            ) : null}
            {model.error ? (
              <div
                role='alert'
                class='flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-red-300'
              >
                <p>{model.error}</p>
                <a
                  class='rounded border border-white/25 px-3 py-1.5 text-sm text-white hover:border-white/60'
                  href={buildMediaUrl(props.sourcePath.replace(/\\/g, '/'))}
                  download
                >
                  Download original
                </a>
              </div>
            ) : null}
            {loaded && model.viewport ? (
              <BookContent
                document={loaded.document}
                appearance={model.preferences.bookAppearance}
                currentChapterId={state.chapterId}
                positionReady={model.positionReady}
                viewport={model.viewport}
                onNavigate={(chapterId, anchor) => actions.navigate(chapterId, anchor)}
                searchQuery={model.searchOpen && !model.searching ? model.searchQuery : ''}
                activeMatch={model.matches[model.matchIndex]}
              />
            ) : null}
          </>
        )}
      />
    )
  }),
)
export default BookReader
