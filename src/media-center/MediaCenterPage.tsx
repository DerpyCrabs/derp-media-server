import { Effect } from 'effect'
import * as AsyncResult from 'effect/reactivity/AsyncResult'
import { available, domBinding, modelOwner, observe, view, controllerView } from 'effectweb'
import { queryCache } from '@/lib/api/cache'
import { configQuery, settingsQuery, type ServerConfig } from '@/lib/api/queries'
import type { WorkspaceSettings } from '@/workspace/model/workspace-settings-types'
import { mediaAiStatusQuery, type IndexingStatus } from '@/features/music/queries'
import { browserHistory, navigateSearchParams } from '@/lib/browser/browser-history'
import { ForYou } from '@/features/media-ai/ForYou'
import { MediaCenterFileBrowser } from './MediaCenterFileBrowser'
import { MainMediaPlayers } from './MainMediaPlayers'
import { playbackSource } from '@/features/playback/PlaybackProvider'
import House from '@effectweb/lucide/icons/house'
import FolderClosed from '@effectweb/lucide/icons/folder-closed'
import Search from '@effectweb/lucide/icons/search'
import LoaderCircle from '@effectweb/lucide/icons/loader-circle'
import { cn } from '@/lib/ui/cn'
import { observeQuery } from '@effectweb/query'
const statusPoll = 'indexing-status'
const feedTarget = (
  element: HTMLDivElement,
  read: () => { set: (element: HTMLDivElement | undefined) => void },
) => {
  read().set(element)
  return () => read().set(undefined)
}
export const MediaCenterPage = controllerView(
  {
    controller: (_props: Record<string, never>) => {
      const owner = modelOwner({
        searchOpen: false,
        audioPlayerVisible:
          !!playbackSource.model().currentItem && playbackSource.model().mode === 'audio',
        feedActions: undefined as HTMLDivElement | undefined,
        ai: AsyncResult.initial<IndexingStatus, Error>(),
        config: AsyncResult.initial<ServerConfig, Error>(),
        settings: AsyncResult.initial<WorkspaceSettings, Error>(),
      })
      const actions = {
        setSearchOpen: (searchOpen: boolean) => owner.patch({ searchOpen }),
        setFeedActions: (feedActions: HTMLDivElement | undefined) => owner.patch({ feedActions }),
      }
      owner.own(
        playbackSource.subscribe((state) => {
          const audioPlayerVisible = !!state.currentItem && state.mode === 'audio'
          if (owner.read().audioPlayerVisible !== audioPlayerVisible)
            owner.patch({ audioPlayerVisible })
        }),
      )
      const ai = observeQuery(owner, queryCache, mediaAiStatusQuery, 'ai')
      const config = observeQuery(owner, queryCache, configQuery, 'config')
      const settings = observeQuery(owner, queryCache, settingsQuery, 'settings')
      ai.select(true)
      config.select(true)
      settings.select(true)
      owner.run(
        statusPoll,
        Effect.forever(
          Effect.sleep(10000).pipe(
            Effect.andThen(
              Effect.sync(() => {
                if (available(owner.read().ai)?.enabled) ai.refresh()
              }),
            ),
          ),
        ),
        'replace',
      )
      return { source: owner.source, ...actions, lifetime: owner }
    },
  },
  view((model) =>
    observe(browserHistory, (location) => {
      const params = () => new URLSearchParams(location.search)
      const searchOpen = model.searchOpen
      const feedActions = model.feedActions
      const setSearchOpen = model.actions.setSearchOpen
      const indexing = () => {
        const status = available(model.ai)
        if (!status?.enabled) return undefined
        const progress = status.progress
        if (status.paused || !progress || progress.phase === 'complete') return undefined
        if (progress.phase === 'discovering')
          return `AI analysis · ${progress.completed.toLocaleString()} processed · finding files (${progress.found.toLocaleString()} found)`
        const percent = progress.total > 0 ? (progress.completed / progress.total) * 100 : 100
        return `AI analysis · ${progress.completed.toLocaleString()} / ${progress.total.toLocaleString()} · ${Number(percent.toFixed(2))}%`
      }
      const home = () =>
        available(model.ai)?.enabled &&
        (params().get('view') === 'for-you' ||
          (!params().has('view') &&
            !params().has('dir') &&
            !params().has('playing') &&
            !params().has('viewing')))
      const knowledgeBases = () => available(model.settings)?.knowledgeBases ?? []
      const editableFolders = () => available(model.config)?.editableFolders ?? []
      const audioPlayerVisible = model.audioPlayerVisible
      function navigation() {
        return (
          <nav class='flex shrink-0 items-center gap-4 max-[600px]:gap-1' aria-label='Media center'>
            {available(model.ai)?.enabled ? (
              <button
                class={`flex items-center justify-center gap-2 h-8 text-sm font-medium transition-colors min-w-8 pointer-coarse:h-11 pointer-coarse:min-w-11 ${home() ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                aria-current={home() ? 'page' : undefined}
                onClick={() => {
                  setSearchOpen(false)
                  navigateSearchParams({ view: 'for-you' }, 'push')
                }}
              >
                <House size={18} />
                <span class='max-[600px]:sr-only'>For you</span>
              </button>
            ) : null}
            <button
              class={`flex items-center justify-center gap-2 h-8 text-sm font-medium transition-colors min-w-8 pointer-coarse:h-11 pointer-coarse:min-w-11 ${!home() ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              aria-current={!home() ? 'page' : undefined}
              onClick={() => {
                setSearchOpen(false)
                navigateSearchParams({ view: 'library' }, 'push')
              }}
            >
              <FolderClosed size={18} />
              <span class='max-[600px]:sr-only'>Library</span>
            </button>
          </nav>
        )
      }
      return (
        <div class='min-h-screen bg-background'>
          {available(model.ai)?.enabled ? (
            <header class='relative h-14 px-4' data-testid='media-navigation-header'>
              <div class='absolute top-1/2 left-[50vw] flex -translate-x-1/2 -translate-y-1/2 items-center'>
                {navigation()}
                {available(model.ai)?.enabled ? (
                  <div class='absolute left-full ml-4 flex items-center gap-1'>
                    <button
                      class='flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground pointer-coarse:h-11 pointer-coarse:w-11'
                      aria-label='Search library'
                      aria-expanded={searchOpen ? 'true' : 'false'}
                      onClick={() => {
                        setSearchOpen(!model.searchOpen)
                      }}
                    >
                      <Search size={18} />
                    </button>
                    <div
                      use={{
                        ...domBinding({ set: model.actions.setFeedActions }, feedTarget),
                        identity: model.actions.setFeedActions,
                      }}
                    />
                  </div>
                ) : null}
              </div>
              {indexing() ? (
                <div
                  class='absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1.5 text-[11px] text-muted-foreground/60 sm:right-4'
                  data-testid='indexing-progress'
                  title={
                    available(model.ai)?.progress?.warning ||
                    'Initial AI review of the current file queue. The queue size stays fixed until it finishes.'
                  }
                >
                  <LoaderCircle size={12} class='motion-safe:animate-spin' />
                  <span class='tabular-nums'>{indexing()}</span>
                </div>
              ) : null}
            </header>
          ) : null}
          <MainMediaPlayers editableFolders={editableFolders()} knowledgeBases={knowledgeBases()} />
          <div
            class={cn(
              'media-center-content lg:pt-1',
              audioPlayerVisible &&
                'max-[649px]:pb-[calc(3.125rem+env(safe-area-inset-bottom,0px))] min-[650px]:pb-[calc(4.5625rem+env(safe-area-inset-bottom,0px))]',
            )}
            data-testid='media-chrome-pad-root'
          >
            {home() ? (
              <ForYou
                aiEnabled={!!available(model.ai)?.enabled}
                actions={feedActions}
                searchOpen={searchOpen}
                onOpenFolder={() => {
                  setSearchOpen(false)
                }}
              />
            ) : (
              <MediaCenterFileBrowser
                hideSearch={available(model.ai)?.enabled}
                searchOpen={searchOpen}
                onSearchOpenChange={setSearchOpen}
              />
            )}
          </div>
        </div>
      )
    }),
  ),
)
