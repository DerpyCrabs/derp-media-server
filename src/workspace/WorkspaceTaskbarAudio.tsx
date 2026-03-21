import { api } from '@/lib/api'
import { useMediaPlayer } from '@/lib/use-media-player'
import { MediaType, type FileItem } from '@/lib/types'
import { queryKeys } from '@/lib/query-keys'
import { stripSharePrefix } from '@/lib/source-context'
import { useVideoPlaybackTime } from '@/lib/use-video-playback-time'
import { useWorkspacePlaybackStore } from '@/lib/workspace-playback-store'
import { useQuery } from '@tanstack/solid-query'
import Headphones from 'lucide-solid/icons/headphones'
import Monitor from 'lucide-solid/icons/monitor'
import Pause from 'lucide-solid/icons/pause'
import Play from 'lucide-solid/icons/play'
import Repeat from 'lucide-solid/icons/repeat'
import StepBack from 'lucide-solid/icons/step-back'
import StepForward from 'lucide-solid/icons/step-forward'
import Volume2 from 'lucide-solid/icons/volume-2'
import VolumeX from 'lucide-solid/icons/volume-x'
import type { Accessor } from 'solid-js'
import { Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import { useStoreSync } from '../lib/solid-store-sync'
import {
  buildAudioExtractUrl,
  buildAudioMetadataUrl,
  buildMediaUrl,
  buildThumbnailUrl,
  type MediaShareContext,
} from '../lib/build-media-url'

const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus']
const VIDEO_EXT = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'm4v']

async function fetchAudioMetadata(url: string) {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Failed to fetch audio metadata')
  return response.json() as Promise<{
    title?: string
    artist?: string
    album?: string
    coverArt?: string | null
    duration?: number
  }>
}

type Props = {
  storageKey: Accessor<string>
  shareCtx: Accessor<MediaShareContext>
  onShowVideo: () => void
}

