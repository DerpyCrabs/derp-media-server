import { getMediaTypeFromPath } from '@/lib/media-utils'
import { isViewerId } from '@/lib/resource'
import { MediaType } from '@/lib/types'
import type { FileItem } from '@/lib/types'
import { Show, lazy } from 'solid-js'
import { createUrlSearchParamsMemo, useBrowserHistory } from '../browser-history'
import type { TextViewerShareContext } from './TextViewerDialog'
import { VideoPlayer } from './VideoPlayer'
import { closeViewer } from '../lib/url-state-actions'
import { viewerMediaType, viewerReaderKind } from '../lib/viewer-registry'

const TextViewerDialog = lazy(() =>
  import('./TextViewerDialog').then((module) => ({ default: module.TextViewerDialog })),
)
const ImageViewerDialog = lazy(() =>
  import('./ImageViewerDialog').then((module) => ({ default: module.ImageViewerDialog })),
)
const UnsupportedFileViewerDialog = lazy(() =>
  import('./UnsupportedFileViewerDialog').then((module) => ({
    default: module.UnsupportedFileViewerDialog,
  })),
)
const ReaderDialog = lazy(() =>
  import('../reader/ReaderDialog').then((module) => ({ default: module.ReaderDialog })),
)

type Props = {
  shareContext?: TextViewerShareContext | null
  editableFolders?: string[]
  knowledgeBases?: string[]
  shareCanEdit?: boolean
  shareCanUpload?: boolean
  offline?: boolean
  explorerFiles?: readonly FileItem[]
}

function LazyDocumentReader(props: Pick<Props, 'shareContext' | 'offline'>) {
  const history = useBrowserHistory()
  const params = createUrlSearchParamsMemo(history)
  const viewingPath = () => params().get('viewing') ?? props.shareContext?.sharePath ?? ''
  const viewerId = () => {
    const value = params().get('viewer')
    return isViewerId(value) ? value : null
  }
  const mediaType = () =>
    viewerId() ? viewerMediaType(viewerId()!) : getMediaTypeFromPath(viewingPath())
  const readerKind = (): 'pdf' | 'book' | null =>
    viewerId()
      ? viewerReaderKind(viewerId()!) === 'pdf'
        ? 'pdf'
        : viewerReaderKind(viewerId()!) === 'book'
          ? 'book'
          : null
      : mediaType() === MediaType.PDF
        ? 'pdf'
        : mediaType() === MediaType.BOOK
          ? 'book'
          : null

  return (
    <Show when={readerKind() && viewingPath()} keyed>
      {(sourcePath) => (
        <ReaderDialog
          sourcePath={sourcePath}
          sourceKind={readerKind()!}
          shareContext={props.shareContext}
          offline={props.offline}
          onClose={closeViewer}
        />
      )}
    </Show>
  )
}

export function MainMediaPlayers(props: Props) {
  const history = useBrowserHistory()
  const params = createUrlSearchParamsMemo(history)
  const viewingPath = () => params().get('viewing') ?? props.shareContext?.sharePath ?? ''
  const viewerId = () => {
    const value = params().get('viewer')
    return isViewerId(value) ? value : null
  }
  const viewerType = () =>
    viewingPath()
      ? viewerId()
        ? viewerMediaType(viewerId()!)
        : getMediaTypeFromPath(viewingPath())
      : null

  return (
    <>
      <Show when={viewerType() === MediaType.TEXT}>
        <TextViewerDialog
          shareContext={props.shareContext}
          offline={props.offline}
          editableFolders={props.offline ? [] : props.editableFolders}
          knowledgeBases={props.knowledgeBases}
          shareCanEdit={props.offline ? false : props.shareCanEdit}
          shareCanUpload={props.offline ? false : props.shareCanUpload}
        />
      </Show>
      <Show when={viewerType() === MediaType.IMAGE}>
        <ImageViewerDialog
          shareContext={props.shareContext}
          offline={props.offline}
          explorerFiles={props.explorerFiles}
        />
      </Show>
      <LazyDocumentReader shareContext={props.shareContext} offline={props.offline} />
      <VideoPlayer shareContext={props.shareContext} />
      <Show when={viewerType() === MediaType.OTHER}>
        <UnsupportedFileViewerDialog
          shareContext={props.shareContext}
          offline={props.offline}
          explorerFiles={props.explorerFiles}
        />
      </Show>
    </>
  )
}
