import { createCodeSearchPanel } from '@/lib/editor/CodeSearchPanel'
import { DropdownMenu } from '@/lib/ui/menu'
import ArrowUp from '@effectweb/lucide/icons/arrow-up'
import ArrowDown from '@effectweb/lucide/icons/arrow-down'
import Ellipsis from '@effectweb/lucide/icons/ellipsis'
import { Button, buttonVariants } from '@/lib/ui/button'
import {
  controllerView,
  domBinding,
  modelOwner,
  ownerController,
  view,
  type JSX,
  type ControllerModel,
} from 'effectweb'
import { Annotation, EditorState, ChangeSet } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import {
  defaultKeymap,
  history,
  historyKeymap,
  undo,
  redo,
  indentWithTab,
} from '@codemirror/commands'
import { search, searchKeymap } from '@codemirror/search'
import {
  MergeView,
  goToNextChunk,
  goToPreviousChunk,
  unifiedMergeView,
  getChunks,
  getOriginalDoc,
  originalDocChangeEffect,
} from '@codemirror/merge'
import {
  sourceState,
  sourceTrackingExtensions,
  replaceSource,
  detectLineSeparator,
  hasMixedLineEndings,
  rawSourcePaste,
  selectionText,
  sourceSlice,
} from './source'
export type MergeDocumentProps = {
  name: string
  toolbarEnd?: JSX.Element
  remote: string
  local: string
  readOnly: boolean
  onChange: (value: string) => void
}
type Command = 'previous' | 'next' | 'undo' | 'redo' | 'remote'
const external = Annotation.define<boolean>()
const theme = EditorView.theme({
  '&': { color: 'var(--foreground)', backgroundColor: 'var(--background)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'var(--font-mono, monospace)',
    fontSize: '13px',
    lineHeight: '1.6',
  },
  '.cm-content': { caretColor: 'var(--foreground)', userSelect: 'text' },
  '.cm-gutters': {
    backgroundColor: 'var(--muted)',
    color: 'var(--muted-foreground)',
    border: 'none',
  },
  '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
  '.cm-panels': { backgroundColor: 'var(--background)', color: 'var(--foreground)' },
  '.cm-deletedChunk .cm-chunkButtons': {
    position: 'static',
    display: 'flex',
    justifyContent: 'flex-end',
    padding: '4px 0',
  },
  '.cm-deletedChunk button': {
    border: 'revert-layer',
    borderRadius: 'revert-layer',
    color: 'revert-layer',
    margin: '0',
    fontFamily: 'var(--font-sans, sans-serif)',
  },
  '.cm-textfield, .cm-button': {
    color: 'var(--foreground)',
    background: 'var(--muted)',
    border: '1px solid var(--border)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'color-mix(in oklab, var(--primary) 25%, transparent)',
  },
  '.cm-changedLine': { backgroundColor: 'color-mix(in oklab, orange 10%, transparent)' },
  '.cm-changedText': {
    backgroundColor: 'color-mix(in oklab, orange 28%, transparent)',
    backgroundImage: 'none',
  },
})
function controller(props: MergeDocumentProps) {
  const owner = modelOwner({ props, count: 0, inline: false })
  let command: ((value: Command) => void) | null = null
  return {
    ...ownerController(owner),
    command: (value: Command) => command?.(value),
    register: (handler: typeof command) => {
      command = handler
    },
    count: (count: number) => owner.patch({ count }),
    inline: (inline: boolean) => owner.patch({ inline }),
  }
}
type Model = ControllerModel<typeof controller>
function bindMerge(parent: HTMLDivElement, current: () => Model) {
  let disposed = false,
    queued = false
  let previousRemote = current().props.remote,
    previousLocal = current().props.local
  let merge: MergeView | undefined
  let single: EditorView | undefined
  const localEditor = () => single ?? merge?.b
  const report = () => {
    if (queued) return
    queued = true
    queueMicrotask(() => {
      queued = false
      if (!disposed)
        current().actions.count(
          single ? (getChunks(single.state)?.chunks.length ?? 0) : (merge?.chunks.length ?? 0),
        )
    })
  }
  const extensions = (readOnly: boolean, label: string, content: string) => [
    theme,
    lineNumbers(),
    EditorView.lineWrapping,
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
    EditorView.contentAttributes.of({
      role: readOnly ? 'document' : 'textbox',
      'aria-label': label,
      'aria-readonly': String(readOnly),
      'aria-multiline': 'true',
      tabindex: '0',
      spellcheck: 'false',
    }),
    history(),
    search({ top: true, createPanel: createCodeSearchPanel }),
    sourceTrackingExtensions(content),
    keymap.of([...searchKeymap, ...historyKeymap, ...defaultKeymap, indentWithTab]),
    EditorView.domEventHandlers({
      keydown(event) {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
          event.preventDefault()
          event.stopPropagation()
          return true
        }
        return false
      },
      paste(event, view) {
        if (view.state.readOnly) return false
        const text = event.clipboardData?.getData('text/plain')
        if (text === undefined) return false
        event.preventDefault()
        view.dispatch(view.state.replaceSelection(text), {
          annotations: rawSourcePaste.of(text),
          userEvent: 'input.paste',
          scrollIntoView: true,
        })
        return true
      },
      copy(event, view) {
        if (view.state.selection.main.empty || !event.clipboardData) return false
        const source = view.state.field(sourceState)
        event.clipboardData.setData(
          'text/plain',
          selectionText(view, source.text, source.lineSeparator),
        )
        event.preventDefault()
        return true
      },
    }),
    EditorView.updateListener.of((update) => {
      if (
        update.docChanged &&
        !update.transactions.some((tr) => tr.annotation(external)) &&
        update.view === localEditor()
      ) {
        previousLocal = update.state.field(sourceState).text
        current().props.onChange(previousLocal)
      }
      if (update.docChanged) report()
    }),
  ]
  const inline = parent.clientWidth < 600
  current().actions.inline(inline)
  if (inline) {
    single = new EditorView({
      parent,
      doc: previousLocal,
      extensions: [
        ...extensions(current().props.readOnly, 'Reviewed version', previousLocal),
        unifiedMergeView({
          original: previousRemote,
          collapseUnchanged: { margin: 3, minSize: 8 },
          mergeControls: current().props.readOnly
            ? false
            : (type) => {
                if (type === 'accept') return document.createElement('span')
                const button = document.createElement('button')
                button.type = 'button'
                button.textContent = 'Use server change'
                button.setAttribute('aria-label', 'Use this server change')
                button.className = buttonVariants({ variant: 'outline', size: 'sm' })
                button.addEventListener('click', (event) => {
                  event.preventDefault()
                  if (!single) return
                  const widget = button.closest('.cm-deletedChunk')
                  if (!widget) return
                  const pos = single.posAtDOM(widget)
                  const chunk = getChunks(single.state)?.chunks.find(
                    (chunk) => chunk.fromB <= pos && chunk.toB >= pos,
                  )
                  if (!chunk) return
                  const original = getOriginalDoc(single.state)
                  let insert = sourceSlice(
                    previousRemote,
                    chunk.fromA,
                    Math.min(chunk.toA, original.length),
                  )
                  if (
                    chunk.fromA !== chunk.toA &&
                    chunk.toA > original.length &&
                    chunk.toB <= single.state.doc.length
                  )
                    insert += detectLineSeparator(previousRemote)
                  single.dispatch({
                    changes: {
                      from: chunk.fromB,
                      to: Math.min(chunk.toB, single.state.doc.length),
                      insert,
                    },
                    annotations: rawSourcePaste.of(insert),
                    userEvent: 'input.revert',
                  })
                  single.focus()
                })
                return button
              },
        }),
      ],
    })
  } else
    merge = new MergeView({
      parent,
      a: { doc: previousRemote, extensions: extensions(true, 'Server version', previousRemote) },
      b: {
        doc: previousLocal,
        extensions: extensions(current().props.readOnly, 'Reviewed version', previousLocal),
      },
      revertControls: current().props.readOnly ? undefined : 'a-to-b',
      renderRevertControl: () => {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = '→'
        button.title = 'Use this server change'
        button.setAttribute('aria-label', 'Use this server change')
        button.className = buttonVariants({ variant: 'outline', size: 'icon-sm' })
        button.addEventListener('mousedown', (event) => event.stopPropagation())
        button.addEventListener('click', (event) => {
          event.preventDefault()
          const chunk = merge?.chunks[Number(button.dataset.chunk)]
          if (!merge || !chunk || current().props.readOnly) return
          const source = merge.a.state.field(sourceState)
          let insert = sourceSlice(
            source.text,
            chunk.fromA,
            Math.min(chunk.toA, merge.a.state.doc.length),
          )
          if (
            chunk.fromA !== chunk.toA &&
            chunk.toA > merge.a.state.doc.length &&
            chunk.toB <= merge.b.state.doc.length
          )
            insert += source.lineSeparator
          merge.b.dispatch({
            changes: {
              from: chunk.fromB,
              to: Math.min(chunk.toB, merge.b.state.doc.length),
              insert,
            },
            annotations: rawSourcePaste.of(insert),
            userEvent: 'input.revert',
          })
          merge.b.focus()
        })
        return button
      },
      collapseUnchanged: { margin: 3, minSize: 8 },
      diffConfig: { scanLimit: 500, timeout: 50 },
    })
  const replace = (editor: EditorView, text: string) =>
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: text },
      annotations: external.of(true),
      effects: replaceSource.of({
        text,
        lineSeparator: detectLineSeparator(text),
        mixedLineEndings: hasMixedLineEndings(text),
      }),
    })
  current().actions.register((command) => {
    const editor = localEditor()
    if (!editor) return
    if (command === 'previous') goToPreviousChunk(editor)
    if (command === 'next') goToNextChunk(editor)
    if (command === 'undo') undo(editor)
    if (command === 'redo') redo(editor)
    if (command === 'remote' && !current().props.readOnly) {
      const text = current().props.remote
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: text },
        annotations: rawSourcePaste.of(text),
        userEvent: 'input',
      })
    }
    editor.focus()
  })
  report()
  return {
    update: () => {
      const editor = localEditor()
      if (!editor) return
      if (current().props.remote !== previousRemote) {
        previousRemote = current().props.remote
        if (single) {
          const original = getOriginalDoc(single.state)
          single.dispatch({
            effects: originalDocChangeEffect(
              single.state,
              ChangeSet.of(
                { from: 0, to: original.length, insert: previousRemote },
                original.length,
              ),
            ),
          })
        } else if (merge) replace(merge.a, previousRemote)
      }
      if (current().props.local !== previousLocal) {
        previousLocal = current().props.local
        replace(editor, previousLocal)
      }
    },
    dispose: () => {
      disposed = true
      current().actions.register(null)
      merge?.destroy()
      single?.destroy()
    },
  }
}
export default controllerView(
  { controller },
  view((model) => (
    <div class='flex min-h-0 flex-1 flex-col'>
      <div class='flex h-12 shrink-0 items-center gap-1 border-b border-border px-2'>
        <span class='mr-auto min-w-0 truncate text-sm font-medium' title={model.props.name}>
          {model.props.name}
        </span>
        <span role='status' class='sr-only'>
          {model.count} {model.count === 1 ? 'change' : 'changes'}
        </span>
        <Button
          variant='outline'
          size='icon'
          aria-label='Previous change'
          disabled={!model.count}
          onClick={() => model.actions.command('previous')}
        >
          <ArrowUp />
        </Button>
        <Button
          variant='outline'
          size='icon'
          aria-label='Next change'
          disabled={!model.count}
          onClick={() => model.actions.command('next')}
        >
          <ArrowDown />
        </Button>
        {!model.props.readOnly ? (
          <DropdownMenu
            aria-label='Comparison actions'
            align='end'
            trigger={
              <Button variant='ghost' size='icon' aria-label='Comparison actions'>
                <Ellipsis />
              </Button>
            }
            items={[
              {
                kind: 'item',
                label: 'Undo',
                shortcut: 'Ctrl/⌘ Z',
                onSelect: () => model.actions.command('undo'),
              },
              {
                kind: 'item',
                label: 'Redo',
                shortcut: '⇧Ctrl/⌘ Z',
                onSelect: () => model.actions.command('redo'),
              },
              { kind: 'separator' },
              {
                kind: 'item',
                label: 'Use entire server version',
                onSelect: () => model.actions.command('remote'),
              },
            ]}
          />
        ) : null}
        {model.props.toolbarEnd}
      </div>
      <div class='text-merge-surface min-h-0 flex-1 overflow-auto bg-background'>
        <div>
          {model.inline ? null : (
            <div class='sticky top-0 z-10 grid grid-cols-2 border-b border-border bg-background text-xs font-medium'>
              <div class='px-3 py-2'>Server</div>
              <div class='border-l border-border px-3 py-2'>Your changes</div>
            </div>
          )}
          <div use={domBinding(model, bindMerge)} />
        </div>
      </div>
    </div>
  )),
)
