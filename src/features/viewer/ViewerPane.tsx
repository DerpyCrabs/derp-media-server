import { useQueries, useQuery } from '@tanstack/solid-query'
import { api } from '@/lib/api/client'
import { queryKeys } from '@/lib/api/query-keys'
import { fileDownloadHref } from '@/lib/files/download-urls'
import { getMediaTypeFromPath } from '@/lib/media/media-utils'
import { formatFileSize } from '@/lib/media/media-utils'
import type { FileItem } from '@/lib/files/types'
import { MediaType } from '@/lib/files/types'
import Download from 'lucide-solid/icons/download'
import FileQuestion from 'lucide-solid/icons/file-question-mark'
import FileText from 'lucide-solid/icons/file-text'
import Headphones from 'lucide-solid/icons/headphones'
import LoaderCircle from 'lucide-solid/icons/loader-circle'
import Music2 from 'lucide-solid/icons/music-2'
import Pause from 'lucide-solid/icons/pause'
import Play from 'lucide-solid/icons/play'
import Volume2 from 'lucide-solid/icons/volume-2'
import VolumeX from 'lucide-solid/icons/volume-x'
import type { Accessor } from 'solid-js'
import { For, Match, Show, Switch, createEffect, createMemo, createSignal, lazy } from 'solid-js'
import { buildAdminMediaUrl, buildAudioMetadataUrl } from '@/lib/media/build-media-url'
import { ImageViewerPane } from './ImageViewerPane'
import { TextEditorPane } from './TextEditorPane'
import {
  audioPlaybackQueueFromFiles,
  type AudioMetadata,
  fetchAudioMetadata,
  formatPlaybackTime,
  playbackItemFromPath,
  playbackPathKey,
  playbackPathMatches,
  playbackQueuesEqual,
  type PlaybackItem,
} from '@/features/playback'
import {
  usePlaybackMediaHost,
  usePlaybackSession,
  usePlaybackSnapshot,
} from '@/features/playback/PlaybackProvider'

const ReaderDialog = lazy(() =>
  import('@/features/reader/ReaderDialog').then((module) => ({ default: module.ReaderDialog })),
)

type Props = {
  viewingPath: Accessor<string>
  directory?: Accessor<string>
  contentVisible: Accessor<boolean>
  active?: Accessor<boolean>
  editableFolders: string[]
  /** Same as main file browser — required for Obsidian-style images in knowledge bases. */
  knowledgeBases?: string[]
  onNavigateViewing: (path: string) => void
  onVideoMetadataLoaded?: (videoWidth: number, videoHeight: number) => void
  autoPlayVideo?: boolean
  showPlayback?: boolean
  presentation?: 'embedded' | 'modal'
  readerKind?: Accessor<'pdf' | 'folder' | 'book' | null>
  onClose?: () => void
  /** Close the viewer tab after switching to taskbar audio (playback keeps running). */
  onListenOnlyDismissViewer?: () => void
  showListenOnly?: boolean
  onAudioActivate?: () => void
}

