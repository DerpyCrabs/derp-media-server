import { history, historyKeymap, invertedEffects, standardKeymap } from '@codemirror/commands'
import {
  Annotation,
  Compartment,
  EditorState,
  StateEffect,
  StateField,
  Transaction,
  type Extension,
  type Text,
} from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'

import { indentMarkdownList, continueMarkdownList, toggleMarkdownDelimiter } from './commands'
import {
  clearPendingImagePastes,
  markdownClipboardExtension,
  pendingImagePasteCompletion,
  rawMarkdownPaste,
} from './clipboard'
import { clearMarkdownImageActivation, openActivatedMarkdownImage } from './images'
import { markdownLanguage } from './markdown-language'
import { livePreviewExtension, markdownModeFacet, refreshMarkdownPreview } from './live-preview'
import { markdownLinkInteractionExtension } from './links'
import { markdownEditorTheme } from './theme'
import type { MarkdownEditorRuntime, MarkdownMode } from './types'

export const externalMarkdownUpdate = Annotation.define<boolean>()

type CreateMarkdownEditorOptions = {
  parent: HTMLElement
  doc: string
  mode: MarkdownMode
  ariaLabel: string
  runtime: MarkdownEditorRuntime
}

export type MarkdownEditorController = {
  view: EditorView
  setMode: (mode: MarkdownMode, ariaLabel: string) => void
  setContent: (content: string) => void
  refresh: () => void
  destroy: () => void
}

function modeExtensions(mode: MarkdownMode, ariaLabel: string): Extension {
  const readOnly = mode === 'read'
  return [
    markdownModeFacet.of(mode),
    EditorState.readOnly.of(readOnly),
    EditorView.editable.of(!readOnly),
    EditorView.contentAttributes.of({
      role: readOnly ? 'document' : 'textbox',
      'aria-label': ariaLabel,
      'aria-readonly': readOnly ? 'true' : 'false',
      'aria-multiline': 'true',
      tabindex: '0',
      spellcheck: 'false',
    }),
  ]
}

type MarkdownLineSeparator = '\n' | '\r\n' | '\r'

function detectLineSeparator(
  content: string,
  fallback: MarkdownLineSeparator = '\n',
): MarkdownLineSeparator {
  return (/\r\n|\r|\n/.exec(content)?.[0] as MarkdownLineSeparator | undefined) ?? fallback
}

function sourceOffsetAt(source: string, position: number): number {
  let internalPosition = 0
  let rawPosition = 0
  for (const match of source.matchAll(/\r\n|\r|\n/g)) {
    const matchPosition = match.index
    const lineLength = matchPosition - rawPosition
    const breakPosition = internalPosition + lineLength
    if (position <= breakPosition) return rawPosition + position - internalPosition
    internalPosition = breakPosition + 1
    rawPosition = matchPosition + match[0].length
  }
  return rawPosition + position - internalPosition
}

function sourceSlice(source: string, from: number, to: number): string {
  return source.slice(sourceOffsetAt(source, from), sourceOffsetAt(source, to))
}

function applySourceChanges(
  source: string,
  transaction: Transaction,
  insertions: readonly string[],
): string {
  const changedRanges: { from: number; to: number }[] = []
  transaction.changes.iterChanges((from, to) => {
    changedRanges.push({ from, to })
  })
  let sourceCursor = 0
  let result = ''

  for (const [index, change] of changedRanges.entries()) {
    const sourceFrom = sourceOffsetAt(source, change.from)
    const sourceTo = sourceOffsetAt(source, change.to)
    result += source.slice(sourceCursor, sourceFrom)
    result += insertions[index] ?? ''
    sourceCursor = sourceTo
  }
  return result + source.slice(sourceCursor)
}

function sourceInsertions(
  transaction: Transaction,
  lineSeparator: MarkdownLineSeparator,
): readonly string[] {
  const inserted: Text[] = []
  transaction.changes.iterChanges((_from, _to, _fromNew, _toNew, text) => {
    inserted.push(text)
  })
  const exactPaste = transaction.annotation(rawMarkdownPaste)
  return exactPaste !== undefined && inserted.length === 1
    ? [exactPaste]
    : inserted.map((text) => text.sliceString(0, text.length, lineSeparator))
}

type MarkdownSourceState = {
  text: string
  lineSeparator: MarkdownLineSeparator
  mixedLineEndings: boolean
}

