import { Slider } from '@/lib/ui/slider'
import { AudioPlaybackMenu } from '@/features/playback/AudioPlaybackMenu'
import { Button } from '@/lib/ui/button'
import { QueuePanel } from '@/features/music/QueuePanel'
import { MediaType } from '@/lib/files/types'
import Monitor from '@effectweb/lucide/icons/monitor'
import Pause from '@effectweb/lucide/icons/pause'
import Play from '@effectweb/lucide/icons/play'
import Repeat from '@effectweb/lucide/icons/repeat'
import StepBack from '@effectweb/lucide/icons/step-back'
import StepForward from '@effectweb/lucide/icons/step-forward'
import Volume2 from '@effectweb/lucide/icons/volume-2'
import VolumeX from '@effectweb/lucide/icons/volume-x'
import {
  audioPlaybackQueueFromFiles,
  formatPlaybackTime,
  playbackQueuesEqual,
} from '@/features/playback'
import { buildMediaUrl, buildThumbnailUrl } from '@/lib/media/build-media-url'
import { setAudioOnly } from '@/lib/browser/url-state-actions'
import { parentPath } from '@/lib/files/path-utils'
import { createFileSortMetadata, sortFilesForPath } from '@/features/explorer/file-display-settings'
import { AsyncResult } from 'effect/reactivity'
import { available, modelOwner, view, controllerView } from 'effectweb'
import { queryCache } from '@/lib/api/cache'
import { settingsQuery, statsQuery } from '@/lib/api/queries'
import { mediaSelectionSource } from '@/features/media-ai/selection'
import { getPlaybackSession } from '@/features/playback/PlaybackProvider'
import { playbackFilesQuery, audioMetadataQuery } from '@/features/playback/PlaybackMediaHost'
import { PlaybackScrubber } from '@/features/playback/create-playback-scrubber'
import type { FileItem } from '@/lib/files/types'
import type { GlobalSettings } from '@/lib/models/settings-types'
import type { AudioMetadata } from '@/features/playback/audio'
import { observeQuery } from '@effectweb/query'
function createAudioPlayer() {
  const session = getPlaybackSession()
  const owner = modelOwner({
    playback: session.getSnapshot(),
    files: [] as readonly FileItem[],
    settings: undefined as GlobalSettings | undefined,
    views: {} as Readonly<Record<string, number>>,
    metadata: undefined as AudioMetadata | undefined,
    metadataLoading: false,
    filesReady: false,
  })
  const syncQueue = () => {
    const state = owner.read()
    const current = state.playback.currentItem
    if (
      !current ||
      state.playback.mode !== 'audio' ||
      !state.filesReady ||
      mediaSelectionSource.model().selection.some((f) => f.path === current.locator)
    )
      return
    const files = sortFilesForPath(
      state.files,
      parentPath(current.locator),
      state.settings?.sortOrders,
      false,
      createFileSortMetadata(state.settings?.favorites, state.views),
    )
    const queue = audioPlaybackQueueFromFiles(files, current)
    const latest = session.getSnapshot()
    if (!latest.queueContext && !playbackQueuesEqual(latest.queue, queue))
      session.dispatch({ type: 'setQueue', queue, current })
  }
  const files = observeQuery(owner, queryCache, playbackFilesQuery, (result) => {
    owner.patch({
      files: available(result)?.files ?? [],
      filesReady: available(result) !== undefined,
    })
    syncQueue()
  })
  const metadata = observeQuery(owner, queryCache, audioMetadataQuery, (result) =>
    owner.patch({ metadata: available(result), metadataLoading: AsyncResult.isInitial(result) }),
  )
  const settings = observeQuery(owner, queryCache, settingsQuery, (result) => {
    owner.patch({ settings: available(result) })
    syncQueue()
  })
  const stats = observeQuery(owner, queryCache, statsQuery, (result) => {
    owner.patch({ views: available(result)?.views ?? {} })
    syncQueue()
  })
  let selected = ''
  let selectedDirectory: string | undefined
  const update = () => {
    const playback = session.getSnapshot()
    owner.patch({ playback })
    const path = playback.mode === 'audio' ? (playback.currentItem?.locator ?? '') : ''
    if (selected !== path) {
      selected = path
      const directory = path ? parentPath(path) : undefined
      if (directory !== selectedDirectory) {
        selectedDirectory = directory
        owner.patch({ filesReady: false })
        files.select(directory)
      }
      metadata.select(path || undefined)
    }
    syncQueue()
  }
  settings.select(true)
  stats.select(true)
  owner.own(session.subscribe(update))
  owner.own(mediaSelectionSource.subscribe(syncQueue))
  update()
  return { source: owner.source, lifetime: owner }
}
export const AudioPlayer = controllerView(
  { controller: createAudioPlayer },
  view((model) => {
    const session = {
      dispatch: (command: Parameters<ReturnType<typeof getPlaybackSession>['dispatch']>[0]) => {
        getPlaybackSession().dispatch(command)
      },
    }
    const currentItem = model.playback.currentItem
    const playbackMode = model.playback.mode
    const shouldHandleAudio = () => !!currentItem && playbackMode === 'audio'
    const playingPath = () => currentItem?.locator ?? ''
    const fileName = () => currentItem?.name ?? ''
    const isVideoFile = () => currentItem?.media === 'video'
    const allFiles = sortFilesForPath(
      model.files,
      parentPath(playingPath()),
      model.settings?.sortOrders,
      false,
      createFileSortMetadata(model.settings?.favorites, model.views),
    )
    const coverFile = allFiles.find(
      (file) =>
        file.type === MediaType.IMAGE &&
        file.name.toLowerCase().replace(/\.[^.]+$/, '') === 'cover',
    )
    const displayImageUrl = () =>
      isVideoFile() && playingPath()
        ? buildThumbnailUrl(playingPath())
        : model.metadata?.coverArt || (coverFile ? buildMediaUrl(coverFile.path) : null)
    const displayDuration = () =>
      isVideoFile() && (model.metadata?.duration ?? 0) > 0
        ? model.metadata!.duration!
        : model.playback.duration
    const scrubTime = model.playback.position
    const isRepeat = model.playback.repeat
    const hasPreviousAudio = () => model.playback.position > 20 || model.playback.currentIndex > 0
    const hasNextAudio = () =>
      model.playback.currentIndex >= 0 &&
      model.playback.currentIndex + 1 < model.playback.queue.length
    const playPrevious = () => session.dispatch({ type: 'previous' })
    const playNext = () => session.dispatch({ type: 'next' })
    const handleShowVideo = () => {
      if (isVideoFile()) {
        session.dispatch({ type: 'setMode', mode: 'video' })
        setAudioOnly(false)
      }
    }
    const metadataQuery = { isLoading: model.metadataLoading }
    return shouldHandleAudio() ? (
      <div
        data-testid='audio-player-chrome'
        class='fixed right-0 bottom-0 left-0 z-50 border-t border-border bg-background pb-[env(safe-area-inset-bottom,0px)]'
      >
        <div class='relative h-px w-full bg-secondary min-[650px]:hidden'>
          <div
            class='absolute top-0 left-0 h-full bg-white transition-all duration-100'
            style={{
              width: `${displayDuration() > 0 ? (scrubTime / displayDuration()) * 100 : 0}%`,
            }}
          />
          <PlaybackScrubber
            itemKey={`${playingPath()}\0${playbackMode}`}
            position={scrubTime}
            duration={displayDuration()}
            onSeek={(position) => session.dispatch({ type: 'seek', position })}
            ariaLabel='Playback position'
            class='absolute -top-2.5 left-0 h-5 w-full cursor-pointer touch-none opacity-0'
            disabled={!currentItem}
          />
        </div>

        <div class='container mx-auto px-2 py-1.5 min-[650px]:px-4 min-[650px]:py-3'>
          <div class='flex min-w-0 items-center gap-2 min-[650px]:gap-4'>
            <div class='flex shrink-0 items-center gap-0.5 min-[650px]:gap-2'>
              <Button
                size='icon'
                variant='ghost'
                type='button'
                aria-label='Previous track'
                disabled={!hasPreviousAudio()}
                onClick={playPrevious}
                class='size-8 shrink-0 min-[650px]:size-10'
              >
                <StepBack class='size-3.5 min-[650px]:size-4' />
              </Button>
              <Button
                variant='default'
                type='button'
                aria-label={model.playback.desiredPlaying ? 'Pause' : 'Play'}
                disabled={!currentItem}
                onClick={() => session.dispatch({ type: 'toggle' })}
                size='icon'
                class='size-8 shrink-0 min-[650px]:size-10'
              >
                {model.playback.desiredPlaying ? (
                  <Pause class='size-3.5 min-[650px]:size-4' />
                ) : (
                  <Play class='size-3.5 min-[650px]:size-4' />
                )}
              </Button>
              <Button
                size='icon'
                variant='ghost'
                type='button'
                aria-label='Next track'
                disabled={!hasNextAudio()}
                onClick={playNext}
                class='size-8 shrink-0 min-[650px]:size-10'
              >
                <StepForward class='size-3.5 min-[650px]:size-4' />
              </Button>
              <Button
                size='icon'
                variant={isRepeat ? 'default' : 'ghost'}
                type='button'
                aria-label={isRepeat ? 'Disable repeat' : 'Enable repeat'}
                aria-pressed={isRepeat ? 'true' : 'false'}
                disabled={!currentItem}
                onClick={() => session.dispatch({ type: 'toggleRepeat' })}
                class='size-8 shrink-0 min-[650px]:size-10'
              >
                <Repeat class='size-3.5 min-[650px]:size-4' />
              </Button>
              {isVideoFile() ? (
                <Button
                  size='icon'
                  variant='ghost'
                  type='button'
                  disabled={!currentItem}
                  onClick={handleShowVideo}
                  aria-label='Show video'
                  class='size-8 shrink-0 min-[650px]:size-10'
                >
                  <Monitor class='size-3.5 min-[650px]:size-4' />
                </Button>
              ) : null}
            </div>

            <div class='hidden h-8 w-px shrink-0 bg-border min-[650px]:block' />

            <div class='hidden flex-1 items-center gap-3 min-[650px]:flex'>
              <span class='text-sm tabular-nums'>{formatPlaybackTime(scrubTime)}</span>
              <PlaybackScrubber
                itemKey={`${playingPath()}\0${playbackMode}`}
                position={scrubTime}
                duration={displayDuration()}
                onSeek={(position) => session.dispatch({ type: 'seek', position })}
                ariaLabel='Playback position'
                class='h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-secondary [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary'
                disabled={!currentItem}
              />
              <span class='text-sm tabular-nums'>{formatPlaybackTime(displayDuration())}</span>
            </div>

            <div class='hidden h-8 w-px shrink-0 bg-border min-[650px]:block' />

            <div class='hidden min-w-[140px] items-center gap-2 lg:flex'>
              <Button
                variant='ghost'
                type='button'
                aria-label={model.playback.muted ? 'Unmute' : 'Mute'}
                onClick={() => session.dispatch({ type: 'setMuted', muted: !model.playback.muted })}
                size='icon'
                class='size-10 shrink-0'
              >
                {model.playback.muted ? <VolumeX class='size-4' /> : <Volume2 class='size-4' />}
              </Button>
              <Slider
                aria-label='Volume'
                aria-valuetext={`${Math.round((model.playback.muted ? 0 : model.playback.volume) * 100)} percent`}
                min={0}
                max={1}
                step={0.01}
                value={model.playback.muted ? 0 : model.playback.volume}
                onValueChange={(value) => session.dispatch({ type: 'setVolume', volume: value })}
                class='min-w-10 flex-1'
              />
            </div>

            <div class='shrink-0'>
              <AudioPlaybackMenu
                rate={model.playback.playbackRate}
                timer={model.playback.sleepTimer}
                disabled={false}
                onRate={(rate) => session.dispatch({ type: 'setPlaybackRate', rate })}
              />
            </div>
            <QueuePanel />
            <div class='hidden h-8 w-px shrink-0 bg-border md:block' />

            <div class='order-first flex min-w-0 flex-1 items-center gap-2 min-[650px]:order-none min-[650px]:w-[200px] min-[650px]:flex-none min-[650px]:gap-3 lg:w-[280px]'>
              {displayImageUrl() ? (
                <img
                  src={displayImageUrl()!}
                  alt='Album art'
                  class='size-9 shrink-0 rounded object-cover min-[650px]:size-12'
                />
              ) : null}

              <div class='min-w-0 flex-1'>
                {!metadataQuery.isLoading ? (
                  <>
                    <div class='truncate text-xs font-medium min-[650px]:text-sm'>
                      {model.metadata?.title || fileName()}
                    </div>
                    {model.metadata?.artist ? (
                      <div class='truncate text-[11px] text-muted-foreground min-[650px]:text-xs'>
                        {model.metadata.artist}
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    ) : null
  }),
)
