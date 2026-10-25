import { controllerView, domBinding, modelOwner, view } from 'effectweb'
import X from '@effectweb/lucide/icons/x'
import { ViewerPane } from '@/features/viewer/LazyViewerPane'
import { modalFocus } from '@/lib/ui/modal-focus'
import { getMediaTypeFromPath } from '@/lib/media/media-utils'
import { buildMediaUrl } from '@/lib/media/build-media-url'
import { MediaType, type FileItem } from '@/lib/files/types'
import { modalDialogBackdropClass } from './modal-overlay-scope'

const releaseMedia = (element: HTMLMediaElement) => () => {
  element.pause()
  element.removeAttribute('src')
  element.load()
}
const PreviewMedia = controllerView(
  {
    identity: (props: { path: string; video: boolean }) => props.path,
    controller: (props: { path: string; video: boolean }) => {
      const owner = modelOwner({
        ...props,
        failed: false,
        fail: () => owner.patch({ failed: true }),
      })
      return { source: owner.source, lifetime: owner }
    },
  },
  view((model) => (
    <div class='flex h-full flex-col items-center justify-center gap-4 p-4'>
      {model.failed ? (
        <p role='status' class='text-center text-sm text-muted-foreground'>
          This format cannot be previewed here. Open the file to use the full player.
        </p>
      ) : model.video ? (
        <video
          class='max-h-full max-w-full'
          src={buildMediaUrl(model.path)}
          controls
          playsinline
          preload='metadata'
          onError={model.fail}
          use={domBinding(true, releaseMedia)}
        />
      ) : (
        <audio
          class='max-w-full'
          src={buildMediaUrl(model.path)}
          controls
          preload='metadata'
          onError={model.fail}
          use={domBinding(true, releaseMedia)}
        />
      )}
    </div>
  )),
)

export const QuickPreview = view<{
  path: string
  files: readonly FileItem[]
  directory: string
  workspace: boolean
  onClose: () => void
  onNavigate: (path: string) => void
  onOpen: (file: FileItem) => void
}>((props) => {
  const type = getMediaTypeFromPath(props.path)
  const file = props.files.find((file) => file.path === props.path)
  return (
    <div
      data-no-window-drag
      class={modalDialogBackdropClass(props.workspace ? 'window' : 'viewport')}
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClose()
      }}
    >
      <section
        role='dialog'
        aria-modal='true'
        aria-label='Quick preview'
        use={modalFocus({ onEscape: props.onClose })}
        class='flex h-full max-h-[48rem] w-full max-w-5xl min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xl'
        onKeyDown={(event) => {
          if (
            event.key === ' ' &&
            !(
              event.target instanceof Element &&
              event.target.closest('input, textarea, [contenteditable=true], video, audio')
            )
          ) {
            event.preventDefault()
            event.stopPropagation()
            props.onClose()
          }
        }}
      >
        <header class='flex h-11 shrink-0 items-center gap-2 border-b border-border px-3'>
          <span class='min-w-0 flex-1 truncate text-sm font-medium' title={props.path}>
            {file?.name ?? props.path.split('/').at(-1)}
          </span>
          {file ? (
            <button
              type='button'
              class='shrink-0 rounded-md px-2 py-1 text-sm hover:bg-muted'
              onClick={() => props.onOpen(file)}
            >
              Open
            </button>
          ) : null}
          <button
            type='button'
            autofocus
            aria-label='Close preview'
            title='Close preview (Space or Escape)'
            class='inline-flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-muted'
            onClick={props.onClose}
          >
            <X class='size-4' />
          </button>
        </header>
        <div class='relative min-h-0 flex-1'>
          {type === MediaType.AUDIO || type === MediaType.VIDEO ? (
            <PreviewMedia path={props.path} video={type === MediaType.VIDEO} />
          ) : (
            <ViewerPane
              viewingPath={props.path}
              selection={props.files}
              directory={props.directory}
              contentVisible
              active
              editableFolders={[]}
              allowImageEditing={false}
              autoPlayVideo={false}
              showListenOnly={false}
              presentation='embedded'
              onNavigateViewing={props.onNavigate}
              onClose={props.onClose}
            />
          )}
        </div>
      </section>
    </div>
  )
})