const replaceMarkdownSource = StateEffect.define<MarkdownSourceState>()
const exactMarkdownSource = StateEffect.define<MarkdownSourceState>()

function hasMixedLineEndings(source: string): boolean {
  let first: string | null = null
  for (const match of source.matchAll(/\r\n|\r|\n/g)) {
    if (first === null) first = match[0]
    else if (match[0] !== first) return true
  }
  return false
}

function replacementSourceEffect(transaction: Transaction): MarkdownSourceState | null {
  let replacement: MarkdownSourceState | null = null
  for (const effect of transaction.effects) {
    if (effect.is(replaceMarkdownSource)) replacement = effect.value
  }
  return replacement
}

function exactSourceEffect(transaction: Transaction): MarkdownSourceState | null {
  let source: MarkdownSourceState | null = null
  for (const effect of transaction.effects) {
    if (effect.is(exactMarkdownSource)) source = effect.value
  }
  return source
}

const markdownSourceState = StateField.define<MarkdownSourceState>({
  create(state) {
    const text = state.doc.sliceString(0, state.doc.length, state.lineBreak)
    return {
      text,
      lineSeparator: detectLineSeparator(text),
      mixedLineEndings: hasMixedLineEndings(text),
    }
  },
  update(value, transaction) {
    const replacement = replacementSourceEffect(transaction)
    if (replacement) return replacement
    const exact = exactSourceEffect(transaction)
    if (exact) return exact
    if (!transaction.docChanged) return value
    const insertions = sourceInsertions(transaction, value.lineSeparator)
    const text = applySourceChanges(value.text, transaction, insertions)
    return {
      text,
      lineSeparator: detectLineSeparator(text, value.lineSeparator),
      mixedLineEndings: hasMixedLineEndings(text),
    }
  },
})

function sourceTrackingExtensions(initialText: string): Extension {
  return [
    markdownSourceState.init(() => ({
      text: initialText,
      lineSeparator: detectLineSeparator(initialText),
      mixedLineEndings: hasMixedLineEndings(initialText),
    })),
    EditorState.transactionExtender.of((transaction) => {
      if (
        !transaction.docChanged ||
        replacementSourceEffect(transaction) ||
        exactSourceEffect(transaction)
      ) {
        return null
      }
      const previous = transaction.startState.field(markdownSourceState)
      if (!previous.mixedLineEndings && transaction.annotation(rawMarkdownPaste) === undefined) {
        return null
      }
      const text = applySourceChanges(
        previous.text,
        transaction,
        sourceInsertions(transaction, previous.lineSeparator),
      )
      const mixedLineEndings = hasMixedLineEndings(text)
      const lineSeparator = detectLineSeparator(text, previous.lineSeparator)
      if (
        !previous.mixedLineEndings &&
        !mixedLineEndings &&
        lineSeparator === previous.lineSeparator
      ) {
        return null
      }
      return {
        effects: exactMarkdownSource.of({
          text,
          lineSeparator,
          mixedLineEndings,
        }),
      }
    }),
    invertedEffects.of((transaction) => {
      if (!transaction.docChanged || !exactSourceEffect(transaction)) return []
      return [exactMarkdownSource.of(transaction.startState.field(markdownSourceState))]
    }),
  ]
}

function selectionText(
  view: EditorView,
  source: string,
  lineSeparator: MarkdownLineSeparator,
): string {
  return view.state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => sourceSlice(source, range.from, range.to))
    .join(lineSeparator)
}

