import { AudioPlayer } from './AudioPlayer'
import { ImageViewerDialog } from './ImageViewerDialog'
import { TextViewerDialog } from './TextViewerDialog'
import { VideoPlayer } from './VideoPlayer'

type Props = {
  shareContext?: { token: string; sharePath: string } | null
}

export function MainMediaPlayers(props: Props) {
  return (
    <>
      <TextViewerDialog shareContext={props.shareContext} />
      <ImageViewerDialog shareContext={props.shareContext} />
      <VideoPlayer shareContext={props.shareContext} />
      <AudioPlayer shareContext={props.shareContext} />
    </>
  )
}
