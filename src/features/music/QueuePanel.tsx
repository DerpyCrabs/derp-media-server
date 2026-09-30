import { localComponent, view, observe, list, Portal } from 'effectweb'
import ArrowDown from '@effectweb/lucide/icons/arrow-down'
import ArrowUp from '@effectweb/lucide/icons/arrow-up'
import ListMusic from '@effectweb/lucide/icons/list-music'
import Play from '@effectweb/lucide/icons/play'
import Radio from '@effectweb/lucide/icons/radio'
import Shuffle from '@effectweb/lucide/icons/shuffle'
import Trash2 from '@effectweb/lucide/icons/trash-2'
import X from '@effectweb/lucide/icons/x'
import { getPlaybackSession, playbackSource } from '@/features/playback/PlaybackProvider'
import { buildThumbnailUrl } from '@/lib/media/build-media-url'
import { modalFocus } from '@/lib/ui/modal-focus'
import { MusicArtwork } from './MusicArtwork'
import { continueRadio } from './actions'
import { radioStatusSource } from './RadioContinuation'
import { musicStatusSource } from './enabled'
export const QueuePanel = localComponent<
  Record<string, never>,
  { open: boolean; showHistory: boolean; limit: number }
>({
  init: () => ({ open: false, showHistory: false, limit: 100 }),
  view: view((model, patch) =>
    observe(playbackSource, (snapshot) => {
      const { open, showHistory, limit } = model
      const setOpen = (open: boolean) => patch({ open })
      const setShowHistory = (showHistory: boolean) => patch({ showHistory })
      const setLimit = (limit: number) => patch({ limit })
      const context = () => snapshot.queueContext
      const queueStart = () => (showHistory ? 0 : Math.max(0, snapshot.currentIndex))
      const icon =
        'grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-secondary disabled:opacity-30'
      return (
        <>
          <button
            class={icon}
            aria-label='Up next'
            aria-expanded={open ? 'true' : 'false'}
            onClick={() => setOpen(!open)}
          >
            <ListMusic size={20} />
          </button>
          {open ? (
            <Portal>
              <div
                class='fixed inset-0 z-[10000] bg-black/30'
                role='presentation'
                onPointerDown={(e) => {
                  if (e.target === e.currentTarget) setOpen(false)
                }}
              >
                <div
                  use={modalFocus({ onEscape: () => setOpen(false) })}
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
                      disabled={snapshot.queue.length < 2}
                      onClick={() => void getPlaybackSession().dispatch({ type: 'shuffleQueue' })}
                    >
                      <Shuffle size={16} />
                      Shuffle upcoming
                    </button>
                  </div>
                  <QueueRadioControls />
                  <div class='min-h-0 flex-1 overflow-y-auto p-3'>
                    {snapshot.currentIndex > 0 ? (
                      <button
                        class='mb-2 min-h-10 px-2 text-xs text-muted-foreground hover:underline'
                        onClick={() => setShowHistory(!showHistory)}
                      >
                        {showHistory
                          ? 'Hide played tracks'
                          : `Show ${snapshot.currentIndex} played tracks`}
                      </button>
                    ) : null}
                    <ol class='space-y-1'>
                      {list(
                        snapshot.queue.slice(queueStart(), queueStart() + limit),
                        (item) => `${item.media}:${item.locator}`,
                        (item, offset) => {
                          const index = () => queueStart() + offset
                          return (
                            <li
                              class={`flex items-center gap-2 rounded-lg p-1 ${index() === snapshot.currentIndex ? 'bg-primary/10' : ''}`}
                            >
                              <button
                                class='relative shrink-0 rounded-lg'
                                aria-label={`Play queued ${item.name}`}
                                onClick={() =>
                                  void getPlaybackSession().dispatch({
                                    type: 'selectQueueItem',
                                    index: index(),
                                  })
                                }
                              >
                                {item.media === 'video' ? (
                                  <img
                                    src={buildThumbnailUrl(item.locator)}
                                    alt=''
                                    class='size-10 rounded-lg object-cover'
                                  />
                                ) : (
                                  <MusicArtwork path={item.locator} class='size-10' />
                                )}
                                <span class='absolute inset-0 grid place-items-center rounded-lg bg-black/30 text-white opacity-0 hover:opacity-100'>
                                  <Play size={16} />
                                </span>
                              </button>
                              <div class='min-w-0 flex-1'>
                                <p class='truncate text-sm'>{item.name}</p>
                                <p class='truncate text-[11px] text-muted-foreground'>
                                  {index() === snapshot.currentIndex
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
                                  void getPlaybackSession().dispatch({
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
                                disabled={index() === snapshot.queue.length - 1}
                                onClick={() =>
                                  void getPlaybackSession().dispatch({
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
                                  void getPlaybackSession().dispatch({
                                    type: 'removeQueueItem',
                                    index: index(),
                                  })
                                }
                              >
                                <Trash2 size={15} />
                              </button>
                            </li>
                          )
                        },
                      )}
                    </ol>
                    {snapshot.queue.length > limit ? (
                      <button
                        class='min-h-11 w-full text-sm underline'
                        onClick={() => setLimit(limit + 100)}
                      >
                        Show more tracks
                      </button>
                    ) : null}
                    {!snapshot.queue.length ? (
                      <p class='p-6 text-center text-sm text-muted-foreground'>
                        Your queue is empty.
                      </p>
                    ) : null}
                  </div>
                </div>
              </div>
            </Portal>
          ) : null}
        </>
      )
    }),
  ),
})
const QueueRadioControls = view(() =>
  observe(playbackSource, (snapshot) =>
    observe(musicStatusSource, ({ enabled: aiEnabled }) =>
      observe(radioStatusSource, (radioStatus) => {
        const context = () => snapshot.queueContext
        const radio = () => context()?.radio
        return (
          <>
            {aiEnabled && context()?.kind !== 'radio' && snapshot.currentItem?.media === 'audio' ? (
              <button
                class='m-4 flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border text-sm hover:bg-secondary'
                onClick={() => continueRadio(getPlaybackSession())}
              >
                <Radio size={17} />
                Continue with radio
              </button>
            ) : null}
            {aiEnabled && radio() ? (
              <div class='space-y-3 border-b border-border bg-secondary/25 p-4'>
                <div class='flex items-center justify-between'>
                  <span class='flex items-center gap-2 text-sm font-medium'>
                    <Radio size={16} />
                    Radio is on
                  </span>
                  <button
                    class='min-h-10 px-2 text-xs underline'
                    onClick={() =>
                      void getPlaybackSession().dispatch({
                        type: 'setQueueContext',
                        context: { kind: 'manual', title: context()?.title || 'Your queue' },
                      })
                    }
                  >
                    Stop radio
                  </button>
                </div>
                {radioStatus.id === context()?.id && radioStatus.exhausted ? (
                  <p role='status' class='text-xs text-muted-foreground'>
                    No more prepared songs for this station.
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        )
      }),
    ),
  ),
)
