import { view, domBinding } from 'effectweb'
import AlertCircle from '@effectweb/lucide/icons/alert-circle'
import FilePlus from '@effectweb/lucide/icons/file-plus'
import FolderPlus from '@effectweb/lucide/icons/folder-plus'
export type KbInlineCreateFooterProps = {
  inlineMode: 'file' | 'folder' | null
  setInlineMode: (m: 'file' | 'folder' | null) => void
  inlineName: string
  setInlineName: (v: string | ((p: string) => string)) => void
  inlineFileExists: boolean
  inlineFolderExists: boolean
  createFilePending: boolean
  createFileIsError: boolean
  createFileError: Error | undefined
  createFolderPending: boolean
  createFolderIsError: boolean
  createFolderError: Error | undefined
  submitInlineFile: () => void
  submitInlineFolder: () => void
  resetInlineCreate: () => void
  onFileInputRef: (el: HTMLInputElement | undefined) => void
  onFolderInputRef: (el: HTMLInputElement | undefined) => void
  /** Avoid starting window drag from footer clicks. */
  noWindowDrag?: boolean
}
const inlineFooterBinding = (element: HTMLDivElement, current: () => KbInlineCreateFooterProps) => {
  const handler = (event: PointerEvent) => {
    if (current().inlineMode && event.target instanceof Node && !element.contains(event.target))
      current().resetInlineCreate()
  }
  document.addEventListener('pointerdown', handler, true)
  return () => document.removeEventListener('pointerdown', handler, true)
}
const inlineInputBinding = (
  element: HTMLInputElement,
  current: () => (element: HTMLInputElement | undefined) => void,
) => {
  let registered = current()
  registered(element)
  const frame = requestAnimationFrame(() => element.focus())
  return {
    update: () => {
      const next = current()
      if (next === registered) return
      registered(undefined)
      registered = next
      registered(element)
    },
    dispose: () => {
      cancelAnimationFrame(frame)
      registered(undefined)
    },
  }
}
export const KbInlineCreateFooter = view<KbInlineCreateFooterProps>((props) => {
  const dragProps = () =>
    props.noWindowDrag ? ({ 'data-no-window-drag': true } as const) : ({} as const)
  return (
    <div
      use={domBinding(props, inlineFooterBinding)}
      class='border-border bg-card shrink-0 rounded-t-lg border-t p-1.5'
      {...dragProps()}
      onClick={(e) => e.stopPropagation()}
    >
      <div class='grid grid-cols-2 gap-2'>
        <div class='flex min-w-0 flex-col gap-1'>
          {props.inlineMode === 'file' ? (
            <>
              <input
                type='text'
                use={domBinding(props.onFileInputRef, inlineInputBinding)}
                class={`border-input bg-background dark:bg-input/30 box-border m-0 h-7 min-h-7 max-h-7 w-full rounded-md border px-2 py-0 text-xs leading-none shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                  props.inlineFileExists
                    ? 'border-yellow-500 ring-2 ring-yellow-500/30'
                    : props.createFileIsError
                      ? 'border-destructive ring-2 ring-destructive/30'
                      : ''
                }`}
                placeholder='File name (e.g. notes.md)'
                value={props.inlineName}
                disabled={props.createFilePending}
                onInput={(e) => props.setInlineName((e.currentTarget as HTMLInputElement).value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') props.submitInlineFile()
                  else if (e.key === 'Escape') props.resetInlineCreate()
                }}
              />
              {props.inlineFileExists ? (
                <div class='flex items-start gap-1.5 rounded border border-yellow-500/50 bg-yellow-500/10 px-2 py-1.5 text-xs text-yellow-800 dark:text-yellow-200'>
                  <AlertCircle class='mt-0.5 h-3.5 w-3.5 shrink-0' stroke-width={2} />
                  <span>A file with this name already exists.</span>
                </div>
              ) : null}
              {props.createFileError && !props.inlineFileExists ? (
                <div class='border-destructive/50 bg-destructive/10 text-destructive flex items-start gap-1.5 rounded border px-2 py-1.5 text-xs'>
                  <AlertCircle class='mt-0.5 h-3.5 w-3.5 shrink-0' stroke-width={2} />
                  <span>{props.createFileError?.message}</span>
                </div>
              ) : null}
            </>
          ) : (
            <button
              type='button'
              class='border-border bg-background text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground box-border flex h-7 min-h-7 max-h-7 w-full items-center justify-center gap-1.5 rounded-md border px-2 py-0 text-xs leading-none transition-colors'
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation()
                props.setInlineName('')
                props.setInlineMode('file')
              }}
            >
              <FilePlus class='h-3.5 w-3.5' stroke-width={2} />
              New file
            </button>
          )}
        </div>
        <div class='flex min-w-0 flex-col gap-1'>
          {props.inlineMode === 'folder' ? (
            <>
              <input
                type='text'
                use={domBinding(props.onFolderInputRef, inlineInputBinding)}
                class={`border-input bg-background dark:bg-input/30 box-border m-0 h-7 min-h-7 max-h-7 w-full rounded-md border px-2 py-0 text-xs leading-none shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                  props.inlineFolderExists
                    ? 'border-yellow-500 ring-2 ring-yellow-500/30'
                    : props.createFolderIsError
                      ? 'border-destructive ring-2 ring-destructive/30'
                      : ''
                }`}
                placeholder='Folder name'
                value={props.inlineName}
                disabled={props.createFolderPending}
                onInput={(e) => props.setInlineName((e.currentTarget as HTMLInputElement).value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') props.submitInlineFolder()
                  else if (e.key === 'Escape') props.resetInlineCreate()
                }}
              />
              {props.inlineFolderExists ? (
                <div class='flex items-start gap-1.5 rounded border border-yellow-500/50 bg-yellow-500/10 px-2 py-1.5 text-xs text-yellow-800 dark:text-yellow-200'>
                  <AlertCircle class='mt-0.5 h-3.5 w-3.5 shrink-0' stroke-width={2} />
                  <span>A folder with this name already exists.</span>
                </div>
              ) : null}
              {props.createFolderError && !props.inlineFolderExists ? (
                <div class='border-destructive/50 bg-destructive/10 text-destructive flex items-start gap-1.5 rounded border px-2 py-1.5 text-xs'>
                  <AlertCircle class='mt-0.5 h-3.5 w-3.5 shrink-0' stroke-width={2} />
                  <span>{props.createFolderError?.message}</span>
                </div>
              ) : null}
            </>
          ) : (
            <button
              type='button'
              class='border-border bg-background text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground box-border flex h-7 min-h-7 max-h-7 w-full items-center justify-center gap-1.5 rounded-md border px-2 py-0 text-xs leading-none transition-colors'
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation()
                props.setInlineName('')
                props.setInlineMode('folder')
              }}
            >
              <FolderPlus class='h-3.5 w-3.5' stroke-width={2} />
              New folder
            </button>
          )}
        </div>
      </div>
    </div>
  )
})
