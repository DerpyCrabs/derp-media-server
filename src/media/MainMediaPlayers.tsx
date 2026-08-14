import { getMediaTypeFromPath } from '@/lib/media-utils'
import { MediaType, type FileItem } from '@/lib/types'
import { Show, createMemo, lazy } from 'solid-js'
import { adaptFileItemResource } from '@/lib/domain/file-item-resource'
import { openResource } from '../features/open/open-resource'
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
  const history = useBrowserHistory()
  const params = createUrlSearchParamsMemo(history)
  const viewingPlanReady = createMemo(() => {
    const path = params().get('viewing')
    if (!path) return true
    const type = getMediaTypeFromPath(path)
    const file: FileItem = {
      path,
      name: path.split(/[/\\]/).at(-1) || path,
      type,
      size: 0,
      extension: path.toLowerCase().endsWith('.fb2.zip')
        ? 'fb2.zip'
        : (path.split('.').at(-1) ?? ''),
      isDirectory: false,
    }
    return (
      openResource(adaptFileItemResource(file).resource, 'view', {
        surface: 'library',
        disposition: type === MediaType.PDF || type === MediaType.BOOK ? 'fullscreen' : 'modal',
      }).status === 'ready'
    )
  })

  return (
    <>
      <Show when={viewingPlanReady()}>
        <TextViewerDialog
          editableFolders={props.editableFolders}
          knowledgeBases={props.knowledgeBases}
        />
        <ImageViewerDialog />
        <LazyDocumentReader />
        <UnsupportedFileViewerDialog />
      </Show>
      <VideoPlayer />
      <AudioPlayer />
    </>
  )
}
