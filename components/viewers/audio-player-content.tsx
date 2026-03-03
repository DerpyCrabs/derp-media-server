'use client'

import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react'

export interface AudioPlayerContentProps {
  src: string
  onTimeUpdate?: (time: number) => void
  onDurationChange?: (duration: number) => void
  onPlay?: () => void
  onPause?: () => void
  onEnded?: () => void
  onError?: () => void
  isPlaying?: boolean
}

export interface AudioPlayerContentRef {
  getAudioElement: () => HTMLAudioElement | null
}

export const AudioPlayerContent = forwardRef<AudioPlayerContentRef, AudioPlayerContentProps>(
  function AudioPlayerContent(
    { src, onTimeUpdate, onDurationChange, onPlay, onPause, onEnded, onError, isPlaying },
    ref,
  ) {
    const audioRef = useRef<HTMLAudioElement>(null)

    useImperativeHandle(ref, () => ({
      getAudioElement: () => audioRef.current,
    }))

    useEffect(() => {
      const audio = audioRef.current
      if (!audio) return

      const handleTimeUpdate = () => {
        onTimeUpdate?.(audio.currentTime)
        if ('mediaSession' in navigator && !isNaN(audio.duration) && !audio.paused) {
          navigator.mediaSession.setPositionState({
            duration: audio.duration,
            playbackRate: audio.playbackRate,
            position: audio.currentTime,
          })
        }
      }
      const handleDurationChange = () => onDurationChange?.(audio.duration)
      const handleLoadedMetadata = () => {
        onDurationChange?.(audio.duration)
        if ('mediaSession' in navigator && !isNaN(audio.duration)) {
          navigator.mediaSession.setPositionState({
            duration: audio.duration,
            playbackRate: audio.playbackRate,
            position: audio.currentTime,
          })
        }
      }
      const handlePlay = () => {
        onPlay?.()
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing'
      }
      const handlePause = () => {
        onPause?.()
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
      const handleEnded = () => onEnded?.()
      const handleError = () => onError?.()

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
    }, [onTimeUpdate, onDurationChange, onPlay, onPause, onEnded, onError])

    useEffect(() => {
      const audio = audioRef.current
      if (!audio || isPlaying === undefined) return

      if (isPlaying && audio.paused) {
        audio.play().catch((err) => console.error('Play error:', err))
      } else if (!isPlaying && !audio.paused) {
        audio.pause()
      }
    }, [isPlaying])

    return <audio ref={audioRef} preload='auto' className='hidden' />
  },
)
