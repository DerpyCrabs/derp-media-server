import { domBinding, view, controllerView, resourceError } from 'effectweb'
import { buildResolveMarkdownImageUrl } from '@/lib/markdown/resolve-markdown-image-url'
import { tryPasteKnowledgeBaseImage } from './handle-kb-image-paste'
import { isPathEditable } from '@/lib/files/path-utils'
import AlertCircle from '@effectweb/lucide/icons/alert-circle'
import Download from '@effectweb/lucide/icons/download'
import Save from '@effectweb/lucide/icons/save'
import Zap from '@effectweb/lucide/icons/zap'
import ZapOff from '@effectweb/lucide/icons/zap-off'
import { fileDownloadHref } from '@/lib/files/download-urls'
import { LazyMarkdownDocument } from '@/lib/markdown/LazyMarkdownDocument'
import { completeMarkdownImagePaste } from '@/lib/markdown/paste-completion'
import { dirtyGuard, textController } from './text-editor-controller'
export const TextEditorPane = controllerView(
  { controller: textController, identity: (props) => props.viewingPath },
  view((model) => {
    const props = model.props
    const { actions } = model
    const fileEditable = () => isPathEditable(props.viewingPath, [...props.editableFolders])
    const autoSaveEnabled = () => model.settings?.autoSave?.[props.viewingPath]?.enabled ?? true
    const showEditor = () => fileEditable() && !model.readOnly
    const conflict = () =>
      model.edit !== model.base &&
      model.remote !== undefined &&
      model.remote.version !== model.version
    const ext = () => props.viewingPath.split('.').pop()?.toLowerCase() || ''
    const isMarkdown = () => ext() === 'md'
    const fileName = () => props.viewingPath.split(/[/\\]/).pop() || ''
    const remoteContent = () => model.remote?.content ?? ''
    const markdownContent = () => (fileEditable() ? model.edit : remoteContent())
    const lineCount = () => remoteContent().split('\n').length
    const resolveImageUrl = () =>
      buildResolveMarkdownImageUrl(props.viewingPath, [...(props.knowledgeBases ?? [])])
    const saveInternal = actions.requestSave
    const toggleAutoSave = actions.autoSave
    const toggleReadOnlyFromEditor = () => actions.readOnly(true)
    const enterEditMode = () => actions.readOnly(false)
    const handleCopy = actions.copy
    const handleClose = actions.dismiss
    const setEditContent = actions.edit
    const currentTextTargetKey = () => props.viewingPath
    const kbList = () => [...(props.knowledgeBases ?? [])]
    const handleDownload = () => {
      const link = document.createElement('a')
      link.href = fileDownloadHref(props.viewingPath)
      link.download = fileName()
      link.click()
    }
    return (
      <div
        use={domBinding(model.edit !== model.base, dirtyGuard)}
        role={props.embedded ? undefined : 'dialog'}
        aria-modal={props.embedded ? undefined : 'true'}
        aria-labelledby='text-viewer-title'
        class={
          props.embedded
            ? 'flex h-full min-h-0 flex-col bg-background'
            : 'fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm'
        }
      >
        <header
          class={
            props.embedded
              ? 'flex h-9 shrink-0 flex-wrap items-center gap-1 border-b border-border bg-muted/50 px-2'
              : 'border-border bg-background/90 flex h-auto min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2'
          }
        >
          {props.embedded ? (
            <span class='text-muted-foreground flex items-center gap-1 text-xs'>
              {ext().toUpperCase()}
              {lineCount() > 0 ? <> &middot; {lineCount()} lines</> : null}
            </span>
          ) : null}
          {!props.embedded ? (
            <div class='min-w-0 flex-1'>
              <h2
                id='text-viewer-title'
                class={
                  props.embedded
                    ? 'text-muted-foreground truncate text-xs font-normal'
                    : 'truncate text-lg font-medium'
                }
              >
                {props.embedded ? ext().toUpperCase() : fileName()}
              </h2>
              <p
                class={
                  props.embedded ? 'text-muted-foreground text-xs' : 'text-muted-foreground text-sm'
                }
              >
                {props.embedded ? (
                  remoteContent().length > 0 ? (
                    <span>&middot; {lineCount()} lines</span>
                  ) : null
                ) : (
                  <>
                    {ext().toUpperCase()} File{' '}
                    {remoteContent().length > 0 ? <span>• {lineCount()} lines</span> : null}
                  </>
                )}
              </p>
            </div>
          ) : null}
          <div
            class={
              props.embedded
                ? 'ml-auto flex min-w-0 items-center gap-0.5'
                : 'flex flex-wrap items-center gap-2'
            }
          >
            {showEditor() ? (
              <>
                {fileEditable() ? (
                  <div
                    class={
                      props.embedded
                        ? 'contents'
                        : 'mr-2 flex flex-wrap items-center gap-2 border-r border-border pr-3'
                    }
                  >
                    {!props.embedded ? (
                      <button
                        type='button'
                        class={`rounded-md px-2 py-1 text-sm ${
                          autoSaveEnabled()
                            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                            : 'border border-border bg-background hover:bg-muted'
                        }`}
                        onClick={() => toggleAutoSave()}
                        title={autoSaveEnabled() ? 'Auto-save enabled' : 'Auto-save disabled'}
                      >
                        <span class='inline-flex items-center gap-1.5'>
                          {autoSaveEnabled() ? (
                            <Zap class='h-4 w-4' stroke-width={2} />
                          ) : (
                            <ZapOff class='h-4 w-4' stroke-width={2} />
                          )}
                          Auto-save
                        </span>
                      </button>
                    ) : null}
                    {resourceError(model.saved) && !model.saved.waiting ? (
                      <button
                        type='button'
                        class='text-destructive inline-flex items-center gap-1 text-xs hover:underline'
                        title={resourceError(model.saved)}
                        onClick={() => saveInternal(true)}
                      >
                        <AlertCircle class='h-4 w-4 shrink-0' stroke-width={2} />
                        Save failed — retry
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <button
                  type='button'
                  class={
                    props.embedded
                      ? 'hover:bg-muted rounded-md px-2 py-1 text-xs disabled:opacity-50'
                      : 'hover:bg-muted rounded-md px-2 py-1 text-sm disabled:opacity-50'
                  }
                  disabled={model.saved.waiting}
                  onClick={() => toggleReadOnlyFromEditor()}
                  title='Switch to read-only mode'
                >
                  Read only
                </button>
                {!autoSaveEnabled() && !props.embedded ? (
                  <button
                    type='button'
                    class='bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm disabled:opacity-50'
                    disabled={model.saved.waiting}
                    onClick={() => saveInternal(false)}
                    title='Save changes'
                  >
                    <Save class='h-4 w-4' stroke-width={2} />
                    {model.saved.waiting ? 'Saving…' : 'Save'}
                  </button>
                ) : null}
              </>
            ) : null}
            {!showEditor() ? (
              <>
                {fileEditable() ? (
                  <button
                    type='button'
                    class={
                      props.embedded
                        ? 'bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-2 py-1 text-xs'
                        : 'bg-primary text-primary-foreground hover:bg-primary/90 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm'
                    }
                    onClick={() => enterEditMode()}
                    title='Edit file'
                  >
                    Edit
                  </button>
                ) : null}
                <button
                  type='button'
                  title='Copy to clipboard'
                  class={
                    props.embedded
                      ? 'hover:bg-muted inline-flex h-7 w-7 items-center justify-center rounded-md text-sm'
                      : 'hover:bg-muted inline-flex h-8 w-8 items-center justify-center rounded-md'
                  }
                  onClick={() => handleCopy()}
                >
                  <span class='sr-only'>Copy to clipboard</span>
                  {model.copied ? '✓' : '⎘'}
                </button>
              </>
            ) : null}
            <button
              type='button'
              title='Download'
              aria-label='Download'
              class={
                props.embedded
                  ? 'hover:bg-muted inline-flex h-7 w-7 items-center justify-center rounded-md'
                  : 'hover:bg-muted inline-flex h-8 w-8 items-center justify-center rounded-md'
              }
              onClick={handleDownload}
            >
              <Download
                class={props.embedded ? 'h-3.5 w-3.5' : 'h-5 w-5'}
                stroke-width={2}
                aria-hidden='true'
              />
            </button>
            <button
              type='button'
              title='Close'
              style={{ display: props.showClose === false ? 'none' : undefined }}
              class={
                props.embedded
                  ? 'hover:bg-muted inline-flex h-7 w-7 items-center justify-center rounded-md'
                  : 'hover:bg-muted inline-flex h-8 w-8 items-center justify-center rounded-md'
              }
              onClick={() => handleClose()}
            >
              <span class='sr-only'>Close</span>×
            </button>
          </div>
        </header>
        <div class='min-h-0 flex-1 overflow-hidden'>
          {conflict() ? (
            <div class='flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-900 dark:text-amber-200'>
              <span>This file changed elsewhere. Your unsaved edits were kept.</span>
              <button
                type='button'
                class='shrink-0 underline'
                onClick={() => {
                  actions.reload()
                }}
              >
                Reload remote version
              </button>
            </div>
          ) : null}
          {model.loading ? <p class='text-muted-foreground p-4 text-sm'>Loading…</p> : null}
          {model.loadError ? (
            <p class='text-destructive p-4 text-sm'>Failed to load file.</p>
          ) : null}
          {!model.loading && !model.loadError ? (
            isMarkdown() ? (
              currentTextTargetKey() ? (
                <LazyMarkdownDocument
                  content={markdownContent()}
                  mode={showEditor() ? 'edit' : 'read'}
                  onChange={setEditContent}
                  onBlur={() => {
                    if (fileEditable() && autoSaveEnabled() && !conflict()) saveInternal(true)
                  }}
                  onSave={() => actions.save(false)}
                  resolveImageUrl={resolveImageUrl()}
                  onPasteImage={(event, _selection, complete) => {
                    return tryPasteKnowledgeBaseImage(event, {
                      viewingPath: props.viewingPath,
                      knowledgeBases: kbList(),
                      editableFolders: [...props.editableFolders],
                      completeCodeMirrorPaste: (markdown) =>
                        completeMarkdownImagePaste(markdown, complete, actions.pasteCanSave, () => {
                          actions.requestSave(true)
                        }),
                    })
                  }}
                  ariaLabel={`${fileName()} Markdown ${showEditor() ? 'editor' : 'document'}`}
                />
              ) : null
            ) : showEditor() ? (
              <div class={props.embedded ? 'h-full' : 'h-full p-4'}>
                <textarea
                  class={
                    props.embedded
                      ? 'bg-transparent font-sans text-base leading-[1.75] text-foreground h-full w-full resize-none px-3 py-2 wrap-break-word whitespace-pre-wrap focus:outline-none'
                      : 'border-input bg-background focus-visible:ring-ring h-full w-full resize-none rounded-lg border p-4 font-sans text-base leading-[1.75] text-foreground wrap-break-word whitespace-pre-wrap focus-visible:ring-2 focus-visible:outline-none'
                  }
                  value={model.edit}
                  spellcheck={false}
                  placeholder='Enter text…'
                  onInput={(e) => setEditContent(e.currentTarget.value)}
                  onBlur={() => {
                    if (autoSaveEnabled() && !conflict()) saveInternal(true)
                  }}
                  onKeyDown={(e) => {
                    if (
                      e.key === 'ArrowLeft' ||
                      e.key === 'ArrowRight' ||
                      e.key === 'ArrowUp' ||
                      e.key === 'ArrowDown' ||
                      e.key === 'Home' ||
                      e.key === 'End' ||
                      e.key === 'PageUp' ||
                      e.key === 'PageDown'
                    ) {
                      e.stopPropagation()
                    }
                  }}
                />
              </div>
            ) : (
              <div class={props.embedded ? 'h-full overflow-auto' : 'h-full overflow-auto p-4'}>
                <pre
                  class={
                    props.embedded
                      ? 'select-text wrap-break-word whitespace-pre-wrap px-3 py-2 font-sans text-base leading-[1.75] text-foreground'
                      : 'select-text wrap-break-word whitespace-pre-wrap font-sans text-base leading-[1.75] text-foreground'
                  }
                >
                  {remoteContent()}
                </pre>
              </div>
            )
          ) : null}
        </div>
      </div>
    )
  }),
)
export type { TextEditorPaneProps } from './text-editor-controller'
