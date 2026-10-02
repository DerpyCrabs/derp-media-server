import { createForYou } from './for-you-controller'
import {
  available,
  domBinding,
  domMount,
  observe,
  resourceError,
  view,
  list,
  Portal,
  type Snapshot,
  controllerView,
} from 'effectweb'

import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { queryCache } from '@/lib/api/cache'
import { query, querySource } from '@effectweb/query'
import { MusicHome } from '@/features/music/MusicHome'

import { startRadio } from '@/features/music/actions'
import { apiSchemaEffect } from '@/lib/api/client'
import { fileSearchResponseSchema } from '@/lib/files/file-schemas'
import { asFile, isReading, categories, type Recommendation as Pick } from './recommendation-model'
import { homeQuery } from './recommendation-queries'
import { MediaType, type FileItem } from '@/lib/files/types'
import { fileSearchResultToFileItem } from '@/lib/files/file-search'
import { buildThumbnailUrl } from '@/lib/media/build-media-url'
import { navigateSearchParams } from '@/lib/browser/browser-history'
import { playbackItemFromFileItem } from '@/features/playback'
import { getPlaybackSession } from '@/features/playback/PlaybackProvider'
import ArrowRight from '@effectweb/lucide/icons/arrow-right'
import EllipsisVertical from '@effectweb/lucide/icons/ellipsis-vertical'
import FolderMinus from '@effectweb/lucide/icons/folder-minus'
import FolderOpen from '@effectweb/lucide/icons/folder-open'
import ListPlus from '@effectweb/lucide/icons/list-plus'
import LoaderCircle from '@effectweb/lucide/icons/loader-circle'
import BookOpen from '@effectweb/lucide/icons/book-open'

