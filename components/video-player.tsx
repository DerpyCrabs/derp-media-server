'use client'

import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Minimize2, Maximize2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export function VideoPlayer() {
  const searchParams = useSearchParams()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [isMinimized, setIsMinimized] = useState(false)

  const playingPath = searchParams.get('playing')
  const currentFile = playingPath || ''
  const fileName = currentFile.split('/').pop() || ''

  // Determine if we should show the player based on file type
  const extension = currentFile.split('.').pop()?.toLowerCase()
  const videoExtensions = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv']
  const isVideoFile = currentFile && videoExtensions.includes(extension || '')

  // Load video source when playingPath changes
  useEffect(() => {
    const video = videoRef.current
    if (!video || !playingPath || !isVideoFile) {
      return
    }

    // Update video source
    const mediaUrl = `/api/media/${playingPath}`
    if (video.src !== window.location.origin + mediaUrl) {
      video.src = mediaUrl
      video.load()
    }
  }, [playingPath, isVideoFile])

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

  const handlePictureInPicture = async () => {
    const video = videoRef.current
    if (!video) return

    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture()
      } else {
        await video.requestPictureInPicture()
      }
    } catch (error) {
      console.error('Picture-in-picture error:', error)
    }
  }

  if (!isVideoFile) {
    return null
  }

  return (
    <Card
      className={`fixed z-40 transition-all duration-300 ${
        isMinimized ? 'bottom-20 right-4 w-80' : 'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-4xl'
      }`}
    >
      <div className='relative'>
        {/* Controls Bar */}
        <div className='absolute top-0 left-0 right-0 bg-background/90 backdrop-blur-sm border-b border-border p-2 flex items-center justify-between z-10'>
          <span className='text-sm font-medium truncate flex-1 px-2'>{fileName}</span>
          <div className='flex items-center gap-1'>
            <Button variant='ghost' size='icon' onClick={handlePictureInPicture} className='h-8 w-8'>
              <Maximize2 className='h-4 w-4' />
            </Button>
            <Button variant='ghost' size='icon' onClick={toggleMinimize} className='h-8 w-8'>
              {isMinimized ? <Maximize2 className='h-4 w-4' /> : <Minimize2 className='h-4 w-4' />}
            </Button>
            <Button variant='ghost' size='icon' onClick={handleClose} className='h-8 w-8'>
              <X className='h-4 w-4' />
            </Button>
          </div>
        </div>

        {/* Video Element */}
        <video
          ref={videoRef}
          controls
          autoPlay
          className={`w-full bg-black ${isMinimized ? 'aspect-video' : ''}`}
          style={{ maxHeight: isMinimized ? '180px' : '80vh' }}
        >
          Your browser does not support the video tag.
        </video>
      </div>
    </Card>
  )
}
