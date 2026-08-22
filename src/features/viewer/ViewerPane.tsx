import { useQuery } from '@tanstack/solid-query'
import { queryKeys } from '@/lib/api/query-keys'
import { fileDownloadHref } from '@/lib/files/download-urls'
import { getMediaTypeFromPath } from '@/lib/media/media-utils'
import { formatFileSize } from '@/lib/media/media-utils'
import { fetchDirectoryFiles } from '@/lib/files/files-client'
import { MediaType } from '@/lib/files/types'
import { createFileSortMetadata, sortFilesForPath } from '@/features/explorer/file-display-settings'
import { useExplorerSettings } from '@/features/explorer/use-explorer-settings'
import { useViewStats } from '@/features/explorer/use-view-stats'
import FileQuestion from 'lucide-solid/icons/file-question-mark'
import FileText from 'lucide-solid/icons/file-text'
import type { Accessor } from 'solid-js'
import { Show, createEffect, createMemo, lazy } from 'solid-js'
import { ImageViewerPane } from './ImageViewerPane'
import { TextEditorPane } from './TextEditorPane'
import { AudioViewerPane } from './AudioViewerPane'
import { VideoViewerPane } from './VideoViewerPane'

const Reader = lazy(() =>
  import('@/features/reader/Reader').then((module) => ({ default: module.Reader })),
)

type Props = {
  viewingPath: Accessor<string>
  directory?: Accessor<string>
  contentVisible: Accessor<boolean>
  active?: Accessor<boolean>
  editableFolders: string[]
  /** Same as main file browser — required for Obsidian-style images in knowledge bases. */
  knowledgeBases?: string[]
  onNavigateViewing: (path: string) => void
  onVideoMetadataLoaded?: (videoWidth: number, videoHeight: number) => void
  autoPlayVideo?: boolean
  showPlayback?: boolean
  presentation?: 'embedded' | 'modal'
  readerKind?: Accessor<'pdf' | 'folder' | 'book' | null>
  onClose?: () => void
  /** Close the viewer tab after switching to taskbar audio (playback keeps running). */
  onListenOnlyDismissViewer?: () => void
  showListenOnly?: boolean
  onAudioActivate?: () => void
}

