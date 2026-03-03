'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Minimize2, Maximize2, X, ArrowUp, Headphones } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useMediaPlayer } from '@/lib/use-media-player'
import {
  useVideoPlayerPosition,
  validatePosition,
  getDefaultPosition,
} from '@/lib/use-video-player-position'
import { useVideoPlaybackTime } from '@/lib/use-video-playback-time'
import {
  VideoPlayerContent,
  type VideoPlayerContentRef,
} from '@/components/viewers/video-player-content'

interface Position {
  x: number
  y: number
}

export function VideoPlayer() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const playerRef = useRef<HTMLDivElement>(null)
  const videoContentRef = useRef<VideoPlayerContentRef>(null)
  const [isMinimized, setIsMinimized] = useState(false)
  const [showScrollToTop, setShowScrollToTop] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const dragOffset = useRef<Position>({ x: 0, y: 0 })

  const { position, setPosition } = useVideoPlayerPosition()
  const { getSavedTime, saveTime } = useVideoPlaybackTime()

  const {
    currentFile,
    mediaType,
    isPlaying,
    currentTime,
    setCurrentFile,
    setIsPlaying,
    setCurrentTime,
    setDuration,
  } = useMediaPlayer()

  const playingPath = searchParams.get('playing')
  const isAudioOnly = searchParams.get('audioOnly') === 'true'
  const fileName = (playingPath || '').split('/').pop() || ''

  const extension = (playingPath || '').split('.').pop()?.toLowerCase()
  const videoExtensions = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv']
  const isVideoFile = playingPath && videoExtensions.includes(extension || '')

  const handleDragStart = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isMinimized) return
    const target = e.target as HTMLElement
    if (target.closest('button') || target.closest('video')) return

    setIsDragging(true)
    const rect = playerRef.current?.getBoundingClientRect()
    if (rect) {
      dragOffset.current = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }
  }

  useEffect(() => {
    if (!isDragging) return

    const handleMouseMove = (e: MouseEvent) => {
      const newX = e.clientX - dragOffset.current.x
      const newY = e.clientY - dragOffset.current.y
      const maxX = window.innerWidth - (playerRef.current?.offsetWidth || 320)
      const maxY = window.innerHeight - (playerRef.current?.offsetHeight || 300)
      setPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY)),
      })
    }

    const handleMouseUp = () => setIsDragging(false)

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, setPosition])

  // Sync store when playing path changes
  useEffect(() => {
    if (!playingPath || !isVideoFile || isAudioOnly) return
    if (currentFile !== playingPath || mediaType !== 'video') {
      setCurrentFile(playingPath, 'video')
    }
  }, [playingPath, isVideoFile, isAudioOnly, currentFile, mediaType, setCurrentFile])

  const handleTimeUpdate = useCallback(
    (time: number) => {
      setCurrentTime(time)
      const video = videoContentRef.current?.getVideoElement()
      if (playingPath && video && !isNaN(video.duration) && video.duration > 0) {
        saveTime(playingPath, time, video.duration)
      }
    },
    [setCurrentTime, playingPath, saveTime],
  )

  const handlePlay = useCallback(() => setIsPlaying(true), [setIsPlaying])
  const handlePause = useCallback(() => setIsPlaying(false), [setIsPlaying])
  const handleDurationChange = useCallback(
    (duration: number) => setDuration(duration),
    [setDuration],
  )

  useEffect(() => {
    const handleScroll = () => {
      setShowScrollToTop(!isMinimized && window.scrollY > 200)
    }
    window.addEventListener('scroll', handleScroll)
    handleScroll()
    return () => window.removeEventListener('scroll', handleScroll)
  }, [isMinimized])

  const toggleMinimize = () => {
    const newMinimized = !isMinimized
    setIsMinimized(newMinimized)

    if (newMinimized && typeof window !== 'undefined') {
      const validatedPos = validatePosition(position)
      if (position.x === 0 && position.y === 0) {
        setPosition(getDefaultPosition())
      } else if (validatedPos.x !== position.x || validatedPos.y !== position.y) {
        setPosition(validatedPos)
      }
    }
  }

  const handleClose = () => {
    const video = videoContentRef.current?.getVideoElement()
    if (video) video.pause()
    window.location.href =
      window.location.pathname +
      window.location.search.replace(/[?&]playing=[^&]*/g, '').replace(/^&/, '?')
  }

  const handleAudioOnly = () => {
    const video = videoContentRef.current?.getVideoElement()
    if (video && playingPath) {
      setCurrentTime(video.currentTime)
      const params = new URLSearchParams(searchParams)
      params.set('audioOnly', 'true')
      router.replace(`/?${params.toString()}`, { scroll: false })
    }
  }

  if (!isVideoFile || isAudioOnly) return null

  const initialTime = getSavedTime(playingPath!) ?? (currentTime > 0 ? currentTime : 0)

  return (
    <>
      <div
        ref={playerRef}
        className={` ${isMinimized ? 'fixed z-40 w-80' : 'w-full bg-background'}`}
        style={isMinimized ? { left: `${position.x}px`, top: `${position.y}px` } : undefined}
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
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={handleAudioOnly}
                  className='h-8 w-8'
                  aria-label='Audio only mode'
                >
                  <Headphones className='h-4 w-4' />
                </Button>
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
            <VideoPlayerContent
              ref={videoContentRef}
              src={`/api/media/${playingPath}`}
              fileName={fileName}
              initialTime={initialTime}
              onTimeUpdate={handleTimeUpdate}
              onDurationChange={handleDurationChange}
              onPlay={handlePlay}
              onPause={handlePause}
              isPlaying={
                isPlaying && currentFile === playingPath && mediaType === 'video'
                  ? true
                  : !isPlaying && currentFile === playingPath && mediaType === 'video'
                    ? false
                    : undefined
              }
              maxHeight={isMinimized ? '180px' : '70vh'}
              minHeight={isMinimized ? '180px' : undefined}
              height={isMinimized ? '180px' : undefined}
              aspectRatio={isMinimized ? undefined : '16 / 9'}
            />
          </div>
        </Card>
      </div>

      {showScrollToTop && !isMinimized && (
        <Button
          variant='default'
          size='icon'
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          className='flex fixed bottom-4 right-4 lg:bottom-8 lg:right-8 z-50 h-10 w-10 rounded-full shadow-lg'
          aria-label='Scroll to top'
        >
          <ArrowUp className='h-4 w-4' />
        </Button>
      )}
    </>
  )
}
