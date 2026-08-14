import { formatFileSize } from '@/lib/media-utils'
import FileQuestion from 'lucide-solid/icons/file-question'
import FileText from 'lucide-solid/icons/file-text'
import X from 'lucide-solid/icons/x'
import { Show, type JSX } from 'solid-js'

export type UnsupportedViewerContentProps = {
  name: string
  extension?: string
  size?: number
  downloadHref?: string
  onDownload?: () => void | Promise<void>
  onClose?: () => void
}

export function UnsupportedViewerContent(props: UnsupportedViewerContentProps): JSX.Element {
  return (
    <div
      data-testid='unsupported-viewer-content'
      class='flex h-full min-h-0 items-center justify-center bg-black/50 p-4'
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
                {props.name}
              </h2>
              <p class='text-muted-foreground text-xs'>
                {props.extension ? `.${props.extension.toUpperCase()}` : 'Unknown'} file
                <Show when={props.size !== undefined}> • {formatFileSize(props.size!)}</Show>
              </p>
            </div>
          </div>
          <Show when={props.onClose}>
            <button
              type='button'
              title='Close'
              aria-label='Close'
              class='hover:bg-muted inline-flex size-8 shrink-0 items-center justify-center rounded-md'
              onClick={() => props.onClose?.()}
            >
              <X class='h-4 w-4' stroke-width={2} />
            </button>
          </Show>
        </div>
        <div class='bg-muted/50 flex flex-col items-center space-y-4 rounded-b-xl p-8 text-center'>
          <FileText class='text-muted-foreground h-16 w-16 opacity-50' stroke-width={1.5} />
          <div>
            <h3 class='mb-2 text-lg font-medium'>Unsupported File Type</h3>
            <p class='text-muted-foreground text-sm'>
              This file type cannot be previewed. You can still download the original.
            </p>
          </div>
          <div class='pt-2'>
            <Show
              when={props.downloadHref}
              fallback={
                <Show when={props.onDownload}>
                  <button
                    type='button'
                    class='bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium shadow-sm'
                    onClick={() => void props.onDownload?.()}
                  >
                    Download File
                  </button>
                </Show>
              }
            >
              {(downloadHref) => (
                <a
                  href={downloadHref()}
                  download={props.name}
                  class='bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center justify-center rounded-md px-4 text-sm font-medium shadow-sm'
                >
                  Download File
                </a>
              )}
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}
