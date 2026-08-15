import { syntaxTree } from '@codemirror/language'
import { EditorState, type StateCommand, type Transaction } from '@codemirror/state'
import { describe, expect, test } from 'bun:test'

import {
  continueMarkdownList,
  indentMarkdownList,
  toggleMarkdownDelimiter,
} from '@/lib/markdown/commands'
import { markdownLanguage } from '@/lib/markdown/markdown-language'

type Selection = number | { anchor: number; head: number }

function runCommand(source: string, selection: Selection, command: StateCommand, readOnly = false) {
  const state = EditorState.create({
    doc: source,
    selection: typeof selection === 'number' ? { anchor: selection } : selection,
    extensions: [markdownLanguage, EditorState.readOnly.of(readOnly)],
  })
  let transaction: Transaction | undefined
  const handled = command({
    state,
    dispatch(next) {
      transaction = next
    },
  })
  return {
    handled,
    transaction,
    state: transaction?.state ?? state,
  }
}

describe('Markdown formatting commands', () => {
  test('wraps bold selection and preserves selected text range', () => {
    const result = runCommand(
      'before word after',
      { anchor: 7, head: 11 },
      toggleMarkdownDelimiter('**'),
    )

    expect(result.handled).toBe(true)
    expect(result.state.doc.toString()).toBe('before **word** after')
    expect(result.state.selection.main.from).toBe(9)
    expect(result.state.selection.main.to).toBe(13)
    expect(result.transaction?.isUserEvent('input.markdown.format')).toBe(true)
  })

  test('wraps italic selection', () => {
    const result = runCommand('word', { anchor: 0, head: 4 }, toggleMarkdownDelimiter('*'))

    expect(result.state.doc.toString()).toBe('*word*')
    expect(
      result.state.sliceDoc(result.state.selection.main.from, result.state.selection.main.to),
    ).toBe('word')
  })

  test('inserts paired markers at empty cursor and leaves cursor inside', () => {
    const result = runCommand('word', 2, toggleMarkdownDelimiter('**'))

    expect(result.state.doc.toString()).toBe('wo****rd')
    expect(result.state.selection.main.anchor).toBe(4)
  })

  test('removes markers surrounding selection', () => {
    const result = runCommand('**word**', { anchor: 2, head: 6 }, toggleMarkdownDelimiter('**'))

    expect(result.state.doc.toString()).toBe('word')
    expect(
      result.state.sliceDoc(result.state.selection.main.from, result.state.selection.main.to),
    ).toBe('word')
  })

  test('removes markers included in selection', () => {
    const result = runCommand('**word**', { anchor: 0, head: 8 }, toggleMarkdownDelimiter('**'))

    expect(result.state.doc.toString()).toBe('word')
    expect(result.state.selection.main.from).toBe(0)
    expect(result.state.selection.main.to).toBe(4)
  })

  test('removes empty pair surrounding cursor', () => {
    const result = runCommand('before **** after', 9, toggleMarkdownDelimiter('**'))

    expect(result.state.doc.toString()).toBe('before  after')
    expect(result.state.selection.main.anchor).toBe(7)
  })

  test('does not format read-only state', () => {
    const result = runCommand('word', { anchor: 0, head: 4 }, toggleMarkdownDelimiter('**'), true)

    expect(result.handled).toBe(false)
    expect(result.transaction).toBeUndefined()
    expect(result.state.doc.toString()).toBe('word')
  })
})

