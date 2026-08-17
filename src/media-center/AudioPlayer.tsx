import { api, post } from '@/lib/api/client'
import { queryKeys } from '@/lib/api/query-keys'
import { MediaType, type FileItem } from '@/lib/files/types'
import type { GlobalSettings } from '@/lib/models/settings-types'
import { isVirtualFolderPath } from '@/lib/files/constants'
import { useQuery } from '@tanstack/solid-query'
import Monitor from 'lucide-solid/icons/monitor'
import Pause from 'lucide-solid/icons/pause'
import Play from 'lucide-solid/icons/play'
import Repeat from 'lucide-solid/icons/repeat'
import StepBack from 'lucide-solid/icons/step-back'
import StepForward from 'lucide-solid/icons/step-forward'
import Volume2 from 'lucide-solid/icons/volume-2'
import VolumeX from 'lucide-solid/icons/volume-x'
import { Show, createEffect, createMemo } from 'solid-js'
import { createUrlSearchParamsMemo, useBrowserHistory } from '@/lib/browser/browser-history'
import {
  audioPlaybackQueueFromFiles,
  fetchAudioMetadata,
  formatPlaybackTime,
  playbackQueuesEqual,
  type PlaybackItem,
} from '@/features/playback'
import { usePlaybackSession, usePlaybackSnapshot } from '@/features/playback/PlaybackProvider'
import {
  buildAudioMetadataUrl,
  buildMediaUrl,
  buildThumbnailUrl,
} from '@/lib/media/build-media-url'
import { setAudioOnly } from '@/lib/browser/url-state-actions'
import { parentPath } from '@/lib/files/path-utils'
import { DEFAULT_FILE_SORT, sortFileItems } from '@/features/explorer/file-display-settings'

