import { api } from '@/lib/api'
import { MediaType, type FileItem } from '@/lib/types'
import { queryKeys } from '@/lib/query-keys'
import { stripSharePrefix } from '@/lib/source-context'
import { useVideoPlaybackTime } from '@/lib/use-video-playback-time'
import { useWorkspaceAudio } from '@/lib/workspace-audio-store'
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
import X from 'lucide-solid/icons/x'
import type { Accessor } from 'solid-js'
import { Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js'
import { useStoreProgressSync, useStoreSync } from '../lib/solid-store-sync'
import {
  buildAudioExtractUrl,
  buildAudioMetadataUrl,
  buildMediaUrl,
  buildThumbnailUrl,
  type MediaShareContext,
} from '../lib/build-media-url'

const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus']
const VIDEO_EXT = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'm4v']

function normFs(p: string) {
  return p.replace(/\\/g, '/').toLowerCase()
}

function getTaskbarAudioElement(
  fromRef: HTMLAudioElement | undefined,
): HTMLAudioElement | undefined {
  const connected = fromRef?.isConnected ? fromRef : undefined
  return (
    connected ??
    (typeof document !== 'undefined'
      ? document.querySelector<HTMLAudioElement>('[data-workspace-taskbar-media-audio]')
      : null) ??
    undefined
  )
}

function audioElementShowsUrl(audio: HTMLAudioElement, fullUrl: string): boolean {
  try {
    const b = new URL(fullUrl, window.location.origin)
    const candidates: string[] = []
    if (audio.currentSrc) candidates.push(audio.currentSrc)
    if (audio.src) candidates.push(audio.src)
    for (const raw of candidates) {
      const a = new URL(raw, window.location.origin)
      if (a.pathname === b.pathname && a.search === b.search) return true
    }
    return false
  } catch {
    return false
  }
}

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
  onStopPlayback: () => void
}

