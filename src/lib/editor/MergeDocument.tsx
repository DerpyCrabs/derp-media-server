import { controllerView, domBinding, modelOwner, view, type ControllerModel } from 'effectweb'
import { Annotation, EditorState } from '@codemirror/state'
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
import { MergeView, goToNextChunk, goToPreviousChunk } from '@codemirror/merge'
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
  const owner = modelOwner({ props, count: 0 })
  let command: ((value: Command) => void) | null = null
  return {
    source: owner.source,
    command: (value: Command) => command?.(value),
    register: (handler: typeof command) => {
      command = handler
    },
    count: (count: number) => owner.patch({ count }),
    receive: (props: MergeDocumentProps) => owner.patch({ props }),
    lifetime: owner,
  }
}
type Model = ControllerModel<typeof controller>
function bindMerge(parent: HTMLDivElement, current: () => Model) {
  let disposed = false,
    queued = false
  let previousRemote = current().props.remote,
    previousLocal = current().props.local
  let merge: MergeView | undefined
  const report = () => {
    if (queued) return
    queued = true
    queueMicrotask(() => {
      queued = false
      if (!disposed && merge) current().actions.count(merge.chunks.length)
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
    search({ top: true }),
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
        merge &&
        update.view === merge.b
      ) {
        previousLocal = update.state.field(sourceState).text
        current().props.onChange(previousLocal)
      }
      if (update.docChanged) report()
    }),
  ]
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
      button.className =
        'rounded border border-border bg-background px-2 py-1 text-foreground hover:bg-muted'
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
          changes: { from: chunk.fromB, to: Math.min(chunk.toB, merge.b.state.doc.length), insert },
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
    if (!merge) return
    if (command === 'previous') goToPreviousChunk(merge.b)
    if (command === 'next') goToNextChunk(merge.b)
    if (command === 'undo') undo(merge.b)
    if (command === 'redo') redo(merge.b)
    if (command === 'remote' && !current().props.readOnly) {
      const text = current().props.remote
      merge.b.dispatch({
        changes: { from: 0, to: merge.b.state.doc.length, insert: text },
        annotations: rawSourcePaste.of(text),
        userEvent: 'input',
      })
    }
    merge.b.focus()
  })
  report()
  return {
    update: () => {
      if (!merge) return
      if (current().props.remote !== previousRemote) {
        previousRemote = current().props.remote
        replace(merge.a, previousRemote)
      }
      if (current().props.local !== previousLocal) {
        previousLocal = current().props.local
        replace(merge.b, previousLocal)
      }
    },
    dispose: () => {
      disposed = true
      current().actions.register(null)
      merge?.destroy()
    },
  }
}
export default controllerView(
  { controller },
  view((model) => (
    <div class='flex min-h-0 flex-1 flex-col'>
      <div class='flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs'>
        <span role='status' class='mr-auto'>
          {model.count} {model.count === 1 ? 'change' : 'changes'}
        </span>
        <button
          type='button'
          class='rounded border border-input px-2 py-1 disabled:opacity-40'
          disabled={!model.count}
          onClick={() => model.actions.command('previous')}
        >
          Previous change
        </button>
        <button
          type='button'
          class='rounded border border-input px-2 py-1 disabled:opacity-40'
          disabled={!model.count}
          onClick={() => model.actions.command('next')}
        >
          Next change
        </button>
        {!model.props.readOnly ? (
          <>
            <button
              type='button'
              class='rounded border border-input px-2 py-1'
              onClick={() => model.actions.command('undo')}
            >
              Undo
            </button>
            <button
              type='button'
              class='rounded border border-input px-2 py-1'
              onClick={() => model.actions.command('redo')}
            >
              Redo
            </button>
            <button
              type='button'
              class='rounded border border-input px-2 py-1'
              onClick={() => model.actions.command('remote')}
            >
              Use entire server version
            </button>
          </>
        ) : null}
      </div>
      <div class='text-merge-surface min-h-0 flex-1 overflow-auto'>
        <div class='min-w-[36rem]'>
          <div class='sticky top-0 z-10 grid grid-cols-2 border-b border-border bg-background text-xs font-medium'>
            <div class='px-3 py-2'>Server version · read only</div>
            <div class='border-l border-border px-3 py-2'>Your reviewed version</div>
          </div>
          <div use={domBinding(model, bindMerge)} />
        </div>
      </div>
    </div>
  )),
)
