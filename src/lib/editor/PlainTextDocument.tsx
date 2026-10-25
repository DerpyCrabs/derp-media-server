import { Effect } from 'effect'
import { domBinding, modelOwner, view } from 'effectweb'
import { Annotation, Compartment, EditorState, Transaction } from '@codemirror/state'
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view'
import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands'
import { search, searchKeymap, openSearchPanel, gotoLine } from '@codemirror/search'
import {
  detectLineSeparator,
  hasMixedLineEndings,
  sourceState,
  replaceSource,
  sourceTrackingExtensions,
  rawSourcePaste,
  selectionText,
} from './source'

export type PlainTextDocumentProps = {
  content: string
  readOnly: boolean
  code: boolean
  ariaLabel: string
  onChange: (content: string) => void
  onBlur: () => void
  onSave: () => Effect.Effect<void, unknown>
}
const externalUpdate = Annotation.define<boolean>()
const theme = EditorView.theme({
  '&': { height: '100%', color: 'var(--foreground)', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
    fontSize: '14px',
    lineHeight: '1.6',
  },
  '.cm-content': { padding: '0.5rem 0', caretColor: 'var(--foreground)', userSelect: 'text' },
  '.cm-line': { padding: '0 12px' },
  '.cm-gutters': {
    backgroundColor: 'var(--muted)',
    color: 'var(--muted-foreground)',
    border: 'none',
  },
  '.cm-activeLine': { backgroundColor: 'color-mix(in oklab, var(--muted) 45%, transparent)' },
  '.cm-cursor': { borderLeftColor: 'var(--foreground)' },
  '.cm-panels': { backgroundColor: 'var(--background)', color: 'var(--foreground)' },
  '.cm-textfield, .cm-button': {
    color: 'var(--foreground)',
    background: 'var(--muted)',
    border: '1px solid var(--border)',
    borderRadius: '4px',
  },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in oklab, orange 35%, transparent)' },
  '.cm-searchMatch-selected': { backgroundColor: 'color-mix(in oklab, orange 65%, transparent)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'color-mix(in oklab, var(--primary) 25%, transparent)',
  },
})
const bindEditor = (parent: HTMLDivElement, current: () => PlainTextDocumentProps) => {
  const owner = modelOwner({})
  const mode = new Compartment()
  const undo = new Compartment()
  const wrapping = new Compartment()
  let wrap = true
  const modeExtension = () => [
    EditorState.readOnly.of(current().readOnly),
    EditorView.editable.of(!current().readOnly),
    EditorView.contentAttributes.of({
      role: current().readOnly ? 'document' : 'textbox',
      tabindex: '0',
      'aria-label': current().ariaLabel,
      'aria-readonly': String(current().readOnly),
      'aria-multiline': 'true',
      spellcheck: 'false',
    }),
    ...(current().code
      ? [lineNumbers(), highlightActiveLine()]
      : [
          EditorView.theme({
            '.cm-scroller': { fontFamily: 'var(--font-sans)', fontSize: '16px' },
          }),
        ]),
  ]
  const editor = new EditorView({
    parent,
    state: EditorState.create({
      doc: current().content,
      extensions: [
        theme,
        mode.of(modeExtension()),
        undo.of(history()),
        wrapping.of(EditorView.lineWrapping),
        sourceTrackingExtensions(current().content),
        search({ top: true }),
        EditorState.transactionFilter.of((tr) =>
          tr.docChanged && tr.startState.readOnly && !tr.annotation(externalUpdate) ? [] : tr,
        ),
        EditorView.updateListener.of((update) => {
          if (update.transactions.some((tr) => tr.docChanged && !tr.annotation(externalUpdate)))
            current().onChange(update.state.field(sourceState).text)
        }),
        EditorView.domEventHandlers({
          blur(event, view) {
            if (!(event.relatedTarget instanceof Node) || !view.dom.contains(event.relatedTarget))
              current().onBlur()
          },
          keydown(event) {
            if (
              [
                'ArrowLeft',
                'ArrowRight',
                'ArrowUp',
                'ArrowDown',
                'Home',
                'End',
                'PageUp',
                'PageDown',
              ].includes(event.key) ||
              event.ctrlKey ||
              event.metaKey
            )
              event.stopPropagation()
          },
          paste(event, view) {
            const text = event.clipboardData?.getData('text/plain')
            if (view.state.readOnly || text === undefined) return false
            view.dispatch({
              ...view.state.replaceSelection(text),
              annotations: [rawSourcePaste.of(text), Transaction.userEvent.of('input.paste')],
            })
            event.preventDefault()
            return true
          },
          copy(event, view) {
            const source = view.state.field(sourceState)
            const text = selectionText(view, source.text, source.lineSeparator)
            if (!text || !event.clipboardData) return false
            event.clipboardData.setData('text/plain', text)
            event.preventDefault()
            return true
          },
        }),
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              if (!current().readOnly) owner.run('save', current().onSave(), 'latest-queued')
              return true
            },
          },
          { key: 'Mod-g', run: gotoLine },
          ...searchKeymap,
          ...historyKeymap,
          ...defaultKeymap,
          indentWithTab,
        ]),
      ],
    }),
  })
  const container = parent.parentElement!
  const click = (event: MouseEvent) => {
    const action = (event.target as Element).closest<HTMLElement>('[data-text-action]')?.dataset
      .textAction
    if (action === 'find') openSearchPanel(editor)
    if (action === 'line') gotoLine(editor)
    if (action === 'wrap') {
      wrap = !wrap
      editor.dispatch({ effects: wrapping.reconfigure(wrap ? EditorView.lineWrapping : []) })
      const button = (event.target as Element).closest('button')!
      button.setAttribute('aria-pressed', String(wrap))
      editor.focus()
    }
  }
  container.addEventListener('click', click)
  let previousMode = `${current().readOnly}:${current().ariaLabel}:${current().code}`
  return {
    update() {
      const props = current()
      const nextMode = `${props.readOnly}:${props.ariaLabel}:${props.code}`
      if (nextMode !== previousMode) {
        previousMode = nextMode
        editor.dispatch({ effects: mode.reconfigure(modeExtension()) })
      }
      const previous = editor.state.field(sourceState)
      if (props.content === previous.text) return
      const doc = editor.state.toText(props.content)
      editor.dispatch({
        changes: { from: 0, to: editor.state.doc.length, insert: doc },
        selection: {
          anchor: Math.min(editor.state.selection.main.anchor, doc.length),
          head: Math.min(editor.state.selection.main.head, doc.length),
        },
        effects: [
          undo.reconfigure([]),
          replaceSource.of({
            text: props.content,
            lineSeparator: detectLineSeparator(props.content, previous.lineSeparator),
            mixedLineEndings: hasMixedLineEndings(props.content),
          }),
        ],
        annotations: [externalUpdate.of(true), Transaction.addToHistory.of(false)],
      })
      editor.dispatch({ effects: undo.reconfigure(history()) })
    },
    dispose() {
      container.removeEventListener('click', click)
      owner.dispose()
      editor.destroy()
    },
  }
}
export default view<PlainTextDocumentProps>((props) => (
  <div class='flex h-full min-h-0 flex-col' data-testid='plain-text-document'>
    <div class='flex shrink-0 items-center gap-1 border-b border-border px-2 py-1 text-xs text-muted-foreground'>
      <button
        type='button'
        class='rounded px-2 py-1 hover:bg-muted'
        data-text-action='find'
        title='Find and replace (Ctrl/Cmd+F)'
      >
        Find
      </button>
      <button
        type='button'
        class='rounded px-2 py-1 hover:bg-muted'
        data-text-action='line'
        title='Go to line (Ctrl/Cmd+G)'
      >
        Go to line
      </button>
      <button
        type='button'
        class='ml-auto rounded px-2 py-1 hover:bg-muted'
        data-text-action='wrap'
        aria-pressed='true'
      >
        Wrap lines
      </button>
    </div>
    <div class='min-h-0 flex-1 overflow-hidden' use={domBinding(props, bindEditor)} />
  </div>
))
