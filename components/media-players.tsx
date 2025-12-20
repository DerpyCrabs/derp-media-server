'use client'

import { Suspense } from 'react'
import { AudioPlayer } from '@/components/audio-player'
import { VideoPlayer } from '@/components/video-player'

function MediaPlayersInner() {
  return (
    <>
      <AudioPlayer />
      <VideoPlayer />
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