export function createMarkdownEditor(
  options: CreateMarkdownEditorOptions,
): MarkdownEditorController {
  const modeCompartment = new Compartment()
  const historyCompartment = new Compartment()
  const runtime = options.runtime

  const state = EditorState.create({
    doc: options.doc,
    extensions: [
      markdownLanguage,
      markdownEditorTheme,
      EditorView.lineWrapping,
      EditorState.tabSize.of(2),
      sourceTrackingExtensions(options.doc),
      historyCompartment.of(history()),
      modeCompartment.of(modeExtensions(options.mode, options.ariaLabel)),
      EditorState.transactionFilter.of((transaction) => {
        if (
          transaction.docChanged &&
          transaction.startState.readOnly &&
          !transaction.annotation(externalMarkdownUpdate) &&
          !transaction.annotation(pendingImagePasteCompletion)
        ) {
          return []
        }
        return transaction
      }),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return
        clearMarkdownImageActivation(update.view)
        let changedLocally = false
        for (const transaction of update.transactions) {
          if (!transaction.docChanged || transaction.annotation(externalMarkdownUpdate)) continue
          changedLocally = true
        }
        if (changedLocally) runtime.onChange?.(update.state.field(markdownSourceState).text)
      }),
      livePreviewExtension(runtime),
      markdownClipboardExtension(runtime),
      markdownLinkInteractionExtension(),
      EditorView.domEventHandlers({
        mousedown(event, view) {
          const target = event.target
          if (
            event.detail < 2 &&
            (!(target instanceof Element) || !target.closest('img.cm-md-image'))
          ) {
            clearMarkdownImageActivation(view)
          }
          return false
        },
        dblclick(event, view) {
          if (!openActivatedMarkdownImage(view, runtime)) return false
          event.preventDefault()
          event.stopPropagation()
          return true
        },
        blur(event, view) {
          if (!(event.relatedTarget instanceof Node) || !view.dom.contains(event.relatedTarget)) {
            runtime.onBlur?.()
          }
          return false
        },
        copy(event, view) {
          if (!view.state.readOnly) return false
          const source = view.state.field(markdownSourceState)
          const text = selectionText(view, source.text, source.lineSeparator)
          if (!text || !event.clipboardData) return false
          event.clipboardData.setData('text/plain', text)
          event.preventDefault()
          return true
        },
        keydown(event, view) {
          clearMarkdownImageActivation(view)
          if (
            event.key === 'ArrowLeft' ||
            event.key === 'ArrowRight' ||
            event.key === 'ArrowUp' ||
            event.key === 'ArrowDown' ||
            event.key === 'Home' ||
            event.key === 'End' ||
            event.key === 'PageUp' ||
            event.key === 'PageDown' ||
            ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k')
          ) {
            event.stopPropagation()
          }
          return false
        },
      }),
      keymap.of([
        {
          key: 'Mod-s',
          preventDefault: true,
          run: (view) => {
            if (view.state.readOnly) return false
            void runtime.onSave?.()
            return true
          },
        },
        { key: 'Mod-b', run: toggleMarkdownDelimiter('**') },
        { key: 'Mod-i', run: toggleMarkdownDelimiter('*') },
        { key: 'Enter', run: continueMarkdownList },
        {
          key: 'Tab',
          run: (view) => (view.state.readOnly ? false : indentMarkdownList(false)(view)),
          shift: (view) => (view.state.readOnly ? false : indentMarkdownList(true)(view)),
        },
        ...historyKeymap,
        ...standardKeymap,
      ]),
    ],
  })

  const view = new EditorView({ state, parent: options.parent })

  return {
    view,
    setMode(mode, ariaLabel) {
      clearMarkdownImageActivation(view)
      view.dispatch({ effects: modeCompartment.reconfigure(modeExtensions(mode, ariaLabel)) })
    },
    setContent(content) {
      clearMarkdownImageActivation(view)
      const previousSource = view.state.field(markdownSourceState)
      if (content === previousSource.text) return
      const document = view.state.toText(content)
      const selection = view.state.selection.main
      const anchor = Math.min(selection.anchor, document.length)
      const head = Math.min(selection.head, document.length)
      const replaceDocument = !document.eq(view.state.doc)
      view.dispatch({
        ...(replaceDocument
          ? {
              changes: { from: 0, to: view.state.doc.length, insert: document },
              selection: { anchor, head },
            }
          : {}),
        effects: [
          clearPendingImagePastes.of(undefined),
          historyCompartment.reconfigure([]),
          replaceMarkdownSource.of({
            text: content,
            lineSeparator: detectLineSeparator(content, previousSource.lineSeparator),
            mixedLineEndings: hasMixedLineEndings(content),
          }),
        ],
        annotations: [
          externalMarkdownUpdate.of(true),
          Transaction.addToHistory.of(false),
          Transaction.userEvent.of('sync.external'),
        ],
      })
      view.dispatch({ effects: historyCompartment.reconfigure(history()) })
    },
    refresh() {
      view.dispatch({ effects: refreshMarkdownPreview.of(undefined) })
    },
    destroy() {
      clearMarkdownImageActivation(view)
      view.destroy()
    },
  }
}
