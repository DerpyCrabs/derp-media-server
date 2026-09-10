import { createEffect, createMemo, createSignal, For, Show } from 'solid-js'
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
import {
  ArrowRight,
  EllipsisVertical,
  FolderMinus,
  FolderOpen,
  ListPlus,
  LoaderCircle,
  Play,
  RefreshCw,
  Search,
  ThumbsDown,
  ThumbsUp,
} from 'lucide-solid'
import { FloatingContextMenu } from '@/features/explorer/FloatingContextMenu'
import { selection, setMediaSelection } from './selection'
import { MediaCenterPlaybackSync } from '@/media-center/MediaCenterPlaybackSync'

type Pick = FileItem & {
  id: number
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
async function readyPicks(items: Pick[]) {
  const ready = await Promise.all(
    items
      .filter(
        (i) =>
          i.type === MediaType.AUDIO || i.type === MediaType.VIDEO || i.type === MediaType.FOLDER,
      )
      .map(async (item) => {
        const image = new Image()
        image.src = buildThumbnailUrl(item.previewPath || item.path, 2)
        try {
          await image.decode()
          return image.naturalWidth > 1 && image.naturalHeight > 1 ? item : null
        } catch {
          return null
        }
      }),
  )
  return ready.filter((item): item is Pick => item !== null)
}
async function loadPage(param: PageParam, signal?: AbortSignal): Promise<Home> {
  const query = new URLSearchParams({
    hour: String(new Date().getHours()),
    cursor: String(param.cursor),
  })
  if (param.feedId) query.set('feedId', param.feedId)
  const page = await api<Home>(`/api/media-ai/home?${query}`, { signal })
  return {
    ...page,
    rows: [{ title: 'For you', items: await readyPicks(page.rows.flatMap((row) => row.items)) }],
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
  searchOpen: boolean
  onOpenFolder: () => void
}) {
  const params = createUrlSearchParamsMemo(useBrowserHistory())
  const session = usePlaybackSession()
  const client = useQueryClient()
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
  const home = useInfiniteQuery(() => ({
    queryKey: ['media-ai', 'home'],
    reconcile: 'path',
    meta: { refetchOnSseConnect: false },
    initialPageParam: { cursor: 0 } as PageParam,
    queryFn: ({ pageParam, signal }) => loadPage(pageParam, signal),
    getNextPageParam: (page) =>
      page.nextCursor == null ? undefined : { cursor: page.nextCursor, feedId: page.feedId },
    staleTime: 60_000,
  }))
  const [sentinel, setSentinel] = createSignal<HTMLDivElement>()
  const refresh = useMutation(() => ({
    onMutate: () => client.cancelQueries({ queryKey: ['media-ai', 'home'] }),
    mutationFn: async () => {
      const page = await post<Home>('/api/media-ai/refresh', { hour: new Date().getHours() })
      if (!page.rows) return loadPage({ cursor: 0 })
      return {
        ...page,
        rows: [
          { title: 'For you', items: await readyPicks(page.rows.flatMap((row) => row.items)) },
        ],
      }
    },
    onSuccess: (page) => {
      client.setQueryData<HomePages>(['media-ai', 'home'], {
        pages: [page],
        pageParams: [{ cursor: 0, feedId: page.feedId }],
      })
      setAnswer(undefined)
      setHistory([])
      setQuery('')
    },
  }))
  createEffect(
    () => {
      const last = home.data?.pages.at(-1)
      return last?.warming && last.nextCursor == null ? last : undefined
    },
    (last) => {
      if (!last?.feedId || last.resumeCursor === undefined) return undefined
      const param = { cursor: last.resumeCursor, feedId: last.feedId }
      const controller = new AbortController()
      let active = true
      let timer: ReturnType<typeof setTimeout>
      const poll = async () => {
        try {
          const page = await loadPage(param, controller.signal)
          if (!active) return
          const hasItems = page.rows.some((row) => row.items.length > 0)
          if (hasItems || !page.warming) {
            client.setQueryData<HomePages>(['media-ai', 'home'], (data) => {
              if (!data || data.pages.at(-1)?.feedId !== param.feedId) return data
              if (!hasItems)
                return {
                  ...data,
                  pages: data.pages.map((item, i) =>
                    i === data.pages.length - 1 ? { ...item, warming: false } : item,
                  ),
                }
              const replaceEmpty = !last.rows.some((row) => row.items.length > 0)
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
        timer = setTimeout(() => void poll(), 1500)
      }
      timer = setTimeout(() => void poll(), 1500)
      return () => {
        active = false
        clearTimeout(timer)
        controller.abort()
      }
    },
  )
  createEffect(
    () => ({
      element: sentinel(),
      canLoad: home.hasNextPage && !home.isFetching && !home.isError && !answer(),
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
    () => home.data?.pages[0]?.profileResetAt,
    (next) => {
      if (next !== profileResetAt) setHidden([])
      profileResetAt = next
    },
  )
  const exact = useQuery(() => ({
    queryKey: ['media-ai', 'matches', debounced()],
    queryFn: () =>
      api<FileSearchResponse>(`/api/files/search?q=${encodeURIComponent(debounced())}&limit=12`),
    enabled: debounced().length >= 3 && debounced().length <= 200,
  }))
  function open(item: FileItem, files: FileItem[]) {
    if (item.isDirectory) {
      props.onOpenFolder()
      navigateSearchParams({ view: 'library', dir: item.path }, 'push')
      return
    }
    const sameKind = files.filter((f) => f.type === item.type && !f.isDirectory)
    setMediaSelection(sameKind)
    if (item.type === MediaType.IMAGE) {
      navigateSearchParams({ viewing: item.path, view: 'for-you', dir: null }, 'push')
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
    })
    navigateSearchParams(
      { playing: item.path, view: 'for-you', dir: null, audioOnly: null },
      'push',
    )
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
    session.dispatch({ type: 'setQueue', queue: next, current: state.currentItem ?? additions[0] })
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
    },
  }))
  const feed = createMemo(() => {
    const seen = new Set<string>()
    return (home.data?.pages.flatMap((page) => page.rows.flatMap((row) => row.items)) ?? []).filter(
      (item) => {
        if (seen.has(item.path)) return false
        seen.add(item.path)
        return true
      },
    )
  })
  const [menu, setMenu] = createSignal<{ item: Pick; x: number; y: number }>()
  const actionClass =
    'flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm hover:bg-secondary focus:bg-secondary'
  function Cards(props: { items: Pick[] }) {
    const visible = () =>
      props.items.filter((i) => !hidden().some((p) => i.path === p || i.path.startsWith(`${p}/`)))
    return (
      <div class='grid grid-cols-2 gap-x-2 gap-y-4 sm:gap-x-5 sm:gap-y-7 min-[1000px]:grid-cols-3 min-[1440px]:grid-cols-4'>
        <For each={visible()}>
          {(item) => (
            <article class='group min-w-0'>
              <button
                class='relative block aspect-video w-full overflow-hidden rounded-lg bg-secondary text-left focus-visible:ring-2 focus-visible:ring-ring sm:rounded-xl'
                aria-label={`${item.type === MediaType.FOLDER ? 'Open' : 'Play'} ${item.name}`}
                title={item.reason}
                onClick={() => open(asFile(item), visible().map(asFile))}
              >
                <img
                  src={buildThumbnailUrl(item.previewPath || item.path, 2)}
                  alt=''
                  class='h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]'
                />
                <span class='absolute inset-0 flex items-center justify-center bg-black/0 transition-colors group-hover:bg-black/15'>
                  <span class='flex size-12 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100'>
                    <Show when={item.type === MediaType.FOLDER} fallback={<Play size={22} />}>
                      <FolderOpen size={22} />
                    </Show>
                  </span>
                </span>
                <span class='absolute top-1 left-1 rounded bg-black/75 px-1 py-0.5 text-[10px] font-medium text-white sm:top-auto sm:bottom-2 sm:left-2 sm:px-2 sm:py-1 sm:text-[11px]'>
                  {item.type === MediaType.FOLDER
                    ? `${item.itemCount ?? 0} items · Folder`
                    : item.type === MediaType.AUDIO
                      ? 'Music'
                      : 'Video'}
                </span>
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
      <Show when={props.actions}>
        {(mount) => (
          <Portal mount={mount()}>
            <button
              class='flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50 pointer-coarse:h-11 pointer-coarse:w-11'
              aria-label='Refresh recommendations'
              title='Refresh recommendations'
              aria-busy={refresh.isPending ? 'true' : 'false'}
              disabled={refresh.isPending || home.isFetching}
              onClick={() => refresh.mutate()}
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
                  if (query().trim()) ask.mutate(query().trim())
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
                  disabled={ask.isPending || !query().trim()}
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
          <Show when={debounced().length >= 3 && exact.data?.results.length}>
            <div class='rounded-xl border border-border bg-card p-3'>
              <p class='mb-2 text-xs text-muted-foreground'>Library matches</p>
              <div class='grid gap-1 sm:grid-cols-2'>
                <For each={exact.data?.results}>
                  {(result) => (
                    <button
                      class='truncate rounded-lg px-3 py-2 text-left text-sm hover:bg-secondary'
                      title={result.path}
                      onClick={() =>
                        open(
                          fileSearchResultToFileItem(result),
                          (exact.data?.results ?? []).map(fileSearchResultToFileItem),
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
        <Cards items={feed()} />
        <Show when={home.isPending || home.isFetchingNextPage || home.data?.pages.at(-1)?.warming}>
          <div
            role='status'
            class='flex items-center justify-center gap-3 py-12 text-sm text-muted-foreground'
          >
            <LoaderCircle size={17} class='animate-spin' />
            Loading…
          </div>
        </Show>
        <Show when={home.error}>
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
            !home.isPending && !home.error && !home.data?.pages.at(-1)?.warming && !feed().length
          }
        >
          <p class='py-12 text-center text-sm text-muted-foreground'>
            Nothing to play yet. Try searching your library.
          </p>
        </Show>
        <Show when={home.hasNextPage && !home.isFetching && !home.error}>
          <div class='text-center'>
            <button class={button} onClick={() => void home.fetchNextPage()}>
              More to play
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
              class={`${actionClass} sm:hidden`}
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
              class={`${actionClass} sm:hidden`}
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
            <Show when={value.item.type === MediaType.FOLDER || value.item.path.includes('/')}>
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
