'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Play, Pause, Volume2, VolumeX, StepBack, StepForward, Repeat, Monitor } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { FileItem, MediaType } from '@/lib/types'
import { useMediaPlayer } from '@/lib/use-media-player'
import { useAudioMetadata } from '@/lib/use-audio-metadata'

export function AudioPlayer() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const audioRef = useRef<HTMLAudioElement>(null)
  const [audioFiles, setAudioFiles] = useState<FileItem[]>([])
  const [coverArtUrl, setCoverArtUrl] = useState<string | null>(null)
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

  const playingPath = searchParams.get('playing')
  const currentDir = searchParams.get('dir') || ''
  const fileName = (playingPath || '').split('/').pop() || ''

  // Determine if we should show the player based on file type
  const extension = (playingPath || '').split('.').pop()?.toLowerCase()
  const audioExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus']
  const videoExtensions = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv']
  const isAudioFile = playingPath && audioExtensions.includes(extension || '')
  const isVideoFile = playingPath && videoExtensions.includes(extension || '')
  const isAudioOnly = searchParams.get('audioOnly') === 'true'

  // Fetch audio metadata using React Query
  const { data: audioMetadata, isLoading: isLoadingMetadata } = useAudioMetadata(
    playingPath,
    !!isAudioFile,
  )

  // Fetch audio files in the current directory
  useEffect(() => {
    if (!currentDir && !playingPath) return

    // Extract directory from playing path if no dir param
    let dirToFetch = currentDir
    if (!dirToFetch && playingPath) {
      const pathParts = playingPath.split(/[/\\]/)
      pathParts.pop() // Remove filename
      dirToFetch = pathParts.join('/')
    }

    const fetchFiles = async () => {
      try {
        const response = await fetch(`/api/files?dir=${encodeURIComponent(dirToFetch)}`)
        const data = await response.json()
        if (data.files) {
          // Filter audio and video files (videos can be played audio-only)
          const audioFiles = data.files.filter(
            (file: FileItem) => file.type === MediaType.AUDIO || file.type === MediaType.VIDEO,
          )
          setAudioFiles(audioFiles)

          // Look for cover art in the same directory
          const coverFile = data.files.find((file: FileItem) => {
            if (file.type !== MediaType.IMAGE) return false
            const name = file.name.toLowerCase()
            const nameWithoutExt = name.substring(0, name.lastIndexOf('.'))
            return nameWithoutExt === 'cover'
          })

          if (coverFile) {
            setCoverArtUrl(`/api/media/${coverFile.path}`)
          } else {
            setCoverArtUrl(null)
          }
        }
      } catch (error) {
        console.error('Error fetching files:', error)
      }
    }

    fetchFiles()
  }, [currentDir, playingPath])

  // Function to play next audio file
  const playNextAudio = useCallback(() => {
    if (!playingPath || audioFiles.length === 0) return

    const currentIndex = audioFiles.findIndex((file) => file.path === playingPath)
    if (currentIndex === -1) {
      // Current file not found
      setIsPlaying(false)
      return
    }

    // Find the next audio-only file (skip video files)
    let nextFile = null
    for (let i = currentIndex + 1; i < audioFiles.length; i++) {
      if (audioFiles[i].type === MediaType.AUDIO) {
        nextFile = audioFiles[i]
        break
      }
    }

    if (!nextFile) {
      // No more audio files to play
      setIsPlaying(false)
      return
    }

    // Navigate to next audio file
    const params = new URLSearchParams(searchParams)
    params.set('playing', nextFile.path)
    params.set('dir', currentDir)
    router.replace(`/?${params.toString()}`, { scroll: false })

    // Trigger playback through store
    playFile(nextFile.path, 'audio')
  }, [playingPath, audioFiles, searchParams, currentDir, router, setIsPlaying, playFile])

  // Function to play previous audio file
  const playPreviousAudio = useCallback(() => {
    if (!playingPath || audioFiles.length === 0) return

    const audio = audioRef.current

    // If current time is more than 20 seconds, restart the current file
    if (audio && currentTime > 20) {
      audio.currentTime = 0
      return
    }

    const currentIndex = audioFiles.findIndex((file) => file.path === playingPath)
    if (currentIndex === -1) {
      // Current file not found
      return
    }

    // Find the previous audio-only file (skip video files)
    let previousFile = null
    for (let i = currentIndex - 1; i >= 0; i--) {
      if (audioFiles[i].type === MediaType.AUDIO) {
        previousFile = audioFiles[i]
        break
      }
    }

    if (!previousFile) {
      // No previous audio files
      return
    }

    // Navigate to previous audio file
    const params = new URLSearchParams(searchParams)
    params.set('playing', previousFile.path)
    params.set('dir', currentDir)
    router.replace(`/?${params.toString()}`, { scroll: false })

    // Trigger playback through store
    playFile(previousFile.path, 'audio')
  }, [playingPath, audioFiles, searchParams, currentDir, router, playFile, currentTime])

  // Setup event listeners
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime)
      // Update Media Session position state only when playing
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
      // Update Media Session position state when metadata loads
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
      // Update Media Session playback state
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'playing'
      }
    }
    const handlePause = () => {
      setIsPlaying(false)
      // Update Media Session playback state and lock position
      if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = 'paused'
        // Update position state one more time to lock the current position
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
      if (isRepeat) {
        audio.currentTime = 0
        audio.play()
      } else {
        // Play next audio file if available
        playNextAudio()
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
  }, [isRepeat, playNextAudio, setIsPlaying, setCurrentTime, setDuration])

  // Load audio when URL changes
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !playingPath || (!isAudioFile && !isVideoFile)) {
      return
    }

    // Use extract API for video files, regular media API for audio files
    const mediaUrl = isVideoFile ? `/api/audio/extract/${playingPath}` : `/api/media/${playingPath}`
    const fullUrl = new URL(mediaUrl, window.location.origin).href

    // Only load if the source has changed
    if (audio.src !== fullUrl) {
      // Check if we're switching from the same file (e.g., video to audio mode)
      const isSameFile = currentFile === playingPath

      // Sync the URL to store if not already synced (without autoplay)
      if (currentFile !== playingPath || mediaType !== 'audio') {
        setCurrentFile(playingPath, 'audio')
      }

      // Load new audio
      audio.src = fullUrl
      audio.load()

      // Only seek to stored position if switching from video player for the SAME file
      if (currentTime > 0 && isSameFile) {
        const seekToPosition = () => {
          audio.currentTime = currentTime
          audio.removeEventListener('loadedmetadata', seekToPosition)
        }
        audio.addEventListener('loadedmetadata', seekToPosition)
      }

      // Set up action handlers for media controls (only needs to be done once)
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
          playPreviousAudio()
        })
        navigator.mediaSession.setActionHandler('nexttrack', () => {
          playNextAudio()
        })
      }
    }
  }, [
    playingPath,
    isAudioFile,
    isVideoFile,
    playPreviousAudio,
    playNextAudio,
    currentFile,
    mediaType,
    setCurrentFile,
    currentTime,
  ])

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

    // Prefer embedded cover art, fallback to directory cover
    const artworkUrl = audioMetadata?.coverArt || coverArtUrl
    if (artworkUrl) {
      // If it's a base64 data URL, use it directly; otherwise create full URL
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
      // Save current playback position
      setCurrentTime(audio.currentTime)

      // Update media type to video so video player takes over
      setCurrentFile(playingPath, 'video')

      // Remove audioOnly parameter to show video player
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

  // Helper functions to check if there are previous/next audio files
  const hasPreviousAudio = useCallback(() => {
    if (!playingPath || audioFiles.length === 0) return false
    const currentIndex = audioFiles.findIndex((file) => file.path === playingPath)
    if (currentIndex === -1) return false

    // Check if there's any audio file before the current index
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

    // Check if there's any audio file after the current index
    for (let i = currentIndex + 1; i < audioFiles.length; i++) {
      if (audioFiles[i].type === MediaType.AUDIO) {
        return true
      }
    }
    return false
  }, [playingPath, audioFiles])

  // Show player for audio files, or video files in audio-only mode
  if (!isAudioFile && !(isVideoFile && isAudioOnly)) {
    return null
  }

  return (
    <div className='fixed bottom-0 left-0 right-0 bg-background z-50'>
      {/* Mobile Seekbar - Top Border */}
      <div className='min-[650px]:hidden relative w-full h-1 bg-secondary'>
        {/* Progress indicator */}
        <div
          className='absolute top-0 left-0 h-full bg-white transition-all duration-100'
          style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
        />
        {/* Invisible full-width slider for interaction */}
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

      {/* Border below seekbar on mobile, or at top on desktop */}
      <div className='border-t border-border' />

      <div className='container mx-auto px-4 py-3'>
        <div className='flex items-center gap-4'>
          <audio ref={audioRef} preload='auto' />

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
            <Button variant='ghost' size='icon' onClick={playNextAudio} disabled={!hasNextAudio()}>
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
            {/* Cover Art Thumbnail - Always reserve space */}
            <div className='shrink-0 w-12 h-12 rounded overflow-hidden bg-secondary'>
              {(audioMetadata?.coverArt || coverArtUrl) && (
                <img
                  src={audioMetadata?.coverArt || coverArtUrl || ''}
                  alt='Album art'
                  className='w-full h-full object-cover'
                />
              )}
            </div>

            {/* Track Info */}
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
  )
}
