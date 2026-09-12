import { createMemo, createSignal, For, Loading, Show } from 'solid-js'
import { Portal } from '@solidjs/web'
import ArrowDown from 'lucide-solid/icons/arrow-down'
import ArrowUp from 'lucide-solid/icons/arrow-up'
import ListMusic from 'lucide-solid/icons/list-music'
import Play from 'lucide-solid/icons/play'
import Radio from 'lucide-solid/icons/radio'
import Shuffle from 'lucide-solid/icons/shuffle'
import Trash2 from 'lucide-solid/icons/trash-2'
import X from 'lucide-solid/icons/x'
import { usePlaybackSession, usePlaybackSnapshot } from '@/features/playback/PlaybackProvider'
import { buildThumbnailUrl } from '@/lib/media/build-media-url'
import { useModalFocus } from '@/lib/ui/modal-focus'
import { MusicArtwork } from './MusicArtwork'
import { continueRadio } from './actions'
import { radioStatus } from './RadioContinuation'
import { useMusicAI } from './enabled'

export function QueuePanel() {
  const session = usePlaybackSession()
  const snapshot = usePlaybackSnapshot()
  const [open, setOpen] = createSignal(false)
  const [showHistory, setShowHistory] = createSignal(false)
  const [limit, setLimit] = createSignal(100)
  let panel: HTMLDivElement | undefined
  const onKeyDown = useModalFocus({
    active: open,
    element: () => panel,
    onEscape: () => setOpen(false),
  })
  const context = () => snapshot().queueContext
  const queueStart = createMemo(() => (showHistory() ? 0 : Math.max(0, snapshot().currentIndex)))
  const icon =
    'grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-secondary disabled:opacity-30'
  return (
    <>
      <button
        class={icon}
        aria-label='Up next'
        aria-expanded={open() ? 'true' : 'false'}
        onClick={() => setOpen(!open())}
      >
        <ListMusic size={20} />
      </button>
      <Show when={open()}>
        <Portal>
          <div
            class='fixed inset-0 z-[10000] bg-black/30'
            role='presentation'
            onKeyDown={onKeyDown}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) setOpen(false)
            }}
          >
            <div
              ref={(element) => {
                panel = element
              }}
              role='dialog'
              aria-modal='true'
              aria-label='Up next'
              class='absolute top-0 right-0 bottom-0 flex w-full max-w-md flex-col border-l border-border bg-background shadow-2xl'
            >
              <div class='flex items-start justify-between border-b border-border p-4'>
                <div>
                  <h2 class='text-lg font-semibold'>Up next</h2>
                  <p class='mt-1 text-sm text-muted-foreground'>
                    {context()?.title || 'From this folder'}
                  </p>
                </div>
                <button class={icon} aria-label='Close queue' onClick={() => setOpen(false)}>
                  <X size={20} />
                </button>
              </div>
              <div class='flex flex-wrap gap-2 border-b border-border px-4 py-2'>
                <button
                  class='flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm hover:bg-secondary'
                  disabled={snapshot().queue.length < 2}
                  onClick={() => session.dispatch({ type: 'shuffleQueue' })}
                >
                  <Shuffle size={16} />
                  Shuffle upcoming
                </button>
              </div>
              <Loading>
                <QueueRadioControls />
              </Loading>
              <div class='min-h-0 flex-1 overflow-y-auto p-3'>
                <Show when={snapshot().currentIndex > 0}>
                  <button
                    class='mb-2 min-h-10 px-2 text-xs text-muted-foreground hover:underline'
                    onClick={() => setShowHistory(!showHistory())}
                  >
                    {showHistory()
                      ? 'Hide played tracks'
                      : `Show ${snapshot().currentIndex} played tracks`}
                  </button>
                </Show>
                <ol class='space-y-1'>
                  <For each={snapshot().queue.slice(queueStart(), queueStart() + limit())}>
                    {(item, offset) => {
                      const index = () => queueStart() + offset()
                      return (
                        <li
                          class={`flex items-center gap-2 rounded-lg p-1 ${index() === snapshot().currentIndex ? 'bg-primary/10' : ''}`}
                        >
                          <button
                            class='relative shrink-0 rounded-lg'
                            aria-label={`Play queued ${item.name}`}
                            onClick={() =>
                              session.dispatch({ type: 'selectQueueItem', index: index() })
                            }
                          >
                            <Show
                              when={item.media === 'video'}
                              fallback={<MusicArtwork path={item.locator} class='size-10' />}
                            >
                              <img
                                src={buildThumbnailUrl(item.locator)}
                                alt=''
                                class='size-10 rounded-lg object-cover'
                              />
                            </Show>
                            <span class='absolute inset-0 grid place-items-center rounded-lg bg-black/30 text-white opacity-0 hover:opacity-100'>
                              <Play size={16} />
                            </span>
                          </button>
                          <div class='min-w-0 flex-1'>
                            <p class='truncate text-sm'>{item.name}</p>
                            <p class='truncate text-[11px] text-muted-foreground'>
                              {index() === snapshot().currentIndex
                                ? 'Now playing'
                                : item.automatic
                                  ? 'Radio suggestion'
                                  : item.locator.split('/').slice(0, -1).join('/')}
                            </p>
                          </div>
                          <button
                            class={icon}
                            aria-label={`Move ${item.name} up`}
                            disabled={index() === 0}
                            onClick={() =>
                              session.dispatch({
                                type: 'moveQueueItem',
                                from: index(),
                                to: index() - 1,
                              })
                            }
                          >
                            <ArrowUp size={15} />
                          </button>
                          <button
                            class={icon}
                            aria-label={`Move ${item.name} down`}
                            disabled={index() === snapshot().queue.length - 1}
                            onClick={() =>
                              session.dispatch({
                                type: 'moveQueueItem',
                                from: index(),
                                to: index() + 1,
                              })
                            }
                          >
                            <ArrowDown size={15} />
                          </button>
                          <button
                            class={icon}
                            aria-label={`Remove ${item.name} from queue`}
                            onClick={() =>
                              session.dispatch({ type: 'removeQueueItem', index: index() })
                            }
                          >
                            <Trash2 size={15} />
                          </button>
                        </li>
                      )
                    }}
                  </For>
                </ol>
                <Show when={snapshot().queue.length > limit()}>
                  <button
                    class='min-h-11 w-full text-sm underline'
                    onClick={() => setLimit(limit() + 100)}
                  >
                    Show more tracks
                  </button>
                </Show>
                <Show when={!snapshot().queue.length}>
                  <p class='p-6 text-center text-sm text-muted-foreground'>Your queue is empty.</p>
                </Show>
              </div>
            </div>
          </div>
        </Portal>
      </Show>
    </>
  )
}

