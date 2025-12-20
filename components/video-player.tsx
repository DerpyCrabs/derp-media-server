'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Minimize2, Maximize2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export function VideoPlayer() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isMinimized, setIsMinimized] = useState(false)

  const playingPath = searchParams.get('playing')
  const shouldAutoPlay = searchParams.get('autoplay') === 'true'
  const currentFile = playingPath || ''
  const fileName = currentFile.split('/').pop() || ''

  // Determine if we should show the player based on file type
  const extension = currentFile.split('.').pop()?.toLowerCase()
  const videoExtensions = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv']
  const isVideoFile = currentFile && videoExtensions.includes(extension || '')

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

  const toggleMinimize = () => {
    setIsMinimized(!isMinimized)
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

  if (!isVideoFile) {
    return null
  }

  return (
    <div className={` ${isMinimized ? 'fixed bottom-20 right-4 w-80 z-40' : 'w-full bg-background'}`}>
      <Card className={`py-0 ${isMinimized ? '' : 'w-full rounded-none border-x-0 border-t-0'}`}>
        <div className='bg-black'>
          <div className='bg-background/90 backdrop-blur-sm border-b border-border p-2 flex items-center justify-between z-10'>
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
  )
}
