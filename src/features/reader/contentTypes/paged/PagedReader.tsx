import ZoomIn from 'lucide-solid/icons/zoom-in'
import ZoomOut from 'lucide-solid/icons/zoom-out'
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onSettled,
  untrack,
} from 'solid-js'
import { createStore } from 'solid-js'
import type { JSX } from '@solidjs/web'
import { buildMediaUrl } from '@/lib/media/build-media-url'
import { ReaderFrame, type ReaderFrameContent } from '../../ReaderFrame'
import { ReaderOutline, type ReaderOutlineItem } from '../../ReaderOutline'
import { ReaderSetting, Segmented } from '../../ReaderSettings'
import { useReaderPreferences } from '../../ReaderPreferences'
import {
  normalizePagedReaderPosition,
  type PagedReaderPosition,
  type ReaderFitMode,
  type ReaderPage,
  type ReaderSelectionMode,
  type ReaderViewMode,
} from '../../reader-position'
import { createReaderPositionSync } from '../../reader-position-sync'
import type { ReaderSyncedState } from '../../reader-state-client'
import type { ReaderContentProps } from '../../reader-types'
import { createAsyncValue } from '../../create-async-value'

export type PagedDocument<TPage extends ReaderPage = ReaderPage> = {
  pages: TPage[]
  outline: ReaderOutlineItem[]
  release?: () => void | Promise<void>
}

type PagedReaderProps<TDocument extends PagedDocument> = ReaderContentProps & {
  load: (path: string, signal: AbortSignal) => Promise<TDocument>
  selectionModes: readonly ReaderSelectionMode[]
  renderPage: (input: {
    document: TDocument
    page: TDocument['pages'][number]
    pageIndex: number
    zoom: number
    frame: ReaderFrameContent
  }) => JSX.Element
}

const clampZoom = (value: number) => Math.max(0.35, Math.min(3, Number(value.toFixed(2))))
const estimatedPageBlockHeight = (page: ReaderPage | undefined, zoom: number) =>
  (page?.height ?? 900) * zoom + (page?.kind === 'pdf' ? 10 : 8)
const estimateOffsetForPage = (pages: ReaderPage[], pageIndex: number, zoom: number) =>
  pages
    .slice(0, Math.min(pageIndex, pages.length))
    .reduce((offset, page) => offset + estimatedPageBlockHeight(page, zoom), 0)
const pageFromScroll = (pages: ReaderPage[], scrollTop: number, zoom: number) => {
  let offset = 0
  for (let index = 0; index < pages.length; index += 1) {
    offset += estimatedPageBlockHeight(pages[index], zoom)
    if (scrollTop < offset) return index
  }
  return Math.max(0, pages.length - 1)
}

function PageIndicator(props: {
  page: number
  count: number
  open: boolean
  setOpen: (open: boolean) => void
  onNavigate: (page: number) => void
}) {
  let input: HTMLInputElement | undefined
  const commit = () => {
    const page = Number.parseInt(input?.value ?? '', 10)
    props.setOpen(false)
    if (Number.isFinite(page)) props.onNavigate(page - 1)
  }
  return (
    <div class='relative'>
      <button
        type='button'
        data-testid='reader-page-indicator'
        class='flex h-8 min-w-[104px] items-center justify-center rounded-lg border border-[#3a3a3a] bg-[#181818] px-2 text-sm tabular-nums hover:border-[#777]'
        title='Go to page'
        onClick={() => props.setOpen(true)}
      >
        Page {Math.min(props.page + 1, Math.max(1, props.count))} / {Math.max(1, props.count)}
      </button>
      <Show when={props.open}>
        <div class='absolute top-[38px] left-1/2 z-50 -translate-x-1/2 rounded-lg border border-[#3a3a3a] bg-[#181818] p-[5px] shadow-[0_14px_34px_rgb(0_0_0/42%)]'>
          <input
            ref={(element) => {
              input = element
            }}
            data-testid='reader-page-input'
            class='h-8 w-20 rounded-md border border-[#3a3a3a] bg-[#202020] px-2 text-center text-sm outline-none focus:border-[#777]'
            value={String(props.page + 1)}
            inputmode='numeric'
            autofocus
            onFocus={(event) => event.currentTarget.select()}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur()
              if (event.key === 'Escape') {
                event.stopPropagation()
                props.setOpen(false)
              }
            }}
          />
        </div>
      </Show>
    </div>
  )
}