export function WorkspaceTaskbarAudio(props: Props) {
  const wxTick = useStoreSync(useWorkspacePlaybackStore)
  const storeTick = useStoreSync(useMediaPlayer)
  const [detailsOpen, setDetailsOpen] = createSignal(false)
  const [audioEl, setAudioEl] = createSignal<HTMLAudioElement | undefined>()
  const pendingSeekRef = { current: false }
  const srcSwitchRef = { current: false }
  const srcLoadGenRef = { current: 0 }
  const detailsOpenRef = { current: false }

  createEffect(() => {
    detailsOpenRef.current = detailsOpen()
  })

  const slice = createMemo(() => {
    void wxTick()
    const k = props.storageKey()
    if (!k) return { playing: null as string | null, audioOnly: false, dir: null as string | null }
    return (
      useWorkspacePlaybackStore.getState().byKey[k] ?? {
        playing: null,
        audioOnly: false,
        dir: null,
      }
    )
  })

  const playingPath = () => slice().playing
  const audioOnlyWs = () => slice().audioOnly
  const currentDir = () => slice().dir ?? ''

  const extension = createMemo(() => (playingPath() || '').split('.').pop()?.toLowerCase() || '')
  const isAudioFile = createMemo(() => !!(playingPath() && AUDIO_EXT.includes(extension())))
  const isVideoFile = createMemo(() => !!(playingPath() && VIDEO_EXT.includes(extension())))
  const shouldHandleAudio = createMemo(() => !!(isAudioFile() || (isVideoFile() && audioOnlyWs())))
  const canControlVideoFromTaskbar = createMemo(
    () => !!(playingPath() && isVideoFile() && !audioOnlyWs()),
  )

  const fileName = createMemo(() => (playingPath() || '').split('/').pop() || '')

  const dirToFetch = createMemo(() => {
    const dir = currentDir()
    const play = playingPath()
    if (!dir && !play) return ''
    if (play) {
      const pathParts = play.split(/[/\\]/)
      pathParts.pop()
      return pathParts.join('/')
    }
    return dir
  })

  const listDir = createMemo(() => {
    const raw = dirToFetch()
    const ctx = props.shareCtx()
    if (ctx) return stripSharePrefix(raw, ctx.sharePath.replace(/\\/g, '/'))
    return raw
  })

  const filesQuery = useQuery(() => {
    const sh = props.shareCtx()
    const dir = listDir()
    return {
      queryKey: sh ? queryKeys.shareFiles(sh.token, dir) : queryKeys.files(dir),
      queryFn: () =>
        sh
          ? api<{ files: FileItem[] }>(
              `/api/share/${sh.token}/files?dir=${encodeURIComponent(dir)}`,
            )
          : api<{ files: FileItem[] }>(`/api/files?dir=${encodeURIComponent(dir)}`),
      enabled: !!dirToFetch(),
    }
  })

  const allFiles = createMemo(() => filesQuery.data?.files ?? [])
  const audioFiles = createMemo(() =>
    allFiles().filter((f) => f.type === MediaType.AUDIO || f.type === MediaType.VIDEO),
  )

  const mediaShare = () => props.shareCtx()
  const getMediaUrl = (filePath: string) => buildMediaUrl(filePath, mediaShare())

  const coverArtUrl = createMemo(() => {
    const coverFile = allFiles().find((file) => {
      if (file.type !== MediaType.IMAGE) return false
      const name = file.name.toLowerCase()
      const nameWithoutExt = name.substring(0, name.lastIndexOf('.'))
      return nameWithoutExt === 'cover'
    })
    return coverFile ? getMediaUrl(coverFile.path) : null
  })

  const metadataUrl = createMemo(() => {
    const path = playingPath()
    if (!path) return null
    return buildAudioMetadataUrl(path, mediaShare())
  })

  const needMetadata = createMemo(() => !!(isAudioFile() || (isVideoFile() && audioOnlyWs())))

  const metadataQuery = useQuery(() => ({
    queryKey: queryKeys.audioMetadata(playingPath()!),
    queryFn: () => fetchAudioMetadata(metadataUrl()!),
    enabled: !!playingPath() && needMetadata() && !!metadataUrl(),
    refetchOnWindowFocus: false,
  }))

  const audioMetadata = createMemo(() => metadataQuery.data)

  const displayImageUrl = createMemo(() => {
    const path = playingPath()
    if (isVideoFile() && audioOnlyWs() && path) {
      return buildThumbnailUrl(path, mediaShare())
    }
    return audioMetadata()?.coverArt || coverArtUrl()
  })

  const storeSlice = createMemo(() => {
    void storeTick()
    return useMediaPlayer.getState()
  })

  const displayDuration = createMemo(() => {
    void storeTick()
    const meta = audioMetadata()
    const d = useMediaPlayer.getState().duration
    if (isVideoFile() && audioOnlyWs() && meta?.duration != null && meta.duration > 0) {
      return meta.duration
    }
    return d
  })

  const currentTimeDisplay = createMemo(() => storeSlice().currentTime)

  function playNextAudio() {
    const k = props.storageKey()
    const path = k ? (useWorkspacePlaybackStore.getState().byKey[k]?.playing ?? null) : null
    const dir = k ? (useWorkspacePlaybackStore.getState().byKey[k]?.dir ?? null) : null
    const files = filesQuery.data?.files?.filter(
      (f) => f.type === MediaType.AUDIO || f.type === MediaType.VIDEO,
    )
    if (!path || !files?.length || !k) return

    const currentIndex = files.findIndex((file) => file.path === path)
    if (currentIndex === -1) {
      useMediaPlayer.getState().setIsPlaying(false)
      return
    }

    let nextFile: FileItem | null = null
    for (let i = currentIndex + 1; i < files.length; i++) {
      if (files[i].type === MediaType.AUDIO) {
        nextFile = files[i]
        break
      }
    }

    if (!nextFile) {
      useMediaPlayer.getState().setIsPlaying(false)
      return
    }

    useWorkspacePlaybackStore.getState().playFile(k, nextFile.path, dir ?? undefined)
    useMediaPlayer.getState().playFile(nextFile.path, 'audio')
  }

  function playPreviousAudio() {
    const k = props.storageKey()
    const path = k ? (useWorkspacePlaybackStore.getState().byKey[k]?.playing ?? null) : null
    const dir = k ? (useWorkspacePlaybackStore.getState().byKey[k]?.dir ?? null) : null
    const files = filesQuery.data?.files?.filter(
      (f) => f.type === MediaType.AUDIO || f.type === MediaType.VIDEO,
    )
    if (!path || !files?.length || !k) return

    const audio = audioEl()
    if (audio && audio.currentTime > 20) {
      audio.currentTime = 0
      return
    }

    const currentIndex = files.findIndex((file) => file.path === path)
    if (currentIndex === -1) return

    let previousFile: FileItem | null = null
    for (let i = currentIndex - 1; i >= 0; i--) {
      if (files[i].type === MediaType.AUDIO) {
        previousFile = files[i]
        break
      }
    }

    if (!previousFile) return

    useWorkspacePlaybackStore.getState().playFile(k, previousFile.path, dir ?? undefined)
    useMediaPlayer.getState().playFile(previousFile.path, 'audio')
  }

  createEffect(() => {
    const audio = audioEl()
    if (!audio) return

    const onTimeUpdate = () => {
      if (detailsOpenRef.current) {
        useMediaPlayer.getState().setCurrentTime(audio.currentTime)
      }
      const k = props.storageKey()
      const path = k ? useWorkspacePlaybackStore.getState().byKey[k]?.playing : null
      const ao = k ? useWorkspacePlaybackStore.getState().byKey[k]?.audioOnly : false
      const ext = path?.split('.').pop()?.toLowerCase() || ''
      const isVid = VIDEO_EXT.includes(ext)
      const dur = useMediaPlayer.getState().duration
      if (path && isVid && ao && dur > 0) {
        useVideoPlaybackTime.getState().saveTime(path, audio.currentTime, dur)
      }
      if ('mediaSession' in navigator && Number.isFinite(audio.duration) && !audio.paused) {
        navigator.mediaSession.setPositionState?.({
          duration: audio.duration,
          playbackRate: audio.playbackRate,
          position: audio.currentTime,
        })
      }
    }

    const onDurationChange = () => {
      const d = audio.duration
      if (Number.isFinite(d) && !Number.isNaN(d) && d > 0) {
        useMediaPlayer.getState().setDuration(d)
      }
    }

    const onLoadedMetadata = () => {
      const d = audio.duration
      if (Number.isFinite(d) && !Number.isNaN(d) && d > 0) {
        useMediaPlayer.getState().setDuration(d)
      }
      if ('mediaSession' in navigator && Number.isFinite(d) && !Number.isNaN(d) && d > 0) {
        navigator.mediaSession.setPositionState?.({
          duration: d,
          playbackRate: audio.playbackRate,
          position: audio.currentTime,
        })
      }
    }

    const onPlay = () => {
      useMediaPlayer.getState().setIsPlaying(true)
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'
    }

    const onPause = () => {
      useMediaPlayer.getState().setIsPlaying(false)
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'
    }

    const onEnded = () => {
      if (useMediaPlayer.getState().isRepeat) {
        audio.currentTime = 0
        void audio.play().catch(() => {})
      } else {
        playNextAudio()
      }
    }

    const onError = () => {
      useMediaPlayer.getState().setIsPlaying(false)
    }

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('durationchange', onDurationChange)
    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)

    onCleanup(() => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('durationchange', onDurationChange)
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
    })
  })

  createEffect(() => {
    void audioMetadata()
    const metaDur = audioMetadata()?.duration
    if (
      !isVideoFile() ||
      !audioOnlyWs() ||
      metaDur == null ||
      metaDur <= 0 ||
      useMediaPlayer.getState().duration > 0
    ) {
      return
    }
    useMediaPlayer.getState().setDuration(metaDur)
  })

  createEffect(() => {
    if (shouldHandleAudio()) return
    const audio = audioEl()
    if (!audio || !audio.src) return
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  })

  createEffect(() => {
    const audio = audioEl()
    if (!audio) return
    const st = storeSlice()
    audio.muted = st.isMuted
    audio.volume = st.isMuted ? 0 : st.volume
  })

  createEffect(() => {
    const audio = audioEl()
    const path = playingPath()
    if (!audio || !path || !shouldHandleAudio()) return

    const mediaUrl = isVideoFile()
      ? buildAudioExtractUrl(path, mediaShare())
      : buildMediaUrl(path, mediaShare())
    const fullUrl = new URL(mediaUrl, window.location.origin).href

    if (audio.src === fullUrl) return

    const state = useMediaPlayer.getState()
    const isSameFile = state.currentFile === path
    const storedTime = state.currentTime
    const savedTime = isVideoFile() ? useVideoPlaybackTime.getState().getSavedTime(path) : null
    const timeToRestore = storedTime > 0 ? storedTime : (savedTime ?? 0)

    if (state.currentFile !== path || state.mediaType !== 'audio') {
      useMediaPlayer.getState().setCurrentFile(path, 'audio')
    }

    srcLoadGenRef.current += 1
    const token = srcLoadGenRef.current
    srcSwitchRef.current = true
    const endSrcSwitch = () => {
      audio.removeEventListener('canplay', endSrcSwitch)
      audio.removeEventListener('error', endSrcSwitch)
      if (token !== srcLoadGenRef.current) return
      srcSwitchRef.current = false
    }
    audio.addEventListener('canplay', endSrcSwitch)
    audio.addEventListener('error', endSrcSwitch)

    audio.src = fullUrl
    audio.load()

    if ((isSameFile || isVideoFile()) && timeToRestore > 0) {
      pendingSeekRef.current = true
      const seekAndMaybePlay = () => {
        pendingSeekRef.current = false
        audio.currentTime = timeToRestore
        audio.removeEventListener('loadedmetadata', seekAndMaybePlay)
        audio.removeEventListener('canplay', seekAndMaybePlay)
        if (useMediaPlayer.getState().isPlaying) {
          void audio.play().catch(() => {})
        }
      }
      audio.addEventListener('loadedmetadata', seekAndMaybePlay)
      audio.addEventListener('canplay', seekAndMaybePlay)
    }

    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => void audio.play().catch(() => {}))
      navigator.mediaSession.setActionHandler('pause', () => audio.pause())
      navigator.mediaSession.setActionHandler('seekbackward', (details) => {
        const skipTime = details.seekOffset || 10
        audio.currentTime = Math.max(0, audio.currentTime - skipTime)
      })
      navigator.mediaSession.setActionHandler('seekforward', (details) => {
        const skipTime = details.seekOffset || 10
        audio.currentTime = Math.min(audio.duration, audio.currentTime + skipTime)
      })
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime != null) audio.currentTime = details.seekTime
      })
      navigator.mediaSession.setActionHandler('previoustrack', playPreviousAudio)
      navigator.mediaSession.setActionHandler('nexttrack', playNextAudio)
    }
  })

  createEffect(() => {
    const path = playingPath()
    if (!path || !shouldHandleAudio() || !('mediaSession' in navigator)) return

    const isVideoAudio = isVideoFile() && audioOnlyWs()
    const meta = audioMetadata()
    const metadata: MediaMetadataInit = {
      title: isVideoAudio ? `${fileName()} (Audio)` : meta?.title || fileName(),
      artist: isVideoAudio ? 'Video Audio' : meta?.artist || 'Unknown Artist',
      album: meta?.album || currentDir() || 'Unknown Album',
    }

    const artworkUrl = displayImageUrl()
    if (artworkUrl) {
      const fullArtworkUrl = artworkUrl.startsWith('data:')
        ? artworkUrl
        : new URL(artworkUrl, window.location.origin).href
      metadata.artwork = [
        { src: fullArtworkUrl, sizes: '512x512', type: 'image/jpeg' },
        { src: fullArtworkUrl, sizes: '256x256', type: 'image/jpeg' },
        { src: fullArtworkUrl, sizes: '128x128', type: 'image/jpeg' },
      ]
    }

    navigator.mediaSession.metadata = new MediaMetadata(metadata)
  })

  createEffect(() => {
    const audio = audioEl()
    const path = playingPath()
    const st = storeSlice()
    if (!audio || !shouldHandleAudio() || st.currentFile !== path || st.mediaType !== 'audio')
      return
    if (pendingSeekRef.current) return

    if (st.isPlaying && audio.paused) {
      void audio.play().catch(() => {})
    } else if (!st.isPlaying && !audio.paused) {
      audio.pause()
    }
  })

  createEffect(() => {
    if (!detailsOpen()) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node | null
      const root = document.querySelector('[data-workspace-taskbar-audio-root]')
      if (root && t && !root.contains(t)) setDetailsOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDetailsOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    onCleanup(() => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    })
  })

  function handleTogglePlayPause() {
    const path = playingPath()
    if (path) {
      useMediaPlayer.getState().playFile(path, canControlVideoFromTaskbar() ? 'video' : 'audio')
    }
  }

  function handleShowVideo() {
    const audio = audioEl()
    const path = playingPath()
    const k = props.storageKey()
    if (audio && path && k) {
      audio.pause()
      useMediaPlayer.getState().setCurrentTime(audio.currentTime)
      useMediaPlayer.getState().setCurrentFile(path, 'video')
      useWorkspacePlaybackStore.getState().setAudioOnly(k, false)
      props.onShowVideo()
    }
  }

  function handleSeek(value: number) {
    if (canControlVideoFromTaskbar()) {
      useMediaPlayer.getState().setCurrentTime(value)
      return
    }
    const audio = audioEl()
    if (audio) audio.currentTime = value
  }

  function formatTime(time: number) {
    if (!Number.isFinite(time) || Number.isNaN(time)) return '0:00'
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const hasPreviousAudio = createMemo(() => {
    const path = playingPath()
    const files = audioFiles()
    if (!path || files.length === 0) return false
    const currentIndex = files.findIndex((file) => file.path === path)
    if (currentIndex === -1) return false
    for (let i = currentIndex - 1; i >= 0; i--) {
      if (files[i].type === MediaType.AUDIO) return true
    }
    return false
  })

  const hasNextAudio = createMemo(() => {
    const path = playingPath()
    const files = audioFiles()
    if (!path || files.length === 0) return false
    const currentIndex = files.findIndex((file) => file.path === path)
    if (currentIndex === -1) return false
    for (let i = currentIndex + 1; i < files.length; i++) {
      if (files[i].type === MediaType.AUDIO) return true
    }
    return false
  })

  return (
    <>
      <audio ref={setAudioEl} preload='auto' class='hidden' data-workspace-taskbar-media-audio />

      <div class='relative' data-workspace-taskbar-audio-root>
        <div class='text-muted-foreground flex h-8 items-center gap-1 border-l border-border bg-muted/50 px-2'>
          <button
            type='button'
            class='hover:opacity-90 flex min-w-0 cursor-pointer items-center gap-1.5 pr-1 text-left transition-opacity'
            onClick={() => setDetailsOpen(!detailsOpen())}
            aria-label='Open audio controls'
            aria-expanded={detailsOpen()}
          >
            <div class='bg-muted flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded'>
              <Show
                when={displayImageUrl()}
                fallback={
                  <Headphones class='text-muted-foreground h-3.5 w-3.5 shrink-0' stroke-width={2} />
                }
              >
                <img
                  src={displayImageUrl()!}
                  alt=''
                  class='block size-full object-cover object-center'
                  loading='eager'
                />
              </Show>
            </div>
            <div class='hidden max-w-52 min-w-52 min-[1150px]:block'>
              <div class='text-foreground truncate text-[12px] leading-none font-medium'>
                {playingPath() ? audioMetadata()?.title || fileName() : 'Audio idle'}
              </div>
              <div class='text-muted-foreground truncate text-[11px] leading-none'>
                {playingPath()
                  ? audioMetadata()?.artist ||
                    currentDir() ||
                    (canControlVideoFromTaskbar() ? 'Video playback' : 'Ready')
                  : 'Play audio to pin controls here'}
              </div>
            </div>
          </button>
        </div>

        <Show when={detailsOpen()}>
          <div class='bg-popover absolute right-0 bottom-full z-100001 mb-2 w-80 border border-border shadow-xl'>
            <div class='space-y-3 p-3'>
              <div class='flex items-center gap-3'>
                <div class='flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded bg-neutral-800'>
                  <Show
                    when={displayImageUrl()}
                    fallback={<Headphones class='text-muted-foreground h-5 w-5' stroke-width={2} />}
                  >
                    <img
                      src={displayImageUrl()!}
                      alt='Album art'
                      class='h-full w-full object-cover object-center'
                    />
                  </Show>
                </div>
                <div class='min-w-0 flex-1'>
                  <div class='text-foreground truncate text-sm font-medium'>
                    {playingPath() ? audioMetadata()?.title || fileName() : 'Nothing playing'}
                  </div>
                  <div class='text-muted-foreground truncate text-xs'>
                    {playingPath()
                      ? audioMetadata()?.artist ||
                        currentDir() ||
                        (canControlVideoFromTaskbar()
                          ? 'Current video playback'
                          : 'Current playback')
                      : 'Choose a file from the workspace'}
                  </div>
                </div>
              </div>

              <div class='text-muted-foreground flex items-center gap-2 text-[11px]'>
                <span class='w-9 text-right tabular-nums'>{formatTime(currentTimeDisplay())}</span>
                <input
                  type='range'
                  min={0}
                  max={displayDuration() || 0}
                  value={currentTimeDisplay()}
                  onInput={(e) => handleSeek(Number.parseFloat(e.currentTarget.value))}
                  class='[&::-webkit-slider-thumb]:bg-primary h-1.5 flex-1 cursor-pointer appearance-none rounded-none bg-secondary [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full'
                  disabled={!playingPath()}
                />
                <span class='w-9 tabular-nums'>{formatTime(displayDuration())}</span>
              </div>

              <div class='grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3'>
                <div class='flex shrink-0 items-center gap-1'>
                  <button
                    type='button'
                    class='hover:bg-accent inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md disabled:opacity-50'
                    disabled={!hasPreviousAudio()}
                    onClick={() => playPreviousAudio()}
                  >
                    <StepBack class='h-4 w-4' stroke-width={2} />
                  </button>
                  <button
                    type='button'
                    class='bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md disabled:opacity-50'
                    disabled={!playingPath()}
                    onClick={handleTogglePlayPause}
                  >
                    <Show
                      when={
                        storeSlice().isPlaying &&
                        storeSlice().currentFile === playingPath() &&
                        storeSlice().mediaType ===
                          (canControlVideoFromTaskbar() ? 'video' : 'audio')
                      }
                      fallback={<Play class='h-4 w-4' stroke-width={2} />}
                    >
                      <Pause class='h-4 w-4' stroke-width={2} />
                    </Show>
                  </button>
                  <button
                    type='button'
                    class='hover:bg-accent inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md disabled:opacity-50'
                    disabled={!hasNextAudio()}
                    onClick={() => playNextAudio()}
                  >
                    <StepForward class='h-4 w-4' stroke-width={2} />
                  </button>
                  <button
                    type='button'
                    class={
                      storeSlice().isRepeat
                        ? 'bg-primary text-primary-foreground inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md disabled:opacity-50'
                        : 'hover:bg-accent inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md disabled:opacity-50'
                    }
                    disabled={!playingPath()}
                    onClick={() => useMediaPlayer.getState().toggleRepeat()}
                  >
                    <Repeat class='h-4 w-4' stroke-width={2} />
                  </button>
                </div>

                <div class='flex min-w-0 items-center justify-end gap-2'>
                  <Show when={isVideoFile() && audioOnlyWs()}>
                    <button
                      type='button'
                      class='border-input bg-background hover:bg-accent inline-flex h-8 shrink-0 items-center gap-1 rounded-md border px-2 text-xs'
                      onClick={handleShowVideo}
                    >
                      <Monitor class='h-4 w-4' stroke-width={2} />
                      Show video
                    </button>
                  </Show>

                  <div class='ml-1 flex min-w-0 max-w-32 flex-1 items-center gap-2'>
                    <button
                      type='button'
                      class='hover:bg-accent inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md'
                      onClick={() => {
                        const st = useMediaPlayer.getState()
                        if (st.isMuted) {
                          useMediaPlayer.getState().setMuted(false)
                          if (st.volume === 0) useMediaPlayer.getState().setVolume(0.5)
                        } else {
                          useMediaPlayer.getState().setMuted(true)
                        }
                      }}
                    >
                      <Show when={storeSlice().isMuted} fallback={<Volume2 class='h-4 w-4' />}>
                        <VolumeX class='h-4 w-4' />
                      </Show>
                    </button>
                    <input
                      type='range'
                      min={0}
                      max={1}
                      step={0.01}
                      value={storeSlice().isMuted ? 0 : storeSlice().volume}
                      onInput={(e) => {
                        const v = Number.parseFloat(e.currentTarget.value)
                        useMediaPlayer.getState().setVolume(v)
                        const a = audioEl()
                        if (a) a.volume = v
                      }}
                      class='[&::-webkit-slider-thumb]:bg-primary h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-none bg-secondary [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full'
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </>
  )
}
