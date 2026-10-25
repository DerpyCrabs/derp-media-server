import {
  Annotation,
  EditorState,
  StateEffect,
  StateField,
  type Extension,
  type Text,
  type Transaction,
} from '@codemirror/state'
import { invertedEffects } from '@codemirror/commands'
import type { EditorView } from '@codemirror/view'

export const rawSourcePaste = Annotation.define<string>()

type SourceLineSeparator = '\n' | '\r\n' | '\r'

export function detectLineSeparator(
  content: string,
  fallback: SourceLineSeparator = '\n',
): SourceLineSeparator {
  return (/\r\n|\r|\n/.exec(content)?.[0] as SourceLineSeparator | undefined) ?? fallback
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
  lineSeparator: SourceLineSeparator,
): readonly string[] {
  const inserted: Text[] = []
  transaction.changes.iterChanges((_from, _to, _fromNew, _toNew, text) => {
    inserted.push(text)
  })
  const exactPaste = transaction.annotation(rawSourcePaste)
  return exactPaste !== undefined && inserted.length === 1
    ? [exactPaste]
    : inserted.map((text) => text.sliceString(0, text.length, lineSeparator))
}

type SourceState = { text: string; lineSeparator: SourceLineSeparator; mixedLineEndings: boolean }

export const replaceSource = StateEffect.define<SourceState>()
const exactSource = StateEffect.define<SourceState>()

export function hasMixedLineEndings(source: string): boolean {
  let first: string | null = null
  for (const match of source.matchAll(/\r\n|\r|\n/g)) {
    if (first === null) first = match[0]
    else if (match[0] !== first) return true
  }
  return false
}

function replacementSourceEffect(transaction: Transaction): SourceState | null {
  let replacement: SourceState | null = null
  for (const effect of transaction.effects) {
    if (effect.is(replaceSource)) replacement = effect.value
  }
  return replacement
}

function exactSourceEffect(transaction: Transaction): SourceState | null {
  let source: SourceState | null = null
  for (const effect of transaction.effects) {
    if (effect.is(exactSource)) source = effect.value
  }
  return source
}

export const sourceState = StateField.define<SourceState>({
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

export function sourceTrackingExtensions(initialText: string): Extension {
  return [
    sourceState.init(() => ({
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
      const previous = transaction.startState.field(sourceState)
      if (!previous.mixedLineEndings && transaction.annotation(rawSourcePaste) === undefined) {
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
      return { effects: exactSource.of({ text, lineSeparator, mixedLineEndings }) }
    }),
    invertedEffects.of((transaction) => {
      if (!transaction.docChanged || !exactSourceEffect(transaction)) return []
      return [exactSource.of(transaction.startState.field(sourceState))]
    }),
  ]
}

export function selectionText(
  view: EditorView,
  source: string,
  lineSeparator: SourceLineSeparator,
): string {
  return view.state.selection.ranges
    .filter((range) => !range.empty)
    .map((range) => sourceSlice(source, range.from, range.to))
    .join(lineSeparator)
}
