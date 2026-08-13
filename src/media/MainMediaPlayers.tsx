import { getMediaTypeFromPath } from '@/lib/media-utils'
import { MediaType } from '@/lib/types'
import { Show, lazy } from 'solid-js'
import { createUrlSearchParamsMemo, useBrowserHistory } from '../browser-history'
import { AudioPlayer } from './AudioPlayer'
import { ImageViewerDialog } from './ImageViewerDialog'
import { TextViewerDialog } from './TextViewerDialog'
import { UnsupportedFileViewerDialog } from './UnsupportedFileViewerDialog'
import { VideoPlayer } from './VideoPlayer'
import { closeViewer } from '../lib/url-state-actions'

const ReaderDialog = lazy(() =>
  import('../reader/ReaderDialog').then((module) => ({ default: module.ReaderDialog })),
)

type Props = {
  editableFolders?: string[]
  knowledgeBases?: string[]
}

function LazyDocumentReader() {
  const history = useBrowserHistory()
  const params = createUrlSearchParamsMemo(history)
  const viewingPath = () => params().get('viewing') ?? ''
  const mediaType = () => getMediaTypeFromPath(viewingPath())
  const readerKind = (): 'pdf' | 'book' | null =>
    mediaType() === MediaType.PDF ? 'pdf' : mediaType() === MediaType.BOOK ? 'book' : null

  return (
    <Show when={readerKind() && viewingPath()} keyed>
      {(sourcePath) => (
        <ReaderDialog
          sourcePath={sourcePath}
          sourceKind={getMediaTypeFromPath(sourcePath) === MediaType.PDF ? 'pdf' : 'book'}
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
        editableFolders={props.editableFolders}
        knowledgeBases={props.knowledgeBases}
      />
      <ImageViewerDialog />
      <LazyDocumentReader />
      <VideoPlayer />
      <AudioPlayer />
      <UnsupportedFileViewerDialog />
    </>
  )
}
