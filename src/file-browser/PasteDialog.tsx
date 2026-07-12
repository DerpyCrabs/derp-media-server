import type { PasteData } from '@/lib/paste-data'
import type { FileItem } from '@/lib/types'
import { buildAdminMediaUrl } from '@/src/lib/build-media-url'
import type { ModalOverlayScope } from './modal-overlay-scope'
import { modalDialogBackdropClass } from './modal-overlay-scope'
import { formatFileSize } from '@/lib/media-utils'
import { createMarkdownRenderer, preprocessObsidianImages } from '../media/text-viewer-markdown'
import AlertCircle from 'lucide-solid/icons/alert-circle'
import FileIcon from 'lucide-solid/icons/file'
import HardDrive from 'lucide-solid/icons/hard-drive'
import { Show, createEffect, createMemo, createSignal, type Accessor } from 'solid-js'

const PASTE_TEXT_PREVIEW_MAX = 10_000

function PasteTextPreview(props: { content: string; renderAsMarkdown: Accessor<boolean> }) {
  const previewSlice = createMemo(() => {
    const c = props.content
    if (c.length <= PASTE_TEXT_PREVIEW_MAX) return c
    return c.slice(0, PASTE_TEXT_PREVIEW_MAX)
  })

  const truncated = createMemo(() => props.content.length > PASTE_TEXT_PREVIEW_MAX)

  const [mdMount, setMdMount] = createSignal<HTMLDivElement | null>(null)
  const mdHtml = createMemo(() => {
    if (!props.renderAsMarkdown()) return ''
    const md = createMarkdownRenderer(() => null)
    return md.render(preprocessObsidianImages(previewSlice()))
  })

  createEffect(() => {
    if (!props.renderAsMarkdown()) return
    const el = mdMount()
    const h = mdHtml()
    if (el) el.innerHTML = h
  })

  return (
    <div class='bg-muted/30 rounded-lg border'>
      <Show
        when={props.renderAsMarkdown()}
        fallback={
          <pre class='max-h-96 overflow-auto p-4 font-mono text-xs whitespace-pre-wrap wrap-break-word'>
            {previewSlice()}
          </pre>
        }
      >
        <div class='max-h-96 overflow-auto p-4'>
          <div
            ref={setMdMount}
            class='markdown-pane-prose prose prose-sm prose-neutral dark:prose-invert max-w-none [&_img]:max-h-32 [&_img]:max-w-full [&_img]:object-contain'
          />
        </div>
      </Show>
      <Show when={truncated()}>
        <div class='text-muted-foreground border-t px-4 py-2 text-xs'>
          Showing first {PASTE_TEXT_PREVIEW_MAX.toLocaleString()} characters of{' '}
          {props.content.length.toLocaleString()} total
        </div>
      </Show>
    </div>
  )
}

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

