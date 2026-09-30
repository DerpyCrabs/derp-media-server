import { nextAnimationFrame } from '@/lib/browser/animation-frame'
import { cn } from '@/lib/ui/cn'
import { Effect, Semaphore } from 'effect'
import {
  commandSlot,
  domMount,
  entities,
  list,
  localComponent,
  modelOwner,
  view,
  type JSX,
  type Snapshot,
  controllerView,
  type ControllerModel,
} from 'effectweb'
import ZoomIn from '@effectweb/lucide/icons/zoom-in'
import ZoomOut from '@effectweb/lucide/icons/zoom-out'
import { buildMediaUrl } from '@/lib/media/build-media-url'
import { ReaderFrame, type ReaderFrameContent } from '../../ReaderFrame'
import { ReaderOutline, type ReaderOutlineItem } from '../../ReaderOutline'
import { ReaderSetting, Segmented } from '../../ReaderSettings'
import { readerPreferences } from '../../ReaderPreferences'
import {
  normalizePagedReaderPosition,
  type PagedReaderPosition,
  type ReaderFitMode,
  type ReaderPage,
  type ReaderSelectionMode,
  type ReaderViewMode,
} from '../../reader-position'
import { createReaderPositionSync } from '../../reader-position-sync'
import type { ReaderContentProps } from '../../reader-types'
export type PagedDocument<TPage extends ReaderPage = ReaderPage> = {
  pages: TPage[]
  outline: ReaderOutlineItem[]
  release?: () => Effect.Effect<void>
}
type Props<TDocument extends PagedDocument> = ReaderContentProps & {
  load: (path: string) => Effect.Effect<TDocument, unknown>
  selectionModes: readonly ReaderSelectionMode[]
  renderPage: (input: {
    document: Snapshot<TDocument>
    page: TDocument['pages'][number]
    pageIndex: number
    zoom: number
    frame: ReaderFrameContent
  }) => JSX.Element
}
const clampZoom = (value: number) => Math.max(0.35, Math.min(3, Number(value.toFixed(2))))
const blockHeight = (page: ReaderPage, zoom: number) =>
  page.height * zoom + (page.kind === 'pdf' ? 10 : 8)
const offsetForPage = (pages: readonly ReaderPage[], index: number, zoom: number) =>
  pages.slice(0, index).reduce((offset, page) => offset + blockHeight(page, zoom), 0)
const pageFromScroll = (pages: readonly ReaderPage[], scrollTop: number, zoom: number) => {
  let offset = 0
  for (let i = 0; i < pages.length; i++) {
    offset += blockHeight(pages[i]!, zoom)
    if (scrollTop < offset) return i
  }
  return Math.max(0, pages.length - 1)
}
const loadSlot = commandSlot('reader-document-load')
const saveSlot = commandSlot('reader-position-save')
const debounceSlot = commandSlot('reader-position-debounce')
const restoreSlot = commandSlot('reader-position-restore')
const focusPageInput = domMount((element: HTMLInputElement) => {
  element.focus()
  element.select()
})
const PageIndicator = localComponent<
  { page: number; count: number; onNavigate: (page: number) => void },
  { open: boolean; draft: string }
