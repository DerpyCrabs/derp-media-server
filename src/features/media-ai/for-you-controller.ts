import { createMediaCenterPlaybackSync } from '@/media-center/media-center-playback-sync'
import { Effect, Schema } from 'effect'
import { available, modelOwner } from 'effectweb'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { groups, queryCache, initialData } from '@/lib/api/cache'
import { postSchemaEffect } from '@/lib/api/client'
import { updateMusicFeedback } from '@/features/music/cache'
import { getPlaybackSession } from '@/features/playback/PlaybackProvider'
import { playbackItemFromFileItem } from '@/features/playback'
import { browserHistory, navigateSearchParams } from '@/lib/browser/browser-history'
import { MediaType, type FileItem } from '@/lib/files/types'
import { openInReader } from '@/features/reader/reader-url'
import { setMediaSelection, mediaSelectionSource } from './selection'
import {
  asFile,
  isReading,
  preparePage,
  refreshRecommendationSchema,
  libraryAnswerSchema,
  initialRecommendationPagesSchema,
  type Recommendation as Pick,
  type Answer,
  type Home,
  type PageParam,
  type Category,
  type ForYouProps as Props,
} from './recommendation-model'
import { homeKey, homeQuery, readingQuery, loadPage } from './recommendation-queries'
import { infiniteResource, observeQuery, type InfiniteData } from '@effectweb/query'
const slots = { poll: 'warming-feed', notice: 'feed-notice', debounce: 'library-search-delay' }
export function createForYou(props: Props) {
  const session = getPlaybackSession()
  // Results of the feed's actions, published by `owner.task` under the same keys.
  const initialTask = () => AsyncResult.initial() as AsyncResult.AsyncResult<unknown, unknown>
  const owner = modelOwner({
    props,
    category: 'all' as Category,
    query: '',
    debounced: '',
    history: [] as readonly string[],
    answer: undefined as Answer | undefined,
    hidden: [] as string[],
    notice: '',
    likes: {} as Record<string, boolean>,
    menu: undefined as { item: Pick; x: number; y: number } | undefined,
    waitingForRecommendations: false,
    home: AsyncResult.initial<InfiniteData<Home, PageParam>, unknown>() as AsyncResult.AsyncResult<
      InfiniteData<Home, PageParam>,
      unknown
    >,
    reading: AsyncResult.initial<{ items: Pick[] }, unknown>() as AsyncResult.AsyncResult<
      { items: Pick[] },
      unknown
    >,
    refreshResult: initialTask(),
    askResult: initialTask(),
    feedbackResult: initialTask(),
    pageResult: initialTask(),
  })
  const actions = {
    open,
    playCollection,
    queue,
    setCategory,
    setQuery,
    setHistory,
    setAnswer,
    setMenu,
    refresh: refreshFeed,
    ask: askLibrary,
    feedback: saveFeedback,
    loadNext,
    refreshReading: () => reading.refresh(),
  }
  const home = owner.own(infiniteResource(queryCache, homeQuery))
  const reading = observeQuery(owner, queryCache, readingQuery, 'reading')
  let selectedCategory = ''
  let profileResetAt: number | null | undefined
  let pollingKey = ''
  const stopHome = home.subscribe((result) => {
    owner.patch({ home: result })
    const data = available(result)
    if (data?.pages[0]?.value.profileResetAt !== profileResetAt) {
      profileResetAt = data?.pages[0]?.value.profileResetAt
      owner.patch({ hidden: [] })
    }
    const last = data?.pages.at(-1)?.value
    if (
      owner.read().category !== 'all' ||
      owner.read().answer ||
      !last?.warming ||
      last.nextCursor != null ||
      !last.feedId ||
      last.resumeCursor == null
    )
      return
    const key = `${last.feedId}:${last.resumeCursor}`
    if (key === pollingKey) return
    pollingKey = key
    owner.patch({ waitingForRecommendations: true })
    const param = { cursor: last.resumeCursor, feedId: last.feedId }
    owner.run(
      slots.poll,
      Effect.gen(function* () {
        for (let attempt = 0; attempt < 4; attempt++) {
          yield* Effect.sleep(attempt === 0 ? 1500 : 1500 * 2 ** attempt)
          const page = yield* loadPage(param).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (!page) continue
          const hasItems = page.rows.some((row) => row.items.length > 0)
          if (!hasItems && page.warming) continue
          queryCache.updateQueryData(homeQuery.query, 'all', (data) => {
            if (data.pages.at(-1)?.value.feedId !== param.feedId) return data
            const replaceEmpty = !last.rows.some((row) => row.items.length > 0)
            const pages = hasItems
              ? [...(replaceEmpty ? data.pages.slice(0, -1) : data.pages), { param, value: page }]
              : data.pages.map((entry, i) =>
                  i === data.pages.length - 1
                    ? { ...entry, value: { ...entry.value, warming: false } }
                    : entry,
                )
            return {
              pages,
              next:
                page.nextCursor == null
                  ? undefined
                  : { cursor: page.nextCursor, feedId: page.feedId },
            }
          })
          return
        }
      }).pipe(
        // Not a finalizer: a replaced poll must not clear the newer poll's status.
        Effect.tap(() => Effect.sync(() => owner.patch({ waitingForRecommendations: false }))),
        Effect.tapCause(() => Effect.sync(() => owner.patch({ waitingForRecommendations: false }))),
      ),
      'replace',
    )
  })
  owner.own(stopHome)
  function select() {
    const state = owner.read()
    const category = state.category === 'music' ? 'all' : state.category
    if (selectedCategory !== category) {
      selectedCategory = category
      const bootstrap = initialData(homeKey(category))
      const decoded = Schema.decodeUnknownExit(initialRecommendationPagesSchema)(bootstrap)
      const seeded = decoded._tag === 'Success' ? decoded.value : undefined
      if (seeded && !queryCache.getQueryData(homeQuery.query, category)) {
        const pages = seeded.pages.map((value, index) => ({
          value,
          param: seeded.pageParams[index] ?? { cursor: 0 },
        }))
        const last = pages.at(-1)?.value
        home.seed(category, {
          pages,
          next:
            last?.nextCursor == null ? undefined : { cursor: last.nextCursor, feedId: last.feedId },
        })
      }
    }
    home.select(state.props.aiEnabled && state.category !== 'music' ? category : undefined)
  }
  function setCategory(category: Category) {
    owner.patch({ category })
    select()
  }
  function setQuery(query: string) {
    owner.patch({ query })
    owner.run(
      slots.debounce,
      Effect.sleep(180).pipe(
        Effect.andThen(Effect.sync(() => owner.patch({ debounced: query.trim() }))),
      ),
      'replace',
    )
  }
  function setHistory(history: readonly string[]) {
    owner.patch({ history })
  }
  function setAnswer(answer: Answer | undefined) {
    owner.patch({ answer })
  }
  function setMenu(menu: { item: Pick; x: number; y: number } | undefined) {
    owner.patch({ menu })
  }
  function setNotice(notice: string) {
    owner.patch({ notice })
    owner.run(
      slots.notice,
      Effect.sleep(4000).pipe(Effect.andThen(Effect.sync(() => owner.patch({ notice: '' })))),
      'replace',
    )
  }
  function loadNext() {
    if (!available(owner.read().home)?.next || owner.read().home.waiting) return
    owner.task('pageResult', home.fetchNextPage(), 'drop')
  }
  function refreshFeed(category: Category) {
    const selected = category === 'music' ? 'all' : category
    queryCache.cancelQuery(homeQuery.query, selected)
    owner.cancel(slots.poll)
    owner.patch({ waitingForRecommendations: false })
    owner.task(
      'refreshResult',
      postSchemaEffect(refreshRecommendationSchema, '/api/media-ai/refresh', {
        hour: new Date().getHours(),
        category: selected,
      }).pipe(
        Effect.flatMap((page) =>
          'rows' in page ? Effect.succeed(preparePage(page)) : loadPage({ cursor: 0 }, selected),
        ),
        Effect.tap((page) =>
          Effect.sync(() => {
            queryCache.invalidateQuery(readingQuery)
            queryCache.invalidateGroup(groups.music)
            home.seed(selected, {
              pages: [{ param: { cursor: 0, feedId: page.feedId }, value: page }],
              next:
                page.nextCursor == null
                  ? undefined
                  : { cursor: page.nextCursor, feedId: page.feedId },
            })
            owner.patch({
              answer: undefined,
              history: [],
              query: '',
              debounced: '',
              pageResult: initialTask(),
            })
          }),
        ),
      ),
      'drop',
    )
  }
  function askLibrary(text: string) {
    owner.task(
      'askResult',
      postSchemaEffect(libraryAnswerSchema, '/api/media-ai/ask', {
        query: text,
        history: owner.read().history.slice(-6),
        hour: new Date().getHours(),
      }).pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            owner.patch({ answer: result, history: [...owner.read().history, text].slice(-6) })
            if (result.intent === 'play' && result.items[0]) {
              if (result.items[0].type === MediaType.FOLDER) playCollection(result.items[0])
              else open(asFile(result.items[0]), result.items.map(asFile))
            }
            if (result.intent === 'queue') queue(result.items)
          }),
        ),
      ),
      'drop',
    )
  }
  function saveFeedback(input: { path: string; kind: string }) {
    owner.task(
      'feedbackResult',
      postSchemaEffect(Schema.Struct({ ok: Schema.Boolean }), '/api/media-ai/feedback', input).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            if (input.kind === 'hide' || input.kind === 'later')
              owner.edit('hidden', (hidden) => [...hidden, input.path])
            if (input.kind === 'more' || input.kind === 'clear')
              owner.edit('likes', (likes) => ({ ...likes, [input.path]: input.kind === 'more' }))
            setNotice(
              input.kind === 'more' ? 'Liked' : input.kind === 'clear' ? 'Like removed' : 'Hidden',
            )
            updateMusicFeedback(input)
          }),
        ),
      ),
      'drop',
    )
  }
  function open(item: FileItem, files: readonly FileItem[]) {
    if (item.isDirectory) {
      owner.read().props.onOpenFolder()
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
      {
        view: first.type === MediaType.VIDEO ? 'library' : 'for-you',
        ...(first.type === MediaType.VIDEO ? { dir: item.path } : {}),
        playing: first.path,
        audioOnly: null,
      },
      'push',
    )
  }
  function queue(input: readonly Pick[]) {
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
  const playbackProps = () => {
    const params = new URLSearchParams(browserHistory.model().search)
    const files = mediaSelectionSource.model().selection
    return {
      playingPath: params.get('playing'),
      audioOnly: params.get('audioOnly') === 'true',
      files,
      displayedFiles: files,
      session,
    }
  }
  const playbackSync = owner.own(createMediaCenterPlaybackSync(playbackProps()))
  owner.own(mediaSelectionSource.subscribe(() => playbackSync.receive(playbackProps())))
  let previousReader = new URLSearchParams(browserHistory.model().search).get('reader')
  owner.own(
    browserHistory.subscribe((location) => {
      playbackSync.receive(playbackProps())
      const next = new URLSearchParams(location.search).get('reader')
      if (next !== previousReader) {
        previousReader = next
        reading.refresh()
      }
    }),
  )
  const focus = () => reading.refresh()
  window.addEventListener('focus', focus)
  owner.own(() => window.removeEventListener('focus', focus))
  reading.select(true)
  select()
  return {
    source: owner.source,
    ...actions,
    receive: (props: Props) => {
      owner.patch({ props })
      select()
    },
    lifetime: owner,
  }
}
