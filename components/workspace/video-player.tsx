import { useEffect, useRef } from 'react'
import { Headphones, MonitorPlay } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useMediaPlayer } from '@/lib/use-media-player'
import { useWorkspaceSessionStore } from '@/lib/workspace-session-store'
import { useMediaUrl } from '@/lib/use-media-url'
import { useNavigationSession } from '@/lib/use-navigation-session'
import { useVideoPlaybackTime } from '@/lib/use-video-playback-time'
import type { NavigationSession } from '@/lib/navigation-session'
import type { SourceContext } from '@/lib/source-context'

interface WorkspaceVideoPlayerProps {
  session?: NavigationSession
  mediaContext?: SourceContext
  /** Called when video metadata is loaded so the window can be resized to match aspect ratio. */
  onVideoMetadataLoaded?: (videoWidth: number, videoHeight: number) => void
  /** When set with `workspaceWindowId`, player resizes the workspace window via the session store (stable, no parent callback). */
  workspaceStorageKey?: string
  workspaceWindowId?: string
}

const VIDEO_EXTENSIONS = new Set(['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv', 'm4v'])

function isVideoPath(path: string | null) {
  const extension = path?.split('.').pop()?.toLowerCase()
  return extension ? VIDEO_EXTENSIONS.has(extension) : false
}

