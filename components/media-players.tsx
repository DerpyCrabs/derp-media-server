'use client'

import { Suspense } from 'react'
import { AudioPlayer } from '@/components/viewers/audio-player'
import { VideoPlayer } from '@/components/viewers/video-player'
import { ImageViewer } from '@/components/viewers/image-viewer'
import { PdfViewer } from '@/components/viewers/pdf-viewer'
import { TextViewer } from '@/components/viewers/text-viewer'
import { UnsupportedFileViewer } from '@/components/viewers/unsupported-file-viewer'

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
