import { Suspense } from 'react'
import { AudioPlayer } from '@/components/audio-player'
import { VideoPlayer } from '@/components/video-player'
import { ImageViewer } from '@/components/image-viewer'
import { PdfViewer } from '@/components/pdf-viewer'
import { TextViewer, type ShareInfoForViewer } from '@/components/text-viewer'
import { UnsupportedFileViewer } from '@/components/unsupported-file-viewer'
import type { NavigationSession } from '@/lib/navigation-session'
import type { SourceContext } from '@/lib/source-context'

interface MediaPlayersProps {
  editableFolders: string[]
  session?: NavigationSession
  mediaContext?: SourceContext
  shareContext?: {
    token: string
    shareInfo: ShareInfoForViewer
  }
}

function MediaPlayersInner({
  editableFolders,
  session,
  mediaContext,
  shareContext,
}: MediaPlayersProps) {
  const resolvedMediaContext = mediaContext ?? {
    shareToken: shareContext?.token ?? null,
    sharePath: shareContext?.shareInfo.path ?? null,
  }

  return (
    <>
      <AudioPlayer session={session} mediaContext={resolvedMediaContext} />
      <VideoPlayer session={session} mediaContext={resolvedMediaContext} />
      <ImageViewer session={session} mediaContext={resolvedMediaContext} />
      <PdfViewer session={session} mediaContext={resolvedMediaContext} />
      <TextViewer
        editableFolders={editableFolders}
        session={session}
        mediaContext={resolvedMediaContext}
        shareContext={shareContext}
      />
      <UnsupportedFileViewer session={session} mediaContext={resolvedMediaContext} />
    </>
  )
}

export function MediaPlayers(props: MediaPlayersProps) {
  return (
    <Suspense fallback={null}>
      <MediaPlayersInner {...props} />
    </Suspense>
  )
}
