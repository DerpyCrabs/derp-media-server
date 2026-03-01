'use client'

import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Play, Pause, Volume2, VolumeX, StepBack, StepForward, Repeat, Monitor } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { FileItem, MediaType } from '@/lib/types'
import { useMediaPlayer } from '@/lib/use-media-player'
import { useAudioMetadata } from '@/lib/use-audio-metadata'
import { useViewStats } from '@/lib/use-view-stats'
import { useFiles } from '@/lib/use-files'

export function AudioPlayer() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const audioRef = useRef<HTMLAudioElement>(null)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)

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
    toggleRepeat,
  } = useMediaPlayer()

  const { incrementView } = useViewStats()

  const playingPath = searchParams.get('playing')
  const currentDir = searchParams.get('dir') || ''
  const fileName = (playingPath || '').split('/').pop() || ''

  const extension = (playingPath || '').split('.').pop()?.toLowerCase()
  const audioExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus']
  const videoExtensions = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv']
  const isAudioFile = playingPath && audioExtensions.includes(extension || '')
  const isVideoFile = playingPath && videoExtensions.includes(extension || '')
  const isAudioOnly = searchParams.get('audioOnly') === 'true'

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

  const { data: allFiles = [] } = useFiles(dirToFetch)

  const audioFiles = useMemo(() => {
    return allFiles.filter(
      (file: FileItem) => file.type === MediaType.AUDIO || file.type === MediaType.VIDEO,
    )
  }, [allFiles])

  const coverArtUrl = useMemo(() => {
    const coverFile = allFiles.find((file: FileItem) => {
      if (file.type !== MediaType.IMAGE) return false
      const name = file.name.toLowerCase()
      const nameWithoutExt = name.substring(0, name.lastIndexOf('.'))
      return nameWithoutExt === 'cover'
    })
    return coverFile ? `/api/media/${coverFile.path}` : null
  }, [allFiles])

  const { data: audioMetadata, isLoading: isLoadingMetadata } = useAudioMetadata(
    playingPath,
    !!isAudioFile,
  )

  // Stable refs for values used inside effects — prevents effect re-runs
  // when React Query refetches cause new callback/value references.
  const playNextAudioRef = useRef<() => void>(() => {})
  const playPreviousAudioRef = useRef<() => void>(() => {})
  const isRepeatRef = useRef(isRepeat)

  useEffect(() => {
    isRepeatRef.current = isRepeat
  }, [isRepeat])

  const playNextAudio = useCallback(() => {
    if (!playingPath || audioFiles.length === 0) return

    const currentIndex = audioFiles.findIndex((file) => file.path === playingPath)
    if (currentIndex === -1) {
      setIsPlaying(false)
      return
    }

    let nextFile = null
    for (let i = currentIndex + 1; i < audioFiles.length; i++) {
      if (audioFiles[i].type === MediaType.AUDIO) {
        nextFile = audioFiles[i]
        break
      }
    }

    if (!nextFile) {
      setIsPlaying(false)
      return
    }

    incrementView(nextFile.path)

    const params = new URLSearchParams(searchParams)
    params.set('playing', nextFile.path)
    params.set('dir', currentDir)
    router.replace(`/?${params.toString()}`, { scroll: false })

    playFile(nextFile.path, 'audio')
  }, [
    playingPath,
    audioFiles,
    searchParams,
    currentDir,
    router,
    setIsPlaying,
    playFile,
    incrementView,
  ])

  const playPreviousAudio = useCallback(() => {
    if (!playingPath || audioFiles.length === 0) return

    const audio = audioRef.current

    // Read from the DOM element directly to avoid currentTime as a dep
    if (audio && audio.currentTime > 20) {
      audio.currentTime = 0
      return
    }

    const currentIndex = audioFiles.findIndex((file) => file.path === playingPath)
    if (currentIndex === -1) {
      return
    }

    let previousFile = null
    for (let i = currentIndex - 1; i >= 0; i--) {
      if (audioFiles[i].type === MediaType.AUDIO) {
        previousFile = audioFiles[i]
        break
      }
    }

    if (!previousFile) {
      return
    }

    incrementView(previousFile.path)

    const params = new URLSearchParams(searchParams)
    params.set('playing', previousFile.path)
    params.set('dir', currentDir)
    router.replace(`/?${params.toString()}`, { scroll: false })

    playFile(previousFile.path, 'audio')
  }, [playingPath, audioFiles, searchParams, currentDir, router, playFile, incrementView])

  // Keep callback refs in sync without causing effect re-runs
  useEffect(() => {
    playNextAudioRef.current = playNextAudio
  }, [playNextAudio])
  useEffect(() => {
    playPreviousAudioRef.current = playPreviousAudio
  }, [playPreviousAudio])

  // Setup event listeners — deps are all stable Zustand setters, so this
  // effect runs once and never tears down during playback.
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
        if (!isNaN(audio.duration)) {
          navigator.mediaSession.setPositionState({
            duration: audio.duration,
            playbackRate: audio.playbackRate,
            position: audio.currentTime,
          })
        }
      }
    }
    const handleEnded = () => {
      if (isRepeatRef.current) {
        audio.currentTime = 0
        audio.play()
      } else {
        playNextAudioRef.current()
      }
    }
    const handleError = () => {
      console.error('Audio error:', audio.error)
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
  }, [setIsPlaying, setCurrentTime, setDuration])

  // Load audio when the playing path actually changes
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !playingPath || (!isAudioFile && !isVideoFile)) {
      return
    }

    const mediaUrl = isVideoFile ? `/api/audio/extract/${playingPath}` : `/api/media/${playingPath}`
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
          audio.play()
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
  }, [playingPath, isAudioFile, isVideoFile, currentFile, mediaType, setCurrentFile])

  // Update Media Session metadata when metadata loads
  useEffect(() => {
    if (!playingPath || (!isAudioFile && !isVideoFile) || !('mediaSession' in navigator)) {
      return
    }

    const metadata: MediaMetadataInit = {
      title: isVideoFile ? `${fileName} (Audio)` : audioMetadata?.title || fileName,
      artist: isVideoFile ? 'Video Audio' : audioMetadata?.artist || 'Unknown Artist',
      album: isVideoFile
        ? currentDir || 'Unknown Album'
        : audioMetadata?.album || currentDir || 'Unknown Album',
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
  }, [playingPath, isAudioFile, isVideoFile, audioMetadata, fileName, currentDir, coverArtUrl])

  // React to store isPlaying changes
  useEffect(() => {
    const audio = audioRef.current
    if (
      !audio ||
      (!isAudioFile && !isVideoFile) ||
      currentFile !== playingPath ||
      mediaType !== 'audio'
    )
      return

    if (isPlaying && audio.paused) {
      audio.play().catch((err) => console.error('Play error:', err))
    } else if (!isPlaying && !audio.paused) {
      audio.pause()
    }
  }, [isPlaying, currentFile, playingPath, mediaType, isAudioFile, isVideoFile])

  const handleTogglePlayPause = () => {
    if (playingPath) {
      playFile(playingPath, 'audio')
    }
  }

  const handleShowVideo = () => {
    const audio = audioRef.current
    if (audio && playingPath) {
      setCurrentTime(audio.currentTime)
      setCurrentFile(playingPath, 'video')

      const params = new URLSearchParams(searchParams)
      params.delete('audioOnly')
      router.replace(`/?${params.toString()}`, { scroll: false })
    }
  }

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current
    if (!audio) return
    const time = parseFloat(e.target.value)
    audio.currentTime = time
  }

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current
    if (!audio) return
    const vol = parseFloat(e.target.value)
    audio.volume = vol
    setVolume(vol)
    setIsMuted(vol === 0)
  }

  const toggleMute = () => {
    const audio = audioRef.current
    if (!audio) return

    if (isMuted) {
      audio.volume = volume || 0.5
      setVolume(volume || 0.5)
      setIsMuted(false)
    } else {
      audio.volume = 0
      setIsMuted(true)
    }
  }

  const formatTime = (time: number) => {
    if (isNaN(time)) return '0:00'
    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    return `${minutes}:${seconds.toString().padStart(2, '0')}`
  }

  const hasPreviousAudio = useCallback(() => {
    if (!playingPath || audioFiles.length === 0) return false
    const currentIndex = audioFiles.findIndex((file) => file.path === playingPath)
    if (currentIndex === -1) return false

    for (let i = currentIndex - 1; i >= 0; i--) {
      if (audioFiles[i].type === MediaType.AUDIO) {
        return true
      }
    }
    return false
  }, [playingPath, audioFiles])

  const hasNextAudio = useCallback(() => {
    if (!playingPath || audioFiles.length === 0) return false
    const currentIndex = audioFiles.findIndex((file) => file.path === playingPath)
    if (currentIndex === -1) return false

    for (let i = currentIndex + 1; i < audioFiles.length; i++) {
      if (audioFiles[i].type === MediaType.AUDIO) {
        return true
      }
    }
    return false
  }, [playingPath, audioFiles])

  const showPlayer = isAudioFile || (isVideoFile && isAudioOnly)

  return (
    <>
      {/* Audio element lives outside the conditional UI so it is never
          unmounted by re-renders that toggle the player chrome. */}
      <audio ref={audioRef} preload='auto' className='hidden' />

      {showPlayer && (
        <div className='fixed bottom-0 left-0 right-0 bg-background z-50'>
          {/* Mobile Seekbar - Top Border */}
          <div className='min-[650px]:hidden relative w-full h-1 bg-secondary'>
            <div
              className='absolute top-0 left-0 h-full bg-white transition-all duration-100'
              style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
            />
            <input
              type='range'
              min='0'
              max={duration || 0}
              value={currentTime}
              onChange={handleSeek}
              className='absolute top-0 left-0 w-full h-full opacity-0 cursor-pointer'
              disabled={!playingPath}
            />
          </div>

          <div className='border-t border-border' />

          <div className='container mx-auto px-4 py-3'>
            <div className='flex items-center gap-4'>
              {/* Controls */}
              <div className='flex items-center gap-2'>
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={playPreviousAudio}
                  disabled={!hasPreviousAudio()}
                >
                  <StepBack className='h-4 w-4' />
                </Button>
                <Button
                  variant='default'
                  size='icon'
                  onClick={handleTogglePlayPause}
                  disabled={!playingPath}
                >
                  {isPlaying && mediaType === 'audio' && currentFile === playingPath ? (
                    <Pause className='h-4 w-4' />
                  ) : (
                    <Play className='h-4 w-4' />
                  )}
                </Button>
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={playNextAudio}
                  disabled={!hasNextAudio()}
                >
                  <StepForward className='h-4 w-4' />
                </Button>
                <Button
                  variant={isRepeat ? 'default' : 'ghost'}
                  size='icon'
                  onClick={toggleRepeat}
                  disabled={!playingPath}
                >
                  <Repeat className='h-4 w-4' />
                </Button>
                {isVideoFile && (
                  <Button
                    variant='ghost'
                    size='icon'
                    onClick={handleShowVideo}
                    disabled={!playingPath}
                    aria-label='Show video'
                  >
                    <Monitor className='h-4 w-4' />
                  </Button>
                )}
              </div>

              <Separator orientation='vertical' className='h-8 hidden min-[650px]:block' />

              {/* Desktop Progress */}
              <div className='hidden min-[650px]:flex flex-1 items-center gap-3'>
                <span className='text-sm tabular-nums'>{formatTime(currentTime)}</span>
                <input
                  type='range'
                  min='0'
                  max={duration || 0}
                  value={currentTime}
                  onChange={handleSeek}
                  className='flex-1 h-2 bg-secondary rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary'
                  disabled={!playingPath}
                />
                <span className='text-sm tabular-nums'>{formatTime(duration)}</span>
              </div>

              <Separator orientation='vertical' className='h-8 hidden min-[650px]:block' />

              {/* Volume */}
              <div className='hidden lg:flex items-center gap-2 min-w-[140px]'>
                <Button variant='ghost' size='icon' onClick={toggleMute}>
                  {isMuted ? <VolumeX className='h-4 w-4' /> : <Volume2 className='h-4 w-4' />}
                </Button>
                <input
                  type='range'
                  min='0'
                  max='1'
                  step='0.01'
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className='flex-1 h-2 bg-secondary rounded-lg appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary'
                />
              </div>

              <Separator orientation='vertical' className='h-8 hidden md:block' />

              {/* Now Playing Info */}
              <div className='w-[200px] lg:w-[280px] flex items-center gap-3'>
                <div className='shrink-0 w-12 h-12 rounded overflow-hidden bg-secondary'>
                  {(audioMetadata?.coverArt || coverArtUrl) && (
                    <img
                      src={audioMetadata?.coverArt || coverArtUrl || ''}
                      alt='Album art'
                      className='w-full h-full object-cover'
                    />
                  )}
                </div>

                <div className='flex-1 min-w-0'>
                  {!isLoadingMetadata && (
                    <>
                      <div className='font-medium truncate text-sm'>
                        {audioMetadata?.title || fileName}
                      </div>
                      <div className='text-xs text-muted-foreground truncate'>
                        {audioMetadata?.artist || 'Unknown Artist'}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