export function AudioPlayer() {
  const history = useBrowserHistory()
  const urlSearchParams = createUrlSearchParamsMemo(history)
  const session = usePlaybackSession()
  const snapshot = usePlaybackSnapshot()

  const currentItem = createMemo(() => snapshot().currentItem)
  const playbackMode = createMemo(() => snapshot().mode)
  const shouldHandleAudio = createMemo(() => !!currentItem() && playbackMode() === 'audio')
  const playingPath = createMemo(() => currentItem()?.locator ?? '')
  const currentDir = createMemo(() => urlSearchParams().get('dir') || parentPath(playingPath()))
  const fileName = createMemo(() => currentItem()?.name ?? '')
  const isVideoFile = createMemo(() => currentItem()?.media === 'video')

  const filesQuery = useQuery(() => ({
    queryKey: queryKeys.files(currentDir()),
    queryFn: () => api<{ files: FileItem[] }>(`/api/files?dir=${encodeURIComponent(currentDir())}`),
  }))
  const settingsQuery = useQuery(() => ({
    queryKey: queryKeys.settings(),
    queryFn: () => api<GlobalSettings>('/api/settings'),
  }))
  const allFiles = createMemo(() => {
    const files = filesQuery.data?.files ?? []
    const directory = currentDir()
    if (isVirtualFolderPath(directory)) return files
    const order = settingsQuery.data?.sortOrders?.[directory] ?? DEFAULT_FILE_SORT
    return sortFileItems(files, order)
  })

  createEffect(
    () => {
      const current = currentItem()
      if (!current || playbackMode() !== 'audio') return null
      return { current, queue: audioPlaybackQueueFromFiles(allFiles(), current) }
    },
    (next) => {
      if (!next) return
      const state = session.getSnapshot()
      if (!playbackQueuesEqual(state.queue, next.queue)) {
        session.dispatch({ type: 'setQueue', queue: next.queue, current: next.current })
      }
    },
  )

  const coverArtUrl = createMemo(() => {
    const coverFile = allFiles().find((file) => {
      if (file.type !== MediaType.IMAGE) return false
      return file.name.toLowerCase().replace(/\.[^.]+$/, '') === 'cover'
    })
    return coverFile ? buildMediaUrl(coverFile.path) : null
  })

  const metadataUrl = createMemo(() => {
    const path = playingPath()
    return path ? buildAudioMetadataUrl(path) : ''
  })
  const metadataQuery = useQuery(() => ({
    queryKey: queryKeys.audioMetadata(playingPath()),
    queryFn: () => fetchAudioMetadata(metadataUrl()),
    enabled: shouldHandleAudio() && !!metadataUrl(),
    refetchOnWindowFocus: false,
  }))
  const audioMetadata = createMemo(() => metadataQuery.data)

  const displayImageUrl = createMemo(() => {
    const path = playingPath()
    if (isVideoFile() && path) return buildThumbnailUrl(path)
    return audioMetadata()?.coverArt || coverArtUrl()
  })
  const scrubTime = createMemo(() => snapshot().position)
  const displayDuration = createMemo(() => {
    const metadataDuration = audioMetadata()?.duration
    return isVideoFile() && metadataDuration && metadataDuration > 0
      ? metadataDuration
      : snapshot().duration
  })
  const isRepeat = createMemo(() => snapshot().repeat)
  const hasPreviousAudio = createMemo(() => {
    const state = snapshot()
    return state.position > 20 || state.currentIndex > 0
  })
  const hasNextAudio = createMemo(() => {
    const state = snapshot()
    return state.currentIndex >= 0 && state.currentIndex + 1 < state.queue.length
  })

  function incrementView(item: PlaybackItem | undefined) {
    if (item) void post('/api/stats/views', { filePath: item.locator }).catch(() => undefined)
  }

  function playPrevious() {
    const state = session.getSnapshot()
    if (state.position <= 20) incrementView(state.queue[state.currentIndex - 1])
    session.dispatch({ type: 'previous' })
  }

  function playNext() {
    const state = session.getSnapshot()
    incrementView(state.queue[state.currentIndex + 1])
    session.dispatch({ type: 'next' })
  }

  function handleShowVideo() {
    if (!isVideoFile()) return
    session.dispatch({ type: 'setMode', mode: 'video' })
    setAudioOnly(false)
  }

  return (
    <Show when={shouldHandleAudio()}>
      <div
        data-testid='audio-player-chrome'
        class='fixed right-0 bottom-0 left-0 z-50 border-t border-border bg-background pb-[env(safe-area-inset-bottom,0px)]'
      >
        <div class='relative h-px w-full bg-secondary min-[650px]:hidden'>
          <div
            class='absolute top-0 left-0 h-full bg-white transition-all duration-100'
            style={{
              width: `${displayDuration() > 0 ? (scrubTime() / displayDuration()) * 100 : 0}%`,
            }}
          />
          <input
            type='range'
            aria-label='Playback position'
            aria-valuetext={`${formatPlaybackTime(scrubTime())} of ${formatPlaybackTime(displayDuration())}`}
            min={0}
            max={displayDuration() || 0}
            value={scrubTime()}
            onInput={(event) =>
              session.dispatch({
                type: 'seek',
                position: Number.parseFloat(event.currentTarget.value),
              })
            }
            class='absolute top-0 left-0 h-full w-full cursor-pointer opacity-0'
            disabled={!currentItem()}
          />
        </div>

        <div class='container mx-auto px-2 py-1.5 min-[650px]:px-4 min-[650px]:py-3'>
          <div class='flex min-w-0 items-center gap-2 min-[650px]:gap-4'>
            <div class='flex shrink-0 items-center gap-0.5 min-[650px]:gap-2'>
              <button
                type='button'
                aria-label='Previous track'
                disabled={!hasPreviousAudio()}
                onClick={playPrevious}
                class='inline-flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent disabled:opacity-50 min-[650px]:size-10'
              >
                <StepBack class='size-3.5 min-[650px]:size-4' />
              </button>
              <button
                type='button'
                aria-label={snapshot().desiredPlaying ? 'Pause' : 'Play'}
                disabled={!currentItem()}
                onClick={() => session.dispatch({ type: 'toggle' })}
                class='inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 min-[650px]:size-10'
              >
                <Show
                  when={snapshot().desiredPlaying}
                  fallback={<Play class='size-3.5 min-[650px]:size-4' />}
                >
                  <Pause class='size-3.5 min-[650px]:size-4' />
                </Show>
              </button>
              <button
                type='button'
                aria-label='Next track'
                disabled={!hasNextAudio()}
                onClick={playNext}
                class='inline-flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent disabled:opacity-50 min-[650px]:size-10'
              >
                <StepForward class='size-3.5 min-[650px]:size-4' />
              </button>
              <button
                type='button'
                aria-label={isRepeat() ? 'Disable repeat' : 'Enable repeat'}
                aria-pressed={isRepeat() ? 'true' : 'false'}
                disabled={!currentItem()}
                onClick={() => session.dispatch({ type: 'toggleRepeat' })}
                class={
                  isRepeat()
                    ? 'inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50 min-[650px]:size-10'
                    : 'inline-flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent disabled:opacity-50 min-[650px]:size-10'
                }
              >
                <Repeat class='size-3.5 min-[650px]:size-4' />
              </button>
              <Show when={isVideoFile()}>
                <button
                  type='button'
                  disabled={!currentItem()}
                  onClick={handleShowVideo}
                  aria-label='Show video'
                  class='inline-flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent disabled:opacity-50 min-[650px]:size-10'
                >
                  <Monitor class='size-3.5 min-[650px]:size-4' />
                </button>
              </Show>
            </div>

            <div class='hidden h-8 w-px shrink-0 bg-border min-[650px]:block' />

            <div class='hidden flex-1 items-center gap-3 min-[650px]:flex'>
              <span class='text-sm tabular-nums'>{formatPlaybackTime(scrubTime())}</span>
              <input
                type='range'
                aria-label='Playback position'
                aria-valuetext={`${formatPlaybackTime(scrubTime())} of ${formatPlaybackTime(displayDuration())}`}
                min={0}
                max={displayDuration() || 0}
                value={scrubTime()}
                onInput={(event) =>
                  session.dispatch({
                    type: 'seek',
                    position: Number.parseFloat(event.currentTarget.value),
                  })
                }
                class='h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-secondary [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary'
                disabled={!currentItem()}
              />
              <span class='text-sm tabular-nums'>{formatPlaybackTime(displayDuration())}</span>
            </div>

            <div class='hidden h-8 w-px shrink-0 bg-border min-[650px]:block' />

            <div class='hidden min-w-[140px] items-center gap-2 lg:flex'>
              <button
                type='button'
                aria-label={snapshot().muted ? 'Unmute' : 'Mute'}
                onClick={() => session.dispatch({ type: 'setMuted', muted: !snapshot().muted })}
                class='inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md hover:bg-accent'
              >
                <Show when={snapshot().muted} fallback={<Volume2 class='h-4 w-4' />}>
                  <VolumeX class='h-4 w-4' />
                </Show>
              </button>
              <input
                type='range'
                aria-label='Volume'
                aria-valuetext={`${Math.round((snapshot().muted ? 0 : snapshot().volume) * 100)} percent`}
                min={0}
                max={1}
                step={0.01}
                value={snapshot().muted ? 0 : snapshot().volume}
                onInput={(event) =>
                  session.dispatch({
                    type: 'setVolume',
                    volume: Number.parseFloat(event.currentTarget.value),
                  })
                }
                class='h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-secondary [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary'
              />
            </div>

            <div class='hidden h-8 w-px shrink-0 bg-border md:block' />

            <div class='flex min-w-0 flex-1 items-center gap-2 min-[650px]:w-[200px] min-[650px]:flex-none min-[650px]:gap-3 lg:w-[280px]'>
              <div class='size-9 shrink-0 overflow-hidden rounded bg-secondary min-[650px]:size-12'>
                <Show when={displayImageUrl()}>
                  <img src={displayImageUrl()!} alt='Album art' class='size-full object-cover' />
                </Show>
              </div>

              <div class='min-w-0 flex-1'>
                <Show when={!metadataQuery.isLoading}>
                  <div class='truncate text-xs font-medium min-[650px]:text-sm'>
                    {audioMetadata()?.title || fileName()}
                  </div>
                  <div class='truncate text-[11px] text-muted-foreground min-[650px]:text-xs'>
                    {audioMetadata()?.artist || 'Unknown Artist'}
                  </div>
                </Show>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Show>
  )
}