export function ViewerPane(props: Props) {
  const playbackSession = usePlaybackSession()
  const playback = usePlaybackSnapshot()
  const playbackMediaHost = usePlaybackMediaHost()

  const viewingPath = createMemo(() => props.viewingPath())
  const readerKind = createMemo(() => props.readerKind?.() ?? null)

  const mediaType = createMemo(() => getMediaTypeFromPath(viewingPath()))

  const downloadHref = createMemo(() => {
    const path = viewingPath()
    if (!path) return '#'
    return fileDownloadHref(path)
  })

  const dirFromWindow = createMemo(() => props.directory?.() ?? '')
  const contentActive = createMemo(() => props.active?.() ?? props.contentVisible())
  const showPlayback = createMemo(() => props.showPlayback !== false)

  const [videoEl, setVideoEl] = createSignal<HTMLVideoElement | undefined>()
  const [videoReadyGeneration, setVideoReadyGeneration] = createSignal(0)
  const [audioSurfaceEl, setAudioSurfaceEl] = createSignal<HTMLDivElement>()
  const [audioSurfaceSize, setAudioSurfaceSize] = createSignal({ width: 576, height: 256 })

  createEffect(
    () => audioSurfaceEl(),
    (element) => {
      if (!element) return undefined
      const update = () => {
        const rect = element.getBoundingClientRect()
        setAudioSurfaceSize({ width: rect.width, height: rect.height })
      }
      update()
      const observer = new ResizeObserver(update)
      observer.observe(element)
      // eslint-disable-next-line solid/reactivity
      return () => observer.disconnect()
    },
  )

  const audioLayout = createMemo<'compact' | 'standard' | 'expanded'>(() => {
    const size = audioSurfaceSize()
    if (size.width >= 640 && size.height >= 236) return 'expanded'
    if (size.width < 480 || size.height < 230) return 'compact'
    return 'standard'
  })

  const videoPlaybackActive = createMemo(() => {
    const state = playback()
    return (
      mediaType() === MediaType.VIDEO &&
      state.mode === 'video' &&
      state.currentItem?.media === 'video' &&
      playbackPathMatches(state.currentItem, viewingPath())
    )
  })
  const videoLoading = createMemo(() => {
    if (!videoPlaybackActive()) return false
    const state = playback()
    if (state.phase === 'resolving') return true
    return !!state.source && videoReadyGeneration() !== state.source.generation
  })
  const videoError = createMemo(() => (videoPlaybackActive() ? playback().error : null))

  let offeredInitialVideoPath = ''
  createEffect(
    () => {
      const path = viewingPath()
      return {
        path,
        currentItem: playback().currentItem,
        isVideo: mediaType() === MediaType.VIDEO,
        playbackShown: showPlayback(),
        contentVisible: props.contentVisible(),
        key: path ? playbackPathKey(path) : '',
      }
    },
    ({ path, currentItem, isVideo, playbackShown, contentVisible, key }) => {
      if (
        !path ||
        !isVideo ||
        !playbackShown ||
        !contentVisible ||
        offeredInitialVideoPath === key
      ) {
        return
      }
      offeredInitialVideoPath = key
      if (
        playbackPathMatches(currentItem, path) ||
        (currentItem && props.autoPlayVideo === false)
      ) {
        return
      }
      playbackSession.dispatch({
        type: 'load',
        item: playbackItemFromPath(path, 'video'),
        autoplay: props.autoPlayVideo !== false,
        mode: 'video',
      })
    },
  )

  createEffect(
    () => {
      const generation = videoPlaybackActive() ? (playback().source?.generation ?? 0) : 0
      return { generation, readyGeneration: videoReadyGeneration() }
    },
    ({ generation, readyGeneration }) => {
      if (readyGeneration !== generation) setVideoReadyGeneration(0)
    },
  )

  createEffect(
    () => {
      const element = videoEl()
      const path = viewingPath()
      return element && path && showPlayback() && props.contentVisible() && videoPlaybackActive()
        ? { element, path }
        : null
    },
    (attachment) => {
      if (!attachment) return undefined
      const detach = playbackMediaHost.attach(attachment.element, 'video')
      // eslint-disable-next-line solid/reactivity
      return () => {
        const state = playbackSession.getSnapshot()
        if (
          state.mode === 'video' &&
          state.desiredPlaying &&
          playbackPathMatches(state.currentItem, attachment.path)
        ) {
          playbackSession.dispatch({ type: 'pause' })
        }
        detach()
      }
    },
  )

  const listDirForFiles = createMemo(() => dirFromWindow())

  const filesQuery = useQuery(() => {
    return {
      queryKey: queryKeys.files(listDirForFiles()),
      queryFn: () =>
        api<{ files: FileItem[] }>(`/api/files?dir=${encodeURIComponent(listDirForFiles())}`),
      enabled:
        (mediaType() === MediaType.IMAGE ||
          mediaType() === MediaType.AUDIO ||
          mediaType() === MediaType.OTHER) &&
        Boolean(viewingPath()),
    }
  })

  const folderAudioFiles = createMemo(() =>
    (filesQuery.data?.files ?? []).filter((file) => file.type === MediaType.AUDIO),
  )

  const audioQueue = createMemo(() => {
    const queue = audioPlaybackQueueFromFiles(folderAudioFiles())
    const path = viewingPath()
    if (!path || mediaType() !== MediaType.AUDIO) return queue
    if (queue.some((item) => playbackPathMatches(item, path))) return queue
    return [...queue, playbackItemFromPath(path, 'audio')]
  })
  const audioPlaybackActive = createMemo(() => {
    const state = playback()
    return (
      mediaType() === MediaType.AUDIO &&
      state.mode === 'audio' &&
      state.currentItem?.media === 'audio' &&
      playbackPathMatches(state.currentItem, viewingPath())
    )
  })
  const audioPlaying = createMemo(() => audioPlaybackActive() && playback().desiredPlaying)
  const audioCurrentTime = createMemo(() => (audioPlaybackActive() ? playback().position : 0))
  const audioDuration = createMemo(() => (audioPlaybackActive() ? playback().duration : 0))
  const audioVolume = createMemo(() => playback().volume)
  const audioMuted = createMemo(() => playback().muted)
  const audioLoading = createMemo(() => audioPlaybackActive() && playback().phase === 'resolving')
  const audioError = createMemo(() => (audioPlaybackActive() ? playback().error : null))
  const unsupportedFile = createMemo(
    () =>
      filesQuery.data?.files.find(
        (file) => file.path === viewingPath() && file.type === MediaType.OTHER,
      ) ?? null,
  )

  function audioItem(path: string): PlaybackItem {
    return (
      audioQueue().find((item) => playbackPathMatches(item, path)) ??
      playbackItemFromPath(path, 'audio')
    )
  }

  function loadAudio(path: string, autoplay: boolean, position?: number) {
    playbackSession.dispatch({
      type: 'load',
      item: audioItem(path),
      queue: audioQueue(),
      autoplay,
      mode: 'audio',
      ...(position === undefined ? {} : { position }),
    })
  }

  function toggleAudioPlayback() {
    const path = viewingPath()
    if (!path) return
    props.onAudioActivate?.()
    if (audioPlaybackActive()) playbackSession.dispatch({ type: 'toggle' })
    else loadAudio(path, true)
  }

  function seekAudio(time: number) {
    if (!Number.isFinite(time)) return
    const path = viewingPath()
    if (!path) return
    props.onAudioActivate?.()
    if (audioPlaybackActive()) playbackSession.dispatch({ type: 'seek', position: time })
    else loadAudio(path, false, time)
  }

  function setAudioPlayerVolume(volume: number) {
    playbackSession.dispatch({ type: 'setVolume', volume })
  }

  function toggleAudioMute() {
    playbackSession.dispatch({ type: 'setMuted', muted: !playback().muted })
  }

  function selectAudioFile(file: FileItem) {
    const controlledCurrent = audioPlaybackActive()
    props.onAudioActivate?.()
    props.onNavigateViewing(file.path)
    if (controlledCurrent) {
      const queue = audioPlaybackQueueFromFiles(folderAudioFiles())
      const item = queue.find((candidate) => playbackPathMatches(candidate, file.path))
      if (item) {
        playbackSession.dispatch({
          type: 'load',
          item,
          queue,
          autoplay: false,
          mode: 'audio',
        })
      }
    }
  }

  let offeredInitialAudioPath = ''
  createEffect(
    () => {
      const path = viewingPath()
      return {
        path,
        currentItem: playback().currentItem,
        playbackShown: showPlayback(),
        autoPlayVideo: props.autoPlayVideo,
        isAudio: mediaType() === MediaType.AUDIO,
        contentVisible: props.contentVisible(),
        key: path ? playbackPathKey(path) : '',
      }
    },
    ({ path, currentItem, playbackShown, autoPlayVideo, isAudio, contentVisible, key }) => {
      if (
        !playbackShown ||
        autoPlayVideo !== false ||
        !path ||
        !isAudio ||
        !contentVisible ||
        offeredInitialAudioPath === key
      ) {
        return
      }
      offeredInitialAudioPath = key
      if (!currentItem) loadAudio(path, false)
    },
  )

  createEffect(
    () => {
      const state = playback()
      const queue = audioQueue()
      return audioPlaybackActive() && queue.length > 0 && state.currentItem
        ? { state, queue }
        : null
    },
    (next) => {
      if (!next || playbackQueuesEqual(next.state.queue, next.queue)) return
      playbackSession.dispatch({
        type: 'setQueue',
        queue: next.queue,
        current: next.state.currentItem!,
      })
    },
  )

  function retryMedia() {
    if (videoPlaybackActive() || audioPlaybackActive()) {
      playbackSession.dispatch({ type: 'retry' })
    }
  }

  function handleListenOnly() {
    const path = viewingPath()
    if (!path) return
    const elementTime = videoEl()?.currentTime
    const position =
      elementTime !== undefined && Number.isFinite(elementTime)
        ? elementTime
        : videoPlaybackActive()
          ? playback().position
          : 0
    if (videoPlaybackActive()) {
      playbackSession.dispatch({ type: 'seek', position })
      playbackSession.dispatch({ type: 'setMode', mode: 'audio' })
      playbackSession.dispatch({ type: 'play' })
    } else {
      playbackSession.dispatch({
        type: 'load',
        item: playbackItemFromPath(path, 'video'),
        autoplay: true,
        position,
        mode: 'audio',
      })
    }
    props.onListenOnlyDismissViewer?.()
  }

  const audioMetadataUrl = createMemo(() => {
    const path = viewingPath()
    if (!path || mediaType() !== MediaType.AUDIO) return ''
    return buildAudioMetadataUrl(path)
  })

  const audioMetadataQuery = useQuery(() => ({
    queryKey: queryKeys.audioMetadata(viewingPath()),
    queryFn: () => fetchAudioMetadata(audioMetadataUrl()),
    enabled: !!audioMetadataUrl(),
    refetchOnWindowFocus: false,
  }))

  const playlistMetadataQueries = useQueries(() => ({
    queries: folderAudioFiles().map((file) => {
      const url = buildAudioMetadataUrl(file.path)
      return {
        queryKey: queryKeys.audioMetadata(file.path),
        queryFn: () => fetchAudioMetadata(url),
        enabled: mediaType() === MediaType.AUDIO && audioLayout() === 'expanded',
        refetchOnWindowFocus: false,
      }
    }),
  }))

  const folderCoverUrl = createMemo(() => {
    const cover = (filesQuery.data?.files ?? []).find((file) => {
      if (file.type !== MediaType.IMAGE) return false
      const stem = file.name.toLowerCase().replace(/\.[^.]+$/, '')
      return stem === 'cover' || stem === 'folder'
    })
    if (!cover) return null
    return buildAdminMediaUrl(cover.path)
  })

  const audioArtworkUrl = createMemo(() => audioMetadataQuery.data?.coverArt || folderCoverUrl())

  const audioDisplayDuration = createMemo(() => {
    const elementDuration = audioDuration()
    if (elementDuration > 0) return elementDuration
    return audioMetadataQuery.data?.duration ?? 0
  })

  const fileName = createMemo(() => viewingPath().split(/[/\\]/).pop() ?? 'file')
  const ext = createMemo(() => viewingPath().split('.').pop()?.toLowerCase() || '')

  function AudioArtwork(props: { class: string }) {
    return (
      <div
        class={`ring-border/70 relative shrink-0 overflow-hidden rounded-lg bg-neutral-900 shadow-md ring-1 ${props.class}`}
      >
        <Show
          when={audioArtworkUrl()}
          fallback={
            <div class='flex h-full w-full items-center justify-center bg-gradient-to-br from-fuchsia-950 to-neutral-950'>
              <Music2 class='h-8 w-8 text-fuchsia-300/80' stroke-width={1.5} />
            </div>
          }
        >
          <img src={audioArtworkUrl()!} alt='Album art' class='h-full w-full object-cover' />
        </Show>
      </div>
    )
  }

  function AudioInfo(props: { compact?: boolean }) {
    return (
      <div class='min-w-0'>
        <h2
          class={`truncate font-semibold leading-tight text-foreground ${props.compact ? 'text-sm' : 'text-lg'}`}
          title={audioMetadataQuery.data?.title || fileName()}
        >
          {audioMetadataQuery.data?.title || fileName()}
        </h2>
        <p class='mt-0.5 truncate text-xs text-muted-foreground'>
          {audioMetadataQuery.data?.artist || 'Unknown artist'}
        </p>
        <Show when={!props.compact}>
          <p class='truncate text-[11px] text-muted-foreground/75'>
            {audioMetadataQuery.data?.album || dirFromWindow() || 'Unknown album'}
          </p>
          <div class='mt-1.5 flex gap-1.5 text-[10px] text-muted-foreground'>
            <span class='rounded bg-muted px-1.5 py-0.5 font-medium'>{ext().toUpperCase()}</span>
            <span class='rounded bg-muted px-1.5 py-0.5 tabular-nums'>
              {formatPlaybackTime(audioDisplayDuration())}
            </span>
          </div>
        </Show>
      </div>
    )
  }

  function AudioSeek() {
    return (
      <div class='flex min-w-0 items-center gap-2 text-[10px] text-muted-foreground'>
        <span class='w-8 text-right tabular-nums'>{formatPlaybackTime(audioCurrentTime())}</span>
        <input
          type='range'
          aria-label='Playback position'
          min={0}
          max={audioDisplayDuration() || 0}
          step={0.1}
          value={audioCurrentTime()}
          onInput={(event) => seekAudio(Number.parseFloat(event.currentTarget.value))}
          class='[&::-webkit-slider-thumb]:bg-primary h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-secondary [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full'
        />
        <span class='w-8 tabular-nums'>{formatPlaybackTime(audioDisplayDuration())}</span>
      </div>
    )
  }

  function AudioTransport() {
    return (
      <div class='flex min-w-0 items-center gap-2'>
        <button
          type='button'
          aria-label={audioPlaying() ? 'Pause' : 'Play'}
          class='bg-primary text-primary-foreground hover:bg-primary/90 inline-flex size-9 shrink-0 items-center justify-center rounded-full shadow-sm'
          onClick={toggleAudioPlayback}
        >
          <Show when={audioPlaying()} fallback={<Play class='size-4 fill-current' />}>
            <Pause class='size-4 fill-current' />
          </Show>
        </button>
        <button
          type='button'
          aria-label={audioMuted() ? 'Unmute' : 'Mute'}
          class='hover:bg-muted inline-flex size-8 shrink-0 items-center justify-center rounded-md'
          onClick={toggleAudioMute}
        >
          <Show when={audioMuted()} fallback={<Volume2 class='size-4' />}>
            <VolumeX class='size-4' />
          </Show>
        </button>
        <input
          type='range'
          aria-label='Volume'
          min={0}
          max={1}
          step={0.01}
          value={audioMuted() ? 0 : audioVolume()}
          onInput={(event) => setAudioPlayerVolume(Number.parseFloat(event.currentTarget.value))}
          class='[&::-webkit-slider-thumb]:bg-foreground h-1.5 min-w-10 flex-1 cursor-pointer appearance-none rounded-full bg-secondary [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full'
        />
        <a
          href={downloadHref()}
          download={fileName()}
          aria-label='Download'
          title='Download'
          class='hover:bg-muted inline-flex size-8 shrink-0 items-center justify-center rounded-md'
        >
          <Download class='size-4' />
        </a>
      </div>
    )
  }

  function StandardAudioPlayer() {
    return (
      <div class='grid h-full min-h-0 grid-cols-[112px_minmax(0,1fr)] items-center gap-4 p-4'>
        <AudioArtwork class='size-28' />
        <div class='min-w-0 space-y-2.5'>
          <AudioInfo />
          <AudioSeek />
          <AudioTransport />
        </div>
      </div>
    )
  }

  function CompactAudioPlayer() {
    return (
      <div class='flex h-full min-h-0 flex-col justify-center gap-2.5 p-3'>
        <div class='flex min-w-0 items-center gap-3'>
          <AudioArtwork class='size-12' />
          <div class='min-w-0 flex-1'>
            <AudioInfo compact />
          </div>
        </div>
        <AudioSeek />
        <AudioTransport />
      </div>
    )
  }

  function AudioPlaylist() {
    return (
      <div
        data-testid='canvas-audio-playlist'
        class='flex h-full min-h-0 flex-col border-l border-border bg-muted/20'
      >
        <div class='border-b border-border px-3 py-2.5'>
          <p class='truncate text-[11px] text-muted-foreground'>{dirFromWindow()}</p>
        </div>
        <div class='min-h-0 flex-1 overflow-auto p-1.5'>
          <For each={folderAudioFiles()}>
            {(file, index) => {
              const active = () => file.path === viewingPath()
              const label = () => {
                const metadata = playlistMetadataQueries[index()]?.data as AudioMetadata | undefined
                const title = metadata?.title?.trim() || file.name
                const artist = metadata?.artist?.trim()
                return artist ? `${artist} — ${title}` : title
              }
              return (
                <button
                  type='button'
                  data-audio-playlist-path={file.path}
                  class={[
                    'flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted',
                    { 'bg-primary/10 text-primary': active() },
                  ]}
                  onClick={() => selectAudioFile(file)}
                >
                  <Music2 class='size-3.5 shrink-0' />
                  <span class='min-w-0 flex-1 truncate text-xs' title={label()}>
                    {label()}
                  </span>
                </button>
              )
            }}
          </For>
        </div>
      </div>
    )
  }

  return (
    <div
      data-no-window-drag
      class={
        props.presentation === 'modal'
          ? 'contents'
          : 'absolute inset-0 flex min-h-0 flex-col overflow-hidden bg-background'
      }
    >
      <Show when={readerKind() && viewingPath()} keyed>
        {(sourcePath) => (
          <div class='relative h-full min-h-0 overflow-hidden bg-neutral-900'>
            <ReaderDialog
              sourcePath={sourcePath}
              sourceKind={readerKind()!}
              embedded={props.presentation !== 'modal'}
              showClose={props.presentation === 'modal'}
              onClose={props.onClose}
            />
          </div>
        )}
      </Show>

      <Show when={!readerKind() && mediaType() === MediaType.IMAGE && viewingPath()}>
        <ImageViewerPane
          viewingPath={viewingPath()}
          allFiles={() => filesQuery.data?.files ?? []}
          directory={dirFromWindow}
          embedded={props.presentation !== 'modal'}
          showClose={props.presentation === 'modal'}
          active={contentActive}
          onNavigate={props.onNavigateViewing}
          onClose={props.onClose}
        />
      </Show>

      <Show when={!readerKind() && mediaType() === MediaType.PDF && viewingPath()} keyed>
        {(sourcePath) => (
          <div class='relative h-full min-h-0 overflow-hidden bg-neutral-900'>
            <ReaderDialog
              sourcePath={sourcePath}
              sourceKind='pdf'
              embedded={props.presentation !== 'modal'}
              showClose={props.presentation === 'modal'}
              onClose={props.onClose}
            />
          </div>
        )}
      </Show>

      <Show when={!readerKind() && mediaType() === MediaType.BOOK && viewingPath()} keyed>
        {(sourcePath) => (
          <div class='relative h-full min-h-0 overflow-hidden bg-neutral-900'>
            <ReaderDialog
              sourcePath={sourcePath}
              sourceKind='book'
              embedded={props.presentation !== 'modal'}
              showClose={props.presentation === 'modal'}
              onClose={props.onClose}
            />
          </div>
        )}
      </Show>

      <Show
        when={showPlayback() && !readerKind() && mediaType() === MediaType.VIDEO && viewingPath()}
      >
        <div class='flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-black'>
          <div class='group relative flex min-h-0 min-w-0 flex-1 flex-col bg-black'>
            <Show when={props.showListenOnly !== false}>
              <div class='absolute top-2 right-2 z-10 opacity-0 transition-opacity group-hover:opacity-100'>
                <button
                  type='button'
                  title='Listen only'
                  aria-label='Listen only'
                  class='bg-secondary inline-flex h-7 w-7 items-center justify-center rounded-md'
                  onClick={handleListenOnly}
                >
                  <Headphones class='h-4 w-4' stroke-width={2} />
                </button>
              </div>
            </Show>
            <Show when={videoLoading() && !videoError()}>
              <div class='pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/45 text-white'>
                <LoaderCircle class='h-7 w-7 animate-spin' stroke-width={2} />
              </div>
            </Show>
            <Show when={videoError()}>
              <div class='absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/80 p-6 text-center text-white'>
                <p class='text-sm'>{videoError()}</p>
                <div class='flex gap-2'>
                  <button
                    type='button'
                    class='rounded-md bg-white px-3 py-1.5 text-sm text-black'
                    onClick={retryMedia}
                  >
                    Retry
                  </button>
                  <a
                    href={downloadHref()}
                    download={fileName()}
                    class='rounded-md border border-white/40 px-3 py-1.5 text-sm'
                  >
                    Download
                  </a>
                </div>
              </div>
            </Show>
            <video
              ref={(el) => setVideoEl(el ?? undefined)}
              class='min-h-0 w-full flex-1 bg-black object-contain'
              controls
              playsinline
              data-media-type={MediaType.VIDEO}
              data-playback-media-host={
                videoPlaybackActive() && props.contentVisible() ? 'video' : undefined
              }
              title={fileName()}
              onCanPlay={() => setVideoReadyGeneration(playback().source?.generation ?? 0)}
              onLoadedMetadata={(e) => {
                const v = e.currentTarget
                if (v.videoWidth > 0 && v.videoHeight > 0) {
                  props.onVideoMetadataLoaded?.(v.videoWidth, v.videoHeight)
                }
              }}
            />
          </div>
        </div>
      </Show>

      <Show
        when={showPlayback() && !readerKind() && mediaType() === MediaType.AUDIO && viewingPath()}
      >
        <div
          ref={setAudioSurfaceEl}
          data-testid='canvas-audio-player-ui'
          data-audio-layout={audioLayout()}
          class='relative h-full min-h-0 overflow-hidden bg-gradient-to-br from-muted/45 via-background to-background'
        >
          <Show when={audioLoading() && !audioError()}>
            <div class='pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/55 backdrop-blur-sm'>
              <LoaderCircle class='h-7 w-7 animate-spin text-muted-foreground' stroke-width={2} />
            </div>
          </Show>
          <Show when={audioError()}>
            <div class='absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-background/90 p-6 text-center'>
              <p class='text-destructive text-sm'>{audioError()}</p>
              <div class='flex gap-2'>
                <button
                  type='button'
                  class='rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground'
                  onClick={retryMedia}
                >
                  Retry
                </button>
                <a
                  href={downloadHref()}
                  download={fileName()}
                  class='rounded-md border border-input px-3 py-1.5 text-sm'
                >
                  Download
                </a>
              </div>
            </div>
          </Show>

          <Switch>
            <Match when={audioLayout() === 'compact'}>
              <CompactAudioPlayer />
            </Match>
            <Match when={audioLayout() === 'expanded'}>
              <div class='grid h-full min-h-0 grid-cols-[minmax(0,1fr)_272px]'>
                <StandardAudioPlayer />
                <AudioPlaylist />
              </div>
            </Match>
            <Match when={audioLayout() === 'standard'}>
              <StandardAudioPlayer />
            </Match>
          </Switch>
        </div>
      </Show>

      <Show when={!readerKind() && mediaType() === MediaType.TEXT && viewingPath()} keyed>
        {(sourcePath) => (
          <TextEditorPane
            viewingPath={sourcePath}
            editableFolders={props.editableFolders}
            knowledgeBases={props.knowledgeBases}
            embedded={props.presentation !== 'modal'}
            showClose={props.presentation === 'modal'}
            onClose={props.onClose}
          />
        )}
      </Show>

      <Show when={!readerKind() && mediaType() === MediaType.OTHER && viewingPath()}>
        <Show when={props.presentation === 'modal' && unsupportedFile()} keyed>
          {(file) => (
            <div
              role='dialog'
              aria-modal='true'
              aria-labelledby='unsupported-file-title'
              class='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'
              onClick={(event) => {
                if (event.target === event.currentTarget) props.onClose?.()
              }}
            >
              <div
                class='bg-card text-card-foreground max-h-[90vh] w-full max-w-md overflow-auto rounded-xl border border-border shadow-lg'
                onClick={(event) => event.stopPropagation()}
              >
                <div class='flex items-start justify-between gap-2 border-b border-border p-4'>
                  <div class='flex min-w-0 flex-1 items-start gap-3'>
                    <FileQuestion class='h-8 w-8 shrink-0 text-yellow-500' stroke-width={2} />
                    <div class='min-w-0'>
                      <h2 id='unsupported-file-title' class='truncate text-lg font-semibold'>
                        {file.name}
                      </h2>
                      <p class='text-muted-foreground text-xs'>
                        {file.extension ? `.${file.extension.toUpperCase()}` : 'Unknown'} file •{' '}
                        {formatFileSize(file.size)}
                      </p>
                    </div>
                  </div>
                  <button
                    type='button'
                    title='Close'
                    aria-label='Close'
                    class='hover:bg-muted inline-flex size-8 shrink-0 items-center justify-center rounded-md'
                    onClick={() => props.onClose?.()}
                  >
                    <span aria-hidden='true'>×</span>
                  </button>
                </div>
                <div class='bg-muted/50 flex flex-col items-center space-y-4 rounded-b-xl p-8 text-center'>
                  <FileText class='text-muted-foreground h-16 w-16 opacity-50' stroke-width={1.5} />
                  <div>
                    <h3 class='mb-2 text-lg font-medium'>Unsupported File Type</h3>
                    <p class='text-muted-foreground text-sm'>
                      This file type is not supported for preview. The media server currently
                      supports video, audio, and image files.
                    </p>
                  </div>
                  <div class='pt-2'>
                    <a
                      href={downloadHref()}
                      download={file.name}
                      class='bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium shadow-sm'
                    >
                      Download File
                    </a>
                  </div>
                </div>
              </div>
            </div>
          )}
        </Show>
        <div
          role={props.presentation === 'modal' ? 'dialog' : undefined}
          aria-modal={props.presentation === 'modal' ? 'true' : undefined}
          aria-labelledby='unsupported-file-title'
          class={[
            props.presentation === 'modal'
              ? 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'
              : 'flex flex-1 flex-col items-center justify-center gap-4 p-6',
            { hidden: props.presentation === 'modal' && !!unsupportedFile() },
          ]}
        >
          <div
            class={
              props.presentation === 'modal'
                ? 'bg-card text-card-foreground w-full max-w-md rounded-xl border border-border p-6 shadow-lg'
                : 'contents'
            }
          >
            <h2 id='unsupported-file-title' class='text-center text-lg font-semibold'>
              Unsupported File Type
            </h2>
            <Show when={props.presentation === 'modal'}>
              <button
                type='button'
                title='Close'
                aria-label='Close'
                class='hover:bg-muted absolute top-2 right-2 inline-flex h-8 w-8 items-center justify-center rounded-md'
                onClick={() => props.onClose?.()}
              >
                ×
              </button>
            </Show>
            <p class='text-muted-foreground text-center text-sm'>
              This file type cannot be previewed.
            </p>
            <a
              href={downloadHref()}
              download={fileName()}
              class='bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium shadow-sm'
            >
              Download File
            </a>
          </div>
        </div>
      </Show>
    </div>
  )
}
