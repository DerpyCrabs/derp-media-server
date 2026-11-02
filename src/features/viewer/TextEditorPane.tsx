import { NativeFileMenu } from '@/desktop/NativeOpen'
import { type MenuEntry } from '@/lib/ui/menu'
import Ellipsis from '@effectweb/lucide/icons/ellipsis'
import X from '@effectweb/lucide/icons/x'
import { Button } from '@/lib/ui/button'
import { TextComparisonDialog } from './TextComparisonDialog'
import { LazyTableDocument } from '@/features/table/LazyTableDocument'
import { LazyPlainTextDocument } from '@/lib/editor/LazyPlainTextDocument'
import { getMediaExtensionFromPath } from '@/lib/media/media-utils'
import { domBinding, view, controllerView, resourceError } from 'effectweb'
import { buildResolveMarkdownImageUrl } from '@/lib/markdown/resolve-markdown-image-url'
import { tryPasteKnowledgeBaseImage } from './handle-kb-image-paste'
import { isPathEditable } from '@/lib/files/path-utils'
import Save from '@effectweb/lucide/icons/save'
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
    const markdownContent = () => model.edit
    const resolveImageUrl = () =>
      buildResolveMarkdownImageUrl(props.viewingPath, [...(props.knowledgeBases ?? [])])
    const saveInternal = actions.requestSave
    const handleClose = actions.dismiss
    const setEditContent = actions.edit
    const currentTextTargetKey = () => props.viewingPath
    const kbList = () => [...(props.knowledgeBases ?? [])]
    const menu: MenuEntry[] = [
      ...(model.browserDownloads
        ? [{ kind: 'item' as const, label: 'Download', onSelect: actions.download }]
        : []),
      {
        kind: 'item',
        label: 'Save as…',
        shortcut: '⇧Ctrl/⌘ S',
        onSelect: actions.openSaveAs,
        disabled: !props.editableFolders.length || model.loading,
      },
      { kind: 'item', label: model.copied ? 'Copied' : 'Copy text', onSelect: actions.copy },
      ...(fileEditable()
        ? [
            { kind: 'separator' as const },
            {
              kind: 'checkbox' as const,
              label: 'Auto-save',
              checked: autoSaveEnabled(),
              onCheckedChange: actions.autoSave,
            },
            {
              kind: 'checkbox' as const,
              label: 'Read only',
              checked: model.readOnly,
              onCheckedChange: actions.readOnly,
            },
          ]
        : []),
      ...(isTable()
        ? [
            {
              kind: 'checkbox' as const,
              label: 'Table view',
              checked: model.tableView,
              onCheckedChange: actions.tableView,
            },
          ]
        : []),
      ...(recovery
        ? [
            { kind: 'separator' as const },
            {
              kind: 'item' as const,
              label: 'Restore unsaved changes',
              onSelect: () => actions.restoreDraft(recovery),
            },
            {
              kind: 'item' as const,
              label: 'Discard recovered changes',
              onSelect: () => actions.discardDraft(recovery),
            },
          ]
        : []),
    ]
    const closeButton =
      props.showClose !== false ? (
        <Button variant='ghost' size='icon' aria-label='Close' onClick={handleClose}>
          <X />
        </Button>
      ) : null
    const toolbar = (
      <>
        <h2
          id='text-viewer-title'
          class='min-w-0 flex-1 truncate text-sm font-medium'
          title={props.viewingPath}
        >
          {fileName()}
          {model.edit !== model.base ? (
            <span aria-label='Unsaved changes' class='ml-2 text-muted-foreground'>
              ●
            </span>
          ) : null}
        </h2>
        {fileEditable() ? (
          <Button
            variant='ghost'
            size='icon'
            aria-label='Save'
            title='Save (Ctrl/⌘ S)'
            disabled={model.saved.waiting || model.loading || model.edit === model.base}
            onClick={() => saveInternal(false)}
          >
            <Save />
          </Button>
        ) : null}
        <NativeFileMenu
          path={props.viewingPath}
          aria-label='Document actions'
          align='end'
          trigger={
            <Button variant='ghost' size='icon' aria-label='Document actions'>
              <Ellipsis />
            </Button>
          }
          items={menu}
        />
      </>
    )
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
        {isMarkdown() ? (
          <header class='flex h-10 shrink-0 items-center gap-1 border-b border-border px-2'>
            {toolbar}
            {closeButton}
          </header>
        ) : null}
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
          {resourceError(model.saved) ? (
            <p role='alert' class='px-3 py-2 text-sm text-destructive'>
              {resourceError(model.saved)}
            </p>
          ) : null}
          {model.draftError ? (
            <p
              role='alert'
              class='shrink-0 border-b border-amber-500/40 px-3 py-2 text-xs text-amber-700 dark:text-amber-300'
            >
              {model.draftError}
            </p>
          ) : null}

          {conflict() ? (
            <div class='flex flex-wrap items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-900 dark:text-amber-200'>
              <span>This file changed elsewhere. Your unsaved edits were kept.</span>
              <Button
                variant='ghost'
                type='button'
                class='shrink-0 underline'
                onClick={actions.compare}
              >
                Review changes…
              </Button>
              <Button
                variant='ghost'
                type='button'
                class='shrink-0 underline'
                onClick={() => {
                  actions.reload()
                }}
              >
                Reload remote version
              </Button>
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
                  toolbar={toolbar}
                  toolbarEnd={closeButton}
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
                  toolbar={toolbar}
                  toolbarEnd={closeButton}
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
        {model.saveAsOpen ? (
          <SaveFileDialog
            title='Save text as'
            suggestedPath={props.viewingPath}
            editableFolders={props.editableFolders}
            pending={model.saveAsPending}
            error={model.saveAsError}
            overlayScope={props.embedded ? 'window' : 'viewport'}
            onConfirm={actions.saveAs}
            onClose={actions.closeSaveAs}
          />
        ) : null}
      </div>
    )
  }),
)
export type { TextEditorPaneProps } from './text-editor-controller'
