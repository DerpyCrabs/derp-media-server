'use client'

import { Suspense } from 'react'
import { AudioPlayer } from '@/components/audio-player'
import { VideoPlayer } from '@/components/video-player'
import { ImageViewer } from '@/components/image-viewer'
import { PdfViewer } from '@/components/pdf-viewer'
import { TextViewer } from '@/components/text-viewer'
import { UnsupportedFileViewer } from '@/components/unsupported-file-viewer'

interface MediaPlayersProps {
  editableFolders: string[]
}

function MediaPlayersInner({ editableFolders }: MediaPlayersProps) {
  return (
    <>
      <AudioPlayer />
      <VideoPlayer />
      <ImageViewer />
      <PdfViewer />
      <TextViewer editableFolders={editableFolders} />
      <UnsupportedFileViewer />
    </>
  )
}

export function MediaPlayers({ editableFolders }: MediaPlayersProps) {
  return (
    <Suspense fallback={null}>
      <MediaPlayersInner editableFolders={editableFolders} />
    </Suspense>
  )
}