describe('Markdown list continuation', () => {
  test('continues bullet marker', () => {
    const result = runCommand('- item', 6, continueMarkdownList)

    expect(result.state.doc.toString()).toBe('- item\n- ')
    expect(result.state.selection.main.anchor).toBe(9)
    expect(result.transaction?.isUserEvent('input.markdown.list')).toBe(true)
  })

  test('increments ordered marker while preserving delimiter', () => {
    expect(runCommand('9. item', 7, continueMarkdownList).state.doc.toString()).toBe(
      '9. item\n10. ',
    )
    expect(runCommand('9) item', 7, continueMarkdownList).state.doc.toString()).toBe(
      '9) item\n10) ',
    )
  })

  test('continues completed task as open task and preserves nesting', () => {
    const result = runCommand('  - [X] nested', 14, continueMarkdownList)

    expect(result.state.doc.toString()).toBe('  - [X] nested\n  - [ ] ')
  })

  test('splits list content at cursor', () => {
    const result = runCommand('- one tail', 5, continueMarkdownList)

    expect(result.state.doc.toString()).toBe('- one\n-  tail')
    expect(result.state.selection.main.anchor).toBe(8)
  })

  test('exits empty bullet and empty task items', () => {
    expect(runCommand('- ', 2, continueMarkdownList).state.doc.toString()).toBe('')
    expect(runCommand('- [ ] ', 6, continueMarkdownList).state.doc.toString()).toBe('')
  })

  test('does not handle paragraph, range selection, or read-only list', () => {
    expect(runCommand('plain', 5, continueMarkdownList).handled).toBe(false)
    expect(runCommand('- item', { anchor: 2, head: 4 }, continueMarkdownList).handled).toBe(false)
    expect(runCommand('- item', 6, continueMarkdownList, true).handled).toBe(false)
  })
})

describe('Markdown list indentation', () => {
  test('indents a bullet item to its content column', () => {
    const result = runCommand('- item', 3, indentMarkdownList(false))

    expect(result.handled).toBe(true)
    expect(result.state.doc.toString()).toBe('  - item')
    expect(result.transaction?.isUserEvent('input.markdown.list')).toBe(true)
  })

  test('indents every selected list line', () => {
    const result = runCommand('- one\n- two', { anchor: 2, head: 9 }, indentMarkdownList(false))

    expect(result.state.doc.toString()).toBe('  - one\n  - two')
  })

  test('excludes an unselected line whose start is the selection endpoint', () => {
    const source = '- one\n- two'
    const result = runCommand(
      source,
      { anchor: 0, head: source.indexOf('- two') },
      indentMarkdownList(false),
    )

    expect(result.state.doc.toString()).toBe('  - one\n- two')
  })

  test('preserves reverse selection direction and skips non-list lines', () => {
    const source = '- one\n\nplain\n\n- two'
    const result = runCommand(source, { anchor: source.length, head: 2 }, indentMarkdownList(false))

    expect(result.state.doc.toString()).toBe('  - one\n\nplain\n\n  - two')
    expect(result.state.selection.main.anchor).toBeGreaterThan(result.state.selection.main.head)
  })

  test('uses the preceding ordered marker width so the result parses as nested', () => {
    const source = '9. parent\n10. child'
    const result = runCommand(source, source.length, indentMarkdownList(false))

    expect(result.state.doc.toString()).toBe('9. parent\n   10. child')
    expect(syntaxTree(result.state).toString()).toContain(
      'ListItem(ListMark,Paragraph,OrderedList(ListItem',
    )
  })

  test('outdents one or two leading spaces', () => {
    expect(runCommand('  - item', 5, indentMarkdownList(true)).state.doc.toString()).toBe('- item')
    expect(runCommand(' - item', 4, indentMarkdownList(true)).state.doc.toString()).toBe('- item')
  })

  test('consumes Shift+Tab on unindented list without changing source', () => {
    const result = runCommand('- item', 3, indentMarkdownList(true))

    expect(result.handled).toBe(true)
    expect(result.transaction).toBeUndefined()
    expect(result.state.doc.toString()).toBe('- item')
  })

  test('leaves Tab to browser outside list and blocks changes in read-only state', () => {
    expect(runCommand('plain', 2, indentMarkdownList(false)).handled).toBe(false)
    expect(runCommand('- item', 3, indentMarkdownList(false), true).handled).toBe(false)
  })
})
