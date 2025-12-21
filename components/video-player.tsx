'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Minimize2, Maximize2, X, ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

// LocalStorage key for video player position
const PLAYER_POSITION_KEY = 'video-player-position'

interface Position {
  x: number
  y: number
}

// Get saved position from localStorage
function getSavedPosition(): Position | null {
  if (typeof window === 'undefined') return null
  try {
    const saved = localStorage.getItem(PLAYER_POSITION_KEY)
    if (saved) {
      const position = JSON.parse(saved) as Position
      // Validate position is within viewport
      if (
        position.x >= 0 &&
        position.y >= 0 &&
        position.x < window.innerWidth - 100 &&
        position.y < window.innerHeight - 100
      ) {
        return position
      }
    }
  } catch {
    // Silently fail if localStorage is not available
  }
  return null
}

// Save position to localStorage
function savePosition(position: Position) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(PLAYER_POSITION_KEY, JSON.stringify(position))
  } catch {
    // Silently fail if localStorage is not available
  }
}

export function VideoPlayer() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const videoRef = useRef<HTMLVideoElement>(null)
  const playerRef = useRef<HTMLDivElement>(null)
  const [isMinimized, setIsMinimized] = useState(false)
  const [showScrollToTop, setShowScrollToTop] = useState(false)
  // Initialize position with saved value or default
  const [position, setPosition] = useState<Position>(() => {
    if (typeof window !== 'undefined') {
      return getSavedPosition() || { x: 0, y: 0 }
    }
    return { x: 0, y: 0 }
  })
  const [isDragging, setIsDragging] = useState(false)
  const dragOffset = useRef<Position>({ x: 0, y: 0 })

  const playingPath = searchParams.get('playing')
  const shouldAutoPlay = searchParams.get('autoplay') === 'true'
  const currentFile = playingPath || ''
  const fileName = currentFile.split('/').pop() || ''

  // Determine if we should show the player based on file type
  const extension = currentFile.split('.').pop()?.toLowerCase()
  const videoExtensions = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv']
  const isVideoFile = currentFile && videoExtensions.includes(extension || '')

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

      setPosition({ x: constrainedX, y: constrainedY })
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      // Save position when drag ends
      savePosition(position)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragging, position])

  // Load video source when playingPath changes, auto-play based on autoplay param
  useEffect(() => {
    const video = videoRef.current
    if (!video || !playingPath || !isVideoFile) {
      return
    }

    // Update video source
    const mediaUrl = `/api/media/${playingPath}`
    const fullUrl = new URL(mediaUrl, window.location.origin).href

    if (video.src !== fullUrl) {
      video.src = mediaUrl
      video.load()

      // Auto-play if the autoplay param is set
      if (shouldAutoPlay) {
        const playHandler = () => {
          const playPromise = video.play()
          if (playPromise !== undefined) {
            playPromise.catch((error) => {
              console.error('Error auto-playing video:', error)
            })
          }
        }
        video.addEventListener('canplaythrough', playHandler, { once: true })

        // Remove autoplay param from URL after attempting to play
        const params = new URLSearchParams(searchParams)
        params.delete('autoplay')
        router.replace(`/?${params.toString()}`, { scroll: false })
      }
    }
  }, [playingPath, isVideoFile, shouldAutoPlay, searchParams, router])

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

    // When minimizing for the first time without a saved position, center it with offset
    if (newMinimized && typeof window !== 'undefined') {
      const savedPos = getSavedPosition()
      if (!savedPos) {
        // Default position: bottom-right with some padding
        const defaultX = window.innerWidth - 320 - 16 // 320px width + 16px padding
        const defaultY = window.innerHeight - 300 - 80 // approximate height + padding
        const newPos = {
          x: Math.max(0, defaultX),
          y: Math.max(0, defaultY),
        }
        setPosition(newPos)
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
      window.location.pathname + window.location.search.replace(/[?&]playing=[^&]*/g, '').replace(/^&/, '?')
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
                  {isMinimized ? <Maximize2 className='h-4 w-4' /> : <Minimize2 className='h-4 w-4' />}
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
