'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Play, Pause, Volume2, VolumeX, StepBack, StepForward, Repeat } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { FileItem, MediaType } from '@/lib/types'
import { useMediaPlayer } from '@/lib/use-media-player'

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
  const isAudioFile = playingPath && audioExtensions.includes(extension || '')

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
          // Filter only audio files and sort them
          const audioFiles = data.files.filter((file: FileItem) => file.type === MediaType.AUDIO)
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
    if (currentIndex === -1 || currentIndex === audioFiles.length - 1) {
      // Current file not found or it's the last file
      setIsPlaying(false)
      return
    }

    // Navigate to next audio file
    const nextFile = audioFiles[currentIndex + 1]
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

    const currentIndex = audioFiles.findIndex((file) => file.path === playingPath)
    if (currentIndex === -1 || currentIndex === 0) {
      // Current file not found or it's the first file
      return
    }

    // Navigate to previous audio file
    const previousFile = audioFiles[currentIndex - 1]
    const params = new URLSearchParams(searchParams)
    params.set('playing', previousFile.path)
    params.set('dir', currentDir)
    router.replace(`/?${params.toString()}`, { scroll: false })

    // Trigger playback through store
    playFile(previousFile.path, 'audio')
  }, [playingPath, audioFiles, searchParams, currentDir, router, playFile])

  // Setup event listeners
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime)
      // Update Media Session position state
      if ('mediaSession' in navigator && !isNaN(audio.duration)) {
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
    const handlePlay = () => setIsPlaying(true)
    const handlePause = () => setIsPlaying(false)
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
    if (!audio || !playingPath || !isAudioFile) {
      return
    }

    const mediaUrl = `/api/media/${playingPath}`
    const fullUrl = new URL(mediaUrl, window.location.origin).href

    // Only load if the source has changed
    if (audio.src !== fullUrl) {
      // Sync the URL to store if not already synced (without autoplay)
      if (currentFile !== playingPath || mediaType !== 'audio') {
        setCurrentFile(playingPath, 'audio')
      }

      // Load new audio
      audio.src = fullUrl
      audio.load()

      // Set Media Session metadata for mobile controls
      if ('mediaSession' in navigator) {
        const metadata: MediaMetadataInit = {
          title: fileName,
          artist: 'Media Server',
          album: currentDir || 'Root',
        }

        // Add artwork if available
        if (coverArtUrl) {
          const fullArtworkUrl = new URL(coverArtUrl, window.location.origin).href
          metadata.artwork = [
            { src: fullArtworkUrl, sizes: '512x512', type: 'image/jpeg' },
            { src: fullArtworkUrl, sizes: '256x256', type: 'image/jpeg' },
            { src: fullArtworkUrl, sizes: '128x128', type: 'image/jpeg' },
          ]
        }

        navigator.mediaSession.metadata = new MediaMetadata(metadata)

        // Set up action handlers for media controls
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
    fileName,
    currentDir,
    coverArtUrl,
    playPreviousAudio,
    playNextAudio,
    currentFile,
    mediaType,
    setCurrentFile,
  ])

  // React to store isPlaying changes
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !isAudioFile || currentFile !== playingPath || mediaType !== 'audio') return

    if (isPlaying && audio.paused) {
      audio.play().catch((err) => console.error('Play error:', err))
    } else if (!isPlaying && !audio.paused) {
      audio.pause()
    }
  }, [isPlaying, currentFile, playingPath, mediaType, isAudioFile])

  const handleTogglePlayPause = () => {
    if (playingPath) {
      playFile(playingPath, 'audio')
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

  if (!isAudioFile) {
    return null
  }

  return (
    <div className='fixed bottom-0 left-0 right-0 bg-background border-t border-border z-50'>
      <div className='container mx-auto px-4 py-3'>
        <div className='flex items-center gap-4'>
          <audio ref={audioRef} preload='auto' />

          {/* Controls */}
          <div className='flex items-center gap-2'>
            <Button
              variant='ghost'
              size='icon'
              onClick={playPreviousAudio}
              disabled={
                !playingPath ||
                audioFiles.length === 0 ||
                audioFiles.findIndex((f) => f.path === playingPath) <= 0
              }
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
              disabled={
                !playingPath ||
                audioFiles.length === 0 ||
                audioFiles.findIndex((f) => f.path === playingPath) >= audioFiles.length - 1
              }
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
          </div>

          <Separator orientation='vertical' className='h-8' />

          {/* Progress */}
          <div className='flex-1 flex items-center gap-3'>
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

          <Separator orientation='vertical' className='h-8 hidden md:block' />

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

          <Separator orientation='vertical' className='h-8 hidden lg:block' />

          {/* File name */}
          <div className='min-w-[200px] max-w-[300px] truncate text-sm'>{fileName}</div>
        </div>
      </div>
    </div>
  )
}
