import ListPlus from '@effectweb/lucide/icons/list-plus'
import Moon from '@effectweb/lucide/icons/moon'
import { Button } from '@/lib/ui/button'
import { openSleepTimer, sleepTimerLabel } from '@/features/playback/sleep-timer'
import { component, view, observe, list } from 'effectweb'
import ArrowDown from '@effectweb/lucide/icons/arrow-down'
import ArrowUp from '@effectweb/lucide/icons/arrow-up'
import ListMusic from '@effectweb/lucide/icons/list-music'
import Play from '@effectweb/lucide/icons/play'
import Radio from '@effectweb/lucide/icons/radio'
import Shuffle from '@effectweb/lucide/icons/shuffle'
import Trash2 from '@effectweb/lucide/icons/trash-2'
import { getPlaybackSession, playbackSource } from '@/features/playback/PlaybackProvider'
import { buildThumbnailUrl } from '@/lib/media/build-media-url'
import { Sheet } from '@/lib/ui/sheet'
import { MusicArtwork } from './MusicArtwork'
import { continueRadio, openPlaylists } from './actions'
import { radioStatusSource } from './RadioContinuation'
import { musicStatusSource } from './enabled'
export const QueuePanel = component<
  { compact?: boolean },
  { open: boolean; showHistory: boolean; limit: number }
>(
  { init: () => ({ open: false, showHistory: false, limit: 100 }) },
  view((model, patch) =>
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
          <Button
            size='icon'
            variant='ghost'
            class={
              model.props.compact
                ? 'grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary'
                : icon
            }
            aria-label='Up next'
            aria-expanded={open ? 'true' : 'false'}
            onClick={() => setOpen(!open)}
          >
            <ListMusic class='size-[20px]' size={20} />
          </Button>
          {open ? (
            <Sheet
              open={open}
              onOpenChange={setOpen}
              title='Up next'
              description={context()?.title || 'From this folder'}
              class='gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md'
            >
              <div class='flex items-center gap-1 border-b border-border px-4 py-2'>
                <Button
                  variant='ghost'
                  class='mr-auto'
                  onClick={() => {
                    setOpen(false)
                    openPlaylists()
                  }}
                >
                  Playlists
                </Button>
                <Button
                  variant='ghost'
                  size='icon'
                  aria-label='Shuffle upcoming'
                  title='Shuffle upcoming'
                  disabled={snapshot.queue.length < 2}
                  onClick={() => void getPlaybackSession().dispatch({ type: 'shuffleQueue' })}
                >
                  <Shuffle size={16} />
                </Button>
                {snapshot.queue.some((item) => item.media === 'audio') ? (
                  <Button
                    variant='ghost'
                    size='icon'
                    aria-label='Save queue…'
                    title='Save queue as playlist'
                    onClick={() => {
                      setOpen(false)
                      openPlaylists(
                        snapshot.queue
                          .filter((item) => item.media === 'audio')
                          .map((item) => item.locator),
                        context()?.title || '',
                      )
                    }}
                  >
                    <ListPlus size={16} />
                  </Button>
                ) : null}
                <Button
                  variant='ghost'
                  size='icon'
                  aria-label={sleepTimerLabel(snapshot.sleepTimer)}
                  title={sleepTimerLabel(snapshot.sleepTimer)}
                  disabled={!snapshot.currentItem}
                  onClick={() => {
                    setOpen(false)
                    openSleepTimer()
                  }}
                >
                  <Moon size={16} />
                </Button>
              </div>
              <QueueRadioControls />
              <div class='min-h-0 flex-1 overflow-y-auto p-3'>
                {snapshot.currentIndex > 0 ? (
                  <Button
                    variant='ghost'
                    class='mb-2 min-h-10 px-2 text-xs text-muted-foreground hover:underline'
                    onClick={() => setShowHistory(!showHistory)}
                  >
                    {showHistory
                      ? 'Hide played tracks'
                      : `Show ${snapshot.currentIndex} played tracks`}
                  </Button>
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
                          <Button
                            variant='ghost'
                            size='icon'
                            class='relative size-10 shrink-0 overflow-hidden p-0'
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
                          </Button>
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
                          <Button
                            size='icon'
                            variant='ghost'
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
                            <ArrowUp size={15} class='size-[15px]' />
                          </Button>
                          <Button
                            size='icon'
                            variant='ghost'
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
                            <ArrowDown size={15} class='size-[15px]' />
                          </Button>
                          <Button
                            size='icon'
                            variant='ghost'
                            class={icon}
                            aria-label={`Remove ${item.name} from queue`}
                            onClick={() =>
                              void getPlaybackSession().dispatch({
                                type: 'removeQueueItem',
                                index: index(),
                              })
                            }
                          >
                            <Trash2 size={15} class='size-[15px]' />
                          </Button>
                        </li>
                      )
                    },
                  )}
                </ol>
                {snapshot.queue.length > limit ? (
                  <Button
                    variant='ghost'
                    class='min-h-11 w-full text-sm underline'
                    onClick={() => setLimit(limit + 100)}
                  >
                    Show more tracks
                  </Button>
                ) : null}
                {!snapshot.queue.length ? (
                  <p class='p-6 text-center text-sm text-muted-foreground'>Your queue is empty.</p>
                ) : null}
              </div>
            </Sheet>
          ) : null}
        </>
      )
    }),
  ),
)
const QueueRadioControls = view(() =>
  observe(playbackSource, (snapshot) =>
    observe(musicStatusSource, ({ enabled: aiEnabled }) =>
      observe(radioStatusSource, (radioStatus) => {
        const context = () => snapshot.queueContext
        const radio = () => context()?.radio
        return (
          <>
            {aiEnabled && context()?.kind !== 'radio' && snapshot.currentItem?.media === 'audio' ? (
              <Button
                variant='outline'
                class='m-4 flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border text-sm hover:bg-secondary'
                onClick={() => continueRadio(getPlaybackSession())}
              >
                <Radio class='size-[17px]' size={17} />
                Continue with radio
              </Button>
            ) : null}
            {aiEnabled && radio() ? (
              <div class='space-y-3 border-b border-border bg-secondary/25 p-4'>
                <div class='flex items-center justify-between'>
                  <span class='flex items-center gap-2 text-sm font-medium'>
                    <Radio size={16} />
                    Radio is on
                  </span>
                  <Button
                    variant='ghost'
                    class='min-h-10 px-2 text-xs underline'
                    onClick={() =>
                      void getPlaybackSession().dispatch({
                        type: 'setQueueContext',
                        context: { kind: 'manual', title: context()?.title || 'Your queue' },
                      })
                    }
                  >
                    Stop radio
                  </Button>
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
