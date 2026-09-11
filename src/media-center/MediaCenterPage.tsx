import { createMemo, createSignal, Show } from 'solid-js'
import { useQuery } from '@tanstack/solid-query'
import { api } from '@/lib/api/client'
import {
  createUrlSearchParamsMemo,
  useBrowserHistory,
  navigateSearchParams,
} from '@/lib/browser/browser-history'
import { ForYou } from '@/features/media-ai/ForYou'
import { MediaCenterFileBrowser } from './MediaCenterFileBrowser'
import { MainMediaPlayers } from './MainMediaPlayers'
import { useServerConfigQuery } from '@/lib/api/use-app-data'
import { useExplorerSettings } from '@/features/explorer/use-explorer-settings'
import { usePlaybackSnapshot } from '@/features/playback/PlaybackProvider'
import House from 'lucide-solid/icons/house'
import FolderClosed from 'lucide-solid/icons/folder-closed'
import Search from 'lucide-solid/icons/search'
import { cn } from '@/lib/ui/cn'

export function MediaCenterPage() {
  const params = createUrlSearchParamsMemo(useBrowserHistory())
  const [searchOpen, setSearchOpen] = createSignal(false)
  const [feedActions, setFeedActions] = createSignal<HTMLDivElement>()
  const ai = useQuery(() => ({
    queryKey: ['media-ai', 'status'],
    queryFn: () => api<{ enabled: boolean }>('/api/media-ai/status'),
    staleTime: 60_000,
  }))
  const home = createMemo(
    () =>
      ai.data?.enabled &&
      (params().get('view') === 'for-you' ||
        (!params().has('view') &&
          !params().has('dir') &&
          !params().has('playing') &&
          !params().has('viewing'))),
  )
  const config = useServerConfigQuery()
  const { knowledgeBases } = useExplorerSettings()
  const playback = usePlaybackSnapshot()
  const editableFolders = () => config.data?.editableFolders ?? []
  const audioPlayerVisible = () => !!playback().currentItem && playback().mode === 'audio'

  function Navigation() {
    return (
      <nav class='flex shrink-0 items-center gap-4 max-[600px]:gap-1' aria-label='Media center'>
        <Show when={ai.data?.enabled}>
          <button
            class={`flex items-center justify-center gap-2 h-8 text-sm font-medium transition-colors min-w-8 pointer-coarse:h-11 pointer-coarse:min-w-11 ${home() ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            aria-current={home() ? 'page' : undefined}
            onClick={() => {
              setSearchOpen(false)
              navigateSearchParams({ view: 'for-you', dir: null }, 'push')
            }}
          >
            <House size={18} />
            <span class='max-[600px]:sr-only'>For you</span>
          </button>
        </Show>
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
      <Show when={ai.data?.enabled}>
        <header class='relative h-14 px-4' data-testid='media-navigation-header'>
          <div class='absolute top-1/2 left-[50vw] flex -translate-x-1/2 -translate-y-1/2 items-center'>
            <Navigation />
            <Show when={ai.data?.enabled}>
              <div class='absolute left-full ml-4 flex items-center gap-1'>
                <button
                  class='flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground pointer-coarse:h-11 pointer-coarse:w-11'
                  aria-label='Search library'
                  aria-expanded={searchOpen() ? 'true' : 'false'}
                  onClick={() => {
                    setSearchOpen((open) => !open)
                  }}
                >
                  <Search size={18} />
                </button>
                <div ref={setFeedActions} />
              </div>
            </Show>
          </div>
        </header>
      </Show>
      <MainMediaPlayers editableFolders={editableFolders()} knowledgeBases={knowledgeBases()} />
      <div
        class={cn(
          'media-center-content lg:pt-1',
          audioPlayerVisible() &&
            'max-[649px]:pb-[calc(3.125rem+env(safe-area-inset-bottom,0px))] min-[650px]:pb-[calc(4.5625rem+env(safe-area-inset-bottom,0px))]',
        )}
        data-testid='media-chrome-pad-root'
      >
        <Show
          when={home()}
          fallback={
            <MediaCenterFileBrowser
              hideSearch={ai.data?.enabled}
              searchOpen={searchOpen}
              onSearchOpenChange={setSearchOpen}
            />
          }
        >
          <ForYou
            aiEnabled={!!ai.data?.enabled}
            actions={feedActions()}
            searchOpen={searchOpen()}
            onOpenFolder={() => {
              setSearchOpen(false)
            }}
          />
        </Show>
      </div>
    </div>
  )
}