export function WorkspaceTaskbarAudio(props: Props) {
  const transportTick = useStoreSync(useWorkspaceAudio)
  const progressTick = useStoreProgressSync(useWorkspaceAudio)
  const [detailsOpen, setDetailsOpen] = createSignal(false)
  const [audioEl, setAudioEl] = createSignal<HTMLAudioElement | undefined>()
  const srcLoadGenRef = { current: 0 }
  /** True while pausing to swap `src` so `onPause` does not clobber `isPlaying`. */
  const swappingSrcRef = { current: false }

  const slice = createMemo(() => {
    void transportTick()
    const st = useWorkspaceAudio.getState()
    return {
      playing: st.playing,
      audioOnly: st.audioOnly,
      dir: st.dir,
    }
  })

  const playingPath = () => slice().playing
  const audioOnlyWs = () => slice().audioOnly
  const currentDir = () => slice().dir ?? ''

  const extension = createMemo(() => (playingPath() || '').split('.').pop()?.toLowerCase() || '')
  const isAudioFile = createMemo(() => !!(playingPath() && AUDIO_EXT.includes(extension())))
  const isVideoFile = createMemo(() => !!(playingPath() && VIDEO_EXT.includes(extension())))
  const shouldHandleAudio = createMemo(() => !!(isAudioFile() || (isVideoFile() && audioOnlyWs())))
  const audioTransportPath = createMemo(() => (shouldHandleAudio() ? playingPath() : null))

  const fileName = createMemo(() => (playingPath() || '').split('/').pop() || '')

  createEffect(() => {
    if (!shouldHandleAudio()) {
      setDetailsOpen(false)
    }
  })

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
    if (!shouldHandleAudio()) return null
    const path = playingPath()
    if (isVideoFile() && path) {
      return buildThumbnailUrl(path, mediaShare())
    }
    return audioMetadata()?.coverArt || coverArtUrl()
  })

  const storeSlice = createMemo(() => {
    void transportTick()
    return useWorkspaceAudio.getState()
  })

  const displayDuration = createMemo(() => {
    void transportTick()
    const meta = audioMetadata()
    const d = useWorkspaceAudio.getState().duration
    if (isVideoFile() && audioOnlyWs() && meta?.duration != null && meta.duration > 0 && d <= 0) {
      return meta.duration
    }
    return d
  })

  const currentTimeDisplay = createMemo(() => {
    void progressTick()
    return useWorkspaceAudio.getState().currentTime
  })

  function playNextAudio() {
    const st = useWorkspaceAudio.getState()
    const path = st.playing
    const dir = st.dir
    const files = audioFiles()
    if (!path || files.length === 0) return

    const currentIndex = files.findIndex((file) => normFs(file.path) === normFs(path))
    if (currentIndex === -1) {
      useWorkspaceAudio.getState().setIsPlaying(false)
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
      useWorkspaceAudio.getState().setIsPlaying(false)
      return
    }

    useWorkspaceAudio.getState().armUserGestureTransport(nextFile.path)
    st.playFile(props.storageKey() || undefined, nextFile.path, dir ?? undefined)
    st.startOrResumePlayback(nextFile.path)
  }

  function playPreviousAudio() {
    const st = useWorkspaceAudio.getState()
    const path = st.playing
    const dir = st.dir
    const files = audioFiles()
    if (!path || files.length === 0) return

    const audio = getTaskbarAudioElement(audioEl())
    if (audio && audio.currentTime > 20) {
      audio.currentTime = 0
      return
    }

    const currentIndex = files.findIndex((file) => normFs(file.path) === normFs(path))
    if (currentIndex === -1) return

    let previousFile: FileItem | null = null
    for (let i = currentIndex - 1; i >= 0; i--) {
      if (files[i].type === MediaType.AUDIO) {
        previousFile = files[i]
        break
      }
    }

    if (!previousFile) return

    useWorkspaceAudio.getState().armUserGestureTransport(previousFile.path)
    st.playFile(props.storageKey() || undefined, previousFile.path, dir ?? undefined)
    st.startOrResumePlayback(previousFile.path)
  }

  createEffect(() => {
    const audio = getTaskbarAudioElement(audioEl())
    if (!audio) return

    const onTimeUpdate = () => {
      useWorkspaceAudio.getState().setCurrentTime(audio.currentTime)
      const st = useWorkspaceAudio.getState()
      const path = st.playing
      const ao = st.audioOnly
      const ext = path?.split('.').pop()?.toLowerCase() || ''
      const isVid = VIDEO_EXT.includes(ext)
      const dur = useWorkspaceAudio.getState().duration
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
        useWorkspaceAudio.getState().setDuration(d)
      }
    }

    const onLoadedMetadata = () => {
      const d = audio.duration
      if (Number.isFinite(d) && !Number.isNaN(d) && d > 0) {
        useWorkspaceAudio.getState().setDuration(d)
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
      useWorkspaceAudio.getState().setCurrentTime(audio.currentTime)
      if (!swappingSrcRef.current) useWorkspaceAudio.getState().setIsPlaying(true)
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'
    }

    const onPause = () => {
      useWorkspaceAudio.getState().setCurrentTime(audio.currentTime)
      if (!swappingSrcRef.current) useWorkspaceAudio.getState().setIsPlaying(false)
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'
    }

    const onSeeked = () => {
      useWorkspaceAudio.getState().setCurrentTime(audio.currentTime)
    }

    const onEnded = () => {
      if (useWorkspaceAudio.getState().isRepeat) {
        audio.currentTime = 0
        void audio.play().catch(() => {})
      } else {
        playNextAudio()
      }
    }

    const onError = () => {
      useWorkspaceAudio.getState().setIsPlaying(false)
    }

    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('durationchange', onDurationChange)
    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('seeked', onSeeked)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)

    onCleanup(() => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('durationchange', onDurationChange)
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('seeked', onSeeked)
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
      useWorkspaceAudio.getState().duration > 0
    ) {
      return
    }
    useWorkspaceAudio.getState().setDuration(metaDur)
  })

  createEffect(() => {
    void transportTick()
    const audio = getTaskbarAudioElement(audioEl())
    if (!audio) return

    const path = playingPath()
    const handle = shouldHandleAudio()
    const wantPlaying = useWorkspaceAudio.getState().isPlaying

    if (!handle || !path) {
      if (audio.src) {
        audio.pause()
        audio.removeAttribute('src')
        audio.load()
      }
      return
    }

    const gesturePath = useWorkspaceAudio.getState().takeUserGestureTransport()

    const mediaUrl = isVideoFile()
      ? buildAudioExtractUrl(path, mediaShare())
      : buildMediaUrl(path, mediaShare())
    const fullUrl = new URL(mediaUrl, window.location.origin).href

    const tryGesturePlay = gesturePath != null && gesturePath === path && wantPlaying

    if (!audioElementShowsUrl(audio, fullUrl)) {
      srcLoadGenRef.current += 1
      const token = srcLoadGenRef.current
      const state = useWorkspaceAudio.getState()
      const isSameFile = state.playing === path
      const storedTime = state.currentTime
      const savedTime = isVideoFile() ? useVideoPlaybackTime.getState().getSavedTime(path) : null
      const timeToRestore = storedTime > 0 ? storedTime : (savedTime ?? 0)
      const restoreSeek = (isSameFile || isVideoFile()) && timeToRestore > 0

      const onCanPlay = () => {
        audio.removeEventListener('canplay', onCanPlay)
        audio.removeEventListener('error', onCanPlay)
        if (token !== srcLoadGenRef.current) return
        if (restoreSeek) audio.currentTime = timeToRestore
        const playing = useWorkspaceAudio.getState().isPlaying
        swappingSrcRef.current = false
        if (playing && audio.paused) void audio.play().catch(() => {})
        else if (!playing && !audio.paused) audio.pause()
      }

      audio.addEventListener('canplay', onCanPlay)
      audio.addEventListener('error', onCanPlay)
      swappingSrcRef.current = true
      audio.pause()
      audio.src = fullUrl
      audio.load()

      if (tryGesturePlay) void audio.play().catch(() => {})

      onCleanup(() => {
        swappingSrcRef.current = false
        audio.removeEventListener('canplay', onCanPlay)
        audio.removeEventListener('error', onCanPlay)
      })
      return
    }

    if (!wantPlaying && !audio.paused) {
      audio.pause()
    } else if (wantPlaying && audio.paused) {
      void audio.play().catch(() => {})
    }
    if (tryGesturePlay) void audio.play().catch(() => {})
  })

  createEffect(() => {
    const audio = getTaskbarAudioElement(audioEl())
    if (!audio) return
    const st = storeSlice()
    audio.muted = st.isMuted
    audio.volume = st.isMuted ? 0 : st.volume
  })

  createEffect(() => {
    if (!('mediaSession' in navigator)) return
    const path = playingPath()
    const handle = shouldHandleAudio()
    const audio = getTaskbarAudioElement(audioEl())
    void audioMetadata()
    void displayImageUrl()

    if (path && handle) {
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
    }

    if (path && handle && audio) {
      const sessionAudio = audio
      navigator.mediaSession.setActionHandler('play', () => {
        useWorkspaceAudio.getState().setIsPlaying(true)
        void sessionAudio.play().catch(() => {})
      })
      navigator.mediaSession.setActionHandler('pause', () => {
        useWorkspaceAudio.getState().setIsPlaying(false)
        sessionAudio.pause()
      })
      navigator.mediaSession.setActionHandler('seekbackward', (details) => {
        const skipTime = details.seekOffset || 10
        sessionAudio.currentTime = Math.max(0, sessionAudio.currentTime - skipTime)
      })
      navigator.mediaSession.setActionHandler('seekforward', (details) => {
        const skipTime = details.seekOffset || 10
        sessionAudio.currentTime = Math.min(
          sessionAudio.duration,
          sessionAudio.currentTime + skipTime,
        )
      })
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime == null) return
        sessionAudio.currentTime = details.seekTime
      })
      navigator.mediaSession.setActionHandler('previoustrack', playPreviousAudio)
      navigator.mediaSession.setActionHandler('nexttrack', playNextAudio)
    }

    onCleanup(() => {
      if (!('mediaSession' in navigator)) return
      navigator.mediaSession.setActionHandler('play', null)
      navigator.mediaSession.setActionHandler('pause', null)
      navigator.mediaSession.setActionHandler('seekbackward', null)
      navigator.mediaSession.setActionHandler('seekforward', null)
      navigator.mediaSession.setActionHandler('seekto', null)
      navigator.mediaSession.setActionHandler('previoustrack', null)
      navigator.mediaSession.setActionHandler('nexttrack', null)
    })
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
    if (!shouldHandleAudio()) return
    const path = playingPath()
    if (path) useWorkspaceAudio.getState().toggleOrSelectFile(path)
  }

  function handleShowVideo() {
    const audio = getTaskbarAudioElement(audioEl())
    const path = playingPath()
    if (audio && path) {
      audio.pause()
      useWorkspaceAudio.getState().reset()
      useWorkspaceAudio.getState().setAudioOnly(undefined, false)
      props.onShowVideo()
    }
  }

  function handleSeek(value: number) {
    const audio = getTaskbarAudioElement(audioEl())
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
    const currentIndex = files.findIndex((file) => normFs(file.path) === normFs(path))
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
    const currentIndex = files.findIndex((file) => normFs(file.path) === normFs(path))
    if (currentIndex === -1) return false
    for (let i = currentIndex + 1; i < files.length; i++) {
      if (files[i].type === MediaType.AUDIO) return true
    }
    return false
  })

  return (
    <>
      <audio ref={setAudioEl} preload='auto' class='hidden' data-workspace-taskbar-media-audio />

      <Show when={shouldHandleAudio()}>
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
                    <Headphones
                      class='text-muted-foreground h-3.5 w-3.5 shrink-0'
                      stroke-width={2}
                    />
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
                  {audioMetadata()?.title || fileName()}
                </div>
                <div class='text-muted-foreground truncate text-[11px] leading-none'>
                  {audioMetadata()?.artist || currentDir() || '\u00A0'}
                </div>
              </div>
            </button>
          </div>

          <Show when={detailsOpen()}>
            <div class='bg-popover absolute right-0 bottom-full z-100001 mb-2 w-80 border border-border shadow-xl'>
              <button
                type='button'
                class='text-muted-foreground hover:bg-accent hover:text-foreground absolute top-2 right-2 z-10 inline-flex h-8 w-8 items-center justify-center rounded-md disabled:opacity-50'
                disabled={!audioTransportPath()}
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
                    <Show
                      when={displayImageUrl()}
                      fallback={
                        <Headphones class='text-muted-foreground h-5 w-5' stroke-width={2} />
                      }
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
                      {audioMetadata()?.title || fileName()}
                    </div>
                    <div class='text-muted-foreground truncate text-xs'>
                      {audioMetadata()?.artist || currentDir() || '\u00A0'}
                    </div>
                  </div>
                </div>

                <div class='text-muted-foreground flex items-center gap-2 text-[11px]'>
                  <span class='w-9 text-right tabular-nums'>
                    {formatTime(currentTimeDisplay())}
                  </span>
                  <input
                    type='range'
                    min={0}
                    max={displayDuration() || 0}
                    value={currentTimeDisplay()}
                    onInput={(e) => handleSeek(Number.parseFloat(e.currentTarget.value))}
                    class='[&::-webkit-slider-thumb]:bg-primary h-1.5 flex-1 cursor-pointer appearance-none rounded-none bg-secondary [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full'
                    disabled={!audioTransportPath()}
                  />
                  <span class='w-9 tabular-nums'>{formatTime(displayDuration())}</span>
                </div>

                <div class='grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3'>
                  <div class='flex shrink-0 items-center gap-1'>
                    <button
                      type='button'
                      class='hover:bg-accent inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md disabled:opacity-50'
                      disabled={!hasPreviousAudio()}
                      aria-label='Previous track'
                      onClick={() => playPreviousAudio()}
                    >
                      <StepBack class='h-4 w-4' stroke-width={2} />
                    </button>
                    <button
                      type='button'
                      class='bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md disabled:opacity-50'
                      disabled={!audioTransportPath()}
                      onClick={handleTogglePlayPause}
                    >
                      <Show
                        when={
                          storeSlice().isPlaying &&
                          storeSlice().playing === playingPath() &&
                          shouldHandleAudio()
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
                      aria-label='Next track'
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
                      disabled={!audioTransportPath()}
                      onClick={() => useWorkspaceAudio.getState().toggleRepeat()}
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
                          const st = useWorkspaceAudio.getState()
                          if (st.isMuted) {
                            useWorkspaceAudio.getState().setMuted(false)
                            if (st.volume === 0) useWorkspaceAudio.getState().setVolume(0.5)
                          } else {
                            useWorkspaceAudio.getState().setMuted(true)
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
                          useWorkspaceAudio.getState().setVolume(v)
                          const a = getTaskbarAudioElement(audioEl())
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
      </Show>
    </>
  )
}