import Music2 from '@effectweb/lucide/icons/music-2'
import Radio from '@effectweb/lucide/icons/radio'
import StepForward from '@effectweb/lucide/icons/step-forward'
import Play from '@effectweb/lucide/icons/play'
import RefreshCw from '@effectweb/lucide/icons/refresh-cw'
import Search from '@effectweb/lucide/icons/search'
import ThumbsDown from '@effectweb/lucide/icons/thumbs-down'
import ThumbsUp from '@effectweb/lucide/icons/thumbs-up'
import { FloatingContextMenu } from '@/features/explorer/FloatingContextMenu'
function itemTitle(item: Snapshot<Pick>) {
  return (
    item.displayTitle ||
    (item.type === MediaType.FOLDER ? item.name : item.name.replace(/\.[^.]+$/, ''))
  )
}
function durationLabel(seconds?: number | null) {
  if (!seconds) return ''
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`
}
const button =
  'min-h-11 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-secondary disabled:opacity-50'
const autofocus = domMount((element: HTMLInputElement) => {
  queueMicrotask(() => {
    if (element.isConnected) element.focus()
  })
})
const watchSentinel = (
  element: HTMLDivElement,
  data: () => { enabled: boolean; load: () => void },
) => {
  let intersecting = false
  const check = () => {
    if (intersecting && data().enabled) data().load()
  }
  const observer = new IntersectionObserver(
    (entries) => {
      intersecting = entries.some((entry) => entry.isIntersecting)
      check()
    },
    { rootMargin: '900px' },
  )
  observer.observe(element)
  return { update: check, dispose: () => observer.disconnect() }
}
export const ForYou = controllerView(
  { controller: createForYou },
  view((model) => {
    const props = model.props
    const session = {
      dispatch: (command: Parameters<ReturnType<typeof getPlaybackSession>['dispatch']>[0]) =>
        getPlaybackSession().dispatch(command),
    }
    const category = () => model.category
    const query = () => model.query
    const debounced = () => model.debounced
    const history = () => model.history
    const answer = () => model.answer
    const hidden = () => model.hidden
    const notice = () => model.notice
    const likes = () => model.likes
    const menu = () => model.menu
    const waitingForRecommendations = () => model.waitingForRecommendations
    const { open, playCollection, queue, setCategory, setQuery, setHistory, setAnswer, setMenu } =
      model.actions
    const home = {
      isPending: AsyncResult.isInitial(model.home),
      isFetching: model.home.waiting,
      isFetchingNextPage: model.pageResult.waiting,
      isFetchNextPageError: !!resourceError(model.pageResult),
      isError: AsyncResult.isFailure(model.home) || !!resourceError(model.pageResult),
      error: resourceError(model.home) || resourceError(model.pageResult),
      hasNextPage: !!available(model.home)?.next,
      fetchNextPage: model.actions.loadNext,
      refetch: () => queryCache.invalidateQuery(homeQuery.query, model.category),
    }
    const reading = { error: resourceError(model.reading), refetch: model.actions.refreshReading }
    const refresh = {
      isPending: model.refreshResult.waiting,
      error: resourceError(model.refreshResult),
      mutate: model.actions.refresh,
    }
    const ask = {
      isPending: model.askResult.waiting,
      error: resourceError(model.askResult),
      mutate: model.actions.ask,
    }
    const feedback = {
      isPending: model.feedbackResult.waiting,
      error: resourceError(model.feedbackResult),
      mutate: model.actions.feedback,
    }
    const feed = () => {
      const readingPaths = new Set(available(model.reading)?.items.map((book) => book.path))
      const seen = new Set<string>()
      return (
        available(model.home)?.pages.flatMap((page) =>
          page.value.rows.flatMap((row) => row.items),
        ) ?? []
      ).filter((item) => {
        const selected = model.category
        if (
          selected === 'music' &&
          item.type !== MediaType.AUDIO &&
          !(item.type === MediaType.FOLDER && item.members?.some((m) => m.type === MediaType.AUDIO))
        )
          return false
        if (
          selected === 'video' &&
          item.type !== MediaType.VIDEO &&
          !(item.type === MediaType.FOLDER && item.members?.some((m) => m.type === MediaType.VIDEO))
        )
          return false
        if (selected === 'all' && isReading(item)) return false
        if (selected === 'books' && !isReading(item)) return false
        if (readingPaths.has(item.path) || seen.has(item.path)) return false
        seen.add(item.path)
        return true
      })
    }
    const actionClass =
      'flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm hover:bg-secondary focus:bg-secondary'
    function bookCard(props: { item: Snapshot<Pick>; compact?: boolean }) {
      const progress = () => (props.item.lastRead === 0 ? undefined : props.item.readingProgress)
      const title = () => {
        if (props.item.displayTitle) return props.item.displayTitle
        const name = props.item.name
          .replace(/\.(?:epub|pdf|fb2(?:\.zip)?)$/i, '')
          .replace(/^[a-z\d.-]+\.[a-z]{2,}_/i, '')
          .replace(/(?:[-_ ](?:\d{13}|\d{9}[\dX]))+$/i, '')
          .replace(/[_-]+/g, ' ')
          .trim()
        return name ? name[0]!.toUpperCase() + name.slice(1) : itemTitle(props.item)
      }
      return (
        <div class='flex items-center rounded-lg bg-secondary/25 transition-colors hover:bg-secondary/50'>
          <button
            class='group/book flex min-h-20 min-w-0 flex-1 items-center gap-3 rounded-lg px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring'
            aria-label={`Read ${props.item.name}`}
            title={props.item.name}
            onClick={() => open(asFile(props.item), [])}
          >
            <BookOpen size={22} strokeWidth={1.5} class='shrink-0 text-muted-foreground/70' />
            <span class='min-w-0 flex-1'>
              <span class='line-clamp-2 text-[15px] font-medium leading-5'>{title()}</span>
              {!props.compact && props.item.reason ? (
                <span class='mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground'>
                  {props.item.reason}
                </span>
              ) : null}
              {progress() != null ? (
                <span class='mt-2 flex items-center gap-2 text-xs text-muted-foreground'>
                  {props.item.type !== MediaType.PDF ? (
                    <span class='h-0.5 w-16 overflow-hidden rounded-full bg-foreground/10'>
                      <span
                        class='block h-full rounded-full bg-foreground/50'
                        style={{ width: `${Math.max(0, Math.min(1, progress() ?? 0)) * 100}%` }}
                      />
                    </span>
                  ) : null}
                  <span class='tabular-nums'>
                    {props.item.type === MediaType.PDF && props.item.pageIndex != null
                      ? `Page ${props.item.pageIndex + 1}`
                      : `${Math.round((progress() ?? 0) * 100)}%`}
                  </span>
                  {props.item.type !== MediaType.PDF ? <span>read</span> : null}
                </span>
              ) : null}
            </span>
            <ArrowRight
              size={16}
              class='shrink-0 text-muted-foreground/50 transition-transform group-hover/book:translate-x-0.5 group-hover/book:text-foreground'
            />
          </button>
          {!props.compact ? (
            <button
              aria-label={`Options for ${props.item.name}`}
              title='More'
              class='mr-1 flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring'
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect()
                setMenu({ item: props.item, x: Math.max(8, rect.right - 240), y: rect.bottom })
              }}
            >
              <EllipsisVertical size={17} />
            </button>
          ) : null}
        </div>
      )
    }
    function cards(props: {
      items: readonly Snapshot<Pick>[]
      readingShelf?: boolean
      bookStrip?: boolean
    }) {
      const visible = () =>
        props.items.filter((i) => !hidden().some((p) => i.path === p || i.path.startsWith(`${p}/`)))
      return (
        <div
          class={
            props.bookStrip
              ? 'flex gap-2 overflow-x-auto pb-1'
              : props.readingShelf
                ? 'grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3'
                : 'grid grid-cols-2 gap-x-2 gap-y-4 sm:gap-x-5 sm:gap-y-7 min-[1000px]:grid-cols-3 min-[1440px]:grid-cols-4'
          }
        >
          {list(
            visible(),
            (item) => item.path,
            (item) => (
              <article
                class={`group min-w-0 ${props.bookStrip ? 'w-[280px] shrink-0 md:w-0 md:flex-1' : ''} ${isReading(item) && !props.readingShelf ? 'col-span-2 sm:col-span-1' : ''}`}
              >
                {!isReading(item) ? (
                  <>
                    <button
                      class='relative block aspect-video w-full overflow-hidden rounded-lg bg-secondary text-left focus-visible:ring-2 focus-visible:ring-ring sm:rounded-xl'
                      aria-label={`${isReading(item) ? 'Read' : item.type === MediaType.FOLDER ? 'Open' : 'Play'} ${item.name}`}
                      title={item.reason}
                      onClick={() => open(asFile(item), visible().map(asFile))}
                    >
                      <span class='absolute inset-0 grid place-items-center text-muted-foreground'>
                        {isReading(item) ? <BookOpen size={32} /> : <Music2 size={32} />}
                      </span>
                      {!isReading(item) ? (
                        <img
                          onError={(event) => {
                            event.currentTarget.style.visibility = 'hidden'
                          }}
                          src={buildThumbnailUrl(item.previewPath || item.path, 2)}
                          alt=''
                          class='relative h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]'
                        />
                      ) : null}
                      <span class='absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/15'>
                        <span class='flex size-12 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100'>
                          {item.type === MediaType.FOLDER ? (
                            <FolderOpen size={22} />
                          ) : isReading(item) ? (
                            <BookOpen size={22} />
                          ) : (
                            <Play size={22} />
                          )}
                        </span>
                      </span>
                      <span class='absolute top-1 left-1 rounded bg-black/75 px-1 py-0.5 text-[10px] font-medium text-white sm:top-auto sm:bottom-2 sm:left-2 sm:px-2 sm:py-1 sm:text-[11px]'>
                        {item.type === MediaType.FOLDER
                          ? `${item.itemCount ?? 0} items · Folder`
                          : item.type === MediaType.AUDIO
                            ? 'Music'
                            : isReading(item)
                              ? 'Book'
                              : 'Video'}
                      </span>
                      {isReading(item) && item.readingProgress != null ? (
                        <span class='absolute right-2 bottom-2 rounded bg-black/75 px-2 py-1 text-xs text-white'>
                          {item.type === MediaType.PDF && item.pageIndex != null
                            ? `Page ${item.pageIndex + 1}`
                            : `${Math.round((item.readingProgress ?? 0) * 100)}%`}
                        </span>
                      ) : null}
                      {durationLabel(item.duration) ? (
                        <span class='absolute right-1 bottom-1 rounded bg-black/75 px-1 py-0.5 text-[10px] tabular-nums text-white sm:right-2 sm:bottom-2 sm:px-1.5 sm:text-xs'>
                          {durationLabel(item.duration)}
                        </span>
                      ) : null}
                    </button>
                    <div class='relative mt-1.5 min-h-11 pr-8 sm:mt-3 sm:min-h-0 sm:pr-0'>
                      <button
                        class='flex w-full items-start text-left text-[13px] leading-[18px] font-medium hover:text-primary sm:h-10 sm:text-[15px] sm:leading-5'
                        onClick={() => open(asFile(item), visible().map(asFile))}
                      >
                        <span class='line-clamp-2 min-w-0'>{itemTitle(item)}</span>
                      </button>
                      <div class='mt-0.5 flex items-center gap-1 sm:mt-1'>
                        <p
                          class='min-w-0 flex-1 truncate text-[11px] text-muted-foreground sm:text-[13px]'
                          title={item.path}
                        >
                          {item.subtitle || item.path.split('/').at(-2) || 'Your library'}
                        </p>
                        <button
                          aria-label={`Like ${item.name}`}
                          title='More like this'
                          aria-pressed={
                            (likes()[item.path] ?? item.liked ?? false) ? 'true' : 'false'
                          }
                          class={`hidden items-center justify-center rounded-full p-2 transition-colors min-h-11 min-w-11 hover:bg-secondary sm:inline-flex ${(likes()[item.path] ?? item.liked) ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                          disabled={feedback.isPending}
                          onClick={() =>
                            feedback.mutate({
                              path: item.path,
                              kind: (likes()[item.path] ?? item.liked) ? 'clear' : 'more',
                            })
                          }
                        >
                          <ThumbsUp size={17} />
                        </button>
                        <button
                          aria-label={`Dislike ${item.name}`}
                          title='Not interested'
                          class='hidden items-center justify-center rounded-full p-2 text-muted-foreground transition-colors min-h-11 min-w-11 hover:bg-secondary hover:text-foreground sm:inline-flex'
                          disabled={feedback.isPending}
                          onClick={() => feedback.mutate({ path: item.path, kind: 'hide' })}
                        >
                          <ThumbsDown size={17} />
                        </button>
                        <button
                          aria-label={`Options for ${item.name}`}
                          title='More'
                          class='absolute -top-1.5 -right-2 inline-flex items-center justify-center rounded-full p-2 text-muted-foreground min-h-11 min-w-11 hover:bg-secondary hover:text-foreground sm:static sm:-mr-2'
                          onClick={(e) => {
                            const r = e.currentTarget.getBoundingClientRect()
                            setMenu({ item, x: Math.max(8, r.right - 240), y: r.bottom })
                          }}
                        >
                          <EllipsisVertical size={18} />
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  bookCard({ item, compact: props.bookStrip })
                )}
              </article>
            ),
          )}
        </div>
      )
    }
    return (
      <main
        class='mx-auto w-full max-w-[1920px] space-y-3 px-2 pb-3 sm:space-y-4 sm:px-7 sm:pb-5 lg:px-9'
        data-testid='for-you'
      >
        <div class='flex items-center gap-2 py-2' role='group' aria-label='For you categories'>
          {list(
            categories,
            (item) => item.id,
            (item) => (
              <button
                class={`min-h-11 rounded-full px-5 text-sm font-medium ${category() === item.id ? 'bg-primary text-primary-foreground' : 'bg-secondary/50 text-muted-foreground hover:bg-secondary'}`}
                aria-pressed={category() === item.id ? 'true' : 'false'}
                onClick={() => setCategory(item.id)}
              >
                {item.title}
              </button>
            ),
          )}
        </div>
        {((mount) =>
          mount ? (
            <Portal mount={mount}>
              <button
                class='flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50 pointer-coarse:h-11 pointer-coarse:w-11'
                aria-label='Refresh recommendations'
                title='Refresh recommendations'
                aria-busy={refresh.isPending ? 'true' : 'false'}
                disabled={refresh.isPending || home.isFetching}
                onClick={() => refresh.mutate(category())}
              >
                <RefreshCw size={18} class={refresh.isPending ? 'animate-spin' : ''} />
              </button>
            </Portal>
          ) : null)(props.aiEnabled && props.actions)}
        {props.searchOpen || ask.error ? (
          <section class='space-y-3'>
            {props.searchOpen ? (
              <div class='mx-auto flex h-9 pointer-coarse:h-11 w-full max-w-xl items-center'>
                <form
                  class='flex h-9 pointer-coarse:h-11 min-w-0 flex-1 items-center gap-2 rounded-lg bg-card pl-3 ring-1 ring-inset ring-border'
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (props.aiEnabled && query().trim()) ask.mutate(query().trim())
                  }}
                >
                  <Search size={18} class='shrink-0 text-muted-foreground' />
                  <input
                    use={autofocus}
                    aria-label='Search your library'
                    class='h-full min-w-0 flex-1 bg-transparent text-base outline-none sm:text-sm'
                    value={query()}
                    maxlength={1000}
                    placeholder='Search your library'
                    onInput={(e) => setQuery(e.currentTarget.value)}
                  />
                  <button
                    class='inline-flex h-8 w-8 pointer-coarse:h-11 pointer-coarse:w-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40'
                    aria-label='Search'
                    disabled={!props.aiEnabled || ask.isPending || !query().trim()}
                    type='submit'
                  >
                    {ask.isPending ? (
                      <LoaderCircle size={18} class='animate-spin' />
                    ) : (
                      <ArrowRight size={18} />
                    )}
                  </button>
                </form>
              </div>
            ) : null}
            {history().length ? (
              <button
                class='text-xs text-muted-foreground hover:text-foreground'
                onClick={() => {
                  setHistory([])
                  setAnswer(undefined)
                  setQuery('')
                }}
              >
                Start a new search
              </button>
            ) : null}
            {debounced().length >= 3 && debounced().length <= 200 ? (
              <LibraryMatches query={debounced()} open={open} />
            ) : null}
            {ask.error ? (
              <p role='alert' class='text-sm text-red-500'>
                Search is unavailable right now. Please try again.
              </p>
            ) : null}
          </section>
        ) : null}
        {((result) =>
          result ? (
            <section class='space-y-4'>
              {!result.items.length ? (
                <p class='text-sm text-muted-foreground'>{result.message || 'No matches.'}</p>
              ) : null}
              {cards({ items: result.items })}
            </section>
          ) : null)(answer())}
        {!answer() ? (
          <>
            {(category() === 'all' || category() === 'books') &&
            available(model.reading)?.items.length ? (
              <section class='space-y-4' aria-label='Books'>
                <div class='flex items-center justify-between'>
                  <h2 class='text-lg font-semibold'>Books</h2>
                  {category() === 'all' ? (
                    <button
                      class='flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring'
                      onClick={() => setCategory('books')}
                    >
                      See all <ArrowRight size={16} />
                    </button>
                  ) : null}
                </div>
                {cards({
                  items:
                    category() === 'all'
                      ? (available(model.reading)?.items ?? []).slice(0, 3)
                      : (available(model.reading)?.items ?? []),
                  readingShelf: true,
                  bookStrip: category() === 'all',
                })}
              </section>
            ) : null}
            {(category() === 'all' || category() === 'books') && reading.error ? (
              <div
                role='alert'
                class='flex flex-wrap items-center gap-3 py-4 text-sm text-muted-foreground'
              >
                <span>Couldn’t load your reading progress.</span>
                <button class={button} onClick={() => reading.refetch()}>
                  Try again
                </button>
              </div>
            ) : null}
            {category() === 'all' || category() === 'music' ? <MusicHome /> : null}
            {props.aiEnabled && category() !== 'music' && feed().length ? (
              <section class='space-y-4 pt-4' aria-label='Recommended media'>
                <h2 class='text-lg font-semibold'>
                  {category() === 'books'
                    ? 'More books'
                    : category() === 'video'
                      ? 'Videos for you'
                      : 'More for you'}
                </h2>
                {cards({ items: feed() })}
              </section>
            ) : null}
            {props.aiEnabled &&
            category() !== 'music' &&
            (home.isPending || home.isFetchingNextPage || waitingForRecommendations()) ? (
              <div
                role='status'
                class='flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground'
              >
                <LoaderCircle size={17} class='animate-spin' />
                Loading…
              </div>
            ) : null}
            {category() !== 'music' && home.error ? (
              <div
                role='alert'
                class='flex flex-wrap items-center justify-center gap-3 py-6 text-sm text-muted-foreground'
              >
                <span>
                  {feed().length
                    ? 'Couldn’t load more right now.'
                    : 'Recommendations are unavailable right now.'}
                </span>
                <button
                  class={button}
                  onClick={() =>
                    home.isFetchNextPageError ? home.fetchNextPage() : home.refetch()
                  }
                >
                  Try again
                </button>
              </div>
            ) : null}
            <div
              use={domBinding(
                {
                  enabled:
                    category() === 'all' &&
                    home.hasNextPage &&
                    !home.isFetching &&
                    !home.isError &&
                    !answer(),
                  load: model.actions.loadNext,
                },
                watchSentinel,
              )}
            />
            {props.aiEnabled &&
            (category() === 'video' || category() === 'books') &&
            !home.isPending &&
            !home.error &&
            !waitingForRecommendations() &&
            !feed().length &&
            (category() !== 'books' || !available(model.reading)?.items.length) ? (
              <p class='py-12 text-center text-sm text-muted-foreground'>
                {category() === 'books'
                  ? 'No book recommendations yet. Try searching your library.'
                  : 'Nothing to play yet. Try searching your library.'}
              </p>
            ) : null}
            {category() !== 'music' && home.hasNextPage && !home.isFetching && !home.error ? (
              <div class='text-center'>
                <button class={button} onClick={() => home.fetchNextPage()}>
                  {category() === 'books' ? 'Load more recommendations' : 'More to play'}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
        <FloatingContextMenu
          state={menu()}
          anchor={(value) => ({ x: value.x, y: value.y })}
          onDismiss={() => setMenu(undefined)}
          role='menu'
          class='w-60'
        >
          {(value) => (
            <>
              <button
                class={`${actionClass} ${isReading(value.item) ? '' : 'sm:hidden'}`}
                aria-label={`Like ${value.item.name}`}
                aria-pressed={
                  (likes()[value.item.path] ?? value.item.liked ?? false) ? 'true' : 'false'
                }
                disabled={feedback.isPending}
                onClick={() => {
                  feedback.mutate({
                    path: value.item.path,
                    kind: (likes()[value.item.path] ?? value.item.liked) ? 'clear' : 'more',
                  })
                  setMenu(undefined)
                }}
              >
                <ThumbsUp size={17} />
                {(likes()[value.item.path] ?? value.item.liked) ? 'Remove like' : 'More like this'}
              </button>
              <button
                class={`${actionClass} ${isReading(value.item) ? '' : 'sm:hidden'}`}
                aria-label={`Dislike ${value.item.name}`}
                disabled={feedback.isPending}
                onClick={() => {
                  feedback.mutate({ path: value.item.path, kind: 'hide' })
                  setMenu(undefined)
                }}
              >
                <ThumbsDown size={17} />
                Not interested
              </button>
              {!isReading(value.item) ? (
                <button
                  class={actionClass}
                  onClick={() => {
                    if (value.item.type === MediaType.FOLDER) playCollection(value.item)
                    else queue([value.item])
                    setMenu(undefined)
                  }}
                >
                  {value.item.type === MediaType.FOLDER ? (
                    <>
                      <Play size={17} />
                      Play collection
                    </>
                  ) : (
                    <>
                      <ListPlus size={17} />
                      Add to queue
                    </>
                  )}
                </button>
              ) : null}
              {value.item.type === MediaType.AUDIO ? (
                <>
                  <button
                    class={actionClass}
                    onClick={() => {
                      const item = playbackItemFromFileItem(asFile(value.item))
                      if (item)
                        session.dispatch({ type: 'enqueue', items: [item], position: 'next' })
                      setMenu(undefined)
                    }}
                  >
                    <StepForward size={17} />
                    Play next
                  </button>
                  <button
                    class={actionClass}
                    onClick={() => {
                      startRadio(
                        getPlaybackSession(),
                        { seeds: [value.item.path] },
                        `${itemTitle(value.item)} radio`,
                      )
                      setMenu(undefined)
                    }}
                  >
                    <Radio size={17} />
                    Start radio
                  </button>
                </>
              ) : null}

              {value.item.type === MediaType.FOLDER || value.item.path.includes('/') ? (
                <button
                  class={actionClass}
                  onClick={() => {
                    feedback.mutate({
                      path:
                        value.item.type === MediaType.FOLDER
                          ? value.item.path
                          : value.item.path.split('/').slice(0, -1).join('/'),
                      kind: 'hide',
                    })
                    setMenu(undefined)
                  }}
                >
                  <FolderMinus size={17} />
                  Hide this folder
                </button>
              ) : null}
              <button
                class={actionClass}
                onClick={() => {
                  navigateSearchParams(
                    {
                      view: 'library',
                      dir:
                        value.item.type === MediaType.FOLDER
                          ? value.item.path
                          : value.item.path.split('/').slice(0, -1).join('/'),
                    },
                    'push',
                  )
                  setMenu(undefined)
                }}
              >
                <FolderOpen size={17} />
                Open folder
              </button>
            </>
          )}
        </FloatingContextMenu>
        {refresh.error || feedback.error || notice() ? (
          <div class='pointer-events-none fixed top-20 right-4 z-50 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card px-4 py-3 text-sm shadow-lg'>
            {refresh.error || feedback.error ? (
              <p role='alert' class='text-red-500'>
                {refresh.error
                  ? 'Couldn’t refresh recommendations. Please try again.'
                  : 'Couldn’t save that change. Please try again.'}
              </p>
            ) : (
              <p role='status'>{notice()}</p>
            )}
          </div>
        ) : null}
      </main>
    )
  }),
)
const librarySearch = query({
  name: 'library-matches',
  load: (text: string) =>
    apiSchemaEffect(
      fileSearchResponseSchema,
      `/api/files/search?q=${encodeURIComponent(text)}&limit=12`,
    ),
})
const LibraryMatches = view<{ query: string; open: (item: FileItem, files: FileItem[]) => void }>(
  (props) =>
    observe(querySource(queryCache, librarySearch, props.query), (search) => {
      const exact = { error: resourceError(search) }
      return available(search)?.results.length || exact.error ? (
        <div class='rounded-xl border border-border bg-card p-3'>
          <p class='mb-2 text-xs text-muted-foreground'>Library matches</p>
          {exact.error ? (
            <p role='alert' class='text-sm text-destructive'>
              {exact.error}
            </p>
          ) : null}
          <div class='grid gap-1 sm:grid-cols-2'>
            {list(
              available(search)?.results ?? [],
              (item) => item.path,
              (result) => (
                <button
                  class='truncate rounded-lg px-3 py-2 text-left text-sm hover:bg-secondary'
                  title={result.path}
                  onClick={() =>
                    props.open(
                      fileSearchResultToFileItem(result),
                      (available(search)?.results ?? []).map(fileSearchResultToFileItem),
                    )
                  }
                >
                  {result.isDirectory ? '▸ ' : ''}
                  {result.name}
                  <span class='ml-2 text-xs text-muted-foreground'>{result.parentPath}</span>
                </button>
              ),
            )}
          </div>
        </div>
      ) : null
    }),
)
