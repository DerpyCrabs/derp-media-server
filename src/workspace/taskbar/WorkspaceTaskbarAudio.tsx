import { PlaybackScrubber } from '@/features/playback/create-playback-scrubber'
import { QueuePanel } from '@/features/music/QueuePanel'
import { fetchDirectoryFilesEffect } from '@/lib/files/files-client'
import { MediaType } from '@/lib/files/types'
import { queryCache, groups } from '@/lib/api/cache'
import { settingsQuery, statsQuery } from '@/lib/api/queries'
import type { WorkspaceSettings } from '@/workspace/model/workspace-settings-types'
import type { FileItem } from '@/lib/files/types'
import { available, modelOwner, view, domBinding, controllerView } from 'effectweb'
import Headphones from '@effectweb/lucide/icons/headphones'
import Monitor from '@effectweb/lucide/icons/monitor'
import Pause from '@effectweb/lucide/icons/pause'
import Play from '@effectweb/lucide/icons/play'
import Repeat from '@effectweb/lucide/icons/repeat'
import StepBack from '@effectweb/lucide/icons/step-back'
import StepForward from '@effectweb/lucide/icons/step-forward'
import Volume2 from '@effectweb/lucide/icons/volume-2'
import VolumeX from '@effectweb/lucide/icons/volume-x'
import X from '@effectweb/lucide/icons/x'
import {
  buildAudioMetadataUrl,
  buildMediaUrl,
  buildThumbnailUrl,
} from '@/lib/media/build-media-url'
import {
  audioPlaybackQueueFromFiles,
  fetchAudioMetadataEffect,
  type AudioMetadata,
  formatPlaybackTime,
} from '@/features/playback'
import { getPlaybackSession, playbackSource } from '@/features/playback/PlaybackProvider'
import { parentPath } from '@/lib/files/path-utils'
import { createFileSortMetadata, sortFilesForPath } from '@/features/explorer/file-display-settings'
import { observeQuery, query } from '@effectweb/query'
type Props = {
  onShowVideo: (path: string, dir?: string) => void
  onStopPlayback: () => void
  suppressTaskbarAudioChrome?: () => boolean
}
const audioFilesQuery = query({
  name: 'workspace-audio-files',
  groups: [groups.files],
  load: (directory: string) => fetchDirectoryFilesEffect(directory),
})
const audioMetadataQuery = query({
  name: 'workspace-audio-metadata',
  load: (path: string) => fetchAudioMetadataEffect(buildAudioMetadataUrl(path)),
})
function audioController(props: Props) {
  const session = getPlaybackSession()
  const owner = modelOwner({
    props,
    session,
    playback: playbackSource.model(),
    settings: undefined as WorkspaceSettings | undefined,
    files: [] as FileItem[],
    views: {} as Record<string, number>,
    metadata: undefined as AudioMetadata | undefined,
    detailsKey: '',
    detailsOpen: false,
  })
  let signature = ''
  const settings = observeQuery(owner, queryCache, settingsQuery, (result) => {
    owner.patch({ settings: available(result) })
    updateQueue()
  })
  const stats = observeQuery(owner, queryCache, statsQuery, (result) => {
    owner.patch({ views: available(result)?.views ?? {} })
    updateQueue()
  })
  const files = observeQuery(owner, queryCache, audioFilesQuery, (result) => {
    owner.patch({ files: available(result)?.files ?? [] })
    updateQueue()
  })
  const metadata = observeQuery(owner, queryCache, audioMetadataQuery, 'metadata', available)
  function updateQueue() {
    const model = owner.read(),
      item = model.playback.currentItem
    if (
      !item ||
      model.playback.mode !== 'audio' ||
      model.playback.queueContext ||
      !model.files.length
    )
      return
    const sorted = sortFilesForPath(
      [...model.files],
      parentPath(item.locator),
      model.settings?.sortOrders,
      false,
      createFileSortMetadata(model.settings?.favorites, model.views),
    )
    const queue = audioPlaybackQueueFromFiles(sorted, item)
    const next = queue.map((item) => item.locator).join('\x01')
    if (next === signature) return
    signature = next
    session.dispatch({ type: 'setQueue', queue, current: item })
  }
  function select() {
    const current = playbackSource.model()
    const detailsKey = `${current.currentItem?.locator}\0${current.mode}`
    owner.patch({
      playback: current,
      ...(detailsKey !== owner.read().detailsKey ? { detailsKey, detailsOpen: false } : {}),
    })
    const enabled = current.mode === 'audio' && !owner.read().props.suppressTaskbarAudioChrome?.(),
      path = current.currentItem?.locator
    files.select(enabled && path ? parentPath(path) : undefined)
    metadata.select(enabled && path ? path : undefined)
  }
  settings.select(true)
  stats.select(true)
  const stop = playbackSource.subscribe(select)
  select()
  const details = (open: boolean) => {
    const current = owner.read().playback
    owner.patch({
      detailsKey: `${current.currentItem?.locator}\0${current.mode}`,
      detailsOpen: open,
    })
  }
  return {
    source: owner.source,
    receive(next: Props) {
      owner.patch({ props: next })
      select()
    },
    dispose() {
      stop()
      owner.dispose()
    },
    details,
  }
}
type AudioModel = ReturnType<ReturnType<typeof audioController>['source']['model']>
export const WorkspaceTaskbarAudio = controllerView(
  {
    controller: (props: Props) => {
      const controller = audioController(props)
      const owner = modelOwner({ ...controller.source.model(), setDetailsOpen: controller.details })
      const stop = controller.source.subscribe((model) => owner.patch(model))
      return {
        source: owner.source,
        receive: (props) => controller.receive(props),
        lifetime: {
          dispose() {
            stop()
            controller.dispose()
            owner.dispose()
          },
        },
      }
    },
  },
  view<AudioModel & { setDetailsOpen: (open: boolean) => void }>((model) => {
    const props = model.props,
      session = model.session,
      setDetailsOpen = model.setDetailsOpen
    const playback = model.playback,
      item = model.playback.currentItem,
      playingPath = () => item?.locator ?? null,
      currentDir = () => parentPath(playingPath() ?? ''),
      isVideoFile = () => item?.media === 'video'
    const shouldHandleAudio = () =>
      !!item && playback.mode === 'audio' && !props.suppressTaskbarAudioChrome?.()
    const detailsOpen = () =>
      model.detailsOpen && model.detailsKey === `${playingPath()}\0${playback.mode}`
    const audioMetadata = model.metadata,
      fileName = () => item?.name ?? '',
      displayDuration = () => playback.duration || audioMetadata?.duration || 0
    const cover = model.files.find(
      (file) =>
        file.type === MediaType.IMAGE &&
        file.name.toLowerCase().replace(/\.[^.]+$/, '') === 'cover',
    )
    const displayImageUrl = () =>
      isVideoFile() && playingPath()
        ? buildThumbnailUrl(playingPath()!)
        : audioMetadata?.coverArt || (cover ? buildMediaUrl(cover.path) : null)
    const hasPreviousAudio = () => playback.currentIndex > 0 || playback.position > 20,
      hasNextAudio = () =>
        playback.currentIndex >= 0 && playback.currentIndex + 1 < playback.queue.length
    function handleShowVideo() {
      const path = playingPath()
      if (!path || !isVideoFile()) return
      session.dispatch({ type: 'setMode', mode: 'video' })
      props.onShowVideo(path, currentDir() || undefined)
    }
    return shouldHandleAudio() ? (
      <div
        class='relative'
        data-workspace-taskbar-audio-root
        use={domBinding(
          { open: detailsOpen(), close: () => setDetailsOpen(false) },
          audioDetailsEvents,
        )}
      >
        <div class='text-muted-foreground flex h-8 items-center gap-1 border-l border-border bg-muted/50 px-2'>
          <button
            type='button'
            class='hover:opacity-90 flex min-w-0 cursor-pointer items-center gap-1.5 pr-1 text-left transition-opacity'
            onClick={() => {
              setDetailsOpen(!detailsOpen())
            }}
            aria-label='Open audio controls'
            aria-expanded={detailsOpen() ? 'true' : 'false'}
          >
            <div class='bg-muted flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded'>
              {displayImageUrl() ? (
                <img
                  src={displayImageUrl()!}
                  alt=''
                  class='block size-full object-cover object-center'
                  loading='eager'
                />
              ) : (
                <Headphones class='text-muted-foreground h-3.5 w-3.5 shrink-0' stroke-width={2} />
              )}
            </div>
            <div class='hidden max-w-52 min-w-52 min-[1150px]:block'>
              <div class='text-foreground truncate text-[12px] leading-none font-medium'>
                {audioMetadata?.title || fileName()}
              </div>
              <div class='text-muted-foreground truncate text-[11px] leading-none'>
                {audioMetadata?.artist || currentDir() || '\u00A0'}
              </div>
            </div>
          </button>
        </div>

        {detailsOpen() ? (
          <div class='bg-popover absolute right-0 bottom-full z-100001 mb-2 w-80 border border-border shadow-xl'>
            <button
              type='button'
              class='text-muted-foreground hover:bg-accent hover:text-foreground absolute top-2 right-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md'
              title='Stop playback'
              aria-label='Stop playback'
              onClick={() => {
                props.onStopPlayback()
                setDetailsOpen(false)
              }}
            >
              <X class='h-4 w-4' stroke-width={2} />
            </button>
            <div class='space-y-3 p-3'>
              <div class='flex items-center gap-3 pr-10'>
                <div class='flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded bg-neutral-800'>
                  {displayImageUrl() ? (
                    <img
                      src={displayImageUrl()!}
                      alt='Album art'
                      class='h-full w-full object-cover object-center'
                    />
                  ) : (
                    <Headphones class='text-muted-foreground h-5 w-5' stroke-width={2} />
                  )}
                </div>
                <div class='min-w-0 flex-1'>
                  <div class='text-foreground truncate text-sm font-medium'>
                    {audioMetadata?.title || fileName()}
                  </div>
                  <div class='text-muted-foreground truncate text-xs'>
                    {audioMetadata?.artist || currentDir() || '\u00A0'}
                  </div>
                </div>
              </div>

              <div class='text-muted-foreground flex items-center gap-2 text-[11px]'>
                <span class='w-9 text-right tabular-nums'>
                  {formatPlaybackTime(playback.position)}
                </span>
                <PlaybackScrubber
                  itemKey={`${playingPath()}\0${playback.mode}`}
                  position={playback.position}
                  duration={displayDuration()}
                  ariaLabel='Playback position'
                  ariaValueText={(position) =>
                    `${formatPlaybackTime(position)} of ${formatPlaybackTime(displayDuration())}`
                  }
                  disabled={!item}
                  onSeek={(position) => session.dispatch({ type: 'seek', position })}
                  class='[&::-webkit-slider-thumb]:bg-primary h-1.5 flex-1 cursor-pointer appearance-none rounded-none bg-secondary [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full'
                />
                <span class='w-9 tabular-nums'>{formatPlaybackTime(displayDuration())}</span>
              </div>

              <div class='grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3'>
                <div class='flex shrink-0 items-center gap-1'>
                  <button
                    type='button'
                    class='hover:bg-accent inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md disabled:opacity-50'
                    disabled={!hasPreviousAudio()}
                    aria-label='Previous track'
                    onClick={() => {
                      session.dispatch({ type: 'previous' })
                    }}
                  >
                    <StepBack class='h-4 w-4' stroke-width={2} />
                  </button>
                  <button
                    type='button'
                    aria-label={playback.desiredPlaying ? 'Pause' : 'Play'}
                    class='bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md'
                    onClick={() => {
                      session.dispatch({ type: 'toggle' })
                    }}
                  >
                    {playback.desiredPlaying ? <Pause class='h-4 w-4' /> : <Play class='h-4 w-4' />}
                  </button>
                  <button
                    type='button'
                    class='hover:bg-accent inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md disabled:opacity-50'
                    disabled={!hasNextAudio()}
                    aria-label='Next track'
                    onClick={() => {
                      session.dispatch({ type: 'next' })
                    }}
                  >
                    <StepForward class='h-4 w-4' stroke-width={2} />
                  </button>
                  <button
                    type='button'
                    aria-label={playback.repeat ? 'Disable repeat' : 'Enable repeat'}
                    aria-pressed={playback.repeat ? 'true' : 'false'}
                    class={
                      playback.repeat
                        ? 'bg-primary text-primary-foreground inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md'
                        : 'hover:bg-accent inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md'
                    }
                    onClick={() => {
                      session.dispatch({ type: 'toggleRepeat' })
                    }}
                  >
                    <Repeat class='h-4 w-4' stroke-width={2} />
                  </button>
                </div>

                <div class='flex min-w-0 items-center justify-end gap-2'>
                  <QueuePanel />
                  {isVideoFile() ? (
                    <button
                      type='button'
                      class='border-input bg-background hover:bg-accent inline-flex h-8 shrink-0 items-center gap-1 rounded-md border px-2 text-xs'
                      onClick={handleShowVideo}
                    >
                      <Monitor class='h-4 w-4' stroke-width={2} />
                      Show video
                    </button>
                  ) : null}

                  <div class='ml-1 flex min-w-0 max-w-32 flex-1 items-center gap-2'>
                    <button
                      type='button'
                      aria-label={playback.muted ? 'Unmute' : 'Mute'}
                      class='hover:bg-accent inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md'
                      onClick={() => {
                        session.dispatch({ type: 'setMuted', muted: !playback.muted })
                      }}
                    >
                      {playback.muted ? <VolumeX class='h-4 w-4' /> : <Volume2 class='h-4 w-4' />}
                    </button>
                    <input
                      type='range'
                      aria-label='Volume'
                      aria-valuetext={`${Math.round((playback.muted ? 0 : playback.volume) * 100)} percent`}
                      min={0}
                      max={1}
                      step={0.01}
                      value={playback.muted ? 0 : playback.volume}
                      onInput={(event) => {
                        session.dispatch({
                          type: 'setVolume',
                          volume: Number.parseFloat(event.currentTarget.value),
                        })
                      }}
                      class='[&::-webkit-slider-thumb]:bg-primary h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-none bg-secondary [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full'
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    ) : null
  }),
)
const audioDetailsEvents = (
  element: HTMLElement,
  current: () => { open: boolean; close: () => void },
) => {
  const click = (event: MouseEvent) => {
    if (current().open && event.target instanceof Node && !element.contains(event.target))
      current().close()
  }
  const key = (event: KeyboardEvent) => {
    if (current().open && event.key === 'Escape') current().close()
  }
  document.addEventListener('mousedown', click)
  document.addEventListener('keydown', key)
  return () => {
    document.removeEventListener('mousedown', click)
    document.removeEventListener('keydown', key)
  }
}
