import { For, createSignal, Show } from 'solid-js'
import { useMutation, useQueryClient } from '@tanstack/solid-query'
import EllipsisVertical from 'lucide-solid/icons/ellipsis-vertical'
import Heart from 'lucide-solid/icons/heart'
import ListPlus from 'lucide-solid/icons/list-plus'
import Play from 'lucide-solid/icons/play'
import Radio from 'lucide-solid/icons/radio'
import StepForward from 'lucide-solid/icons/step-forward'
import Ban from 'lucide-solid/icons/ban'
import { post } from '@/lib/api/client'
import { usePlaybackSession, usePlaybackSnapshot } from '@/features/playback/PlaybackProvider'
import { formatPlaybackTime } from '@/features/playback'
import { FloatingContextMenu } from '@/features/explorer/FloatingContextMenu'
import { MusicArtwork } from './MusicArtwork'
import { musicError, musicItem, notifyMusic, playMusic, startRadio } from './actions'
import type { MusicTrack } from './types'
import { updateMusicFeedback } from './cache'
import { useMusicAI } from './enabled'

export function TrackList(props: {
  items: MusicTrack[]
  title: string
  columns?: boolean
  onPlay?: (index: number) => void
}) {
  const aiEnabled = useMusicAI()
  const session = usePlaybackSession()
  const playback = usePlaybackSnapshot()
  const client = useQueryClient()
  const [menu, setMenu] = createSignal<{ item: MusicTrack; x: number; y: number }>()
  const feedback = useMutation(() => ({
    mutationFn: (input: { path: string; kind: string }) => post('/api/media-ai/feedback', input),
    onSuccess: (_, input) => {
      updateMusicFeedback(client, input)
      void client.invalidateQueries({ queryKey: ['media-ai', 'home'] })
      notifyMusic(
        input.kind === 'later'
          ? 'Set aside for today'
          : input.kind === 'hide'
            ? 'Removed from recommendations'
            : input.kind === 'more'
              ? 'Liked'
              : 'Like removed',
      )
    },
    onError: musicError,
  }))
  const action =
    'flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-secondary'
  return (
    <>
      <div
        class={props.columns ? 'grid gap-x-8 xl:grid-cols-2' : 'divide-y divide-border/50'}
        role='list'
        aria-label={props.title}
      >
        <For each={props.items}>
          {(track, index) => (
            <div
              role='listitem'
              class='group flex min-w-0 items-center gap-3 rounded-lg py-2 pr-1 hover:bg-secondary/40'
            >
              <button
                aria-label={`Play music ${track.title}`}
                class='relative ml-1 shrink-0 rounded-lg focus-visible:ring-2 focus-visible:ring-ring'
                onClick={() =>
                  props.onPlay
                    ? props.onPlay(index())
                    : playMusic(
                        session,
                        props.items,
                        { kind: 'manual', title: props.title },
                        index(),
                      )
                }
              >
                <MusicArtwork path={track.path} hasArtwork={track.hasArtwork} />
                <span class='absolute inset-0 grid place-items-center rounded-lg bg-black/40 text-white opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'>
                  <Play size={18} />
                </span>
              </button>
              <div class='min-w-0 flex-1'>
                <div
                  class={`truncate text-sm font-medium ${playback().currentItem?.locator === track.path ? 'text-primary' : ''}`}
                >
                  {track.title}
                </div>
                <div class='truncate text-xs text-muted-foreground'>
                  {track.artist || 'Unknown artist'}
                  <Show when={track.album}> · {track.album}</Show>
                </div>
              </div>
              <span class='hidden text-xs tabular-nums text-muted-foreground sm:block'>
                {formatPlaybackTime(track.duration)}
              </span>
              <button
                aria-label={`Like music ${track.title}`}
                aria-pressed={track.liked ? 'true' : 'false'}
                disabled={feedback.isPending}
                class={`grid size-11 shrink-0 place-items-center rounded-full hover:bg-secondary ${track.liked ? 'text-primary' : 'text-muted-foreground'}`}
                onClick={() =>
                  feedback.mutate({ path: track.path, kind: track.liked ? 'clear' : 'more' })
                }
              >
                <Heart size={16} class={track.liked ? 'fill-current' : ''} />
              </button>
              <button
                aria-label={`Music options for ${track.title}`}
                class='grid size-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary'
                onClick={(event) => {
                  const r = event.currentTarget.getBoundingClientRect()
                  setMenu({ item: track, x: Math.max(8, r.right - 240), y: r.bottom })
                }}
              >
                <EllipsisVertical size={18} />
              </button>
            </div>
          )}
        </For>
      </div>
      <FloatingContextMenu
        state={menu}
        anchor={(v) => ({ x: v.x, y: v.y })}
        onDismiss={() => setMenu(undefined)}
        role='menu'
        class='w-60'
      >
        {(value) => (
          <>
            <button
              class={action}
              onClick={() => {
                session.dispatch({
                  type: 'enqueue',
                  items: [musicItem(value.item)],
                  position: 'next',
                })
                setMenu(undefined)
                notifyMusic('Playing next')
              }}
            >
              <StepForward size={17} />
              Play next
            </button>
            <button
              class={action}
              onClick={() => {
                session.dispatch({
                  type: 'enqueue',
                  items: [musicItem(value.item)],
                  position: 'end',
                })
                setMenu(undefined)
                notifyMusic('Added to queue')
              }}
            >
              <ListPlus size={17} />
              Add to queue
            </button>
            <Show when={aiEnabled()}>
              <button
                class={action}
                onClick={() => {
                  startRadio(
                    session,
                    client,
                    { seeds: [value.item.path] },
                    `${value.item.title} radio`,
                  )
                  setMenu(undefined)
                }}
              >
                <Radio size={17} />
                Start radio
              </button>
              <Show when={value.item.artist}>
                <button
                  class={action}
                  onClick={() => {
                    startRadio(
                      session,
                      client,
                      { artist: value.item.artist },
                      `${value.item.artist} radio`,
                    )
                    setMenu(undefined)
                  }}
                >
                  <Radio size={17} />
                  Artist radio
                </button>
              </Show>
            </Show>

            <button
              class={action}
              onClick={() => {
                feedback.mutate({ path: value.item.path, kind: 'hide' })
                setMenu(undefined)
              }}
            >
              <Ban size={17} />
              Don’t recommend
            </button>
          </>
        )}
      </FloatingContextMenu>
    </>
  )
}
