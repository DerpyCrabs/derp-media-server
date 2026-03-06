import { Suspense } from 'react'
import { AudioPlayer } from '@/components/audio-player'
import { VideoPlayer } from '@/components/video-player'
import { ImageViewer } from '@/components/image-viewer'
import { PdfViewer } from '@/components/pdf-viewer'
import { TextViewer, type ShareInfoForViewer } from '@/components/text-viewer'
import { UnsupportedFileViewer } from '@/components/unsupported-file-viewer'

interface MediaPlayersProps {
  editableFolders: string[]
  shareContext?: {
    token: string
    shareInfo: ShareInfoForViewer
  }
}

function MediaPlayersInner({ editableFolders, shareContext }: MediaPlayersProps) {
  return (
    <>
      <AudioPlayer />
      <VideoPlayer />
      <ImageViewer />
      <PdfViewer />
      <TextViewer editableFolders={editableFolders} shareContext={shareContext} />
      <UnsupportedFileViewer />
    </>
  )
}

export function MediaPlayers({ editableFolders, shareContext }: MediaPlayersProps) {
  return (
    <Suspense fallback={null}>
      <MediaPlayersInner editableFolders={editableFolders} shareContext={shareContext} />
    </Suspense>
  )
}
