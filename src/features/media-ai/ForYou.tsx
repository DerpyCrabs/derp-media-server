import { queryData } from '@/lib/api/query-data'
import { createEffect, createMemo, createSignal, For, Loading, Show, untrack } from 'solid-js'
import { MusicHome } from '@/features/music/MusicHome'
import { updateMusicFeedback } from '@/features/music/cache'
import { startRadio } from '@/features/music/actions'
import { Portal } from '@solidjs/web'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import { api, post } from '@/lib/api/client'
import { MediaType, type FileItem } from '@/lib/files/types'
import { type FileSearchResponse, fileSearchResultToFileItem } from '@/lib/files/file-search'
import { buildThumbnailUrl } from '@/lib/media/build-media-url'
import {
  createUrlSearchParamsMemo,
  useBrowserHistory,
  navigateSearchParams,
} from '@/lib/browser/browser-history'
import { playbackItemFromFileItem } from '@/features/playback'
import { usePlaybackSession } from '@/features/playback/PlaybackProvider'
import ArrowRight from 'lucide-solid/icons/arrow-right'
import EllipsisVertical from 'lucide-solid/icons/ellipsis-vertical'
import FolderMinus from 'lucide-solid/icons/folder-minus'
import FolderOpen from 'lucide-solid/icons/folder-open'
import ListPlus from 'lucide-solid/icons/list-plus'
import LoaderCircle from 'lucide-solid/icons/loader-circle'
import BookOpen from 'lucide-solid/icons/book-open'
import { openInReader } from '@/features/reader/reader-url'
import Music2 from 'lucide-solid/icons/music-2'
import Radio from 'lucide-solid/icons/radio'
import StepForward from 'lucide-solid/icons/step-forward'
import Play from 'lucide-solid/icons/play'
import RefreshCw from 'lucide-solid/icons/refresh-cw'
import Search from 'lucide-solid/icons/search'
import ThumbsDown from 'lucide-solid/icons/thumbs-down'
import ThumbsUp from 'lucide-solid/icons/thumbs-up'
import { FloatingContextMenu } from '@/features/explorer/FloatingContextMenu'
import { selection, setMediaSelection } from './selection'
import { MediaCenterPlaybackSync } from '@/media-center/MediaCenterPlaybackSync'

type Pick = FileItem & {
  id?: number
  readingProgress?: number
  lastRead?: number
  pageIndex?: number
  description?: string
  reason?: string
  duration?: number
  plays?: number
  displayTitle?: string
  subtitle?: string
  previewKind?: string
  liked?: boolean
  previewPath?: string
  itemCount?: number
  members?: Pick[]
}
type Row = { title: string; items: Pick[] }
type Answer = { items: Pick[]; message: string; intent: string }
type Home = {
  rows: Row[]
  generatedAt: number
  feedId?: string
  resumeCursor?: number
  warming?: boolean
  profileResetAt?: number
  nextCursor?: number | null
}
type PageParam = { cursor: number; feedId?: string }
type HomePages = { pages: Home[]; pageParams: PageParam[] }
function isReading(item: FileItem) {
  return item.type === MediaType.BOOK || item.type === MediaType.PDF
}
function readyPicks(items: Pick[]) {
  return Promise.resolve(
    items.filter(
      (item) =>
        item.type === MediaType.AUDIO ||
        item.type === MediaType.VIDEO ||
        isReading(item) ||
        item.type === MediaType.FOLDER,
    ),
  )
}
function homeKey(category: string) {
  return category === 'all' || category === 'music'
    ? ['media-ai', 'home']
    : ['media-ai', 'home', category]
}
async function loadPage(param: PageParam, signal?: AbortSignal, category = 'all'): Promise<Home> {
  const query = new URLSearchParams({
    category,
    hour: String(new Date().getHours()),
    cursor: String(param.cursor),
  })
  if (param.feedId) query.set('feedId', param.feedId)
  const page = await api<Home>(`/api/media-ai/home?${query}`, { signal })
  return {
    ...page,
    rows: await Promise.all(
      page.rows.map(async (row) => ({ ...row, items: await readyPicks(row.items) })),
    ),
  }
}
function itemTitle(item: Pick) {
  return (
    item.displayTitle ||
    (item.type === MediaType.FOLDER ? item.name : item.name.replace(/\.[^.]+$/, ''))
  )
}
function durationLabel(seconds?: number) {
  if (!seconds) return ''
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0')}`
}
const button =
  'min-h-11 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-secondary disabled:opacity-50'
