import { modalScroll } from './modal-scroll'
import { available, domBinding, modelOwner, view, controllerView } from 'effectweb'
import { queryCache } from '@/lib/api/cache'
import { settingsQuery, statsQuery } from '@/lib/api/queries'
import { fileDownloadHref } from '@/lib/files/download-urls'
import { getMediaTypeFromPath, formatFileSize } from '@/lib/media/media-utils'
import { fileBrowserQuery } from '@/features/explorer/file-browser-listing'
import { MediaType, type FileItem } from '@/lib/files/types'
import { createFileSortMetadata, sortFilesForPath } from '@/features/explorer/file-display-settings'
import type { GlobalSettings } from '@/lib/models/settings-types'
import FileQuestion from '@effectweb/lucide/icons/file-question-mark'
import FileText from '@effectweb/lucide/icons/file-text'
import { ImageViewerPane } from './ImageViewerPane'
import { TextEditorPane } from './TextEditorPane'
import { AudioViewerPane } from './AudioViewerPane'
import { VideoViewerPane } from './VideoViewerPane'
import { Reader } from '@/features/reader/Reader'
import { observeQuery } from '@effectweb/query'
export type ViewerPaneProps = {
  selection?: readonly FileItem[]
  viewingPath: string
  directory?: string
  contentVisible: boolean
  active?: boolean
  editableFolders: readonly string[]
  knowledgeBases?: readonly string[]
  onNavigateViewing: (path: string) => void
  onVideoMetadataLoaded?: (width: number, height: number) => void
  autoPlayVideo?: boolean
  showPlayback?: boolean
  presentation?: 'embedded' | 'modal'
  readerKind?: 'pdf' | 'folder' | 'book' | null
  imageSeed?: string | null
  onImageSeedChange?: (seed: string | null, path: string) => void
  onClose?: () => void
  onListenOnlyDismissViewer?: () => void
  showListenOnly?: boolean
  onAudioActivate?: () => void
}