export function ViewerPane(props: Props) {
  const { settingsQuery } = useExplorerSettings()
  const viewStats = useViewStats()

  const viewingPath = createMemo(() => props.viewingPath())
  const readerKind = createMemo(() => props.readerKind?.() ?? null)
  const contentReaderKind = createMemo(() => {
    const kind = readerKind()
    return kind === 'folder' ? 'directory' : kind
  })

  createEffect(
    () => props.presentation === 'modal' && Boolean(viewingPath()),
    (active) => {
      if (!active) return undefined
      const html = document.documentElement
      const body = document.body
      const previous = { html: html.style.overflow, body: body.style.overflow }
      html.style.overflow = 'hidden'
      body.style.overflow = 'hidden'
      return () => {
        html.style.overflow = previous.html
        body.style.overflow = previous.body
      }
    },
  )

  const mediaType = createMemo(() => getMediaTypeFromPath(viewingPath()))

  const downloadHref = createMemo(() => {
    const path = viewingPath()
    if (!path) return '#'
    return fileDownloadHref(path)
  })

  const dirFromWindow = createMemo(() => props.directory?.() ?? '')
  const contentActive = createMemo(() => props.active?.() ?? props.contentVisible())
  const showPlayback = createMemo(() => props.showPlayback !== false)

  const listDirForFiles = createMemo(() => dirFromWindow())

  const filesQuery = useQuery(() => {
    return {
      queryKey: queryKeys.files(listDirForFiles()),
      queryFn: () => fetchDirectoryFiles(listDirForFiles()),
      enabled:
        (mediaType() === MediaType.IMAGE ||
          mediaType() === MediaType.AUDIO ||
          mediaType() === MediaType.OTHER) &&
        Boolean(viewingPath()),
    }
  })

  const orderedFolderFiles = createMemo(() => {
    const files = filesQuery.data?.files ?? []
    const directory = listDirForFiles()
    return sortFilesForPath(
      files,
      directory,
      settingsQuery.data?.sortOrders,
      false,
      createFileSortMetadata(settingsQuery.data?.favorites, viewStats.viewCounts()),
    )
  })

  const unsupportedFile = createMemo(
    () =>
      filesQuery.data?.files.find(
        (file) => file.path === viewingPath() && file.type === MediaType.OTHER,
      ) ?? null,
  )

  const fileName = createMemo(() => viewingPath().split(/[/\\]/).pop() ?? 'file')

  return (
    <div
      data-no-window-drag
      class={
        props.presentation === 'modal'
          ? 'contents'
          : 'absolute inset-0 flex min-h-0 flex-col overflow-hidden bg-background'
      }
    >
      <Show when={readerKind() && viewingPath()} keyed>
        {(sourcePath) => (
          <div class='relative h-full min-h-0 overflow-hidden bg-neutral-900'>
            <Reader
              sourcePath={sourcePath}
              kind={contentReaderKind()!}
              embedded={props.presentation !== 'modal'}
              showClose={props.presentation === 'modal'}
              onClose={props.onClose}
            />
          </div>
        )}
      </Show>

      <Show when={!readerKind() && mediaType() === MediaType.IMAGE && viewingPath()}>
        <ImageViewerPane
          viewingPath={viewingPath()}
          allFiles={orderedFolderFiles}
          directory={dirFromWindow}
          embedded={props.presentation !== 'modal'}
          showClose={props.presentation === 'modal'}
          active={contentActive}
          onNavigate={props.onNavigateViewing}
          onClose={props.onClose}
        />
      </Show>

      <Show when={!readerKind() && mediaType() === MediaType.PDF && viewingPath()} keyed>
        {(sourcePath) => (
          <div class='relative h-full min-h-0 overflow-hidden bg-neutral-900'>
            <Reader
              sourcePath={sourcePath}
              kind='pdf'
              embedded={props.presentation !== 'modal'}
              showClose={props.presentation === 'modal'}
              onClose={props.onClose}
            />
          </div>
        )}
      </Show>

      <Show when={!readerKind() && mediaType() === MediaType.BOOK && viewingPath()} keyed>
        {(sourcePath) => (
          <div class='relative h-full min-h-0 overflow-hidden bg-neutral-900'>
            <Reader
              sourcePath={sourcePath}
              kind='book'
              embedded={props.presentation !== 'modal'}
              showClose={props.presentation === 'modal'}
              onClose={props.onClose}
            />
          </div>
        )}
      </Show>

      <Show
        when={showPlayback() && !readerKind() && mediaType() === MediaType.VIDEO && viewingPath()}
      >
        <VideoViewerPane
          viewingPath={viewingPath}
          contentVisible={props.contentVisible}
          autoplay={props.autoPlayVideo !== false}
          showListenOnly={props.showListenOnly !== false}
          onMetadataLoaded={props.onVideoMetadataLoaded}
          onListenOnly={props.onListenOnlyDismissViewer}
        />
      </Show>

      <Show
        when={showPlayback() && !readerKind() && mediaType() === MediaType.AUDIO && viewingPath()}
      >
        <AudioViewerPane
          viewingPath={viewingPath}
          directory={dirFromWindow}
          files={orderedFolderFiles}
          contentVisible={props.contentVisible}
          autoLoadPaused={props.autoPlayVideo === false}
          onNavigate={props.onNavigateViewing}
          onActivate={props.onAudioActivate}
        />
      </Show>

      <Show when={!readerKind() && mediaType() === MediaType.TEXT && viewingPath()} keyed>
        {(sourcePath) => (
          <TextEditorPane
            viewingPath={sourcePath}
            editableFolders={props.editableFolders}
            knowledgeBases={props.knowledgeBases}
            embedded={props.presentation !== 'modal'}
            showClose={props.presentation === 'modal'}
            onClose={props.onClose}
          />
        )}
      </Show>

      <Show when={!readerKind() && mediaType() === MediaType.OTHER && viewingPath()}>
        <Show when={props.presentation === 'modal' && unsupportedFile()} keyed>
          {(file) => (
            <div
              role='dialog'
              aria-modal='true'
              aria-labelledby='unsupported-file-title'
              class='fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'
              onClick={(event) => {
                if (event.target === event.currentTarget) props.onClose?.()
              }}
            >
              <div
                class='bg-card text-card-foreground max-h-[90vh] w-full max-w-md overflow-auto rounded-xl border border-border shadow-lg'
                onClick={(event) => event.stopPropagation()}
              >
                <div class='flex items-start justify-between gap-2 border-b border-border p-4'>
                  <div class='flex min-w-0 flex-1 items-start gap-3'>
                    <FileQuestion class='h-8 w-8 shrink-0 text-yellow-500' stroke-width={2} />
                    <div class='min-w-0'>
                      <h2 id='unsupported-file-title' class='truncate text-lg font-semibold'>
                        {file.name}
                      </h2>
                      <p class='text-muted-foreground text-xs'>
                        {file.extension ? `.${file.extension.toUpperCase()}` : 'Unknown'} file •{' '}
                        {formatFileSize(file.size)}
                      </p>
                    </div>
                  </div>
                  <button
                    type='button'
                    title='Close'
                    aria-label='Close'
                    class='hover:bg-muted inline-flex size-8 shrink-0 items-center justify-center rounded-md'
                    onClick={() => props.onClose?.()}
                  >
                    <span aria-hidden='true'>×</span>
                  </button>
                </div>
                <div class='bg-muted/50 flex flex-col items-center space-y-4 rounded-b-xl p-8 text-center'>
                  <FileText class='text-muted-foreground h-16 w-16 opacity-50' stroke-width={1.5} />
                  <div>
                    <h3 class='mb-2 text-lg font-medium'>Unsupported File Type</h3>
                    <p class='text-muted-foreground text-sm'>
                      This file type is not supported for preview. The media server currently
                      supports video, audio, and image files.
                    </p>
                  </div>
                  <div class='pt-2'>
                    <a
                      href={downloadHref()}
                      download={file.name}
                      class='bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium shadow-sm'
                    >
                      Download File
                    </a>
                  </div>
                </div>
              </div>
            </div>
          )}
        </Show>
        <div
          role={props.presentation === 'modal' ? 'dialog' : undefined}
          aria-modal={props.presentation === 'modal' ? 'true' : undefined}
          aria-labelledby='unsupported-file-title'
          class={[
            props.presentation === 'modal'
              ? 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4'
              : 'flex flex-1 flex-col items-center justify-center gap-4 p-6',
            { hidden: props.presentation === 'modal' && !!unsupportedFile() },
          ]}
        >
          <div
            class={
              props.presentation === 'modal'
                ? 'bg-card text-card-foreground w-full max-w-md rounded-xl border border-border p-6 shadow-lg'
                : 'contents'
            }
          >
            <h2 id='unsupported-file-title' class='text-center text-lg font-semibold'>
              Unsupported File Type
            </h2>
            <Show when={props.presentation === 'modal'}>
              <button
                type='button'
                title='Close'
                aria-label='Close'
                class='hover:bg-muted absolute top-2 right-2 inline-flex h-8 w-8 items-center justify-center rounded-md'
                onClick={() => props.onClose?.()}
              >
                ×
              </button>
            </Show>
            <p class='text-muted-foreground text-center text-sm'>
              This file type cannot be previewed.
            </p>
            <a
              href={downloadHref()}
              download={fileName()}
              class='bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium shadow-sm'
            >
              Download File
            </a>
          </div>
        </div>
      </Show>
    </div>
  )
}
