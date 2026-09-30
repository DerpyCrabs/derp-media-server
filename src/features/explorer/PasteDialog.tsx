import { type Snapshot, available, localComponent, observe, view } from 'effectweb'
import { cn } from '@/lib/ui/cn'
import { query, querySource } from '@effectweb/query'
import { queryCache } from '@/lib/api/cache'
import { Effect } from 'effect'
import type { PasteData } from '@/lib/files/paste-data'
import type { FileItem } from '@/lib/files/types'
import { buildAdminMediaUrl } from '@/lib/media/build-media-url'
import type { ModalOverlayScope } from './modal-overlay-scope'
import { modalDialogBackdropClass } from './modal-overlay-scope'
import { formatFileSize } from '@/lib/media/media-utils'
import { LazyMarkdownDocument } from '@/lib/markdown/LazyMarkdownDocument'
import AlertCircle from '@effectweb/lucide/icons/alert-circle'
import FileIcon from '@effectweb/lucide/icons/file'
import HardDrive from '@effectweb/lucide/icons/hard-drive'
const PASTE_TEXT_PREVIEW_MAX = 10000
const PasteTextPreview = view<{ content: string; renderAsMarkdown: boolean }>((props) => {
  const previewSlice = () => {
    const c = props.content
    if (c.length <= PASTE_TEXT_PREVIEW_MAX) return c
    return c.slice(0, PASTE_TEXT_PREVIEW_MAX)
  }
  const truncated = () => props.content.length > PASTE_TEXT_PREVIEW_MAX
  return (
    <div class='bg-muted/30 rounded-lg border'>
      {props.renderAsMarkdown ? (
        <div class='h-64 max-h-96 overflow-hidden'>
          <LazyMarkdownDocument
            content={previewSlice()}
            mode='read'
            resolveImageUrl={() => null}
            ariaLabel='Markdown paste preview'
            compact
          />
        </div>
      ) : (
        <pre class='max-h-96 overflow-auto p-4 font-mono text-xs whitespace-pre-wrap wrap-break-word'>
          {previewSlice()}
        </pre>
      )}
      {truncated() ? (
        <div class='text-muted-foreground border-t px-4 py-2 text-xs'>
          Showing first {PASTE_TEXT_PREVIEW_MAX.toLocaleString()} characters of{' '}
          {props.content.length.toLocaleString()} total
        </div>
      ) : null}
    </div>
  )
})
type Props = {
  overlayScope?: ModalOverlayScope
  isOpen: boolean
  pasteData: PasteData | null
  isPending: boolean
  error: Error | null | undefined
  existingFiles: FileItem[]
  onPaste: (fileName: string, mode: 'create' | 'replace', expectedVersion?: number) => void
  onClose: () => void
}
export const PasteDialog = localComponent({
  init: (_props: Snapshot<Props>) => ({ fileName: '' }),
  view: view((local, patch) => {
    const props = local.props
    const fileName = () => local.fileName,
      setFileName = (value: string) => patch({ fileName: value })
    const displayName = () => fileName() || props.pasteData?.suggestedName || ''
    const existingItem = () => {
      const n = displayName().trim().toLowerCase()
      if (!n) return undefined
      return props.existingFiles.find((file) => file.name.toLowerCase() === n)
    }
    const fileExists = () => !!existingItem()
    const canReplace = () => !!existingItem() && !existingItem()!.isDirectory
    const previewAsMarkdown = () => displayName().trim().toLowerCase().endsWith('.md')
    function handlePaste(mode: 'create' | 'replace' = 'create') {
      const n = displayName().trim()
      if (n) props.onPaste(n, mode, mode === 'replace' ? existingItem()?.version : undefined)
    }
    function handleClose() {
      if (!props.isPending) {
        setFileName('')
        props.onClose()
      }
    }
    function contentLabel() {
      const pd = props.pasteData
      if (!pd) return 'Content'
      switch (pd.type) {
        case 'image':
          return 'Image'
        case 'text':
          return 'Text'
        case 'file':
          return 'File'
        default:
          return 'Content'
      }
    }
    return props.isOpen ? (
      <div
        class={modalDialogBackdropClass(props.overlayScope)}
        role='presentation'
        onClick={() => handleClose()}
      >
        <div
          role='dialog'
          aria-modal='true'
          class='border-border bg-card text-card-foreground max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border p-6 shadow-lg'
          onClick={(e) => e.stopPropagation()}
        >
          <h2 class='text-lg font-semibold'>Paste {contentLabel()}</h2>

          <div class='mt-4 space-y-4'>
            {((pd) =>
              pd ? (
                <>
                  {pd.type === 'image' ? (
                    <div class='space-y-2'>
                      <div class='bg-muted/30 flex max-h-64 items-center justify-center overflow-hidden rounded-lg border p-4'>
                        <img
                          src={`data:${pd.fileType || 'image/png'};base64,${pd.content}`}
                          alt='Preview'
                          class='max-h-56 max-w-full object-contain'
                        />
                      </div>
                      {pd.fileSize ? (
                        <div class='text-muted-foreground flex items-center gap-2 px-2 text-xs'>
                          <HardDrive class='h-3 w-3' stroke-width={2} />
                          <span>{formatFileSize(pd.fileSize!)}</span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {(pd.type === 'text' || pd.type === 'file') && pd.isTextContent === true ? (
                    <div class='space-y-2'>
                      {fileExists() && canReplace() ? (
                        <ExistingPastePreview path={existingItem()!.path} content={pd.content} />
                      ) : (
                        <PasteTextPreview
                          content={pd.content}
                          renderAsMarkdown={previewAsMarkdown()}
                        />
                      )}
                      {pd.fileSize ? (
                        <div class='text-muted-foreground flex items-center gap-2 px-2 text-xs'>
                          <HardDrive class='h-3 w-3' stroke-width={2} />
                          <span>{formatFileSize(pd.fileSize!)}</span>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {pd.type === 'file' && !pd.isTextContent ? (
                    <div class='bg-muted/30 rounded-lg border p-6'>
                      <div class='flex flex-col items-center gap-4 text-center'>
                        <div class='bg-primary/10 rounded-full p-4'>
                          <FileIcon class='text-primary h-8 w-8' stroke-width={2} />
                        </div>
                        <div class='space-y-2'>
                          <p class='text-sm font-medium'>{pd.suggestedName}</p>
                          <div class='text-muted-foreground flex items-center justify-center gap-4 text-xs'>
                            {pd.fileType ? <span class='font-mono'>{pd.fileType}</span> : null}
                            {pd.fileSize ? (
                              <div class='flex items-center gap-1'>
                                <HardDrive class='h-3 w-3' stroke-width={2} />
                                <span>{formatFileSize(pd.fileSize!)}</span>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  {fileExists() && canReplace() && !pd.isTextContent ? (
                    <div
                      class='grid grid-cols-2 gap-3 text-sm'
                      data-testid='binary-replacement-info'
                    >
                      <div class='bg-muted/30 rounded-lg border p-3'>
                        <p class='font-medium'>Existing</p>
                        <p class='text-muted-foreground mt-1 text-xs'>
                          {existingItem()!.extension || existingItem()!.type} ·{' '}
                          {formatFileSize(existingItem()!.size)}
                        </p>
                      </div>
                      <div class='bg-muted/30 rounded-lg border p-3'>
                        <p class='font-medium'>Clipboard</p>
                        <p class='text-muted-foreground mt-1 text-xs'>
                          {pd.fileType || 'binary file'} · {formatFileSize(pd.fileSize ?? 0)}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null)(props.pasteData?.showPreview && props.pasteData)}

            <div class='space-y-2'>
              <label class='text-sm font-medium'>Filename</label>
              <input
                type='text'
                aria-label='Filename'
                class={cn([
                  'border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none',
                  { 'border-yellow-500': fileExists() },
                ])}
                value={displayName()}
                onInput={(e) => setFileName(e.currentTarget.value)}
                placeholder={`e.g., ${props.pasteData?.suggestedName ?? 'file.txt'}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && displayName().trim()) handlePaste()
                }}
                disabled={props.isPending}
                autofocus
              />
            </div>

            {fileExists() ? (
              <div class='flex items-start gap-2 rounded-lg border border-yellow-500/50 bg-yellow-500/10 p-3'>
                <AlertCircle class='mt-0.5 h-4 w-4 shrink-0 text-yellow-600 dark:text-yellow-500' />
                <div class='text-sm text-yellow-800 dark:text-yellow-200'>
                  <p class='font-medium'>File already exists</p>
                  <p class='mt-1 text-xs opacity-90'>
                    {existingItem()?.isDirectory
                      ? 'A folder has this name and cannot be replaced with a file.'
                      : 'Choose Replace, save with another name, or cancel.'}
                  </p>
                </div>
              </div>
            ) : null}

            {props.error ? (
              <div class='bg-destructive/10 text-destructive rounded-lg p-3 text-sm'>
                {props.error?.message}
              </div>
            ) : null}
          </div>

          <div class='mt-6 flex justify-end gap-2'>
            {fileExists() ? (
              <button
                type='button'
                class='border-input bg-background hover:bg-accent h-9 rounded-md border px-4 text-sm font-medium'
                disabled={props.isPending}
                onClick={() =>
                  document.querySelector<HTMLInputElement>('input[autofocus]')?.focus()
                }
              >
                Save with another name
              </button>
            ) : null}
            <button
              type='button'
              class='border-input bg-background hover:bg-accent h-9 rounded-md border px-4 text-sm font-medium'
              disabled={props.isPending}
              onClick={() => handleClose()}
            >
              Cancel
            </button>
            <button
              type='button'
              class='bg-primary text-primary-foreground hover:bg-primary/90 h-9 rounded-md px-4 text-sm font-medium disabled:opacity-50'
              disabled={props.isPending || !displayName().trim() || (fileExists() && !canReplace())}
              onClick={() => handlePaste(fileExists() ? 'replace' : 'create')}
            >
              {props.isPending ? 'Pasting...' : fileExists() ? 'Replace' : 'Paste'}
            </button>
          </div>
        </div>
      </div>
    ) : null
  }),
})
const existingText = query({
  name: 'paste-existing-text',
  load: (path: string) =>
    Effect.gen(function* () {
      const response = yield* Effect.tryPromise({
        try: (signal) => fetch(buildAdminMediaUrl(path), { signal }),
        catch: () => new Error('Unable to load existing text preview'),
      })
      if (!response.ok) return yield* Effect.fail(new Error('Unable to load existing text preview'))
      return yield* Effect.tryPromise({
        try: () => response.text(),
        catch: () => new Error('Unable to load existing text preview'),
      })
    }),
})
const ExistingPastePreview = view<{ path: string; content: string }>((props) =>
  observe(querySource(queryCache, existingText, props.path), (result) => {
    const text = available(result)
    if (text === undefined)
      return <PasteTextPreview content={props.content} renderAsMarkdown={false} />
    return (
      <div class='grid gap-3 sm:grid-cols-2' data-testid='paste-diff'>
        <div>
          <p class='mb-1 text-xs font-medium'>Existing</p>
          <PasteTextPreview content={text} renderAsMarkdown={false} />
        </div>
        <div>
          <p class='mb-1 text-xs font-medium'>Clipboard</p>
          <PasteTextPreview content={props.content} renderAsMarkdown={false} />
        </div>
      </div>
    )
  }),
)
