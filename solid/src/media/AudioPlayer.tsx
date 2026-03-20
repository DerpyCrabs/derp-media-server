import { useMediaPlayer } from '@/lib/use-media-player'
import { useVideoPlaybackTime } from '@/lib/use-video-playback-time'
import { api, post } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { MediaType, type FileItem } from '@/lib/types'
import { stripSharePrefix } from '@/lib/source-context'
import { useQuery } from '@tanstack/solid-query'
import Monitor from 'lucide-solid/icons/monitor'
import Pause from 'lucide-solid/icons/pause'
import Play from 'lucide-solid/icons/play'
import Repeat from 'lucide-solid/icons/repeat'
import StepBack from 'lucide-solid/icons/step-back'
import StepForward from 'lucide-solid/icons/step-forward'
import Volume2 from 'lucide-solid/icons/volume-2'
import VolumeX from 'lucide-solid/icons/volume-x'
import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { useBrowserHistory } from '../browser-history'
import {
  buildAudioExtractUrl,
  buildAudioMetadataUrl,
  buildMediaUrl,
  buildThumbnailUrl,
  type MediaShareContext,
} from '../lib/build-media-url'
import { playFile as urlPlayFile, setAudioOnly } from '../lib/url-state-actions'
import type { TextViewerShareContext } from './TextViewerDialog'

type Props = {
  shareContext?: TextViewerShareContext | null
}

const AUDIO_EXTENSIONS = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus']
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv']

async function fetchAudioMetadata(url: string): Promise<{
  title?: string
  artist?: string
  album?: string
  coverArt?: string | null
  duration?: number
}> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('Failed to fetch audio metadata')
  return response.json()
}

