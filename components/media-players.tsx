'use client'

import { Suspense } from 'react'
import { AudioPlayer } from '@/components/audio-player'
import { VideoPlayer } from '@/components/video-player'
import { ImageViewer } from '@/components/image-viewer'

function MediaPlayersInner() {
  return (
    <>
      <AudioPlayer />
      <VideoPlayer />
      <ImageViewer />
    </>
  )
}

export function MediaPlayers() {
  return (
    <Suspense fallback={null}>
      <MediaPlayersInner />
    </Suspense>
  )
}
