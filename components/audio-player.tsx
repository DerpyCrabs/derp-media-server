'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Play, Pause, Volume2, VolumeX, SkipBack, SkipForward, Repeat } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { FileItem, MediaType } from '@/lib/types'

export function AudioPlayer() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(1)
  const [isMuted, setIsMuted] = useState(false)
  const [isRepeat, setIsRepeat] = useState(false)
  const [audioFiles, setAudioFiles] = useState<FileItem[]>([])

  const playingPath = searchParams.get('playing')
  const currentDir = searchParams.get('dir') || ''
  const shouldAutoPlay = searchParams.get('autoplay') === 'true'
  const currentFile = playingPath || ''
  const fileName = currentFile.split('/').pop() || ''

  // Determine if we should show the player based on file type
  const extension = currentFile.split('.').pop()?.toLowerCase()
  const audioExtensions = ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'opus']
  const isAudioFile = currentFile && audioExtensions.includes(extension || '')

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
        }
      } catch (error) {
        console.error('Error fetching files:', error)
      }
    }

    fetchFiles()
  }, [currentDir, playingPath])

  // Function to play next audio file
  const playNextAudio = () => {
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
    params.set('autoplay', 'true')
    router.push(`/?${params.toString()}`, { scroll: false })
  }

  // Setup event listeners once
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime)
    const handleDurationChange = () => setDuration(audio.duration)
    const handleLoadedMetadata = () => setDuration(audio.duration)
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
  }, [isRepeat, audioFiles, playingPath, currentDir, router, searchParams])

  // Load audio when path changes, auto-play based on autoplay param
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !playingPath || !isAudioFile) {
      return
    }

    const mediaUrl = `/api/media/${playingPath}`
    const fullUrl = new URL(mediaUrl, window.location.origin).href

    if (audio.src !== fullUrl) {
      // Reset state when loading new audio
      setIsPlaying(false)
      setCurrentTime(0)
      setDuration(0)

      audio.src = fullUrl
      audio.load()

      // Auto-play if the autoplay param is set
      if (shouldAutoPlay) {
        const playHandler = () => {
          const playPromise = audio.play()
          if (playPromise !== undefined) {
            playPromise.catch((error) => {
              console.error('Error auto-playing audio:', error)
            })
          }
        }
        audio.addEventListener('canplaythrough', playHandler, { once: true })

        // Remove autoplay param from URL after attempting to play
        const params = new URLSearchParams(searchParams)
        params.delete('autoplay')
        router.replace(`/?${params.toString()}`, { scroll: false })
      }
    }
  }, [playingPath, isAudioFile, shouldAutoPlay, searchParams, router])

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return

    if (audio.paused) {
      audio.play().catch((err) => console.error('Play error:', err))
    } else {
      audio.pause()
    }
  }

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current
    if (!audio) return

    const time = parseFloat(e.target.value)
    audio.currentTime = time
    setCurrentTime(time)
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
      setIsMuted(false)
    } else {
      audio.volume = 0
      setIsMuted(true)
    }
  }

  const skip = (seconds: number) => {
    const audio = audioRef.current
    if (!audio) return

    audio.currentTime = Math.max(0, Math.min(duration, audio.currentTime + seconds))
  }

  const toggleRepeat = () => {
    setIsRepeat(!isRepeat)
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
            <Button variant='ghost' size='icon' onClick={() => skip(-10)} disabled={!currentFile}>
              <SkipBack className='h-4 w-4' />
            </Button>
            <Button variant='default' size='icon' onClick={togglePlay} disabled={!currentFile}>
              {isPlaying ? <Pause className='h-4 w-4' /> : <Play className='h-4 w-4' />}
            </Button>
            <Button variant='ghost' size='icon' onClick={() => skip(10)} disabled={!currentFile}>
              <SkipForward className='h-4 w-4' />
            </Button>
            <Button variant={isRepeat ? 'default' : 'ghost'} size='icon' onClick={toggleRepeat} disabled={!currentFile}>
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
              disabled={!currentFile}
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
