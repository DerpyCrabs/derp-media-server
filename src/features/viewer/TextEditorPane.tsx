import { TextComparisonDialog } from './TextComparisonDialog'
import { openPlaylistImport } from '@/features/music/actions'
import { LazyTableDocument } from '@/features/table/LazyTableDocument'
import { LazyPlainTextDocument } from '@/lib/editor/LazyPlainTextDocument'
import { getMediaExtensionFromPath } from '@/lib/media/media-utils'
import { domBinding, view, controllerView, resourceError } from 'effectweb'
import { buildResolveMarkdownImageUrl } from '@/lib/markdown/resolve-markdown-image-url'
import { tryPasteKnowledgeBaseImage } from './handle-kb-image-paste'
import { isPathEditable } from '@/lib/files/path-utils'
import AlertCircle from '@effectweb/lucide/icons/alert-circle'
import Download from '@effectweb/lucide/icons/download'
import Save from '@effectweb/lucide/icons/save'
import Zap from '@effectweb/lucide/icons/zap'
import ZapOff from '@effectweb/lucide/icons/zap-off'
import SaveAll from '@effectweb/lucide/icons/save-all'
import { SaveFileDialog } from '@/features/explorer/SaveFileDialog'
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
    const recovery = model.draftCandidates.find((draft) => draft.content !== model.remote?.content)
    const ext = () => getMediaExtensionFromPath(props.viewingPath)
    const isMarkdown = () => ext() === 'md'
    const isTable = () => ext() === 'csv' || ext() === 'tsv'
    const fileName = () => props.viewingPath.split(/[/\\]/).pop() || ''
    const remoteContent = () => model.remote?.content ?? ''
    const markdownContent = () => model.edit
    const lineCount = () => model.edit.split('\n').length
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
    return (
      <div
        use={domBinding(
          {
            dirty: model.edit !== model.base,
            onSaveAs: actions.openSaveAs,
            canSaveAs: props.editableFolders.length > 0 && !model.saveAsOpen,
          },
          dirtyGuard,
        )}
        role={props.embedded ? undefined : 'dialog'}
        aria-modal={props.embedded ? undefined : 'true'}
        aria-labelledby='text-viewer-title'
        class={
          props.embedded
            ? 'relative flex h-full min-h-0 flex-col bg-background'
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
            {['m3u', 'm3u8', 'pls', 'xspf'].includes(ext()) ? (
              <button
                class='rounded-md px-2 py-1 text-sm hover:bg-muted disabled:opacity-40'
                disabled={model.loading || !!model.loadError}
                onClick={() => openPlaylistImport(props.viewingPath, model.edit)}
              >
                Import playlist…
              </button>
            ) : null}
            {isTable() ? (
              <div class='flex rounded-md border border-border p-0.5' aria-label='Document view'>
                <button
                  class='rounded px-2 py-1 text-xs aria-pressed:bg-muted'
                  aria-pressed={model.tableView}
                  onClick={() => actions.tableView(true)}
                >
                  Table
                </button>
                <button
                  class='rounded px-2 py-1 text-xs aria-pressed:bg-muted'
                  aria-pressed={!model.tableView}
                  onClick={() => actions.tableView(false)}
                >
                  Text
                </button>
              </div>
            ) : null}
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
            {props.editableFolders.length > 0 ? (
              <button
                type='button'
                title='Save as (Ctrl+Shift+S)'
                aria-label='Save as'
                disabled={model.loading || !!model.loadError}
                class={
                  props.embedded
                    ? 'hover:bg-muted inline-flex size-7 items-center justify-center rounded-md'
                    : 'hover:bg-muted inline-flex size-8 items-center justify-center rounded-md'
                }
                onClick={actions.openSaveAs}
              >
                <SaveAll size={props.embedded ? 14 : 18} />
              </button>
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
              onClick={actions.download}
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
        {model.comparison ? (
          <TextComparisonDialog
            path={props.viewingPath}
            remote={model.comparison}
            latestVersion={model.remote?.version}
            local={model.edit}
            readOnly={!fileEditable() || model.readOnly}
            embedded={props.embedded}
            pending={model.saved.waiting}
            error={model.comparisonError}
            onChange={actions.edit}
            onLatest={actions.compare}
            onApply={actions.useReviewed}
            onClose={actions.closeComparison}
            onDownload={actions.download}
          />
        ) : null}
        <div class='flex min-h-0 flex-1 flex-col overflow-hidden'>
          {recovery ? (
            <div
              role='status'
              class='flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-muted/50 px-3 py-2 text-xs'
            >
              <span class='mr-auto'>
                Unsaved draft available in this browser
                {model.draftCandidates.length > 1
                  ? ` (${model.draftCandidates.length} versions)`
                  : ''}
                .
              </span>
              <button
                type='button'
                class='underline disabled:opacity-40'
                disabled={!model.remote}
                onClick={() => actions.restoreDraft(recovery)}
              >
                Restore draft
              </button>
              <button
                type='button'
                class='underline'
                onClick={() => actions.discardDraft(recovery)}
              >
                Discard draft
              </button>
            </div>
          ) : null}
          {model.recovered ? (
            <div
              role='status'
              class='flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-muted/50 px-3 py-2 text-xs'
            >
              <span class='mr-auto'>Draft restored. Review it before saving.</span>
              {fileEditable() && !conflict() ? (
                <button
                  type='button'
                  class='underline'
                  disabled={model.saved.waiting}
                  onClick={() => actions.requestSave(false)}
                >
                  Save restored draft
                </button>
              ) : null}
            </div>
          ) : null}
          {model.draftError ? (
            <p
              role='alert'
              class='shrink-0 border-b border-amber-500/40 px-3 py-2 text-xs text-amber-700 dark:text-amber-300'
            >
              {model.draftError}
            </p>
          ) : null}

          {model.reviewed ? (
            <div
              role='status'
              class='flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-muted/50 px-3 py-2 text-xs'
            >
              <span class='mr-auto'>
                Changes reviewed. Save when you are ready; automatic saving is paused.
              </span>
              {fileEditable() && !conflict() ? (
                <button
                  type='button'
                  class='underline disabled:opacity-40'
                  disabled={model.saved.waiting}
                  onClick={() => actions.requestSave(false)}
                >
                  Save reviewed version
                </button>
              ) : null}
            </div>
          ) : null}
          {conflict() ? (
            <div class='flex flex-wrap items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-900 dark:text-amber-200'>
              <span>This file changed elsewhere. Your unsaved edits were kept.</span>
              <button type='button' class='shrink-0 underline' onClick={actions.compare}>
                Review changes…
              </button>
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
            <p role='alert' class='text-destructive p-4 text-sm'>
              {model.loadError}
            </p>
          ) : null}
          <div class='min-h-0 flex-1 overflow-hidden'>
            {!model.loading && !model.loadError ? (
              isTable() && model.tableView ? (
                <LazyTableDocument
                  path={props.viewingPath}
                  content={model.edit}
                  readOnly={!showEditor()}
                  onChange={setEditContent}
                  onBlur={() => {
                    if (showEditor() && autoSaveEnabled() && !conflict()) saveInternal(true)
                  }}
                  onSave={() => actions.save(false)}
                />
              ) : isMarkdown() ? (
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
                          completeMarkdownImagePaste(
                            markdown,
                            complete,
                            actions.pasteCanSave,
                            () => {
                              actions.requestSave(true)
                            },
                          ),
                      })
                    }}
                    ariaLabel={`${fileName()} Markdown ${showEditor() ? 'editor' : 'document'}`}
                  />
                ) : null
              ) : (
                <LazyPlainTextDocument
                  path={props.viewingPath}
                  content={model.edit}
                  readOnly={!showEditor()}
                  code={ext() !== 'txt'}
                  ariaLabel={`${fileName()} ${showEditor() ? 'editor' : 'document'}`}
                  onChange={setEditContent}
                  onBlur={() => {
                    if (showEditor() && autoSaveEnabled() && !conflict()) saveInternal(true)
                  }}
                  onSave={() => actions.save(false)}
                />
              )
            ) : null}
          </div>
        </div>
        {model.edit !== model.base ? (
          <footer
            role='status'
            class='shrink-0 border-t border-border px-3 py-1 text-xs text-muted-foreground'
          >
            {model.draftBackedUp
              ? 'Unsaved changes · Draft backed up in this browser'
              : 'Unsaved changes'}
          </footer>
        ) : null}
        {model.saveAsOpen ? (
          <SaveFileDialog
            title='Save text as'
            suggestedPath={props.viewingPath}
            editableFolders={props.editableFolders}
            pending={model.saveAsPending}
            error={model.saveAsError}
            overlayScope={props.embedded ? 'window' : 'viewport'}
            description='Creates a new file with the current text and opens it.'
            onConfirm={actions.saveAs}
            onClose={actions.closeSaveAs}
          />
        ) : null}
      </div>
    )
  }),
)
export type { TextEditorPaneProps } from './text-editor-controller'