>({
  init: () => ({ open: false, draft: '' }),
  view: view((model, patch) => (
    <div class='relative'>
      <button
        type='button'
        data-testid='reader-page-indicator'
        class='flex h-8 min-w-[104px] items-center justify-center rounded-lg border border-[#3a3a3a] bg-[#181818] px-2 text-sm tabular-nums hover:border-[#777]'
        title='Go to page'
        onClick={() => patch({ open: true, draft: String(model.props.page + 1) })}
      >
        Page {Math.min(model.props.page + 1, Math.max(1, model.props.count))} /{' '}
        {Math.max(1, model.props.count)}
      </button>
      {model.open ? (
        <div class='absolute top-[38px] left-1/2 z-50 -translate-x-1/2 rounded-lg border border-[#3a3a3a] bg-[#181818] p-[5px] shadow-[0_14px_34px_rgb(0_0_0/42%)]'>
          <input
            use={focusPageInput}
            data-testid='reader-page-input'
            class='h-8 w-20 rounded-md border border-[#3a3a3a] bg-[#202020] px-2 text-center text-sm outline-none focus:border-[#777]'
            value={model.draft}
            inputmode='numeric'
            autofocus
            onInput={(event) => patch({ draft: event.currentTarget.value })}
            onFocus={(event) => event.currentTarget.select()}
            onBlur={() => {
              patch({ open: false })
              const page = Number.parseInt(model.draft, 10)
              if (Number.isFinite(page)) model.props.onNavigate(page - 1)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') {
                event.stopPropagation()
                patch({ open: false })
              }
            }}
          />
        </div>
      ) : null}
    </div>
  )),
})
function createPagedReader(props: Snapshot<Props<PagedDocument>>) {
  const saveGate = Semaphore.makeUnsafe(1)
  let viewport: HTMLDivElement | undefined
  let resize: ResizeObserver | undefined
  let released: (() => Effect.Effect<void>) | undefined
  let restored = false
  let closing = false
  let finalPosition: PagedReaderPosition | undefined
  let blockedUntil = 0
  const sync = createReaderPositionSync(
    props.sourcePath,
    normalizePagedReaderPosition,
    (position) => ({ ...position, kind: 'paged' }),
  )
  const owner = modelOwner({
    props,
    document: null as PagedDocument | null,
    error: '',
    loading: true,
    position: normalizePagedReaderPosition({}),
    size: { width: 0, height: 0 },
  })
  const actions = {
    navigate: (index: number) => navigate(index),
    change: (changes: Partial<PagedReaderPosition>) => {
      owner.patch({ position: { ...owner.read().position, ...changes } })
      schedule()
    },
    attach: (element: HTMLDivElement) => {
      if (viewport === element) return
      viewport = element
      resize?.disconnect()
      const measure = () =>
        owner.patch({ size: { width: element.clientWidth, height: element.clientHeight } })
      resize = new ResizeObserver(measure)
      resize.observe(element)
      measure()
    },
    scroll: (element: HTMLDivElement) => {
      const current = owner.read()
      const pages = current.document?.pages ?? []
      owner.patch({
        position: {
          ...current.position,
          scrollTop: element.scrollTop,
          pageIndex:
            current.position.viewMode === 'continuous'
              ? pageFromScroll(
                  pages,
                  element.scrollTop,
                  zoomFor(current.position, pages, current.size),
                )
              : current.position.pageIndex,
        },
      })
      schedule()
    },
    persist: () =>
      Effect.gen(function* () {
        owner.cancel(debounceSlot)
        yield* owner.awaitIdle(saveSlot)
        yield* persist()
      }),
  }
  const apply = (position: PagedReaderPosition) => {
    const count = owner.read().document?.pages.length ?? 0
    owner.patch({
      position: {
        ...position,
        pageIndex: Math.max(0, Math.min(Math.max(0, count - 1), position.pageIndex)),
      },
    })
    owner.run(
      restoreSlot,
      nextAnimationFrame.pipe(
        Effect.andThen(nextAnimationFrame),
        Effect.andThen(Effect.sync(() => viewport?.scrollTo({ top: position.scrollTop }))),
      ),
      'replace',
    )
  }
  const persist = () =>
    saveGate.withPermit(
      Effect.gen(function* () {
        if (!restored || Date.now() < blockedUntil) return
        const current = owner.read().position
        const remote = yield* sync.save(
          finalPosition ?? {
            ...current,
            outlineExpanded: [...current.outlineExpanded],
            scrollTop: viewport?.scrollTop ?? current.scrollTop,
          },
        )
        if (remote && !closing && !owner.disposed) {
          blockedUntil = Date.now() + 1500
          apply(remote)
        }
      }),
    )
  const schedule = () => {
    if (closing) return
    owner.run(
      debounceSlot,
      Effect.sleep(1000).pipe(
        Effect.andThen(Effect.sync(() => owner.run(saveSlot, persist(), 'latest-queued'))),
      ),
      'replace',
    )
  }
  const navigate = (index: number) => {
    const current = owner.read()
    const pages = current.document?.pages ?? []
    const next = Math.max(0, Math.min(pages.length - 1, index))
    owner.patch({ position: { ...current.position, pageIndex: next } })
    viewport?.scrollTo({
      top:
        current.position.viewMode === 'continuous'
          ? offsetForPage(pages, next, zoomFor(current.position, pages, current.size))
          : 0,
      behavior: 'smooth',
    })
    schedule()
  }
  owner.run(
    loadSlot,
    Effect.gen(function* () {
      const [document, position] = yield* Effect.all(
        [
          props.load(props.sourcePath).pipe(
            Effect.tap((loaded) =>
              Effect.sync(() => {
                released = loaded.release
              }),
            ),
          ),
          sync.load,
        ],
        { concurrency: 'unbounded' },
      )
      owner.patch({ document, loading: false })
      const initial =
        position ??
        normalizePagedReaderPosition({
          outlineExpanded: document.outline.flatMap(function collect(item): string[] {
            return [item.id, ...item.children.flatMap(collect)]
          }),
        })
      apply(initial)
      restored = true
      yield* Effect.never
    }).pipe(
      Effect.catch((error) =>
        Effect.sync(() => owner.patch({ loading: false, error: String(error) })),
      ),
      Effect.ensuring(Effect.suspend(() => released?.() ?? Effect.void)),
    ),
    'replace',
  )
  return {
    source: owner.source,
    actions,
    receive: (next: Snapshot<Props<PagedDocument>>) => owner.patch({ props: next }),
    beforeDispose: () => {
      const current = owner.read().position
      finalPosition = {
        ...current,
        outlineExpanded: [...current.outlineExpanded],
        scrollTop: viewport?.scrollTop ?? current.scrollTop,
      }
    },
    close: () => {
      closing = true
      const save = persist()
      owner.cancel(debounceSlot)
      owner.cancel(restoreSlot)
      resize?.disconnect()
      return owner
        .awaitIdle(saveSlot)
        .pipe(Effect.andThen(save), Effect.ensuring(owner.close().pipe(Effect.orDie)))
    },
    dispose: () => {
      resize?.disconnect()
      owner.dispose()
    },
  }
}
function zoomFor(
  position: Snapshot<PagedReaderPosition>,
  pages: readonly ReaderPage[],
  size: { width: number; height: number },
) {
  if (position.fitMode === 'manual') return position.zoom
  const page = pages[position.pageIndex] ?? pages[0]
  if (!page) return position.zoom
  return clampZoom(
    position.fitMode === 'width'
      ? Math.max(320, size.width - 24) / page.width
      : Math.max(320, size.height - 28) / page.height,
  )
}
const PagedReaderView = view<ControllerModel<typeof createPagedReader>>((model) => {
  const props = model.props,
    state = model.position,
    actions = model.actions
  const pages = model.document?.pages ?? []
  const zoom = zoomFor(state, pages, model.size)
  const renderedPages =
    state.viewMode === 'page' ? pages.slice(state.pageIndex, state.pageIndex + 1) : pages
  return (
    <ReaderFrame
      {...props}
      title={props.sourcePath}
      selectionModes={props.selectionModes}
      toolbar={
        <PageIndicator page={state.pageIndex} count={pages.length} onNavigate={actions.navigate} />
      }
      settings={(close) => (
        <>
          <ReaderSetting label='View'>
            <Segmented
              values={['continuous', 'page']}
              value={state.viewMode}
              onChange={(value) => {
                actions.change({ viewMode: value as ReaderViewMode })
                close()
              }}
            />
          </ReaderSetting>
          <ReaderSetting label='Fit'>
            <Segmented
              values={['width', 'height']}
              value={state.fitMode}
              onChange={(value) => {
                actions.change({ fitMode: value as ReaderFitMode })
                close()
              }}
            />
          </ReaderSetting>
          <ReaderSetting label='Zoom'>
            <div class='grid grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)] items-center'>
              <button
                type='button'
                aria-label='Reader zoom out'
                class='flex h-8 w-full items-center justify-center rounded-lg border border-[#3a3a3a] bg-[#202020] hover:border-[#777]'
                onClick={() =>
                  actions.change({ fitMode: 'manual', zoom: clampZoom(state.zoom - 0.1) })
                }
              >
                <ZoomOut size={17} />
              </button>
              <span class='text-center text-sm text-[#b8b8b8] tabular-nums'>
                {Math.round(zoom * 100)}%
              </span>
              <button
                type='button'
                aria-label='Reader zoom in'
                class='flex h-8 w-full items-center justify-center rounded-lg border border-[#3a3a3a] bg-[#202020] hover:border-[#777]'
                onClick={() =>
                  actions.change({ fitMode: 'manual', zoom: clampZoom(state.zoom + 0.1) })
                }
              >
                <ZoomIn size={17} />
              </button>
            </div>
          </ReaderSetting>
        </>
      )}
      outline={
        model.document?.outline.length ? (
          <ReaderOutline
            title='Contents'
            items={model.document.outline}
            active={state.pageIndex}
            onNavigate={(target) => typeof target === 'number' && actions.navigate(target)}
            onClose={() => readerPreferences.patch({ outlineOpen: false })}
            expanded={state.outlineExpanded}
            onToggle={(id) =>
              actions.change({
                outlineExpanded: state.outlineExpanded.includes(id)
                  ? state.outlineExpanded.filter((item) => item !== id)
                  : [...state.outlineExpanded, id],
              })
            }
          />
        ) : undefined
      }
      onViewport={actions.attach}
      onScroll={actions.scroll}
      beforeClose={actions.persist}
      onKeyDown={(event, element) => {
        if (event.key === 'PageUp' || event.key === 'PageDown') {
          event.preventDefault()
          if (state.viewMode === 'page')
            actions.navigate(state.pageIndex + (event.key === 'PageDown' ? 1 : -1))
          else element.scrollBy({ top: (event.key === 'PageDown' ? 1 : -1) * element.clientHeight })
          return true
        }
        const targets: Record<string, number> = {
          ArrowRight: state.pageIndex + 1,
          ArrowLeft: state.pageIndex - 1,
          Home: 0,
          End: pages.length - 1,
        }
        if (targets[event.key] === undefined) return false
        event.preventDefault()
        actions.navigate(targets[event.key]!)
        return true
      }}
      content={(frame) => (
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
          {model.document
            ? list(entities(renderedPages), (page) => (
                <article
                  data-page-id={page.id}
                  data-page-index={pages.indexOf(page)}
                  data-reader-page-index={pages.indexOf(page)}
                  class={cn('mx-auto mb-2 w-fit scroll-mt-1', {
                    'max-w-none': page.kind === 'pdf',
                    'max-w-full': page.kind !== 'pdf',
                  })}
                  aria-label={`Page ${pages.indexOf(page) + 1}`}
                >
                  {props.renderPage({
                    document: model.document!,
                    page,
                    pageIndex: pages.indexOf(page),
                    zoom,
                    frame,
                  })}
                </article>
              ))
            : null}
        </>
      )}
    />
  )
})
export const PagedReader = controllerView({
  create: createPagedReader,
  identity: (props) => props.sourcePath,
  view: PagedReaderView,
})