function viewerController(props: ViewerPaneProps) {
  const owner = modelOwner({
    props,
    files: [] as FileItem[],
    settings: undefined as GlobalSettings | undefined,
    views: {} as Record<string, number>,
  })
  const files = observeQuery(owner, queryCache, fileBrowserQuery.query, (result) =>
    owner.patch({ files: available(result)?.pages.flatMap((page) => page.value.files) ?? [] }),
  )
  const settings = observeQuery(owner, queryCache, settingsQuery, 'settings', available)
  const stats = observeQuery(owner, queryCache, statsQuery, (result) =>
    owner.patch({ views: available(result)?.views ?? {} }),
  )
  const select = (next: ViewerPaneProps) => {
    const type = getMediaTypeFromPath(next.viewingPath)
    files.select(
      next.viewingPath && [MediaType.IMAGE, MediaType.AUDIO, MediaType.OTHER].includes(type)
        ? (next.directory ?? '')
        : undefined,
    )
  }
  settings.select(true)
  stats.select(true)
  select(props)
  return {
    source: owner.source,
    receive: (next: ViewerPaneProps) => {
      owner.patch({ props: next })
      select(next)
    },
    lifetime: owner,
  }
}
export const ViewerPane = controllerView(
  { controller: viewerController },
  view((model) => {
    const props = model.props
    const path = props.viewingPath,
      type = getMediaTypeFromPath(path),
      embedded = props.presentation !== 'modal'
    const kind =
      props.readerKind === 'folder'
        ? 'directory'
        : (props.readerKind ??
          (type === MediaType.PDF ? 'pdf' : type === MediaType.BOOK ? 'book' : null))
    const ordered = sortFilesForPath(
      model.files,
      props.directory ?? '',
      model.settings?.sortOrders,
      false,
      createFileSortMetadata(model.settings?.favorites, model.views),
    )
    const unsupported = model.files.find((file) => file.path === path)
    return (
      <div
        data-no-window-drag
        use={domBinding(!embedded && !!path, modalScroll)}
        class={
          !embedded
            ? 'contents'
            : 'absolute inset-0 flex min-h-0 flex-col overflow-hidden bg-background'
        }
      >
        {path && kind ? (
          <div class='relative h-full min-h-0 overflow-hidden bg-neutral-900'>
            <Reader
              sourcePath={path}
              kind={kind}
              embedded={embedded}
              showClose={!embedded}
              onClose={props.onClose}
            />
          </div>
        ) : null}
        {path && !kind && type === MediaType.IMAGE ? (
          <ImageViewerPane
            viewingPath={path}
            imageSeed={props.imageSeed}
            onImageSeedChange={props.onImageSeedChange}
            allFiles={
              props.selection?.some((file) => file.path === path) ? props.selection : ordered
            }
            directory={props.directory ?? ''}
            embedded={embedded}
            showClose={!embedded}
            active={props.active ?? props.contentVisible}
            onNavigate={props.onNavigateViewing}
            onClose={props.onClose}
          />
        ) : null}
        {path && !kind && props.showPlayback !== false && type === MediaType.VIDEO ? (
          <VideoViewerPane
            viewingPath={path}
            contentVisible={props.contentVisible}
            autoplay={props.autoPlayVideo !== false}
            showListenOnly={props.showListenOnly !== false}
            onMetadataLoaded={props.onVideoMetadataLoaded}
            onListenOnly={props.onListenOnlyDismissViewer}
          />
        ) : null}
        {path && !kind && props.showPlayback !== false && type === MediaType.AUDIO ? (
          <AudioViewerPane
            viewingPath={path}
            directory={props.directory ?? ''}
            files={ordered}
            contentVisible={props.contentVisible}
            autoLoadPaused={props.autoPlayVideo === false}
            onNavigate={props.onNavigateViewing}
            onActivate={props.onAudioActivate}
          />
        ) : null}
        {path && !kind && type === MediaType.TEXT ? (
          <TextEditorPane
            viewingPath={path}
            editableFolders={[...props.editableFolders]}
            knowledgeBases={props.knowledgeBases ? [...props.knowledgeBases] : undefined}
            embedded={embedded}
            showClose={!embedded}
            onClose={props.onClose}
          />
        ) : null}
        {path && !kind && type === MediaType.OTHER ? (
          <div
            role={!embedded ? 'dialog' : undefined}
            aria-modal={!embedded ? 'true' : undefined}
            aria-labelledby='unsupported-file-title'
            class={
              !embedded
                ? 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'
                : 'flex flex-1 flex-col items-center justify-center gap-4 p-6'
            }
            onClick={(event) => {
              if (!embedded && event.target === event.currentTarget) props.onClose?.()
            }}
          >
            <div
              class={
                !embedded
                  ? 'bg-card text-card-foreground relative max-h-[90vh] w-full max-w-md overflow-auto rounded-xl border border-border p-6 shadow-lg'
                  : 'contents'
              }
            >
              {!embedded ? (
                <button
                  type='button'
                  title='Close'
                  aria-label='Close'
                  class='hover:bg-muted absolute top-2 right-2 inline-flex h-8 w-8 items-center justify-center rounded-md'
                  onClick={() => props.onClose?.()}
                >
                  ×
                </button>
              ) : null}
              <FileQuestion class='h-8 w-8 shrink-0 text-yellow-500' />
              <h2 id='unsupported-file-title' class='truncate text-lg font-semibold'>
                {unsupported?.name ?? path.split(/[/\\]/).pop()}
              </h2>
              {unsupported ? (
                <p class='text-muted-foreground text-xs'>
                  {unsupported.extension ? `.${unsupported.extension.toUpperCase()}` : 'Unknown'}{' '}
                  file • {formatFileSize(unsupported.size)}
                </p>
              ) : null}
              <div class='flex flex-col items-center gap-4 py-6 text-center'>
                <FileText class='text-muted-foreground h-16 w-16 opacity-50' />
                <h3 class='text-lg font-medium'>Unsupported File Type</h3>
                <p class='text-muted-foreground text-sm'>This file type cannot be previewed.</p>
                <a
                  href={fileDownloadHref(path)}
                  download={unsupported?.name ?? path.split(/[/\\]/).pop()}
                  class='bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium shadow-sm'
                >
                  Download File
                </a>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    )
  }),
)
