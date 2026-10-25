import { view } from 'effectweb'
import { modalFocus } from '@/lib/ui/modal-focus'
import { modalDialogBackdropClass } from '@/features/explorer/modal-overlay-scope'
import { LazyMergeDocument } from '@/lib/editor/LazyMergeDocument'
import { detectLineSeparator, hasMixedLineEndings } from '@/lib/editor/line-endings'
import type { TextDocumentRemote } from './text-editor-controller'
type Props = {
  path: string
  remote: TextDocumentRemote
  latestVersion: string | undefined
  local: string
  readOnly: boolean
  embedded?: boolean
  pending: boolean
  error: string
  onChange: (value: string) => void
  onLatest: () => void
  onApply: () => void
  onClose: () => void
  onDownload: () => void
}
const lineEnding = (text: string) =>
  hasMixedLineEndings(text)
    ? 'Mixed line endings'
    : detectLineSeparator(text) === '\r\n'
      ? 'CRLF'
      : detectLineSeparator(text) === '\r'
        ? 'CR'
        : 'LF'
export const TextComparisonDialog = view<Props>((props) => {
  const stale = props.remote.version !== props.latestVersion
  const large =
    props.remote.content.length > 2 * 1024 * 1024 || props.local.length > 2 * 1024 * 1024
  return (
    <div
      data-no-window-drag
      class={`${modalDialogBackdropClass(props.embedded ? 'window' : 'viewport')} z-[90]`}
    >
      <section
        role='dialog'
        aria-modal='true'
        aria-label='Review file changes'
        class='flex h-[min(44rem,calc(100dvh-2rem))] max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-xl'
        use={modalFocus({ onEscape: props.onClose })}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's')
            event.preventDefault()
        }}
      >
        <header class='flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3'>
          <div class='min-w-0'>
            <h2 class='text-base font-semibold'>Review file changes</h2>
            <p class='truncate text-xs text-muted-foreground'>{props.path}</p>
          </div>
          <button
            type='button'
            aria-label='Close comparison'
            class='shrink-0 rounded border border-input px-2 py-1'
            onClick={props.onClose}
          >
            Close
          </button>
        </header>
        <p class='shrink-0 border-b border-border px-3 py-2 text-xs text-muted-foreground'>
          Compare the server file with your draft. Edit your version or copy individual changes with
          the arrows. Your edits stay in the draft when you close this view. The file is saved only
          after you finish reviewing and press Save.
        </p>
        {stale ? (
          <div
            role='alert'
            class='flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs'
          >
            <span>The file changed again while you were reviewing it.</span>
            <button
              type='button'
              class='underline disabled:opacity-40'
              disabled={!props.latestVersion}
              onClick={props.onLatest}
            >
              Review latest server version
            </button>
          </div>
        ) : null}
        {props.error ? (
          <p role='alert' class='shrink-0 px-3 py-2 text-sm text-destructive'>
            {props.error}
          </p>
        ) : null}
        {large ? (
          <div class='flex-1 p-4 text-sm'>
            <p>
              Side-by-side comparison supports up to 2 million characters per version. Download your
              draft to compare larger files in another editor.
            </p>
            <button type='button' class='mt-3 underline' onClick={props.onDownload}>
              Download your draft
            </button>
          </div>
        ) : (
          <LazyMergeDocument
            remote={props.remote.content}
            local={props.local}
            readOnly={props.readOnly}
            onChange={props.onChange}
          />
        )}
        <footer class='flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-3 text-xs'>
          <span class='text-muted-foreground'>
            Server: {lineEnding(props.remote.content)}
            {props.remote.content.startsWith('\uFEFF') ? ' · BOM' : ''} · Draft:{' '}
            {lineEnding(props.local)}
            {props.local.startsWith('\uFEFF') ? ' · BOM' : ''}
          </span>
          <button
            type='button'
            disabled={stale || props.pending || large}
            class='rounded bg-primary px-3 py-2 text-sm text-primary-foreground disabled:opacity-40'
            onClick={props.onApply}
          >
            Use reviewed version
          </button>
        </footer>
      </section>
    </div>
  )
})
