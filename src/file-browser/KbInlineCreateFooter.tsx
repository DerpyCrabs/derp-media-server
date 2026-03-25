import AlertCircle from 'lucide-solid/icons/alert-circle'
import FilePlus from 'lucide-solid/icons/file-plus'
import FolderPlus from 'lucide-solid/icons/folder-plus'
import type { Accessor } from 'solid-js'
import { Show, createEffect, onCleanup } from 'solid-js'

export type KbInlineCreateFooterProps = {
  inlineMode: Accessor<'file' | 'folder' | null>
  setInlineMode: (m: 'file' | 'folder' | null) => void
  inlineName: Accessor<string>
  setInlineName: (v: string | ((p: string) => string)) => void
  inlineFileExists: Accessor<boolean>
  inlineFolderExists: Accessor<boolean>
  createFilePending: Accessor<boolean>
  createFileIsError: Accessor<boolean>
  createFileError: Accessor<Error | undefined>
  createFolderPending: Accessor<boolean>
  createFolderIsError: Accessor<boolean>
  createFolderError: Accessor<Error | undefined>
  submitInlineFile: () => void | Promise<void>
  submitInlineFolder: () => void | Promise<void>
  resetInlineCreate: () => void
  onFileInputRef: (el: HTMLInputElement | undefined) => void
  onFolderInputRef: (el: HTMLInputElement | undefined) => void
  /** Workspace: avoid starting window drag from footer clicks */
  noWindowDrag?: boolean
}

export function KbInlineCreateFooter(props: KbInlineCreateFooterProps) {
  const dragProps = () =>
    props.noWindowDrag ? ({ 'data-no-window-drag': true } as const) : ({} as const)

  let rootEl: HTMLDivElement | undefined

  createEffect(() => {
    if (props.inlineMode() === null) return
    const handler = (ev: PointerEvent) => {
      const el = rootEl
      const target = ev.target
      if (!el || !(target instanceof Node) || el.contains(target)) return
      props.resetInlineCreate()
    }
    document.addEventListener('pointerdown', handler, true)
    onCleanup(() => document.removeEventListener('pointerdown', handler, true))
  })

  return (
    <div
      ref={(el) => {
        rootEl = el ?? undefined
      }}
      class='border-border bg-card shrink-0 border-t px-2 py-1.5'
      {...dragProps()}
      onClick={(e) => e.stopPropagation()}
    >
      <div class='grid grid-cols-2 gap-2'>
        <div class='flex min-w-0 flex-col gap-1'>
          <Show
            when={props.inlineMode() === 'file'}
            fallback={
              <button
                type='button'
                class='border-border bg-background text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground box-border flex h-7 min-h-7 max-h-7 w-full items-center justify-center gap-1.5 rounded-none border border-dashed px-2 py-0 text-xs leading-none transition-colors'
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
            }
          >
            <input
              type='text'
              ref={(el) => props.onFileInputRef(el ?? undefined)}
              class={`border-input bg-background dark:bg-input/30 box-border m-0 h-7 min-h-7 max-h-7 w-full rounded-none border px-2 py-0 text-xs leading-none shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                props.inlineFileExists()
                  ? 'border-yellow-500 ring-2 ring-yellow-500/30'
                  : props.createFileIsError()
                    ? 'border-destructive ring-2 ring-destructive/30'
                    : ''
              }`}
              placeholder='File name (e.g. notes.md)'
              value={props.inlineName()}
              disabled={props.createFilePending()}
              onInput={(e) => props.setInlineName((e.currentTarget as HTMLInputElement).value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void props.submitInlineFile()
                else if (e.key === 'Escape') props.resetInlineCreate()
              }}
            />
            <Show when={props.inlineFileExists()}>
              <div class='flex items-start gap-1.5 rounded border border-yellow-500/50 bg-yellow-500/10 px-2 py-1.5 text-xs text-yellow-800 dark:text-yellow-200'>
                <AlertCircle class='mt-0.5 h-3.5 w-3.5 shrink-0' stroke-width={2} />
                <span>A file with this name already exists.</span>
              </div>
            </Show>
            <Show when={props.createFileError() && !props.inlineFileExists()}>
              <div class='border-destructive/50 bg-destructive/10 text-destructive flex items-start gap-1.5 rounded border px-2 py-1.5 text-xs'>
                <AlertCircle class='mt-0.5 h-3.5 w-3.5 shrink-0' stroke-width={2} />
                <span>{props.createFileError()?.message}</span>
              </div>
            </Show>
          </Show>
        </div>
        <div class='flex min-w-0 flex-col gap-1'>
          <Show
            when={props.inlineMode() === 'folder'}
            fallback={
              <button
                type='button'
                class='border-border bg-background text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground box-border flex h-7 min-h-7 max-h-7 w-full items-center justify-center gap-1.5 rounded-none border border-dashed px-2 py-0 text-xs leading-none transition-colors'
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
            }
          >
            <input
              type='text'
              ref={(el) => props.onFolderInputRef(el ?? undefined)}
              class={`border-input bg-background dark:bg-input/30 box-border m-0 h-7 min-h-7 max-h-7 w-full rounded-none border px-2 py-0 text-xs leading-none shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                props.inlineFolderExists()
                  ? 'border-yellow-500 ring-2 ring-yellow-500/30'
                  : props.createFolderIsError()
                    ? 'border-destructive ring-2 ring-destructive/30'
                    : ''
              }`}
              placeholder='Folder name'
              value={props.inlineName()}
              disabled={props.createFolderPending()}
              onInput={(e) => props.setInlineName((e.currentTarget as HTMLInputElement).value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void props.submitInlineFolder()
                else if (e.key === 'Escape') props.resetInlineCreate()
              }}
            />
            <Show when={props.inlineFolderExists()}>
              <div class='flex items-start gap-1.5 rounded border border-yellow-500/50 bg-yellow-500/10 px-2 py-1.5 text-xs text-yellow-800 dark:text-yellow-200'>
                <AlertCircle class='mt-0.5 h-3.5 w-3.5 shrink-0' stroke-width={2} />
                <span>A folder with this name already exists.</span>
              </div>
            </Show>
            <Show when={props.createFolderError() && !props.inlineFolderExists()}>
              <div class='border-destructive/50 bg-destructive/10 text-destructive flex items-start gap-1.5 rounded border px-2 py-1.5 text-xs'>
                <AlertCircle class='mt-0.5 h-3.5 w-3.5 shrink-0' stroke-width={2} />
                <span>{props.createFolderError()?.message}</span>
              </div>
            </Show>
          </Show>
        </div>
      </div>
    </div>
  )
}
