'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Minimize2, Maximize2, X, ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useMediaPlayer } from '@/lib/use-media-player'
import {
  useVideoPlayerPosition,
  validatePosition,
  getDefaultPosition,
} from '@/lib/use-video-player-position'

interface Position {
  x: number
  y: number
}

export function VideoPlayer() {
  const searchParams = useSearchParams()
  const videoRef = useRef<HTMLVideoElement>(null)
  const playerRef = useRef<HTMLDivElement>(null)
  const [isMinimized, setIsMinimized] = useState(false)
  const [showScrollToTop, setShowScrollToTop] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const dragOffset = useRef<Position>({ x: 0, y: 0 })
  const isProgrammaticChange = useRef(false)

  const { position, setPosition } = useVideoPlayerPosition()

  const {
    currentFile,
    mediaType,
    isPlaying,
    setCurrentFile,
    setIsPlaying,
    setCurrentTime,
    setDuration,
  } = useMediaPlayer()

  const playingPath = searchParams.get('playing')
  const fileName = (playingPath || '').split('/').pop() || ''

  // Determine if we should show the player based on file type
  const extension = (playingPath || '').split('.').pop()?.toLowerCase()
  const videoExtensions = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv']
  const isVideoFile = playingPath && videoExtensions.includes(extension || '')

  // Handle drag start
  const handleDragStart = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isMinimized) return

    // Only start drag if clicking on the header area (not on buttons or video controls)
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('video')) {
      return
    }

    setIsDragging(true)
    const rect = playerRef.current?.getBoundingClientRect()
    if (rect) {
      dragOffset.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      }
    }
  }

  // Handle drag move
  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const newX = e.clientX - dragOffset.current.x
      const newY = e.clientY - dragOffset.current.y

      // Constrain to viewport
      const maxX = window.innerWidth - (playerRef.current?.offsetWidth || 320)
      const maxY = window.innerHeight - (playerRef.current?.offsetHeight || 300)

      const constrainedX = Math.max(0, Math.min(newX, maxX))
      const constrainedY = Math.max(0, Math.min(newY, maxY))

      // Update position in Zustand store (automatically persists to localStorage)
      setPosition({ x: constrainedX, y: constrainedY })
    }

    const handleMouseUp = () => {
      setIsDragging(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, setPosition])

  // Load video source when playingPath changes
  useEffect(() => {
    const video = videoRef.current
    if (!video || !playingPath || !isVideoFile) {
      return
    }

    // Update video source
    const mediaUrl = `/api/media/${playingPath}`
    const fullUrl = new URL(mediaUrl, window.location.origin).href

    // Only load if the source has changed
    if (video.src !== fullUrl) {
      // Sync the URL to store if not already synced (without autoplay)
      if (currentFile !== playingPath || mediaType !== 'video') {
        setCurrentFile(playingPath, 'video')
      }

      video.src = mediaUrl
      video.load()

      // Set Media Session metadata for mobile controls
      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: fileName,
          artist: 'Media Server',
        })

        // Set up action handlers for media controls
        navigator.mediaSession.setActionHandler('play', () => {
          video.play()
        })
        navigator.mediaSession.setActionHandler('pause', () => {
          video.pause()
        })
        navigator.mediaSession.setActionHandler('seekbackward', (details) => {
          const skipTime = details.seekOffset || 10
          video.currentTime = Math.max(0, video.currentTime - skipTime)
        })
        navigator.mediaSession.setActionHandler('seekforward', (details) => {
          const skipTime = details.seekOffset || 10
          video.currentTime = Math.min(video.duration, video.currentTime + skipTime)
        })
        navigator.mediaSession.setActionHandler('seekto', (details) => {
          if (details.seekTime !== null && details.seekTime !== undefined) {
            video.currentTime = details.seekTime
          }
        })
      }
    }
  }, [playingPath, isVideoFile, fileName, currentFile, mediaType, setCurrentFile])

  // Update Media Session position state and sync with store
  useEffect(() => {
    const video = videoRef.current
    if (!video || !isVideoFile) {
      return
    }

    const updatePositionState = () => {
      setCurrentTime(video.currentTime)
      if ('mediaSession' in navigator && !isNaN(video.duration)) {
        navigator.mediaSession.setPositionState({
          duration: video.duration,
          playbackRate: video.playbackRate,
          position: video.currentTime,
        })
      }
    }

    const handleLoadedMetadata = () => {
      setDuration(video.duration)
      updatePositionState()
    }

    const handlePlay = () => {
      if (!isProgrammaticChange.current) {
        setIsPlaying(true)
      }
    }
    const handlePause = () => {
      if (!isProgrammaticChange.current) {
        setIsPlaying(false)
      }
    }

    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    video.addEventListener('timeupdate', updatePositionState)
    video.addEventListener('play', handlePlay)
    video.addEventListener('pause', handlePause)

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      video.removeEventListener('timeupdate', updatePositionState)
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('pause', handlePause)
    }
  }, [isVideoFile, setCurrentTime, setDuration, setIsPlaying])

  // React to store isPlaying changes
  useEffect(() => {
    const video = videoRef.current
    if (!video || !isVideoFile || currentFile !== playingPath || mediaType !== 'video') return

    if (isPlaying && video.paused) {
      isProgrammaticChange.current = true
      video
        .play()
        .catch((err) => console.error('Play error:', err))
        .finally(() => {
          isProgrammaticChange.current = false
        })
    } else if (!isPlaying && !video.paused) {
      isProgrammaticChange.current = true
      video.pause()
      isProgrammaticChange.current = false
    }
  }, [isPlaying, currentFile, playingPath, mediaType, isVideoFile])

  // Handle scroll detection for scroll-to-top button
  useEffect(() => {
    const handleScroll = () => {
      // Only show button when video is not minimized and scrolled more than 200px
      if (!isMinimized && window.scrollY > 200) {
        setShowScrollToTop(true)
      } else {
        setShowScrollToTop(false)
      }
    }

    window.addEventListener('scroll', handleScroll)
    // Check initial scroll position
    handleScroll()

    return () => window.removeEventListener('scroll', handleScroll)
  }, [isMinimized])

  const toggleMinimize = () => {
    const newMinimized = !isMinimized
    setIsMinimized(newMinimized)

    // When minimizing for the first time, ensure position is valid or set default
    if (newMinimized && typeof window !== 'undefined') {
      const validatedPos = validatePosition(position)
      // If position is at origin (0, 0), it's likely uninitialized, set to default
      if (position.x === 0 && position.y === 0) {
        setPosition(getDefaultPosition())
      } else if (validatedPos.x !== position.x || validatedPos.y !== position.y) {
        // Position is out of bounds, constrain it
        setPosition(validatedPos)
      }
    }
  }

  const handleClose = () => {
    const video = videoRef.current
    if (video) {
      video.pause()
    }
    // Navigate to clear the playing parameter
    window.location.href =
      window.location.pathname +
      window.location.search.replace(/[?&]playing=[^&]*/g, '').replace(/^&/, '?')
  }

  const scrollToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (!isVideoFile) {
    return null
  }

  return (
    <>
      <div
        ref={playerRef}
        className={` ${isMinimized ? 'fixed z-40 w-80' : 'w-full bg-background'}`}
        style={
          isMinimized
            ? {
                left: `${position.x}px`,
                top: `${position.y}px`,
              }
            : undefined
        }
      >
        <Card className={`py-0 ${isMinimized ? '' : 'w-full rounded-none border-x-0 border-t-0'}`}>
          <div className='bg-black'>
            <div
              className='bg-background/90 backdrop-blur-sm border-b border-border p-2 flex items-center justify-between z-10'
              onMouseDown={handleDragStart}
              style={{ cursor: isMinimized ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
            >
              <span className='text-sm font-medium truncate flex-1 px-2'>{fileName}</span>
              <div className='flex items-center gap-1'>
                <Button variant='ghost' size='icon' onClick={toggleMinimize} className='h-8 w-8'>
                  {isMinimized ? (
                    <Maximize2 className='h-4 w-4' />
                  ) : (
                    <Minimize2 className='h-4 w-4' />
                  )}
                </Button>
                <Button variant='ghost' size='icon' onClick={handleClose} className='h-8 w-8'>
                  <X className='h-4 w-4' />
                </Button>
              </div>
            </div>
            <video
              ref={videoRef}
              controls
              className='w-full bg-black'
              style={{
                maxHeight: isMinimized ? '180px' : '70vh',
                minHeight: isMinimized ? '180px' : undefined,
                height: isMinimized ? '180px' : undefined,
                aspectRatio: isMinimized ? undefined : '16 / 9',
              }}
            >
              Your browser does not support the video tag.
            </video>
          </div>
        </Card>
      </div>

      {/* Scroll to top button - only show on large screens, when not minimized and scrolled down */}
      {showScrollToTop && !isMinimized && (
        <Button
          variant='default'
          size='icon'
          onClick={scrollToTop}
          className='flex fixed bottom-4 right-4 lg:bottom-8 lg:right-8 z-50 h-10 w-10 rounded-full shadow-lg'
          aria-label='Scroll to top'
        >
          <ArrowUp className='h-4 w-4' />
        </Button>
      )}
    </>
  )
}