export function AudioPlayer(props: Props) {
  const history = useBrowserHistory()

  const shareCtx = createMemo((): MediaShareContext => {
    const c = props.shareContext
    if (!c) return null
    return { token: c.token, sharePath: c.sharePath }
  })

  const playingPath = createMemo(() => {
    const sp = new URLSearchParams(history().search)
    return sp.get('playing')
  })

  const currentDir = createMemo(() => {
    const sp = new URLSearchParams(history().search)
    return sp.get('dir') ?? ''
  })

  const audioOnly = createMemo(() => {
    const sp = new URLSearchParams(history().search)
    return sp.get('audioOnly') === 'true'
  })

  const extension = createMemo(() => (playingPath() || '').split('.').pop()?.toLowerCase() || '')
  const isAudioFile = createMemo(() => !!(playingPath() && AUDIO_EXTENSIONS.includes(extension())))
  const isVideoFile = createMemo(() => !!(playingPath() && VIDEO_EXTENSIONS.includes(extension())))
  const shouldHandleAudio = createMemo(() => !!(isAudioFile() || (isVideoFile() && audioOnly())))

  const fileName = createMemo(() => (playingPath() || '').split('/').pop() || '')

  const dirToFetch = createMemo(() => {
    if (!currentDir() && !playingPath()) return ''
    let dir = currentDir()
    if (!dir && playingPath()) {
      const pathParts = playingPath()!.split(/[/\\]/)
      pathParts.pop()
      dir = pathParts.join('/')
    }
    return dir
  })

  const filesQuery = useQuery(() => {
    const dir = dirToFetch()
    const ctx = props.shareContext
    return {
      queryKey: ctx ? queryKeys.shareFiles(ctx.token, dir) : queryKeys.files(dir),
      queryFn: () =>
        ctx
          ? api<{ files: FileItem[] }>(
              `/api/share/${ctx.token}/files?dir=${encodeURIComponent(dir)}`,
            )
          : api<{ files: FileItem[] }>(`/api/files?dir=${encodeURIComponent(dir)}`),
    }
  })

  const allFiles = createMemo(() => filesQuery.data?.files ?? [])

  const audioFiles = createMemo(() =>
    allFiles().filter((f) => f.type === MediaType.AUDIO || f.type === MediaType.VIDEO),
  )

  const getMediaUrl = (filePath: string) => buildMediaUrl(filePath, shareCtx())

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
    return buildAudioMetadataUrl(path, shareCtx())
  })

  const needMetadata = createMemo(() => !!(isAudioFile() || (isVideoFile() && audioOnly())))

  const metadataQuery = useQuery(() => ({
    queryKey: queryKeys.audioMetadata(playingPath()!),
    queryFn: () => fetchAudioMetadata(metadataUrl()!),
    enabled: !!playingPath() && needMetadata() && !!metadataUrl(),
    refetchOnWindowFocus: false,
  }))

  const audioMetadata = createMemo(() => metadataQuery.data)

  const displayImageUrl = createMemo(() => {
    const path = playingPath()
    if (isVideoFile() && audioOnly() && path) {
      return buildThumbnailUrl(path, shareCtx())
    }
    return audioMetadata()?.coverArt || coverArtUrl()
  })

  const [storeTick, setStoreTick] = createSignal(0)
  onMount(() => useMediaPlayer.subscribe(() => setStoreTick((n) => n + 1)))

  const [volume, setVolume] = createSignal(1)
  const [isMuted, setIsMuted] = createSignal(false)

  const storeSlice = createMemo(() => {
    void storeTick()
    return useMediaPlayer.getState()
  })

  const scrubTime = createMemo(() => storeSlice().currentTime)

  const displayDuration = createMemo(() => {
    void storeTick()
    const meta = audioMetadata()
    const d = useMediaPlayer.getState().duration
    if (isVideoFile() && audioOnly() && meta?.duration != null && meta.duration > 0) {
      return meta.duration
    }
    return d
  })

  const isRepeat = createMemo(() => storeSlice().isRepeat)

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

  function incrementView(filePath: string) {
    const ctx = props.shareContext
    if (ctx) {
      const rel = stripSharePrefix(filePath, ctx.sharePath)
      void post(`/api/share/${ctx.token}/view`, { filePath: rel || '.' }).catch(() => {})
    } else {
      void post('/api/stats/views', { filePath }).catch(() => {})
    }
  }

  const [audioEl, setAudioEl] = createSignal<HTMLAudioElement | undefined>()
  let pendingSeek = false

  const playNextRef: { current: () => void } = { current: () => undefined }
  const playPrevRef: { current: () => void } = { current: () => undefined }

  createEffect(() => {
    const path = playingPath()
    const files = audioFiles()
    const dir = currentDir()

    playNextRef.current = () => {
      if (!path || files.length === 0) return
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
      incrementView(nextFile.path)
      urlPlayFile(nextFile.path, dir)
      useMediaPlayer.getState().playFile(nextFile.path, 'audio')
    }

    playPrevRef.current = () => {
      if (!path || files.length === 0) return
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
      incrementView(previousFile.path)
      urlPlayFile(previousFile.path, dir)
      useMediaPlayer.getState().playFile(previousFile.path, 'audio')
    }
  })

  createEffect(() => {
    const audio = audioEl()
    if (!audio) return

    const onTimeUpdate = () => {
      useMediaPlayer.getState().setCurrentTime(audio.currentTime)
      const path = playingPath()
      const dd = displayDuration()
      if (path && isVideoFile() && audioOnly() && dd > 0) {
        useVideoPlaybackTime.getState().saveTime(path, audio.currentTime, dd)
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
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing'
      }
    }

    const onPause = () => {
      useMediaPlayer.getState().setIsPlaying(false)
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused'
        if (Number.isFinite(audio.duration) && !Number.isNaN(audio.duration)) {
          navigator.mediaSession.setPositionState?.({
            duration: audio.duration,
            playbackRate: audio.playbackRate,
            position: audio.currentTime,
          })
        }
      }
    }

    const onEnded = () => {
      if (useMediaPlayer.getState().isRepeat) {
        audio.currentTime = 0
        void audio.play().catch(() => {})
      } else {
        playNextRef.current()
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
    void storeTick()
    void audioMetadata()
    const metaDur = audioMetadata()?.duration
    if (
      !isVideoFile() ||
      !audioOnly() ||
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
    audio.muted = isMuted()
    audio.volume = isMuted() ? 0 : volume()
  })

  createEffect(() => {
    const audio = audioEl()
    const path = playingPath()
    if (!audio || !path || !shouldHandleAudio()) return

    const mediaUrl = isVideoFile()
      ? buildAudioExtractUrl(path, shareCtx())
      : buildMediaUrl(path, shareCtx())
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

    audio.src = mediaUrl
    audio.load()

    if ((isSameFile || isVideoFile()) && timeToRestore > 0) {
      pendingSeek = true
      const seekAndMaybePlay = () => {
        pendingSeek = false
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
      navigator.mediaSession.setActionHandler('previoustrack', () => playPrevRef.current())
      navigator.mediaSession.setActionHandler('nexttrack', () => playNextRef.current())
    }
  })

  createEffect(() => {
    const audio = audioEl()
    const path = playingPath()
    if (!audio || !shouldHandleAudio() || !path) return
    if (!('mediaSession' in navigator)) return

    const isVideoAudio = isVideoFile() && audioOnly()
    const meta = audioMetadata()
    const metadata: MediaMetadataInit = {
      title: isVideoAudio ? `${fileName()} (Audio)` : meta?.title || fileName(),
      artist: isVideoAudio ? 'Video Audio' : meta?.artist || 'Unknown Artist',
      album: isVideoAudio
        ? currentDir() || 'Unknown Album'
        : meta?.album || currentDir() || 'Unknown Album',
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
    if (pendingSeek) return

    if (st.isPlaying && audio.paused) {
      void audio.play().catch(() => {})
    } else if (!st.isPlaying && !audio.paused) {
      audio.pause()
    }
  })

  function handleTogglePlayPause() {
    const path = playingPath()
    if (path) useMediaPlayer.getState().playFile(path, 'audio')
  }

  function handleShowVideo() {
    const audio = audioEl()
    const path = playingPath()
    if (audio && path) {
      audio.pause()
      useMediaPlayer.getState().setCurrentTime(audio.currentTime)
      useMediaPlayer.getState().setCurrentFile(path, 'video')
      setAudioOnly(false)
    }
  }

  function handleSeek(value: number) {
    const audio = audioEl()
    if (!audio) return
    audio.currentTime = value
  }

  function handleVolumeInput(value: number) {
    const audio = audioEl()
    setVolume(value)
    if (audio) audio.volume = value
    setIsMuted(value === 0)
  }

  function toggleMute() {
    const audio = audioEl()
    if (isMuted()) {
      setIsMuted(false)
      const v = volume() === 0 ? 0.5 : volume()
      setVolume(v)
      if (audio) audio.volume = v
      return
    }
    setIsMuted(true)
    if (audio) audio.volume = 0
  }

  function toggleRepeat() {
    useMediaPlayer.getState().toggleRepeat()
  }

  function formatTime(time: number) {
    if (!Number.isFinite(time) || Number.isNaN(time)) return '0:00'
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  return (
    <>
      <audio ref={setAudioEl} preload='auto' class='hidden' />

      <Show when={shouldHandleAudio()}>
        <div class='fixed bottom-0 left-0 right-0 bg-background z-50'>
          <div class='min-[650px]:hidden relative w-full h-1 bg-secondary'>
            <div
              class='absolute top-0 left-0 h-full bg-white transition-all duration-100'
              style={{
                width: `${displayDuration() > 0 ? (scrubTime() / displayDuration()) * 100 : 0}%`,
              }}
            />
            <input
              type='range'
              min={0}
              max={displayDuration() || 0}
              value={scrubTime()}
              onInput={(e) => handleSeek(Number.parseFloat(e.currentTarget.value))}
              class='absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer'
              disabled={!playingPath()}
            />
          </div>

          <div class='border-t border-border' />

          <div class='container mx-auto px-4 py-3'>
            <div class='flex items-center gap-4'>
              <div class='flex items-center gap-2'>
                <button
                  type='button'
                  disabled={!hasPreviousAudio()}
                  onClick={() => playPrevRef.current()}
                  class='inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md hover:bg-accent disabled:opacity-50'
                >
                  <StepBack class='h-4 w-4' />
                </button>
                <button
                  type='button'
                  disabled={!playingPath()}
                  onClick={handleTogglePlayPause}
                  class='inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50'
                >
                  <Show
                    when={
                      storeSlice().isPlaying &&
                      storeSlice().mediaType === 'audio' &&
                      storeSlice().currentFile === playingPath()
                    }
                    fallback={<Play class='h-4 w-4' />}
                  >
                    <Pause class='h-4 w-4' />
                  </Show>
                </button>
                <button
                  type='button'
                  disabled={!hasNextAudio()}
                  onClick={() => playNextRef.current()}
                  class='inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md hover:bg-accent disabled:opacity-50'
                >
                  <StepForward class='h-4 w-4' />
                </button>
                <button
                  type='button'
                  disabled={!playingPath()}
                  onClick={toggleRepeat}
                  class={
                    isRepeat()
                      ? 'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50'
                      : 'inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md hover:bg-accent disabled:opacity-50'
                  }
                >
                  <Repeat class='h-4 w-4' />
                </button>
                <Show when={isVideoFile()}>
                  <button
                    type='button'
                    disabled={!playingPath()}
                    onClick={handleShowVideo}
                    aria-label='Show video'
                    class='inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md hover:bg-accent disabled:opacity-50'
                  >
                    <Monitor class='h-4 w-4' />
                  </button>
                </Show>
              </div>

              <div class='hidden min-[650px]:block w-px h-8 bg-border shrink-0' />

              <div class='hidden min-[650px]:flex flex-1 items-center gap-3'>
                <span class='text-sm tabular-nums'>{formatTime(scrubTime())}</span>
                <input
                  type='range'
                  min={0}
                  max={displayDuration() || 0}
                  value={scrubTime()}
                  onInput={(e) => handleSeek(Number.parseFloat(e.currentTarget.value))}
                  class='flex-1 h-2 bg-secondary rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary'
                  disabled={!playingPath()}
                />
                <span class='text-sm tabular-nums'>{formatTime(displayDuration())}</span>
              </div>

              <div class='hidden min-[650px]:block w-px h-8 bg-border shrink-0' />

              <div class='hidden lg:flex items-center gap-2 min-w-[140px]'>
                <button
                  type='button'
                  onClick={toggleMute}
                  class='inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md hover:bg-accent'
                >
                  <Show when={isMuted()} fallback={<Volume2 class='h-4 w-4' />}>
                    <VolumeX class='h-4 w-4' />
                  </Show>
                </button>
                <input
                  type='range'
                  min={0}
                  max={1}
                  step={0.01}
                  value={isMuted() ? 0 : volume()}
                  onInput={(e) => handleVolumeInput(Number.parseFloat(e.currentTarget.value))}
                  class='flex-1 h-2 bg-secondary rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary'
                />
              </div>

              <div class='hidden md:block w-px h-8 bg-border shrink-0' />

              <div class='w-[200px] lg:w-[280px] flex items-center gap-3'>
                <div class='shrink-0 w-12 h-12 rounded overflow-hidden bg-secondary'>
                  <Show when={displayImageUrl()}>
                    <img
                      src={displayImageUrl()!}
                      alt='Album art'
                      class='w-full h-full object-cover'
                    />
                  </Show>
                </div>

                <div class='flex-1 min-w-0'>
                  <Show when={!metadataQuery.isLoading}>
                    <div class='font-medium truncate text-sm'>
                      {audioMetadata()?.title || fileName()}
                    </div>
                    <div class='text-xs text-muted-foreground truncate'>
                      {audioMetadata()?.artist || 'Unknown Artist'}
                    </div>
                  </Show>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </>
  )
}