function QueueRadioControls() {
  const aiEnabled = useMusicAI()
  const session = usePlaybackSession()
  const snapshot = usePlaybackSnapshot()
  const context = () => snapshot().queueContext
  const radio = () => context()?.radio
  return (
    <>
      <Show
        when={
          aiEnabled() && context()?.kind !== 'radio' && snapshot().currentItem?.media === 'audio'
        }
      >
        <button
          class='m-4 flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border text-sm hover:bg-secondary'
          onClick={() => continueRadio(session)}
        >
          <Radio size={17} />
          Continue with radio
        </button>
      </Show>
      <Show when={aiEnabled() && radio()}>
        <div class='space-y-3 border-b border-border bg-secondary/25 p-4'>
          <div class='flex items-center justify-between'>
            <span class='flex items-center gap-2 text-sm font-medium'>
              <Radio size={16} />
              Radio is on
            </span>
            <button
              class='min-h-10 px-2 text-xs underline'
              onClick={() =>
                session.dispatch({
                  type: 'setQueueContext',
                  context: { kind: 'manual', title: context()?.title || 'Your queue' },
                })
              }
            >
              Stop radio
            </button>
          </div>
          <Show when={radioStatus().id === context()?.id && radioStatus().exhausted}>
            <p role='status' class='text-xs text-muted-foreground'>
              No more prepared songs for this station.
            </p>
          </Show>
        </div>
      </Show>
    </>
  )
}