export function PagedReader<TDocument extends PagedDocument>(props: PagedReaderProps<TDocument>) {
  const preferences = useReaderPreferences()
  const document = createAsyncValue(
    () => props.sourcePath,
    (path, signal) => props.load(path, signal),
    (loaded) => loaded.release?.(),
  )
  const [state, setState] = createStore({
    currentPage: 0,
    scrollTop: 0,
    zoom: 1,
    viewMode: 'continuous' as ReaderViewMode,
    fitMode: 'manual' as ReaderFitMode,
    outlineExpanded: [] as string[],
  })
  const [viewport, setViewport] = createSignal<HTMLDivElement>()
  const [viewportSize, setViewportSize] = createSignal({ width: 0, height: 0 })
  const [pageJumpOpen, setPageJumpOpen] = createSignal(false)
  let restored = false
  let saveTimer: number | undefined
  let blockedUntil = 0

  const positionSync = createReaderPositionSync(
    () => props.sourcePath,
    normalizePagedReaderPosition,
    (position) =>
      ({
        kind: 'paged',
        pageIndex: position.pageIndex,
        scrollTop: position.scrollTop,
        zoom: position.zoom,
        viewMode: position.viewMode,
        fitMode: position.fitMode,
        outlineExpanded: position.outlineExpanded,
      }) satisfies ReaderSyncedState,
  )
  const pages = createMemo(() => document.value()?.pages ?? [])
  const zoom = createMemo(() => {
    if (state.fitMode === 'manual') return state.zoom
    const page = pages()[state.currentPage] ?? pages()[0]
    if (!page) return state.zoom
    const size = viewportSize()
    const widthScale = Math.max(320, size.width - 24) / page.width
    const heightScale = Math.max(320, size.height - 28) / page.height
    return clampZoom(state.fitMode === 'width' ? widthScale : heightScale)
  })
  const renderedPages = createMemo(() =>
    state.viewMode === 'page' ? pages().slice(state.currentPage, state.currentPage + 1) : pages(),
  )
  const capture = (): PagedReaderPosition => ({
    kind: 'paged',
    pageIndex: state.currentPage,
    scrollTop: viewport()?.scrollTop ?? state.scrollTop,
    zoom: state.zoom,
    viewMode: state.viewMode,
    fitMode: state.fitMode,
    outlineExpanded: [...state.outlineExpanded],
  })
  const applyPosition = (position: PagedReaderPosition) => {
    const count = pages().length
    setState((draft) => {
      draft.currentPage = Math.max(0, Math.min(Math.max(0, count - 1), position.pageIndex))
      draft.scrollTop = position.scrollTop
      draft.zoom = position.zoom
      draft.viewMode = position.viewMode
      draft.fitMode = position.fitMode
      draft.outlineExpanded = position.outlineExpanded
    })
    requestAnimationFrame(() =>
      requestAnimationFrame(() => viewport()?.scrollTo({ top: position.scrollTop })),
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
  const goToPage = (index: number) => {
    const next = Math.max(0, Math.min(pages().length - 1, index))
    setState((draft) => {
      draft.currentPage = next
    })
    if (state.viewMode === 'continuous') {
      requestAnimationFrame(() =>
        viewport()?.scrollTo({
          top: estimateOffsetForPage(pages(), next, zoom()),
          behavior: 'smooth',
        }),
      )
    } else viewport()?.scrollTo({ top: 0 })
    schedulePersist()
  }

  createEffect(
    () => ({ ready: positionSync.ready(), position: positionSync.loaded(), count: pages().length }),
    ({ ready, position, count }) => {
      if (!ready || !count || restored) return
      const initial =
        position ??
        normalizePagedReaderPosition({
          outlineExpanded: document.value()?.outline.flatMap(function collect(item): string[] {
            return [item.id, ...item.children.flatMap(collect)]
          }),
        })
      applyPosition(initial)
      restored = true
    },
  )

  onSettled(() => {
    const element = viewport()
    if (!element) return
    const resize = new ResizeObserver(() =>
      setViewportSize({ width: element.clientWidth, height: element.clientHeight }),
    )
    resize.observe(element)
    setViewportSize({ width: element.clientWidth, height: element.clientHeight })
    onCleanup(() => resize.disconnect())
  })

  onCleanup(() => {
    window.clearTimeout(saveTimer)
  })

  const settings = (close: () => void) => (
    <>
      <ReaderSetting label='View'>
        <Segmented
          values={['continuous', 'page']}
          value={state.viewMode}
          onChange={(value) => {
            setState((draft) => {
              draft.viewMode = value as ReaderViewMode
            })
            schedulePersist()
            close()
          }}
        />
      </ReaderSetting>
      <ReaderSetting label='Fit'>
        <Segmented
          values={['width', 'height']}
          value={state.fitMode}
          onChange={(value) => {
            setState((draft) => {
              draft.fitMode = value as ReaderFitMode
            })
            schedulePersist()
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
            onClick={() => {
              setState((draft) => {
                draft.fitMode = 'manual'
                draft.zoom = clampZoom(draft.zoom - 0.1)
              })
              schedulePersist()
            }}
          >
            <ZoomOut size={17} />
          </button>
          <span class='text-center text-sm text-[#b8b8b8] tabular-nums'>
            {Math.round(zoom() * 100)}%
          </span>
          <button
            type='button'
            aria-label='Reader zoom in'
            class='flex h-8 w-full items-center justify-center rounded-lg border border-[#3a3a3a] bg-[#202020] hover:border-[#777]'
            onClick={() => {
              setState((draft) => {
                draft.fitMode = 'manual'
                draft.zoom = clampZoom(draft.zoom + 0.1)
              })
              schedulePersist()
            }}
          >
            <ZoomIn size={17} />
          </button>
        </div>
      </ReaderSetting>
    </>
  )

  const outline = createMemo(() => {
    const items = document.value()?.outline ?? []
    if (!items.length) return undefined
    return (
      <ReaderOutline
        title='Contents'
        items={items}
        active={state.currentPage}
        onNavigate={(target) => typeof target === 'number' && goToPage(target)}
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
      title={props.sourcePath}
      selectionModes={props.selectionModes}
      toolbar={
        <PageIndicator
          page={state.currentPage}
          count={pages().length}
          open={pageJumpOpen()}
          setOpen={setPageJumpOpen}
          onNavigate={goToPage}
        />
      }
      settings={settings}
      outline={outline()}
      onViewport={setViewport}
      onScroll={(element) => {
        setState((draft) => {
          draft.scrollTop = element.scrollTop
        })
        if (state.viewMode === 'continuous') {
          setState((draft) => {
            draft.currentPage = pageFromScroll(pages(), element.scrollTop, zoom())
          })
        }
        schedulePersist()
      }}
      onKeyDown={(event, element) => {
        if (event.key === 'PageUp' || event.key === 'PageDown') {
          event.preventDefault()
          if (state.viewMode === 'page') {
            goToPage(state.currentPage + (event.key === 'PageDown' ? 1 : -1))
          } else {
            element.scrollBy({
              top: (event.key === 'PageDown' ? 1 : -1) * element.clientHeight,
            })
          }
          return true
        }
        const targets: Record<string, number> = {
          ArrowRight: state.currentPage + 1,
          ArrowLeft: state.currentPage - 1,
          Home: 0,
          End: pages().length - 1,
        }
        if (targets[event.key] === undefined) return false
        event.preventDefault()
        goToPage(targets[event.key]!)
        return true
      }}
      onEscape={() => {
        if (!pageJumpOpen()) return false
        setPageJumpOpen(false)
        return true
      }}
      beforeClose={persist}
      content={(frame) => (
        <>
          <Show when={document.loading()}>
            <div class='flex h-full items-center justify-center text-sm text-white/60'>
              Opening...
            </div>
          </Show>
          <Show when={document.error()}>
            <div
              role='alert'
              class='flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-red-300'
            >
              <p>
                {document.error() instanceof Error
                  ? (document.error() as Error).message
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
          <Show when={document.value()}>
            {(loaded) => (
              <For each={renderedPages()}>
                {(page) => {
                  const pageIndex = () => pages().indexOf(page)
                  return (
                    <article
                      data-page-id={page.id}
                      data-page-index={pageIndex()}
                      data-reader-page-index={pageIndex()}
                      class={[
                        'mx-auto mb-2 w-fit scroll-mt-1',
                        { 'max-w-none': page.kind === 'pdf', 'max-w-full': page.kind !== 'pdf' },
                      ]}
                      aria-label={`Page ${pageIndex() + 1}`}
                    >
                      {props.renderPage({
                        document: loaded(),
                        page,
                        pageIndex: pageIndex(),
                        zoom: zoom(),
                        frame,
                      })}
                    </article>
                  )
                }}
              </For>
            )}
          </Show>
        </>
      )}
    />
  )
}
