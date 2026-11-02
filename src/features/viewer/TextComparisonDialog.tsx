import X from '@effectweb/lucide/icons/x'
import Check from '@effectweb/lucide/icons/check'
import { BrowserDownload } from '@/lib/ui/browser-download'
import { Button } from '@/lib/ui/button'
import { view } from 'effectweb'
import { Dialog } from '@/lib/ui/dialog'
import { LazyMergeDocument } from '@/lib/editor/LazyMergeDocument'
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
export const TextComparisonDialog = view<Props>((props) => {
  const stale = props.remote.version !== props.latestVersion
  const large =
    props.remote.content.length > 2 * 1024 * 1024 || props.local.length > 2 * 1024 * 1024
  const toolbarEnd = (
    <>
      <Button
        variant='default'
        size='icon'
        aria-label='Use reviewed version'
        title='Use reviewed version'
        disabled={stale || props.pending || large}
        onClick={props.onApply}
      >
        <Check />
      </Button>
      <Button variant='ghost' size='icon' aria-label='Close comparison' onClick={props.onClose}>
        <X />
      </Button>
    </>
  )
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      showCloseButton={false}
      aria-label='Review file changes'
      class='flex h-[min(44rem,calc(100dvh-2rem))] sm:max-w-6xl flex-col overflow-hidden p-0 gap-0'
    >
      {stale ? (
        <div
          role='alert'
          class='flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs'
        >
          <span>The file changed again while you were reviewing it.</span>
          <Button
            variant='ghost'
            type='button'
            class='underline disabled:opacity-40'
            disabled={!props.latestVersion}
            onClick={props.onLatest}
          >
            Review latest server version
          </Button>
        </div>
      ) : null}
      {props.error ? (
        <p role='alert' class='shrink-0 px-3 py-2 text-sm text-destructive'>
          {props.error}
        </p>
      ) : null}
      {large ? (
        <div class='flex-1 p-4 text-sm'>
          <div class='mb-4 flex justify-end gap-1'>{toolbarEnd}</div>
          <p>This file is too large for comparison.</p>
          <BrowserDownload>
            <Button variant='ghost' type='button' class='mt-3 underline' onClick={props.onDownload}>
              Save a copy
            </Button>
          </BrowserDownload>
        </div>
      ) : (
        <LazyMergeDocument
          name={props.path.split('/').pop() ?? props.path}
          toolbarEnd={toolbarEnd}
          remote={props.remote.content}
          local={props.local}
          readOnly={props.readOnly}
          onChange={props.onChange}
        />
      )}
    </Dialog>
  )
})
