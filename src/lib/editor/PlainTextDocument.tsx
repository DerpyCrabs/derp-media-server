import { createCodeSearchPanel } from './CodeSearchPanel'
import { Checkbox } from '@/lib/ui/checkbox'
import { Button } from '@/lib/ui/button'
import { Select } from '@/lib/ui/select'
import { plainTextController, selectedLanguage } from './plain-text-controller'
import { codeLanguages, loadCodeLanguage } from './code-languages'
import {
  HighlightStyle,
  syntaxHighlighting,
  bracketMatching,
  indentUnit,
  indentOnInput,
  foldGutter,
  foldKeymap,
} from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { Popover } from '@/lib/ui/popover'
import { Effect } from 'effect'
import {
  domBinding,
  modelOwner,
  view,
  controllerView,
  type JSX,
  type ControllerModel,
} from 'effectweb'
import { Annotation, Compartment, EditorState, Transaction, countColumn } from '@codemirror/state'
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
  toolbar?: JSX.Element
  toolbarEnd?: JSX.Element
  path: string
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
const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: 'color-mix(in oklab, var(--foreground) 35%, #a855f7)' },
  { tag: [tags.string, tags.regexp], color: 'color-mix(in oklab, var(--foreground) 35%, #22a05b)' },
  {
    tag: [tags.number, tags.bool, tags.null],
    color: 'color-mix(in oklab, var(--foreground) 35%, #dc821c)',
  },
  { tag: tags.comment, color: 'var(--muted-foreground)', fontStyle: 'italic' },
  {
    tag: [tags.typeName, tags.className],
    color: 'color-mix(in oklab, var(--foreground) 35%, #16a3b0)',
  },
  {
    tag: [tags.propertyName, tags.attributeName],
    color: 'color-mix(in oklab, var(--foreground) 35%, #3287dd)',
  },
  { tag: tags.tagName, color: 'color-mix(in oklab, var(--foreground) 35%, #dc5959)' },
])
type EditorModel = ControllerModel<typeof plainTextController>
const bindEditor = (parent: HTMLDivElement, model: () => EditorModel) => {
  const current = () => model().props
  const owner = modelOwner({})
  const mode = new Compartment()
  const undo = new Compartment()
  const wrapping = new Compartment()
  const language = new Compartment()
  const indentation = new Compartment()
  const numbering = new Compartment()
  let languageKey = ''
  let optionsKey = ''
  let queued = false
  let disposed = false
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
      ? [highlightActiveLine()]
      : [
          EditorView.theme({
            '.cm-scroller': { fontFamily: 'var(--font-sans)', fontSize: '16px' },
          }),
        ]),
  ]
  let previousContent = current().content
  const editor = new EditorView({
    parent,
    state: EditorState.create({
      doc: current().content,
      extensions: [
        theme,
        mode.of(modeExtension()),
        undo.of(history()),
        wrapping.of(EditorView.lineWrapping),
        numbering.of([]),
        language.of([]),
        indentation.of([]),
        syntaxHighlighting(highlight),
        bracketMatching(),
        indentOnInput(),
        sourceTrackingExtensions(current().content),
        search({ top: true, createPanel: createCodeSearchPanel }),
        EditorState.transactionFilter.of((tr) =>
          tr.docChanged && tr.startState.readOnly && !tr.annotation(externalUpdate) ? [] : tr,
        ),
        EditorView.updateListener.of((update) => {
          if (
            update.docChanged ||
            update.selectionSet ||
            update.transactions.some((tr) => tr.reconfigured)
          ) {
            const selection = update.state.selection.main,
              line = update.state.doc.lineAt(selection.head)
            model().actions.stats(
              line.number,
              countColumn(line.text, update.state.tabSize, selection.head - line.from) + 1,
              update.state.selection.ranges.reduce((sum, range) => sum + range.to - range.from, 0),
            )
          }
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
          ...foldKeymap,
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
  }
  container.addEventListener('click', click)
  const configure = () => {
    const state = model()
    const indent = state.indent === 'auto' ? state.initialIndent : state.indent
    const nextOptions = `${state.wrap}:${state.numbers}:${indent}`
    if (nextOptions !== optionsKey) {
      optionsKey = nextOptions
      editor.dispatch({
        effects: [
          wrapping.reconfigure(state.wrap ? EditorView.lineWrapping : []),
          numbering.reconfigure(state.numbers ? [lineNumbers(), foldGutter()] : []),
          indentation.reconfigure([
            EditorState.tabSize.of(indent === 'tabs' ? 4 : Number(indent)),
            indentUnit.of(indent === 'tabs' ? '\t' : ' '.repeat(Number(indent))),
          ]),
        ],
      })
    }
    const id = selectedLanguage(state.language, state.props),
      large = state.props.content.length > 2 * 1024 * 1024
    const nextLanguage = `${id}:${state.props.path}:${large}`
    if (nextLanguage === languageKey) return
    languageKey = nextLanguage
    owner.cancel('language')
    editor.dispatch({ effects: language.reconfigure([]) })
    state.actions.languageError(
      large ? 'Syntax highlighting is disabled for files larger than 2 MiB.' : '',
    )
    if (large || id === 'plain') return
    owner.run(
      'language',
      Effect.tryPromise(() => loadCodeLanguage(id, state.props.path)).pipe(
        Effect.tap((extension) =>
          Effect.sync(() => editor.dispatch({ effects: language.reconfigure(extension) })),
        ),
        Effect.catch(() =>
          Effect.sync(() =>
            model().actions.languageError(
              'Syntax highlighting could not be loaded. Editing is still available.',
            ),
          ),
        ),
      ),
      'replace',
    )
  }
  configure()
  let previousMode = `${current().readOnly}:${current().ariaLabel}:${current().code}`
  return {
    update() {
      if (queued) return
      queued = true
      queueMicrotask(() => {
        queued = false
        if (disposed) return
        configure()
        const props = current()
        const nextMode = `${props.readOnly}:${props.ariaLabel}:${props.code}`
        if (nextMode !== previousMode) {
          previousMode = nextMode
          editor.dispatch({ effects: mode.reconfigure(modeExtension()) })
        }
        if (props.content === previousContent) return
        previousContent = props.content
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
      })
    },
    dispose() {
      disposed = true
      container.removeEventListener('click', click)
      owner.dispose()
      editor.destroy()
    },
  }
}
export default controllerView(
  { controller: plainTextController, identity: (props) => props.path },
  view((model) => {
    const language = selectedLanguage(model.language, model.props)
    const label = codeLanguages.find(([id]) => id === language)?.[1] ?? 'Plain text'

    return (
      <div class='relative flex h-full min-h-0 flex-col' data-testid='plain-text-document'>
        <header class='flex h-10 shrink-0 items-center gap-1 border-b border-border px-2'>
          {model.props.toolbar ?? (
            <span class='min-w-0 flex-1 truncate text-sm'>{model.props.path.split('/').pop()}</span>
          )}
          <Popover
            aria-label='Editor options'
            open={model.optionsOpen}
            onOpenChange={model.actions.options}
            align='end'
            class='w-64 space-y-3'
            trigger={
              <Button
                variant='ghost'
                size='sm'
                aria-label='Editor options'
                title={`Ln ${model.line}, Col ${model.column} · ${model.ending}`}
              >
                {label}
              </Button>
            }
          >
            <label class='flex flex-col gap-1'>
              Language
              <Select
                aria-label='Syntax language'
                value={model.language}
                class='min-w-0 w-full'
                onValueChange={(value) => model.actions.language(value)}
                options={[
                  { value: 'auto', label: 'Automatic' },
                  ...codeLanguages.map(([value, label]) => ({ value, label })),
                ]}
              />
            </label>
            <label class='flex flex-col gap-1'>
              Indentation
              <Select
                aria-label='Indentation'
                value={model.indent}
                class='min-w-0 w-full'
                onValueChange={(value) => model.actions.indent(value)}
                options={[
                  {
                    value: 'auto',
                    label: `Automatic (${model.initialIndent === 'tabs' ? 'tabs' : `${model.initialIndent} spaces`})`,
                  },
                  { value: 'tabs', label: 'Tabs (width 4)' },
                  ...['2', '4', '8'].map((value) => ({ value, label: `${value} spaces` })),
                ]}
              />
            </label>
            <label class='flex items-center gap-2'>
              <Checkbox
                checked={model.numbers}
                onCheckedChange={(checked) => model.actions.numbers(checked)}
              />
              Line numbers
            </label>
            <label class='flex items-center gap-2'>
              <Checkbox checked={model.wrap} onCheckedChange={model.actions.wrap} />
              Wrap lines
            </label>
            <div class='flex gap-2 border-t border-border pt-3'>
              <Button
                variant='outline'
                data-text-action='find'
                onClick={model.actions.closeOptions}
              >
                Find
              </Button>
              <Button
                variant='outline'
                data-text-action='line'
                onClick={model.actions.closeOptions}
              >
                Go to line
              </Button>
            </div>
            <span class='text-xs text-muted-foreground' data-testid='text-cursor-position'>
              Ln {model.line}, Col {model.column} · {model.ending}
            </span>
          </Popover>
          {model.props.toolbarEnd}
        </header>
        <div class='min-h-0 flex-1 overflow-hidden' use={domBinding(model, bindEditor)} />
        {model.languageError ? (
          <p role='status' class='border-t border-border px-2 py-1 text-xs text-muted-foreground'>
            {model.languageError}
          </p>
        ) : null}
      </div>
    )
  }),
)
