import { syntaxTree } from '@codemirror/language'
import type { EditorState, StateCommand } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'

function ancestorNamed(state: EditorState, position: number, name: string): boolean {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(position, -1)
  while (node) {
    if (node.name === name) return true
    node = node.parent
  }
  return false
}

export function toggleMarkdownDelimiter(marker: '*' | '**'): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false
    const range = state.selection.main
    const markerLength = marker.length
    const selected = state.sliceDoc(range.from, range.to)

    if (range.empty) {
      const before = state.sliceDoc(Math.max(0, range.from - markerLength), range.from)
      const after = state.sliceDoc(range.from, range.from + markerLength)
      if (before === marker && after === marker) {
        dispatch(
          state.update({
            changes: [
              { from: range.from - markerLength, to: range.from },
              { from: range.from, to: range.from + markerLength },
            ],
            selection: { anchor: range.from - markerLength },
            userEvent: 'input.markdown.format',
          }),
        )
      } else {
        dispatch(
          state.update({
            changes: { from: range.from, insert: marker + marker },
            selection: { anchor: range.from + markerLength },
            userEvent: 'input.markdown.format',
          }),
        )
      }
      return true
    }

    if (
      selected.length >= markerLength * 2 &&
      selected.startsWith(marker) &&
      selected.endsWith(marker)
    ) {
      const inner = selected.slice(markerLength, -markerLength)
      dispatch(
        state.update({
          changes: { from: range.from, to: range.to, insert: inner },
          selection: { anchor: range.from, head: range.from + inner.length },
          userEvent: 'input.markdown.format',
        }),
      )
      return true
    }

    const before = state.sliceDoc(Math.max(0, range.from - markerLength), range.from)
    const after = state.sliceDoc(range.to, range.to + markerLength)
    if (before === marker && after === marker) {
      dispatch(
        state.update({
          changes: {
            from: range.from - markerLength,
            to: range.to + markerLength,
            insert: selected,
          },
          selection: {
            anchor: range.from - markerLength,
            head: range.from - markerLength + selected.length,
          },
          userEvent: 'input.markdown.format',
        }),
      )
      return true
    }

    dispatch(
      state.update({
        changes: { from: range.from, to: range.to, insert: marker + selected + marker },
        selection: {
          anchor: range.from + markerLength,
          head: range.from + markerLength + selected.length,
        },
        userEvent: 'input.markdown.format',
      }),
    )
    return true
  }
}

const listPrefixPattern = /^(\s*(?:>\s*)*)([-+*]|\d+[.)])([ \t]+)(\[[ xX]\]([ \t]+))?/

export const continueMarkdownList: StateCommand = ({ state, dispatch }) => {
  if (state.readOnly) return false
  const range = state.selection.main
  if (!range.empty || !ancestorNamed(state, range.head, 'ListItem')) return false

  const line = state.doc.lineAt(range.head)
  const beforeCursor = state.sliceDoc(line.from, range.head)
  const match = listPrefixPattern.exec(beforeCursor)
  if (!match) return false

  const prefixLength = match[0].length
  const contentBeforeCursor = beforeCursor.slice(prefixLength)
  const contentAfterCursor = state.sliceDoc(range.head, line.to)
  if (!contentBeforeCursor.trim() && !contentAfterCursor.trim()) {
    dispatch(
      state.update({
        changes: { from: line.from, to: range.head, insert: '' },
        userEvent: 'input.markdown.list',
      }),
    )
    return true
  }

  const marker = /^\d/.test(match[2])
    ? match[2].replace(/^\d+/, (number) => String(Number(number) + 1))
    : match[2]
  const task = match[4] ? `[ ]${match[5]}` : ''
  const nextPrefix = `${match[1]}${marker}${match[3]}${task}`
  dispatch(
    state.update({
      changes: { from: range.head, insert: `${state.lineBreak}${nextPrefix}` },
      selection: { anchor: range.head + 1 + nextPrefix.length },
      userEvent: 'input.markdown.list',
    }),
  )
  return true
}

function selectedLineStarts(state: EditorState): number[] {
  const range = state.selection.main
  const starts: number[] = []
  let line = state.doc.lineAt(range.from)
  const selectionEndsAtLineStart =
    !range.empty && range.to > range.from && state.doc.lineAt(range.to).from === range.to
  const end = range.empty ? line.to : range.to - (selectionEndsAtLineStart ? 1 : 0)
  while (true) {
    starts.push(line.from)
    if (line.to >= end || line.number >= state.doc.lines) break
    line = state.doc.line(line.number + 1)
  }
  return starts
}

function listItemAt(state: EditorState, position: number): SyntaxNode | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(position, 1)
  while (node) {
    if (node.name === 'ListItem') return node
    node = node.parent
  }
  return null
}

function lineIndentLength(state: EditorState, lineFrom: number): number {
  return /^[ \t]*/.exec(state.doc.lineAt(lineFrom).text)?.[0].length ?? 0
}

function listContentColumn(state: EditorState, item: SyntaxNode): number | null {
  const mark = item.getChild('ListMark')
  if (!mark) return null
  const line = state.doc.lineAt(mark.from)
  let contentFrom = mark.to
  while (contentFrom < line.to && /[ \t]/.test(state.sliceDoc(contentFrom, contentFrom + 1))) {
    contentFrom += 1
  }
  return contentFrom - line.from
}

function indentLengthForLine(state: EditorState, lineFrom: number): number {
  const currentIndent = lineIndentLength(state, lineFrom)
  const item = listItemAt(state, lineFrom + currentIndent)
  if (!item) return 2
  const previous = item.prevSibling?.name === 'ListItem' ? item.prevSibling : null
  const targetColumn = listContentColumn(state, previous ?? item)
  return Math.max(1, (targetColumn ?? currentIndent + 2) - currentIndent)
}

function outdentLengthForLine(state: EditorState, lineFrom: number): number {
  const currentIndent = lineIndentLength(state, lineFrom)
  if (!currentIndent) return 0
  if (state.sliceDoc(lineFrom, lineFrom + 1) === '\t') return 1

  const item = listItemAt(state, lineFrom + currentIndent)
  const outerItem = item?.parent?.parent?.name === 'ListItem' ? item.parent.parent : null
  if (outerItem) {
    const outerLine = state.doc.lineAt(outerItem.from)
    return Math.max(1, currentIndent - lineIndentLength(state, outerLine.from))
  }
  return Math.min(currentIndent, indentLengthForLine(state, lineFrom))
}

export function indentMarkdownList(remove: boolean): StateCommand {
  return ({ state, dispatch }) => {
    if (state.readOnly) return false
    const starts = selectedLineStarts(state).filter((from) => {
      const line = state.doc.lineAt(from)
      const position = Math.min(line.to, from + lineIndentLength(state, from))
      return listItemAt(state, position) !== null
    })
    if (!starts.length) return false
    const changes = remove
      ? starts
          .map((from) => {
            const removeLength = outdentLengthForLine(state, from)
            return removeLength ? { from, to: from + removeLength, insert: '' } : null
          })
          .filter((change): change is { from: number; to: number; insert: string } => !!change)
      : starts.map((from) => ({ from, insert: ' '.repeat(indentLengthForLine(state, from)) }))
    if (!changes.length) return true
    dispatch(state.update({ changes, userEvent: 'input.markdown.list' }))
    return true
  }
}
