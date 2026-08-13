import { getMediaTypeFromPath } from '@/lib/media-utils'
import { MediaType } from '@/lib/types'
import { Show, lazy } from 'solid-js'
import { createUrlSearchParamsMemo, useBrowserHistory } from '../browser-history'
import { AudioPlayer } from './AudioPlayer'
import { ImageViewerDialog } from './ImageViewerDialog'
import { TextViewerDialog, type TextViewerShareContext } from './TextViewerDialog'
import { UnsupportedFileViewerDialog } from './UnsupportedFileViewerDialog'
import { VideoPlayer } from './VideoPlayer'
import { closeViewer } from '../lib/url-state-actions'

const ReaderDialog = lazy(() =>
  import('../reader/ReaderDialog').then((module) => ({ default: module.ReaderDialog })),
)

type Props = {
  shareContext?: TextViewerShareContext | null
  editableFolders?: string[]
  knowledgeBases?: string[]
  shareCanEdit?: boolean
  shareCanUpload?: boolean
}

function LazyDocumentReader(props: Pick<Props, 'shareContext'>) {
  const history = useBrowserHistory()
  const params = createUrlSearchParamsMemo(history)
  const viewingPath = () => params().get('viewing') ?? props.shareContext?.sharePath ?? ''
  const mediaType = () => getMediaTypeFromPath(viewingPath())
  const readerKind = (): 'pdf' | 'book' | null =>
    mediaType() === MediaType.PDF ? 'pdf' : mediaType() === MediaType.BOOK ? 'book' : null

  return (
    <Show when={readerKind() && viewingPath()} keyed>
      {(sourcePath) => (
        <ReaderDialog
          sourcePath={sourcePath}
          sourceKind={getMediaTypeFromPath(sourcePath) === MediaType.PDF ? 'pdf' : 'book'}
          shareContext={props.shareContext}
          onClose={closeViewer}
        />
      )}
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
      <LazyDocumentReader shareContext={props.shareContext} />
      <VideoPlayer shareContext={props.shareContext} />
      <AudioPlayer shareContext={props.shareContext} />
      <UnsupportedFileViewerDialog shareContext={props.shareContext} />
    </>
  )
}