export function PasteDialog(props: Props) {
  const [fileName, setFileName] = createSignal('')
  const [existingText, setExistingText] = createSignal<string | null>(null)

  const displayName = createMemo(() => fileName() || props.pasteData?.suggestedName || '')

  const existingItem = createMemo(() => {
    const n = displayName().trim().toLowerCase()
    if (!n) return undefined
    return props.existingFiles.find((file) => file.name.toLowerCase() === n)
  })
  const fileExists = createMemo(() => !!existingItem())
  const canReplace = createMemo(() => !!existingItem() && !existingItem()!.isDirectory)

  const previewAsMarkdown = createMemo(() => displayName().trim().toLowerCase().endsWith('.md'))

  function handlePaste(mode: 'create' | 'replace' = 'create') {
    const n = displayName().trim()
    if (n) props.onPaste(n, mode, mode === 'replace' ? existingItem()?.version : undefined)
  }

  createEffect(() => {
    const item = existingItem()
    setExistingText(null)
    if (!item || item.isDirectory || !props.pasteData?.isTextContent) return
    void fetch(buildAdminMediaUrl(item.path))
      .then((response) => (response.ok ? response.text() : Promise.reject()))
      .then(setExistingText)
      .catch(() => setExistingText('Unable to load existing text preview'))
  })

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

  return (
    <Show when={props.isOpen}>
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
            <Show when={props.pasteData?.showPreview && props.pasteData}>
              {(pd) => (
                <>
                  <Show when={pd().type === 'image'}>
                    <div class='space-y-2'>
                      <div class='bg-muted/30 flex max-h-64 items-center justify-center overflow-hidden rounded-lg border p-4'>
                        <img
                          src={`data:${pd().fileType || 'image/png'};base64,${pd().content}`}
                          alt='Preview'
                          class='max-h-56 max-w-full object-contain'
                        />
                      </div>
                      <Show when={pd().fileSize}>
                        <div class='text-muted-foreground flex items-center gap-2 px-2 text-xs'>
                          <HardDrive class='h-3 w-3' stroke-width={2} />
                          <span>{formatFileSize(pd().fileSize!)}</span>
                        </div>
                      </Show>
                    </div>
                  </Show>

                  <Show
                    when={
                      (pd().type === 'text' || pd().type === 'file') && pd().isTextContent === true
                    }
                  >
                    <div class='space-y-2'>
                      <Show when={fileExists() && existingText() !== null} fallback={<PasteTextPreview content={pd().content} renderAsMarkdown={previewAsMarkdown} />}>
                        <div class='grid gap-3 sm:grid-cols-2' data-testid='paste-diff'>
                          <div><p class='mb-1 text-xs font-medium'>Existing</p><PasteTextPreview content={existingText()!} renderAsMarkdown={() => false} /></div>
                          <div><p class='mb-1 text-xs font-medium'>Clipboard</p><PasteTextPreview content={pd().content} renderAsMarkdown={() => false} /></div>
                        </div>
                      </Show>
                      <Show when={pd().fileSize}>
                        <div class='text-muted-foreground flex items-center gap-2 px-2 text-xs'>
                          <HardDrive class='h-3 w-3' stroke-width={2} />
                          <span>{formatFileSize(pd().fileSize!)}</span>
                        </div>
                      </Show>
                    </div>
                  </Show>

                  <Show when={pd().type === 'file' && !pd().isTextContent}>
                    <div class='bg-muted/30 rounded-lg border p-6'>
                      <div class='flex flex-col items-center gap-4 text-center'>
                        <div class='bg-primary/10 rounded-full p-4'>
                          <FileIcon class='text-primary h-8 w-8' stroke-width={2} />
                        </div>
                        <div class='space-y-2'>
                          <p class='text-sm font-medium'>{pd().suggestedName}</p>
                          <div class='text-muted-foreground flex items-center justify-center gap-4 text-xs'>
                            <Show when={pd().fileType}>
                              <span class='font-mono'>{pd().fileType}</span>
                            </Show>
                            <Show when={pd().fileSize}>
                              <div class='flex items-center gap-1'>
                                <HardDrive class='h-3 w-3' stroke-width={2} />
                                <span>{formatFileSize(pd().fileSize!)}</span>
                              </div>
                            </Show>
                          </div>
                        </div>
                      </div>
                    </div>
                  </Show>

                  <Show when={fileExists() && canReplace() && !pd().isTextContent}>
                    <div class='grid grid-cols-2 gap-3 text-sm' data-testid='binary-replacement-info'>
                      <div class='bg-muted/30 rounded-lg border p-3'>
                        <p class='font-medium'>Existing</p>
                        <p class='text-muted-foreground mt-1 text-xs'>{existingItem()!.extension || existingItem()!.type} · {formatFileSize(existingItem()!.size)}</p>
                      </div>
                      <div class='bg-muted/30 rounded-lg border p-3'>
                        <p class='font-medium'>Clipboard</p>
                        <p class='text-muted-foreground mt-1 text-xs'>{pd().fileType || 'binary file'} · {formatFileSize(pd().fileSize ?? 0)}</p>
                      </div>
                    </div>
                  </Show>
                </>
              )}
            </Show>

            <div class='space-y-2'>
              <label class='text-sm font-medium'>Filename</label>
              <input
                type='text'
                aria-label='Filename'
                class='border-input bg-background focus-visible:ring-ring h-9 w-full rounded-md border px-3 py-2 text-sm focus-visible:ring-2 focus-visible:outline-none'
                classList={{ 'border-yellow-500': fileExists() }}
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

            <Show when={fileExists()}>
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
            </Show>

            <Show when={props.error}>
              <div class='bg-destructive/10 text-destructive rounded-lg p-3 text-sm'>
                {props.error?.message}
              </div>
            </Show>
          </div>

          <div class='mt-6 flex justify-end gap-2'>
            <Show when={fileExists()}>
              <button type='button' class='border-input bg-background hover:bg-accent h-9 rounded-md border px-4 text-sm font-medium' disabled={props.isPending} onClick={() => document.querySelector<HTMLInputElement>('input[autofocus]')?.focus()}>
                Save with another name
              </button>
            </Show>
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
    </Show>
  )
}