export function VideoPlayer({
  session: sessionProp,
  mediaContext,
  onVideoMetadataLoaded,
  workspaceStorageKey,
  workspaceWindowId,
}: WorkspaceVideoPlayerProps = {}) {
  const session = useNavigationSession(sessionProp)
  const { state, setAudioOnly } = session
  const videoRef = useRef<HTMLVideoElement>(null)
  const isProgrammaticChange = useRef(false)
  const { getSavedTime, saveTime } = useVideoPlaybackTime()
  const { getMediaUrl } = useMediaUrl(mediaContext)

  const {
    currentFile,
    mediaType,
    isPlaying,
    currentTime,
    volume,
    isMuted,
    setCurrentFile,
    setCurrentTime,
    setDuration,
    setIsPlaying,
  } = useMediaPlayer()

  const playingPath = state.playing
  const audioOnly = state.audioOnly
  const fileName = (playingPath || '').split('/').pop() || 'Video Player'
  const shouldShowVideo = isVideoPath(playingPath)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !playingPath || !shouldShowVideo || audioOnly) {
      return
    }

    const mediaUrl = getMediaUrl(playingPath)
    const fullUrl = new URL(mediaUrl, window.location.origin).href
    if (video.src !== fullUrl) {
      if (currentFile !== playingPath || mediaType !== 'video') {
        setCurrentFile(playingPath, 'video')
      }

      video.src = mediaUrl
      video.load()

      const savedTime = getSavedTime(playingPath)
      const timeToRestore = currentTime > 0 ? currentTime : (savedTime ?? 0)
      if (timeToRestore > 0) {
        const seekToPosition = () => {
          video.currentTime = timeToRestore
          video.removeEventListener('loadedmetadata', seekToPosition)
        }
        video.addEventListener('loadedmetadata', seekToPosition)
      }
    }
  }, [
    audioOnly,
    currentFile,
    currentTime,
    getMediaUrl,
    getSavedTime,
    mediaType,
    playingPath,
    setCurrentFile,
    shouldShowVideo,
  ])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !playingPath || !shouldShowVideo) {
      return
    }

    const updatePositionState = () => {
      setCurrentTime(video.currentTime)
      if (!isNaN(video.duration) && video.duration > 0) {
        saveTime(playingPath, video.currentTime, video.duration)
      }
    }

    const handleLoadedMetadata = () => {
      setDuration(video.duration)
      updatePositionState()
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        if (workspaceStorageKey && workspaceWindowId) {
          useWorkspaceSessionStore
            .getState()
            .resizePlayerWindowForVideo(
              workspaceStorageKey,
              workspaceWindowId,
              video.videoWidth,
              video.videoHeight,
            )
        } else {
          onVideoMetadataLoaded?.(video.videoWidth, video.videoHeight)
        }
      }
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

    const handleEnded = () => {
      setIsPlaying(false)
    }

    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    video.addEventListener('timeupdate', updatePositionState)
    video.addEventListener('play', handlePlay)
    video.addEventListener('pause', handlePause)
    video.addEventListener('ended', handleEnded)

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      video.removeEventListener('timeupdate', updatePositionState)
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('pause', handlePause)
      video.removeEventListener('ended', handleEnded)
    }
  }, [
    onVideoMetadataLoaded,
    playingPath,
    saveTime,
    setCurrentTime,
    setDuration,
    setIsPlaying,
    shouldShowVideo,
    workspaceStorageKey,
    workspaceWindowId,
  ])

  useEffect(() => {
    const video = videoRef.current
    if (
      !video ||
      !shouldShowVideo ||
      audioOnly ||
      currentFile !== playingPath ||
      mediaType !== 'video'
    ) {
      return
    }

    if (isPlaying && video.paused) {
      isProgrammaticChange.current = true
      void video.play().finally(() => {
        isProgrammaticChange.current = false
      })
    } else if (!isPlaying && !video.paused) {
      isProgrammaticChange.current = true
      video.pause()
      isProgrammaticChange.current = false
    }
  }, [audioOnly, currentFile, isPlaying, mediaType, playingPath, shouldShowVideo])

  useEffect(() => {
    const video = videoRef.current
    if (
      !video ||
      !shouldShowVideo ||
      audioOnly ||
      currentFile !== playingPath ||
      mediaType !== 'video'
    ) {
      return
    }

    // Allow taskbar controls to seek the active video without fighting normal timeupdate sync.
    if (Math.abs(video.currentTime - currentTime) > 0.75) {
      video.currentTime = currentTime
    }
  }, [audioOnly, currentFile, currentTime, mediaType, playingPath, shouldShowVideo])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !shouldShowVideo || audioOnly) {
      return
    }

    video.muted = isMuted
    video.volume = isMuted ? 0 : volume
  }, [audioOnly, isMuted, shouldShowVideo, volume])

  if (!playingPath || !shouldShowVideo) {
    return (
      <div className='flex h-full items-center justify-center bg-muted/20 p-6 text-center'>
        <div className='space-y-3'>
          <div className='mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted'>
            <MonitorPlay className='h-6 w-6 text-muted-foreground' />
          </div>
          <div className='text-sm font-medium'>No video is playing</div>
          <div className='text-sm text-muted-foreground'>
            Start a video from any browser window to open it here.
          </div>
        </div>
      </div>
    )
  }

  if (audioOnly) {
    return (
      <div className='flex h-full items-center justify-center bg-muted/20 p-6 text-center'>
        <div className='space-y-3'>
          <div className='mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted'>
            <Headphones className='h-6 w-6 text-muted-foreground' />
          </div>
          <div className='text-sm font-medium'>{fileName} is playing in audio mode</div>
          <div className='text-sm text-muted-foreground'>
            Restore video playback from the taskbar audio controls or here.
          </div>
          <div>
            <Button variant='outline' onClick={() => setAudioOnly(false)}>
              <MonitorPlay className='h-4 w-4' />
              Show video
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className='group relative h-full w-full bg-black'>
      <div className='absolute top-2 right-2 z-10 opacity-0 transition-opacity group-hover:opacity-100'>
        <Button
          variant='secondary'
          size='icon'
          className='h-7 w-7'
          onClick={() => setAudioOnly(true)}
          title='Listen only'
        >
          <Headphones className='h-4 w-4' />
        </Button>
      </div>
      <video ref={videoRef} controls className='h-full w-full bg-black object-contain'>
        Your browser does not support the video tag.
      </video>
    </div>
  )
}