function asFile(item: Pick): FileItem {
  return {
    ...item,
    isDirectory: item.type === MediaType.FOLDER,
    size: item.size || 0,
    extension: item.name.split('.').pop() || '',
  }
}
export function ForYou(props: {
  actions?: HTMLDivElement
  aiEnabled: boolean
  searchOpen: boolean
  onOpenFolder: () => void
}) {
  const params = createUrlSearchParamsMemo(useBrowserHistory())
  const session = usePlaybackSession()
  const client = useQueryClient()
  const [category, setCategory] = createSignal<'all' | 'music' | 'video' | 'books'>('all')
  const [query, setQuery] = createSignal('')
  const [debounced, setDebounced] = createSignal('')
  const [history, setHistory] = createSignal<string[]>([])
  const [answer, setAnswer] = createSignal<Answer>()
  const [hidden, setHidden] = createSignal<string[]>([])
  const [notice, setNotice] = createSignal('')
  const [likes, setLikes] = createSignal<Record<string, boolean>>({})
  createEffect(
    () => notice(),
    (value) => {
      if (!value) return undefined
      const timer = setTimeout(() => setNotice(''), 4000)
      return () => clearTimeout(timer)
    },
  )
  createEffect(
    () => query(),
    (value) => {
      const timer = setTimeout(() => setDebounced(value.trim()), 180)
      return () => clearTimeout(timer)
    },
  )
  const home = useInfiniteQuery(() => {
    const staticCategory = category()
    return {
      queryKey: homeKey(staticCategory),
      enabled: props.aiEnabled && staticCategory !== 'music',
      reconcile: 'path',
      meta: { refetchOnSseConnect: false },
      initialPageParam: { cursor: 0 } as PageParam,
      queryFn: ({ pageParam, signal }) => loadPage(pageParam, signal, staticCategory),
      getNextPageParam: (page) =>
        page.nextCursor == null ? undefined : { cursor: page.nextCursor, feedId: page.feedId },
      staleTime: Infinity,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    }
  })
  const reading = useQuery(() => ({
    queryKey: ['media-ai', 'books'],
    queryFn: ({ signal }) => api<{ items: Pick[] }>('/api/media-ai/books', { signal }),
    staleTime: 0,
    refetchOnWindowFocus: 'always',
  }))
  createEffect(
    () => params().get('reader'),
    () => {
      void client.invalidateQueries({ queryKey: ['media-ai', 'books'] })
    },
  )
  const [sentinel, setSentinel] = createSignal<HTMLDivElement>()
  const refresh = useMutation(() => ({
    onMutate: () => client.cancelQueries({ queryKey: ['media-ai', 'home'] }),
    mutationFn: async (selectedCategory: string) => {
      const page = await post<Home>('/api/media-ai/refresh', {
        hour: new Date().getHours(),
        category: selectedCategory === 'music' ? 'all' : selectedCategory,
      })
      if (!page.rows) return loadPage({ cursor: 0 }, undefined, selectedCategory)
      return {
        ...page,
        rows: await Promise.all(
          page.rows.map(async (row) => ({ ...row, items: await readyPicks(row.items) })),
        ),
      }
    },
    onSuccess: (page, selectedCategory) => {
      void client.invalidateQueries({ queryKey: ['media-ai', 'books'] })
      void client.invalidateQueries({ queryKey: ['music', 'home'] })
      void client.invalidateQueries({ queryKey: ['music', 'playlists'] })
      client.setQueryData<HomePages>(homeKey(selectedCategory), {
        pages: [page],
        pageParams: [{ cursor: 0, feedId: page.feedId }],
      })
      setAnswer(undefined)
      setHistory([])
      setQuery('')
    },
  }))
  let pollingFeedId: string | undefined
  let pollingAttempts = 0
  const [waitingForRecommendations, setWaitingForRecommendations] = createSignal(false)
  createEffect(
    () => {
      if (category() !== 'all' || answer()) return undefined
      const last = queryData(home)?.pages.at(-1)
      return last?.warming && last.nextCursor == null
        ? {
            feedId: last.feedId,
            resumeCursor: last.resumeCursor,
            replaceEmpty: !last.rows.some((row) => row.items.length > 0),
          }
        : undefined
    },
    (last) => {
      if (!last?.feedId || last.resumeCursor === undefined) return undefined
      if (pollingFeedId !== last.feedId) {
        pollingFeedId = last.feedId
        pollingAttempts = 0
      }
      if (pollingAttempts >= 4) return undefined
      setWaitingForRecommendations(true)
      const param = { cursor: last.resumeCursor, feedId: last.feedId }
      const controller = new AbortController()
      let active = true
      let timer: ReturnType<typeof setTimeout>
      const poll = async () => {
        pollingAttempts++
        try {
          const page = await loadPage(param, controller.signal)
          if (!active) return
          const hasItems = page.rows.some((row) => row.items.length > 0)
          if (hasItems || !page.warming) {
            setWaitingForRecommendations(false)
            client.setQueryData<HomePages>(['media-ai', 'home'], (data) => {
              if (!data || data.pages.at(-1)?.feedId !== param.feedId) return data
              if (!hasItems)
                return {
                  ...data,
                  pages: data.pages.map((item, i) =>
                    i === data.pages.length - 1 ? { ...item, warming: false } : item,
                  ),
                }
              const replaceEmpty = last.replaceEmpty
              return {
                pages: [...(replaceEmpty ? data.pages.slice(0, -1) : data.pages), page],
                pageParams: [
                  ...(replaceEmpty ? data.pageParams.slice(0, -1) : data.pageParams),
                  param,
                ],
              }
            })
            return
          }
        } catch {
          if (!active) return
        }
        if (pollingAttempts >= 4) {
          setWaitingForRecommendations(false)
          return
        }
        timer = setTimeout(() => void poll(), 1500 * 2 ** pollingAttempts)
      }
      timer = setTimeout(() => void poll(), 1500)
      return () => {
        active = false
        setWaitingForRecommendations(false)
        clearTimeout(timer)
        controller.abort()
      }
    },
  )
  createEffect(
    () => ({
      element: sentinel(),
      canLoad:
        category() === 'all' && home.hasNextPage && !home.isFetching && !home.isError && !answer(),
    }),
    ({ element, canLoad }) => {
      if (!element || !canLoad) return undefined
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting) && !home.isFetching)
            void home.fetchNextPage({ cancelRefetch: false })
        },
        { rootMargin: '900px' },
      )
      observer.observe(element)
      return () => observer.disconnect()
    },
  )
  let profileResetAt: number | undefined
  createEffect(
    () => queryData(home)?.pages[0]?.profileResetAt,
    (next) => {
      if (next !== profileResetAt) setHidden([])
      profileResetAt = next
    },
  )
  function open(item: FileItem, files: FileItem[]) {
    if (item.isDirectory) {
      props.onOpenFolder()
      navigateSearchParams({ view: 'library', dir: item.path }, 'push')
      return
    }
    if (isReading(item)) {
      openInReader(item)
      return
    }
    const sameKind = files.filter((f) => f.type === item.type && !f.isDirectory)
    setMediaSelection(sameKind)
    if (item.type === MediaType.IMAGE) {
      navigateSearchParams({ viewing: item.path, view: 'for-you' }, 'push')
      return
    }
    const playable = playbackItemFromFileItem(item)
    if (!playable) {
      navigateSearchParams({ viewing: item.path, view: 'for-you' }, 'push')
      return
    }
    session.dispatch({
      type: 'load',
      item: playable,
      queue: sameKind.flatMap((f) => {
        const value = playbackItemFromFileItem(f)
        return value ? [value] : []
      }),
      autoplay: true,
      queueContext: { kind: 'manual', title: 'For you' },
    })
    navigateSearchParams({ playing: item.path, view: 'for-you', audioOnly: null }, 'push')
  }
  function playCollection(item: Pick) {
    const members = item.members ?? []
    const first = members[0]
    if (!first) return
    const current = playbackItemFromFileItem(asFile(first))
    if (!current) return
    const files = members.filter((member) => member.type === first.type).map(asFile)
    setMediaSelection(files)
    session.dispatch({
      type: 'load',
      item: current,
      queue: files.flatMap((file) => {
        const next = playbackItemFromFileItem(file)
        return next ? [next] : []
      }),
      autoplay: true,
      queueContext: { kind: 'manual', title: item.name },
    })
    navigateSearchParams(
      { view: 'library', dir: item.path, playing: first.path, audioOnly: null },
      'push',
    )
  }
  function queue(input: Pick[]) {
    const items = input.flatMap((item) =>
      item.type === MediaType.FOLDER ? (item.members ?? []) : [item],
    )
    const state = session.getSnapshot()
    const kind = state.currentItem?.media ?? items.find((i) => i.type !== MediaType.IMAGE)?.type
    const additions = items
      .filter((i) => i.type === kind)
      .flatMap((i) => {
        const p = playbackItemFromFileItem(asFile(i))
        return p ? [p] : []
      })
    if (!additions.length) {
      setNotice('No matching playable items to queue')
      return
    }
    const next = [...state.queue, ...additions]
    setMediaSelection(
      next.map((i) => ({
        path: i.locator,
        name: i.name,
        type: i.media === 'audio' ? MediaType.AUDIO : MediaType.VIDEO,
        size: 0,
        extension: '',
        isDirectory: false,
      })),
    )
    session.dispatch({ type: 'enqueue', items: additions, position: 'end' })
    setNotice(`Added ${additions.length} items to queue`)
  }
  const ask = useMutation(() => ({
    mutationFn: async (text: string) => {
      const result = await post<Answer>('/api/media-ai/ask', {
        query: text,
        history: history().slice(-6),
        hour: new Date().getHours(),
      })
      return { ...result, items: await readyPicks(result.items) }
    },
    onSuccess: (result, text) => {
      setAnswer(result)
      setHistory((h) => [...h, text].slice(-6))
      if (result.intent === 'play' && result.items[0]) {
        if (result.items[0].type === MediaType.FOLDER) playCollection(result.items[0])
        else open(asFile(result.items[0]), result.items.map(asFile))
      }
      if (result.intent === 'queue') queue(result.items)
    },
  }))
  const feedback = useMutation(() => ({
    mutationFn: (input: { path: string; kind: string }) => post('/api/media-ai/feedback', input),
    onSuccess: (_, input) => {
      if (input.kind === 'hide' || input.kind === 'later') setHidden((h) => [...h, input.path])
      if (input.kind === 'more' || input.kind === 'clear')
        setLikes((value) => ({ ...value, [input.path]: input.kind === 'more' }))
      setNotice(
        input.kind === 'more' ? 'Liked' : input.kind === 'clear' ? 'Like removed' : 'Hidden',
      )
      void client.invalidateQueries({ queryKey: ['media-ai', 'home'] })
      void client.invalidateQueries({ queryKey: ['media-ai', 'books'] })
      updateMusicFeedback(client, input)
    },
  }))
  const feed = createMemo(() => {
    const data = queryData(home)
    void home.dataUpdatedAt
    const selectedCategory = category()
    const readingData = queryData(reading)
    void reading.dataUpdatedAt
    return untrack(() => {
      const readingPaths = new Set(readingData?.items.map((book) => book.path))
      const seen = new Set<string>()
      return (data?.pages.flatMap((page) => page.rows.flatMap((row) => row.items)) ?? []).filter(
        (item) => {
          if (
            selectedCategory === 'music' &&
            item.type !== MediaType.AUDIO &&
            !(
              item.type === MediaType.FOLDER &&
              item.members?.some((m) => m.type === MediaType.AUDIO)
            )
          )
            return false
          if (
            selectedCategory === 'video' &&
            item.type !== MediaType.VIDEO &&
            !(
              item.type === MediaType.FOLDER &&
              item.members?.some((m) => m.type === MediaType.VIDEO)
            )
          )
            return false
          if (selectedCategory === 'all' && isReading(item)) return false
          if (selectedCategory === 'books' && !isReading(item)) return false
          if (readingPaths.has(item.path)) return false
          if (seen.has(item.path)) return false
          seen.add(item.path)
          return true
        },
      )
    })
  })
  const [menu, setMenu] = createSignal<{ item: Pick; x: number; y: number }>()
  const actionClass =
    'flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm hover:bg-secondary focus:bg-secondary'
  function BookCard(props: { item: Pick; compact?: boolean }) {
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
            <Show when={!props.compact && props.item.reason}>
              <span class='mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground'>
                {props.item.reason}
              </span>
            </Show>
            <span class='mt-2 flex items-center gap-2 text-xs text-muted-foreground'>
              <Show when={progress() != null} fallback={<span>Read book</span>}>
                <Show when={props.item.type !== MediaType.PDF}>
                  <span class='h-0.5 w-16 overflow-hidden rounded-full bg-foreground/10'>
                    <span
                      class='block h-full rounded-full bg-foreground/50'
                      style={{ width: `${Math.max(0, Math.min(1, progress() ?? 0)) * 100}%` }}
                    />
                  </span>
                </Show>
                <span class='tabular-nums'>
                  {props.item.type === MediaType.PDF && props.item.pageIndex != null
                    ? `Page ${props.item.pageIndex + 1}`
                    : `${Math.round((progress() ?? 0) * 100)}%`}
                </span>
                <Show when={props.item.type !== MediaType.PDF}>
                  <span>read</span>
                </Show>
              </Show>
            </span>
          </span>
          <ArrowRight
            size={16}
            class='shrink-0 text-muted-foreground/50 transition-transform group-hover/book:translate-x-0.5 group-hover/book:text-foreground'
          />
        </button>
        <Show when={!props.compact}>
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
        </Show>
      </div>
    )
  }
  function Cards(props: { items: Pick[]; readingShelf?: boolean; bookStrip?: boolean }) {
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
        <For each={visible()}>
          {(item) => (
            <article
              class={`group min-w-0 ${props.bookStrip ? 'w-[280px] shrink-0 md:w-0 md:flex-1' : ''} ${isReading(item) && !props.readingShelf ? 'col-span-2 sm:col-span-1' : ''}`}
            >
              <Show
                when={!isReading(item)}
                fallback={<BookCard item={item} compact={props.bookStrip} />}
              >
                <button
                  class='relative block aspect-video w-full overflow-hidden rounded-lg bg-secondary text-left focus-visible:ring-2 focus-visible:ring-ring sm:rounded-xl'
                  aria-label={`${isReading(item) ? 'Read' : item.type === MediaType.FOLDER ? 'Open' : 'Play'} ${item.name}`}
                  title={item.reason}
                  onClick={() => open(asFile(item), visible().map(asFile))}
                >
                  <span class='absolute inset-0 grid place-items-center text-muted-foreground'>
                    <Show when={isReading(item)} fallback={<Music2 size={32} />}>
                      <BookOpen size={32} />
                    </Show>
                  </span>
                  <Show when={!isReading(item)}>
                    <img
                      onError={(event) => {
                        event.currentTarget.style.visibility = 'hidden'
                      }}
                      src={buildThumbnailUrl(item.previewPath || item.path, 2)}
                      alt=''
                      class='relative h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]'
                    />
                  </Show>
                  <span class='absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/15'>
                    <span class='flex size-12 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100'>
                      <Show
                        when={item.type === MediaType.FOLDER}
                        fallback={
                          <Show when={isReading(item)} fallback={<Play size={22} />}>
                            <BookOpen size={22} />
                          </Show>
                        }
                      >
                        <FolderOpen size={22} />
                      </Show>
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
                  <Show when={isReading(item) && item.readingProgress != null}>
                    <span class='absolute right-2 bottom-2 rounded bg-black/75 px-2 py-1 text-xs text-white'>
                      {item.type === MediaType.PDF && item.pageIndex != null
                        ? `Page ${item.pageIndex + 1}`
                        : `${Math.round((item.readingProgress ?? 0) * 100)}%`}
                    </span>
                  </Show>
                  <Show when={durationLabel(item.duration)}>
                    <span class='absolute right-1 bottom-1 rounded bg-black/75 px-1 py-0.5 text-[10px] tabular-nums text-white sm:right-2 sm:bottom-2 sm:px-1.5 sm:text-xs'>
                      {durationLabel(item.duration)}
                    </span>
                  </Show>
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
                      aria-pressed={(likes()[item.path] ?? item.liked ?? false) ? 'true' : 'false'}
                      class={`hidden items-center justify-center rounded-full p-2 transition-colors min-h-11 min-w-11 hover:bg-secondary sm:inline-flex ${(likes()[item.path] ?? item.liked) ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
                      disabled={feedback.isPending}
                      onClick={() =>
                        void feedback.mutate({
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
                      onClick={() => void feedback.mutate({ path: item.path, kind: 'hide' })}
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
              </Show>
            </article>
          )}
        </For>
      </div>
    )
  }
  return (
    <main
      class='mx-auto w-full max-w-[1920px] space-y-3 px-2 pb-3 sm:space-y-4 sm:px-7 sm:pb-5 lg:px-9'
      data-testid='for-you'
    >
      <MediaCenterPlaybackSync
        playingPath={() => params().get('playing')}
        audioOnly={() => params().get('audioOnly') === 'true'}
        session={session}
        files={selection}
        displayedFiles={selection}
      />
      <div class='flex items-center gap-2 py-2' role='group' aria-label='For you categories'>
        <For
          each={[
            { id: 'all' as const, title: 'All' },
            { id: 'music' as const, title: 'Music' },
            { id: 'video' as const, title: 'Videos' },
            { id: 'books' as const, title: 'Books' },
          ]}
        >
          {(item) => (
            <button
              class={`min-h-11 rounded-full px-5 text-sm font-medium ${category() === item.id ? 'bg-primary text-primary-foreground' : 'bg-secondary/50 text-muted-foreground hover:bg-secondary'}`}
              aria-pressed={category() === item.id ? 'true' : 'false'}
              onClick={() => setCategory(item.id)}
            >
              {item.title}
            </button>
          )}
        </For>
      </div>
      <Show when={props.aiEnabled && props.actions}>
        {(mount) => (
          <Portal mount={mount()}>
            <button
              class='flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50 pointer-coarse:h-11 pointer-coarse:w-11'
              aria-label='Refresh recommendations'
              title='Refresh recommendations'
              aria-busy={refresh.isPending ? 'true' : 'false'}
              disabled={refresh.isPending || home.isFetching}
              onClick={() => void refresh.mutate(category())}
            >
              <RefreshCw size={18} class={refresh.isPending ? 'animate-spin' : ''} />
            </button>
          </Portal>
        )}
      </Show>
      <Show when={props.searchOpen || ask.error}>
        <section class='space-y-3'>
          <Show when={props.searchOpen}>
            <div class='mx-auto flex h-9 pointer-coarse:h-11 w-full max-w-xl items-center'>
              <form
                class='flex h-9 pointer-coarse:h-11 min-w-0 flex-1 items-center gap-2 rounded-lg bg-card pl-3 ring-1 ring-inset ring-border'
                onSubmit={(e) => {
                  e.preventDefault()
                  if (props.aiEnabled && query().trim()) void ask.mutate(query().trim())
                }}
              >
                <Search size={18} class='shrink-0 text-muted-foreground' />
                <input
                  ref={(element) => queueMicrotask(() => element.focus())}
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
                  <Show when={ask.isPending} fallback={<ArrowRight size={18} />}>
                    <LoaderCircle size={18} class='animate-spin' />
                  </Show>
                </button>
              </form>
            </div>
          </Show>
          <Show when={history().length}>
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
          </Show>
          <Loading>
            <Show when={debounced().length >= 3 && debounced().length <= 200}>
              <LibraryMatches query={debounced()} open={open} />
            </Show>
          </Loading>
          <Show when={ask.error}>
            <p role='alert' class='text-sm text-red-500'>
              Search is unavailable right now. Please try again.
            </p>
          </Show>
        </section>
      </Show>
      <Show when={answer()}>
        {(result) => (
          <section class='space-y-4'>
            <Show when={!result().items.length}>
              <p class='text-sm text-muted-foreground'>{result().message || 'No matches.'}</p>
            </Show>
            <Cards items={result().items} />
          </section>
        )}
      </Show>
      <Show when={!answer()}>
        <Show
          when={
            (category() === 'all' || category() === 'books') && queryData(reading)?.items.length
          }
        >
          <section class='space-y-4' aria-label='Books'>
            <div class='flex items-center justify-between'>
              <h2 class='text-lg font-semibold'>Books</h2>
              <Show when={category() === 'all'}>
                <button
                  class='flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring'
                  onClick={() => setCategory('books')}
                >
                  See all <ArrowRight size={16} />
                </button>
              </Show>
            </div>
            <Cards
              items={
                category() === 'all'
                  ? (queryData(reading)?.items ?? []).slice(0, 3)
                  : (queryData(reading)?.items ?? [])
              }
              readingShelf
              bookStrip={category() === 'all'}
            />
          </section>
        </Show>
        <Show when={(category() === 'all' || category() === 'books') && reading.error}>
          <div
            role='alert'
            class='flex flex-wrap items-center gap-3 py-4 text-sm text-muted-foreground'
          >
            <span>Couldn’t load your reading progress.</span>
            <button class={button} onClick={() => void reading.refetch()}>
              Try again
            </button>
          </div>
        </Show>
        <Show when={category() === 'all' || category() === 'music'}>
          <MusicHome />
        </Show>
        <Show when={props.aiEnabled && category() !== 'music' && feed().length}>
          <section class='space-y-4 pt-4' aria-label='Recommended media'>
            <h2 class='text-lg font-semibold'>
              {category() === 'books'
                ? 'More books'
                : category() === 'video'
                  ? 'Videos for you'
                  : 'More for you'}
            </h2>
            <Cards items={feed()} />
          </section>
        </Show>
        <Show
          when={
            props.aiEnabled &&
            category() !== 'music' &&
            (home.isPending || home.isFetchingNextPage || waitingForRecommendations())
          }
        >
          <div
            role='status'
            class='flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground'
          >
            <LoaderCircle size={17} class='animate-spin' />
            Loading…
          </div>
        </Show>
        <Show when={category() !== 'music' && home.error}>
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
                home.isFetchNextPageError ? void home.fetchNextPage() : void home.refetch()
              }
            >
              Try again
            </button>
          </div>
        </Show>
        <div ref={setSentinel} />
        <Show
          when={
            props.aiEnabled &&
            (category() === 'video' || category() === 'books') &&
            !home.isPending &&
            !home.error &&
            !waitingForRecommendations() &&
            !feed().length &&
            (category() !== 'books' || !queryData(reading)?.items.length)
          }
        >
          <p class='py-12 text-center text-sm text-muted-foreground'>
            {category() === 'books'
              ? 'No book recommendations yet. Try searching your library.'
              : 'Nothing to play yet. Try searching your library.'}
          </p>
        </Show>
        <Show when={category() !== 'music' && home.hasNextPage && !home.isFetching && !home.error}>
          <div class='text-center'>
            <button class={button} onClick={() => void home.fetchNextPage()}>
              {category() === 'books' ? 'Load more recommendations' : 'More to play'}
            </button>
          </div>
        </Show>
      </Show>
      <FloatingContextMenu
        state={menu}
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
                void feedback.mutate({
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
                void feedback.mutate({ path: value.item.path, kind: 'hide' })
                setMenu(undefined)
              }}
            >
              <ThumbsDown size={17} />
              Not interested
            </button>
            <Show when={!isReading(value.item)}>
              <button
                class={actionClass}
                onClick={() => {
                  if (value.item.type === MediaType.FOLDER) playCollection(value.item)
                  else queue([value.item])
                  setMenu(undefined)
                }}
              >
                <Show
                  when={value.item.type === MediaType.FOLDER}
                  fallback={
                    <>
                      <ListPlus size={17} />
                      Add to queue
                    </>
                  }
                >
                  <Play size={17} />
                  Play collection
                </Show>
              </button>
            </Show>
            <Show when={value.item.type === MediaType.AUDIO}>
              <button
                class={actionClass}
                onClick={() => {
                  const item = playbackItemFromFileItem(asFile(value.item))
                  if (item) session.dispatch({ type: 'enqueue', items: [item], position: 'next' })
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
                    session,
                    client,
                    { seeds: [value.item.path] },
                    `${itemTitle(value.item)} radio`,
                  )
                  setMenu(undefined)
                }}
              >
                <Radio size={17} />
                Start radio
              </button>
            </Show>

            <Show when={value.item.type === MediaType.FOLDER || value.item.path.includes('/')}>
              <button
                class={actionClass}
                onClick={() => {
                  void feedback.mutate({
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
            </Show>
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
      <Show when={refresh.error || feedback.error || notice()}>
        <div class='pointer-events-none fixed top-20 right-4 z-50 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card px-4 py-3 text-sm shadow-lg'>
          <Show when={refresh.error || feedback.error} fallback={<p role='status'>{notice()}</p>}>
            <p role='alert' class='text-red-500'>
              {refresh.error
                ? 'Couldn’t refresh recommendations. Please try again.'
                : 'Couldn’t save that change. Please try again.'}
            </p>
          </Show>
        </div>
      </Show>
    </main>
  )
}

function LibraryMatches(props: {
  query: string
  open: (item: FileItem, files: FileItem[]) => void
}) {
  const exact = useQuery(() => ({
    queryKey: ['media-ai', 'matches', props.query] as const,
    queryFn: ({ queryKey, signal }) =>
      api<FileSearchResponse>(`/api/files/search?q=${encodeURIComponent(queryKey[2])}&limit=12`, {
        signal,
      }),
  }))
  return (
    <Show when={queryData(exact)?.results.length || exact.error}>
      <div class='rounded-xl border border-border bg-card p-3'>
        <p class='mb-2 text-xs text-muted-foreground'>Library matches</p>
        <Show when={exact.error}>
          <p role='alert' class='text-sm text-destructive'>
            {exact.error?.message}
          </p>
        </Show>
        <div class='grid gap-1 sm:grid-cols-2'>
          <For each={queryData(exact)?.results}>
            {(result) => (
              <button
                class='truncate rounded-lg px-3 py-2 text-left text-sm hover:bg-secondary'
                title={result.path}
                onClick={() =>
                  props.open(
                    fileSearchResultToFileItem(result),
                    (queryData(exact)?.results ?? []).map(fileSearchResultToFileItem),
                  )
                }
              >
                {result.isDirectory ? '▸ ' : ''}
                {result.name}
                <span class='ml-2 text-xs text-muted-foreground'>{result.parentPath}</span>
              </button>
            )}
          </For>
        </div>
      </div>
    </Show>
  )
}
