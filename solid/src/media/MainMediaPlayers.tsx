import { AudioPlayer } from './AudioPlayer'
import { ImageViewerDialog } from './ImageViewerDialog'
import { PdfViewerDialog } from './PdfViewerDialog'
import { TextViewerDialog, type TextViewerShareContext } from './TextViewerDialog'
import { VideoPlayer } from './VideoPlayer'

type Props = {
  shareContext?: TextViewerShareContext | null
  editableFolders?: string[]
  shareCanEdit?: boolean
}

export function MainMediaPlayers(props: Props) {
  return (
    <>
      <TextViewerDialog
        shareContext={props.shareContext}
        editableFolders={props.editableFolders}
        shareCanEdit={props.shareCanEdit}
      />
      <ImageViewerDialog shareContext={props.shareContext} />
      <PdfViewerDialog shareContext={props.shareContext} />
      <VideoPlayer shareContext={props.shareContext} />
      <AudioPlayer shareContext={props.shareContext} />
    </>
  )
}
