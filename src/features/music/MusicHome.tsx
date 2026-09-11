import { For, Show } from 'solid-js'
import { useQuery, useQueryClient } from '@tanstack/solid-query'
import Play from 'lucide-solid/icons/play'
import { api } from '@/lib/api/client'
import { usePlaybackSession } from '@/features/playback/PlaybackProvider'
import { MusicArtwork } from './MusicArtwork'
import { TrackList } from './TrackList'
import { CollectionActions } from './CollectionActions'
import { playMusic, setMusicDialog, startRadio } from './actions'
import type { MusicHomeData } from './types'

export function MusicHome() {
  const session = usePlaybackSession()
  const client = useQueryClient()
  const home = useQuery(() => ({
    queryKey: ['music', 'home', ''],
    queryFn: () => api<MusicHomeData>('/api/music/home'),
    staleTime: Infinity,
    meta: { refetchOnSseConnect: false },
    refetchOnWindowFocus: false,
    refetchOnMount: false,
  }))
  const content = () => home.data
  return (
    <div data-testid='music-home' class='w-full space-y-8 py-2'>
      <div class='flex flex-wrap items-center justify-between gap-3'>
        <div>
          <h2 class='text-xl font-semibold tracking-tight'>Your music</h2>
          <Show when={content()?.total}>
            <p class='mt-1 text-sm text-muted-foreground'>
              {content()?.total.toLocaleString()} songs
            </p>
          </Show>
        </div>
      </div>
      <Show when={content()?.mixes.length}>
        <section class='space-y-3' aria-label='Genre mixes'>
          <h3 class='text-base font-semibold'>Genre mixes</h3>
          <div class='grid gap-3 sm:grid-cols-2 xl:grid-cols-3'>
            <For each={content()?.mixes}>
              {(item) => (
                <article class='flex items-center gap-1 rounded-xl border border-border/60 bg-secondary/20 pr-2 transition-colors hover:bg-secondary/40'>
                  <button
                    class='group flex min-h-20 min-w-0 flex-1 items-center gap-4 p-4 text-left disabled:opacity-50'
                    aria-label={`Play ${item.genre} mix`}
                    onClick={() =>
                      playMusic(session, item.items, { kind: 'manual', title: `${item.genre} mix` })
                    }
                  >
                    <span class='grid size-11 shrink-0 place-items-center rounded-full bg-secondary text-muted-foreground group-hover:bg-primary group-hover:text-primary-foreground'>
                      <Play size={18} class='ml-0.5' />
                    </span>
                    <span class='min-w-0'>
                      <span class='block truncate text-sm font-medium capitalize'>
                        {item.genre}
                      </span>
                      <span class='mt-1 block line-clamp-2 text-xs leading-relaxed text-muted-foreground'>
                        {[
                          ...new Set(
                            item.items.map((track) => track.artist.trim()).filter(Boolean),
                          ),
                        ]
                          .slice(0, 3)
                          .join(', ')}
                      </span>
                      <span class='mt-1 block text-xs text-muted-foreground'>
                        {item.count} songs
                      </span>
                    </span>
                  </button>
                  <CollectionActions
                    label={`${item.genre} mix`}
                    onRadio={() =>
                      startRadio(
                        session,
                        client,
                        { genre: item.genre, strictGenre: true },
                        `${item.genre} radio`,
                      )
                    }
                  />
                </article>
              )}
            </For>
          </div>
        </section>
      </Show>
      <div class='grid gap-x-8 gap-y-7 xl:grid-cols-2'>
        <For each={content()?.rows}>
          {(row) => (
            <section
              class={`min-w-0 space-y-2 ${content()?.rows.length === 1 ? 'xl:col-span-2' : ''}`}
              aria-label={row.title}
            >
              <div class='flex items-center justify-between gap-3'>
                <h3 class='truncate text-base font-semibold'>{row.title}</h3>
                <button
                  class='inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg px-2 text-xs text-muted-foreground hover:bg-secondary'
                  onClick={() =>
                    playMusic(session, row.items, { kind: 'manual', title: row.title })
                  }
                >
                  <Play size={14} />
                  Play all
                </button>
              </div>
              <TrackList
                items={row.items}
                title={row.title}
                columns={content()?.rows.length === 1}
              />
            </section>
          )}
        </For>
      </div>
      <Show when={content()?.albums.length}>
        <section class='space-y-3' aria-label='Albums'>
          <h3 class='text-base font-semibold'>Albums</h3>
          <div class='grid grid-cols-2 gap-x-5 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6'>
            <For each={content()?.albums}>
              {(album) => (
                <article class='min-w-0'>
                  <button
                    class='group relative block w-full overflow-hidden rounded-xl text-left'
                    aria-label={`View album ${album.title}`}
                    onClick={() =>
                      setMusicDialog({ kind: 'collection', title: album.title, items: album.items })
                    }
                  >
                    <MusicArtwork
                      path={album.cover?.path}
                      hasArtwork={album.cover?.hasArtwork}
                      class='aspect-square w-full'
                    />
                  </button>
                  <div class='mt-2 flex items-start gap-1'>
                    <div class='min-w-0 flex-1 pt-1'>
                      <p class='line-clamp-2 text-sm font-medium leading-snug'>{album.title}</p>
                      <p class='mt-1 truncate text-xs text-muted-foreground'>{album.artist}</p>
                    </div>
                    <CollectionActions
                      label={album.title}
                      onRadio={() =>
                        startRadio(
                          session,
                          client,
                          { seeds: album.items.slice(0, 20).map((t) => t.path) },
                          `${album.title} radio`,
                        )
                      }
                    />
                  </div>
                </article>
              )}
            </For>
          </div>
        </section>
      </Show>
      <Show when={content()?.curationError}>
        <p role='status' class='text-sm text-muted-foreground'>
          Music recommendations couldn’t update. Your last reviewed results are still available.
        </p>
      </Show>
      <Show when={home.error}>
        <p role='alert' class='text-sm text-destructive'>
          Couldn’t load your music.{' '}
          <button class='underline' onClick={() => void home.refetch()}>
            Try again
          </button>
        </p>
      </Show>
      <Show when={content()?.total === 0}>
        <div class='rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground'>
          {content()?.searchEnabled
            ? content()?.paused
              ? 'Music review is paused.'
              : 'No reviewed music recommendations yet.'
            : 'Enable fileSearch in the server config to browse music and build automatic mixes.'}
        </div>
      </Show>
    </div>
  )
}
