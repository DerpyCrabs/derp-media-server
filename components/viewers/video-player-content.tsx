'use client'

import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react'

export interface VideoPlayerContentProps {
  src: string
  fileName: string
  initialTime?: number
  onTimeUpdate?: (time: number) => void
  onDurationChange?: (duration: number) => void
  onPlay?: () => void
  onPause?: () => void
  onEnded?: () => void
  isPlaying?: boolean
  maxHeight?: string
  minHeight?: string
  height?: string
  aspectRatio?: string
}

export interface VideoPlayerContentRef {
  getVideoElement: () => HTMLVideoElement | null
}

export const VideoPlayerContent = forwardRef<VideoPlayerContentRef, VideoPlayerContentProps>(
  function VideoPlayerContent(
    {
      src,
      fileName,
      initialTime,
      onTimeUpdate,
      onDurationChange,
      onPlay,
      onPause,
      onEnded,
      isPlaying,
      maxHeight = '70vh',
      minHeight,
      height,
      aspectRatio = '16 / 9',
    },
    ref,
  ) {
    const videoRef = useRef<HTMLVideoElement>(null)
    const isProgrammaticChange = useRef(false)

    useImperativeHandle(ref, () => ({
      getVideoElement: () => videoRef.current,
    }))

    useEffect(() => {
      const video = videoRef.current
      if (!video || !src) return

      const fullUrl = new URL(src, window.location.origin).href
      if (video.src === fullUrl) return

      video.src = src
      video.load()

      if (initialTime && initialTime > 0) {
        const seekToPosition = () => {
          video.currentTime = initialTime
          video.removeEventListener('loadedmetadata', seekToPosition)
        }
        video.addEventListener('loadedmetadata', seekToPosition)
      }

      if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: fileName,
          artist: 'Media Server',
        })
        navigator.mediaSession.setActionHandler('play', () => video.play())
        navigator.mediaSession.setActionHandler('pause', () => video.pause())
        navigator.mediaSession.setActionHandler('seekbackward', (details) => {
          video.currentTime = Math.max(0, video.currentTime - (details.seekOffset || 10))
        })
        navigator.mediaSession.setActionHandler('seekforward', (details) => {
          video.currentTime = Math.min(
            video.duration,
            video.currentTime + (details.seekOffset || 10),
          )
        })
        navigator.mediaSession.setActionHandler('seekto', (details) => {
          if (details.seekTime != null) video.currentTime = details.seekTime
        })
      }
    }, [src, fileName, initialTime])

    useEffect(() => {
      const video = videoRef.current
      if (!video) return

      const handleTimeUpdate = () => onTimeUpdate?.(video.currentTime)
      const handleDuration = () => onDurationChange?.(video.duration)
      const handlePlay = () => {
        if (!isProgrammaticChange.current) onPlay?.()
      }
      const handlePause = () => {
        if (!isProgrammaticChange.current) onPause?.()
      }
      const handleEnded = () => onEnded?.()

      video.addEventListener('timeupdate', handleTimeUpdate)
      video.addEventListener('loadedmetadata', handleDuration)
      video.addEventListener('play', handlePlay)
      video.addEventListener('pause', handlePause)
      video.addEventListener('ended', handleEnded)

      return () => {
        video.removeEventListener('timeupdate', handleTimeUpdate)
        video.removeEventListener('loadedmetadata', handleDuration)
        video.removeEventListener('play', handlePlay)
        video.removeEventListener('pause', handlePause)
        video.removeEventListener('ended', handleEnded)
      }
    }, [onTimeUpdate, onDurationChange, onPlay, onPause, onEnded])

    useEffect(() => {
      const video = videoRef.current
      if (!video || isPlaying === undefined) return

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
    }, [isPlaying])

    return (
      <video
        ref={videoRef}
        controls
        className='w-full bg-black'
        style={{
          maxHeight,
          minHeight,
          height,
          aspectRatio: !height ? aspectRatio : undefined,
        }}
      >
        Your browser does not support the video tag.
      </video>
    )
  },
)
