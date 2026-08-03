import { getMediaType } from '@/lib/media-utils'
import { MediaType } from '@/lib/types'
import { Show, lazy } from 'solid-js'
import { createUrlSearchParamsMemo, useBrowserHistory } from '../browser-history'
import { AudioPlayer } from './AudioPlayer'
import { ImageViewerDialog } from './ImageViewerDialog'
import { TextViewerDialog, type TextViewerShareContext } from './TextViewerDialog'
import { UnsupportedFileViewerDialog } from './UnsupportedFileViewerDialog'
import { VideoPlayer } from './VideoPlayer'

const PdfViewerDialog = lazy(() =>
  import('./PdfViewerDialog').then((module) => ({ default: module.PdfViewerDialog })),
)

type Props = {
  shareContext?: TextViewerShareContext | null
  editableFolders?: string[]
  knowledgeBases?: string[]
  shareCanEdit?: boolean
  shareCanUpload?: boolean
}

function LazyPdfViewerDialog(props: Pick<Props, 'shareContext'>) {
  const history = useBrowserHistory()
  const params = createUrlSearchParamsMemo(history)
  const isPdf = () => {
    const viewingPath = params().get('viewing') ?? ''
    return getMediaType(viewingPath.split('.').pop()?.toLowerCase() ?? '') === MediaType.PDF
  }

  return (
    <Show when={isPdf()}>
      <PdfViewerDialog shareContext={props.shareContext} />
    </Show>
  )
}

export function MainMediaPlayers(props: Props) {
  return (
    <>
      <TextViewerDialog
        shareContext={props.shareContext}
        editableFolders={props.editableFolders}
        knowledgeBases={props.knowledgeBases}
        shareCanEdit={props.shareCanEdit}
        shareCanUpload={props.shareCanUpload}
      />
      <ImageViewerDialog shareContext={props.shareContext} />
      <LazyPdfViewerDialog shareContext={props.shareContext} />
      <VideoPlayer shareContext={props.shareContext} />
      <AudioPlayer shareContext={props.shareContext} />
      <UnsupportedFileViewerDialog shareContext={props.shareContext} />
    </>
  )
}
