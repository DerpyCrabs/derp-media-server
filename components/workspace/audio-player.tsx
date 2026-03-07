import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Headphones,
  Monitor,
  MoreHorizontal,
  Pause,
  Play,
  Repeat,
  StepBack,
  StepForward,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FileItem, MediaType } from '@/lib/types'
import { useMediaPlayer } from '@/lib/use-media-player'
import { useMediaUrl } from '@/lib/use-media-url'
import { useAudioMetadata } from '@/lib/use-audio-metadata'
import { useViewStats } from '@/lib/use-view-stats'
import { useFiles } from '@/lib/use-files'
import { useNavigationSession } from '@/lib/use-navigation-session'
import type { NavigationSession } from '@/lib/navigation-session'
import type { SourceContext } from '@/lib/source-context'

interface WorkspaceAudioPlayerProps {
  session?: NavigationSession
  mediaContext?: SourceContext
  onShowVideo?: () => void
}

export function AudioPlayer({
  session: sessionProp,
  mediaContext,
  onShowVideo,
}: WorkspaceAudioPlayerProps = {}) {
  const session = useNavigationSession(sessionProp)
  const { state, playFile: urlPlayFile, setAudioOnly } = session
  const rootRef = useRef<HTMLDivElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)

  const {
    currentFile,
    mediaType,
    isPlaying,
    currentTime,
    duration,
    isRepeat,
    playFile,
    setCurrentFile,
    setIsPlaying,
    setCurrentTime,
    setDuration,
    volume,
    isMuted,
    setVolume,
    setMuted,
    toggleRepeat,
  } = useMediaPlayer()

  const { incrementView } = useViewStats(mediaContext, { includeCounts: false })
  const { getMediaUrl, getAudioExtractUrl, getAudioMetadataUrl, shareToken, sharePath } =
    useMediaUrl(mediaContext)

  const playingPath = state.playing
  const currentDir = state.dir || ''
  const fileName = (playingPath || '').split('/').pop() || ''

  const extension = (playingPath || '').split('.').pop()?.toLowerCase()
  const audioExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus']
  const videoExtensions = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv']
  const isAudioFile = playingPath && audioExtensions.includes(extension || '')
  const isVideoFile = playingPath && videoExtensions.includes(extension || '')
  const isAudioOnly = state.audioOnly
  const shouldHandleAudio = !!(isAudioFile || (isVideoFile && isAudioOnly))
  const canControlVideoFromTaskbar = !!(playingPath && isVideoFile && !isAudioOnly)

  const dirToFetch = useMemo(() => {
    if (!currentDir && !playingPath) return ''

    let dir = currentDir
    if (!dir && playingPath) {
      const pathParts = playingPath.split(/[/\\]/)
      pathParts.pop()
      dir = pathParts.join('/')
    }
    return dir
  }, [currentDir, playingPath])

  const { data: allFiles = [] } = useFiles(dirToFetch, shareToken, sharePath)

  const audioFiles = useMemo(
    () =>
      allFiles.filter(
        (file: FileItem) => file.type === MediaType.AUDIO || file.type === MediaType.VIDEO,
      ),
    [allFiles],
  )

  const coverArtUrl = useMemo(() => {
    const coverFile = allFiles.find((file: FileItem) => {
      if (file.type !== MediaType.IMAGE) return false
      const name = file.name.toLowerCase()
      const nameWithoutExt = name.substring(0, name.lastIndexOf('.'))
      return nameWithoutExt === 'cover'
    })
    return coverFile ? getMediaUrl(coverFile.path) : null
  }, [allFiles, getMediaUrl])

  const metadataUrl = playingPath ? getAudioMetadataUrl(playingPath) : null
  const { data: audioMetadata } = useAudioMetadata(playingPath, !!isAudioFile, metadataUrl)

  const playNextAudioRef = useRef<() => void>(() => {})
  const playPreviousAudioRef = useRef<() => void>(() => {})
  const isRepeatRef = useRef(isRepeat)

  useEffect(() => {
    isRepeatRef.current = isRepeat
  }, [isRepeat])

  useEffect(() => {
    if (!detailsOpen) return

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setDetailsOpen(false)
      }
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDetailsOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [detailsOpen])

  const playNextAudio = useCallback(() => {
    if (!playingPath || audioFiles.length === 0) return

    const currentIndex = audioFiles.findIndex((file) => file.path === playingPath)
    if (currentIndex === -1) {
      setIsPlaying(false)
      return
    }

    let nextFile: FileItem | null = null
    for (let index = currentIndex + 1; index < audioFiles.length; index += 1) {
      if (audioFiles[index].type === MediaType.AUDIO) {
        nextFile = audioFiles[index]
        break
      }
    }

    if (!nextFile) {
      setIsPlaying(false)
      return
    }

    incrementView(nextFile.path)
    urlPlayFile(nextFile.path, currentDir)
    playFile(nextFile.path, 'audio')
  }, [audioFiles, currentDir, incrementView, playFile, playingPath, setIsPlaying, urlPlayFile])

  const playPreviousAudio = useCallback(() => {
    if (!playingPath || audioFiles.length === 0) return

    const audio = audioRef.current
    if (audio && audio.currentTime > 20) {
      audio.currentTime = 0
      return
    }

    const currentIndex = audioFiles.findIndex((file) => file.path === playingPath)
    if (currentIndex === -1) return

    let previousFile: FileItem | null = null
    for (let index = currentIndex - 1; index >= 0; index -= 1) {
      if (audioFiles[index].type === MediaType.AUDIO) {
        previousFile = audioFiles[index]
        break
      }
    }

    if (!previousFile) return

    incrementView(previousFile.path)
    urlPlayFile(previousFile.path, currentDir)
    playFile(previousFile.path, 'audio')
  }, [audioFiles, currentDir, incrementView, playFile, playingPath, urlPlayFile])

  useEffect(() => {
    playNextAudioRef.current = playNextAudio
  }, [playNextAudio])

  useEffect(() => {
    playPreviousAudioRef.current = playPreviousAudio
  }, [playPreviousAudio])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime)
      if ('mediaSession' in navigator && !isNaN(audio.duration) && !audio.paused) {
        navigator.mediaSession.setPositionState({
          duration: audio.duration,
          playbackRate: audio.playbackRate,
          position: audio.currentTime,
        })
      }
    }

    const handleDurationChange = () => setDuration(audio.duration)
    const handleLoadedMetadata = () => {
      setDuration(audio.duration)
      if ('mediaSession' in navigator && !isNaN(audio.duration)) {
        navigator.mediaSession.setPositionState({
          duration: audio.duration,
          playbackRate: audio.playbackRate,
          position: audio.currentTime,
        })
      }
    }

    const handlePlay = () => {
      setIsPlaying(true)
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing'
      }
    }

    const handlePause = () => {
      setIsPlaying(false)
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused'
      }
    }

    const handleEnded = () => {
      if (isRepeatRef.current) {
        audio.currentTime = 0
        void audio.play()
      } else {
        playNextAudioRef.current()
      }
    }

    const handleError = () => {
      setIsPlaying(false)
    }

    audio.addEventListener('timeupdate', handleTimeUpdate)
    audio.addEventListener('durationchange', handleDurationChange)
    audio.addEventListener('loadedmetadata', handleLoadedMetadata)
    audio.addEventListener('play', handlePlay)
    audio.addEventListener('pause', handlePause)
    audio.addEventListener('ended', handleEnded)
    audio.addEventListener('error', handleError)

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate)
      audio.removeEventListener('durationchange', handleDurationChange)
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata)
      audio.removeEventListener('play', handlePlay)
      audio.removeEventListener('pause', handlePause)
      audio.removeEventListener('ended', handleEnded)
      audio.removeEventListener('error', handleError)
    }
  }, [setCurrentTime, setDuration, setIsPlaying])

  useEffect(() => {
    if (shouldHandleAudio) return
    const audio = audioRef.current
    if (!audio || !audio.src) return
    audio.pause()
    audio.removeAttribute('src')
    audio.load()
  }, [shouldHandleAudio])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.muted = isMuted
    audio.volume = isMuted ? 0 : volume
  }, [isMuted, volume])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !playingPath || !shouldHandleAudio) {
      return
    }

    const mediaUrl = isVideoFile ? getAudioExtractUrl(playingPath) : getMediaUrl(playingPath)
    const fullUrl = new URL(mediaUrl, window.location.origin).href

    if (audio.src !== fullUrl) {
      const isSameFile = currentFile === playingPath

      if (currentFile !== playingPath || mediaType !== 'audio') {
        setCurrentFile(playingPath, 'audio')
      }

      audio.src = fullUrl
      audio.load()

      if (isSameFile) {
        const storedTime = useMediaPlayer.getState().currentTime
        if (storedTime > 0) {
          const seekToPosition = () => {
            audio.currentTime = storedTime
            audio.removeEventListener('loadedmetadata', seekToPosition)
          }
          audio.addEventListener('loadedmetadata', seekToPosition)
        }
      }

      if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', () => {
          void audio.play()
        })
        navigator.mediaSession.setActionHandler('pause', () => {
          audio.pause()
        })
        navigator.mediaSession.setActionHandler('seekbackward', (details) => {
          const skipTime = details.seekOffset || 10
          audio.currentTime = Math.max(0, audio.currentTime - skipTime)
        })
        navigator.mediaSession.setActionHandler('seekforward', (details) => {
          const skipTime = details.seekOffset || 10
          audio.currentTime = Math.min(audio.duration, audio.currentTime + skipTime)
        })
        navigator.mediaSession.setActionHandler('seekto', (details) => {
          if (details.seekTime !== null && details.seekTime !== undefined) {
            audio.currentTime = details.seekTime
          }
        })
        navigator.mediaSession.setActionHandler('previoustrack', () => {
          playPreviousAudioRef.current()
        })
        navigator.mediaSession.setActionHandler('nexttrack', () => {
          playNextAudioRef.current()
        })
      }
    }
  }, [
    currentFile,
    getAudioExtractUrl,
    getMediaUrl,
    isVideoFile,
    mediaType,
    playingPath,
    setCurrentFile,
    shouldHandleAudio,
  ])

  useEffect(() => {
    if (!playingPath || !shouldHandleAudio || !('mediaSession' in navigator)) {
      return
    }

    const metadata: MediaMetadataInit = {
      title: isVideoFile && isAudioOnly ? `${fileName} (Audio)` : audioMetadata?.title || fileName,
      artist:
        isVideoFile && isAudioOnly ? 'Video Audio' : audioMetadata?.artist || 'Unknown Artist',
      album: audioMetadata?.album || currentDir || 'Unknown Album',
    }

    const artworkUrl = audioMetadata?.coverArt || coverArtUrl
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
  }, [
    audioMetadata,
    coverArtUrl,
    currentDir,
    fileName,
    isAudioOnly,
    isVideoFile,
    playingPath,
    shouldHandleAudio,
  ])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !shouldHandleAudio || currentFile !== playingPath || mediaType !== 'audio') return

    if (isPlaying && audio.paused) {
      void audio.play()
    } else if (!isPlaying && !audio.paused) {
      audio.pause()
    }
  }, [currentFile, isPlaying, mediaType, playingPath, shouldHandleAudio])

  const handleTogglePlayPause = () => {
    if (playingPath) {
      playFile(playingPath, canControlVideoFromTaskbar ? 'video' : 'audio')
    }
  }

  const handleShowVideo = () => {
    const audio = audioRef.current
    if (audio && playingPath) {
      audio.pause()
      setCurrentTime(audio.currentTime)
      setCurrentFile(playingPath, 'video')
      setAudioOnly(false)
      onShowVideo?.()
    }
  }

  const handleSeek = (value: string) => {
    const nextTime = Number.parseFloat(value)

    if (canControlVideoFromTaskbar) {
      setCurrentTime(nextTime)
      return
    }

    const audio = audioRef.current
    if (!audio) return
    audio.currentTime = nextTime
  }

  const handleVolumeChange = (value: string) => {
    const nextVolume = Number.parseFloat(value)
    setVolume(nextVolume)
  }

  const toggleMute = () => {
    if (isMuted) {
      setMuted(false)
      if (volume === 0) {
        setVolume(0.5)
      }
      return
    }

    setMuted(true)
  }

  const formatTime = (time: number) => {
    if (isNaN(time)) return '0:00'
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const hasPreviousAudio = useMemo(() => {
    if (!playingPath || audioFiles.length === 0) return false
    const currentIndex = audioFiles.findIndex((file) => file.path === playingPath)
    if (currentIndex === -1) return false

    for (let index = currentIndex - 1; index >= 0; index -= 1) {
      if (audioFiles[index].type === MediaType.AUDIO) return true
    }

    return false
  }, [audioFiles, playingPath])

  const hasNextAudio = useMemo(() => {
    if (!playingPath || audioFiles.length === 0) return false
    const currentIndex = audioFiles.findIndex((file) => file.path === playingPath)
    if (currentIndex === -1) return false

    for (let index = currentIndex + 1; index < audioFiles.length; index += 1) {
      if (audioFiles[index].type === MediaType.AUDIO) return true
    }

    return false
  }, [audioFiles, playingPath])

  return (
    <>
      <audio ref={audioRef} preload='auto' className='hidden' />

      <div ref={rootRef} className='relative'>
        <div className='flex h-10 items-center gap-1 border-l border-white/6 bg-white/4 px-2 text-muted-foreground'>
          <div className='hidden min-[1150px]:flex items-center gap-1.5 pr-1'>
            <div className='flex h-6 w-6 items-center justify-center rounded bg-white/8'>
              <Headphones className='h-3.5 w-3.5 text-muted-foreground' />
            </div>
            <div className='max-w-40 min-w-0'>
              <div className='truncate text-[11px] font-medium leading-none text-foreground'>
                {playingPath ? audioMetadata?.title || fileName : 'Audio idle'}
              </div>
              <div className='truncate text-[10px] leading-none text-muted-foreground'>
                {playingPath
                  ? audioMetadata?.artist ||
                    currentDir ||
                    (canControlVideoFromTaskbar ? 'Video playback' : 'Ready')
                  : 'Play audio to pin controls here'}
              </div>
            </div>
          </div>

          <Button
            variant='ghost'
            size='icon-xs'
            className='rounded-none text-muted-foreground hover:bg-white/8 hover:text-foreground'
            onClick={playPreviousAudio}
            disabled={!hasPreviousAudio}
            aria-label='Previous track'
          >
            <StepBack className='h-3.5 w-3.5' />
          </Button>
          <Button
            variant='default'
            size='icon-xs'
            onClick={handleTogglePlayPause}
            disabled={!playingPath}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            className='rounded-none shadow-none'
          >
            {isPlaying &&
            currentFile === playingPath &&
            mediaType === (canControlVideoFromTaskbar ? 'video' : 'audio') ? (
              <Pause className='h-3.5 w-3.5' />
            ) : (
              <Play className='h-3.5 w-3.5' />
            )}
          </Button>
          <Button
            variant='ghost'
            size='icon-xs'
            className='rounded-none text-muted-foreground hover:bg-white/8 hover:text-foreground'
            onClick={playNextAudio}
            disabled={!hasNextAudio}
            aria-label='Next track'
          >
            <StepForward className='h-3.5 w-3.5' />
          </Button>

          {isVideoFile && isAudioOnly && (
            <Button
              variant='ghost'
              size='icon-xs'
              className='rounded-none text-muted-foreground hover:bg-white/8 hover:text-foreground'
              onClick={handleShowVideo}
              aria-label='Show video window'
              title='Show video'
            >
              <Monitor className='h-3.5 w-3.5' />
            </Button>
          )}

          <Button
            variant='ghost'
            size='icon-xs'
            className='rounded-none text-muted-foreground hover:bg-white/8 hover:text-foreground'
            onClick={() => setDetailsOpen((open) => !open)}
            aria-label='Open audio controls'
            aria-expanded={detailsOpen}
            title='Open audio controls'
          >
            <MoreHorizontal className='h-3.5 w-3.5' />
          </Button>
        </div>

        {detailsOpen ? (
          <div className='absolute right-0 bottom-full mb-2 w-80 border border-white/8 bg-neutral-900 shadow-2xl'>
            <div className='space-y-3 p-3'>
              <div className='flex items-center gap-3'>
                <div className='flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden bg-neutral-800'>
                  {coverArtUrl ? (
                    <img src={coverArtUrl} alt='Album art' className='h-full w-full object-cover' />
                  ) : (
                    <Headphones className='h-5 w-5 text-muted-foreground' />
                  )}
                </div>
                <div className='min-w-0 flex-1'>
                  <div className='truncate text-sm font-medium text-foreground'>
                    {playingPath ? audioMetadata?.title || fileName : 'Nothing playing'}
                  </div>
                  <div className='truncate text-xs text-muted-foreground'>
                    {playingPath
                      ? audioMetadata?.artist ||
                        currentDir ||
                        (canControlVideoFromTaskbar ? 'Current video playback' : 'Current playback')
                      : 'Choose a file from the workspace'}
                  </div>
                </div>
              </div>

              <div className='flex items-center gap-2 text-[11px] text-muted-foreground'>
                <span className='w-9 text-right tabular-nums'>{formatTime(currentTime)}</span>
                <input
                  type='range'
                  min='0'
                  max={duration || 0}
                  value={currentTime}
                  onChange={(event) => handleSeek(event.target.value)}
                  className='h-1.5 flex-1 cursor-pointer appearance-none rounded-none bg-secondary [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary'
                  disabled={!playingPath}
                />
                <span className='w-9 tabular-nums'>{formatTime(duration)}</span>
              </div>

              <div className='grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-3'>
                <div className='flex shrink-0 items-center gap-1'>
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    onClick={playPreviousAudio}
                    disabled={!hasPreviousAudio}
                  >
                    <StepBack className='h-4 w-4' />
                  </Button>
                  <Button
                    variant='default'
                    size='icon-sm'
                    onClick={handleTogglePlayPause}
                    disabled={!playingPath}
                  >
                    {isPlaying &&
                    currentFile === playingPath &&
                    mediaType === (canControlVideoFromTaskbar ? 'video' : 'audio') ? (
                      <Pause className='h-4 w-4' />
                    ) : (
                      <Play className='h-4 w-4' />
                    )}
                  </Button>
                  <Button
                    variant='ghost'
                    size='icon-sm'
                    onClick={playNextAudio}
                    disabled={!hasNextAudio}
                  >
                    <StepForward className='h-4 w-4' />
                  </Button>
                  <Button
                    variant={isRepeat ? 'default' : 'ghost'}
                    size='icon-sm'
                    onClick={toggleRepeat}
                    disabled={!playingPath}
                  >
                    <Repeat className='h-4 w-4' />
                  </Button>
                </div>

                <div className='flex min-w-0 items-center justify-end gap-2'>
                  {isVideoFile && isAudioOnly ? (
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={handleShowVideo}
                      className='shrink-0'
                    >
                      <Monitor className='h-4 w-4' />
                      Show video
                    </Button>
                  ) : null}

                  <div className='ml-1 flex min-w-0 max-w-32 flex-1 items-center gap-2'>
                    <Button
                      variant='ghost'
                      size='icon-sm'
                      onClick={toggleMute}
                      className='shrink-0'
                    >
                      {isMuted ? <VolumeX className='h-4 w-4' /> : <Volume2 className='h-4 w-4' />}
                    </Button>
                    <input
                      type='range'
                      min='0'
                      max='1'
                      step='0.01'
                      value={isMuted ? 0 : volume}
                      onChange={(event) => handleVolumeChange(event.target.value)}
                      className='min-w-0 flex-1 cursor-pointer appearance-none rounded-none bg-secondary h-1.5 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary'
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  )
}
