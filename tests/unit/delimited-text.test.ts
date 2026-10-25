import { describe, expect, test } from 'bun:test'
import {
  columnName,
  detectDelimiter,
  parseDelimited,
  queryDelimited,
  replaceDelimitedCell,
} from '../../src/features/table/delimited-text'
describe('delimited documents', () => {
  test('parses quoted separators, escaped quotes, multiline cells, empty fields and mixed line endings', () => {
    const source = '\ufeffname,note,empty\r\n"A,B","line one\r\nline ""two""",\nlast,x,\r'
    const data = parseDelimited(source)
    expect(data.error).toBe('')
    expect(data.rows.map((row) => row.cells.map((cell) => cell.value))).toEqual([
      ['name', 'note', 'empty'],
      ['A,B', 'line one\r\nline "two"', ''],
      ['last', 'x', ''],
    ])
    expect(data.columns).toBe(3)
  })
  test('detects delimiters without counting separators inside quoted values and keeps directives', () => {
    expect(detectDelimiter('name;amount\n"a,b,c";2\nx;3')).toBe(';')
    expect(detectDelimiter('name\tamount\na\t2\nb\t3', '\t')).toBe('\t')
    const source = '\ufeffsep=|\r\nname|value\r\none|two\r\n'
    const data = parseDelimited(source)
    expect(data.directive).toBe(true)
    expect(data.delimiter).toBe('|')
    expect(replaceDelimitedCell(source, data.rows[1]!, 1, 'three', '|')).toBe(
      '\ufeffsep=|\r\nname|value\r\none|three\r\n',
    )
  })
  test('editing one cell preserves every byte outside that field including BOM, quoting and line endings', () => {
    const source = '\ufeff"name"; value ;note\r\n"Alice";001;"a\r\nb"\nBob;2;\r'
    const data = parseDelimited(source)
    const changed = replaceDelimitedCell(source, data.rows[1]!, 1, 'x;y"z', ';')
    expect(changed).toBe('\ufeff"name"; value ;note\r\n"Alice";"x;y""z";"a\r\nb"\nBob;2;\r')
    expect(replaceDelimitedCell(source, data.rows[1]!, 0, 'Alice', ';')).toBe(source)
    expect(replaceDelimitedCell(source, data.rows[2]!, 4, 'new', ';')).toBe(
      '\ufeff"name"; value ;note\r\n"Alice";001;"a\r\nb"\nBob;2;;;new\r',
    )
  })
  test('filtering and stable numeric sorting change only row order, never values or source', () => {
    const data = parseDelimited('id,value\n001,10\n002,-2\n003,1.5\n004,1.5')
    expect(queryDelimited(data, '', true, { column: 1, direction: 'ascending' })).toEqual([
      2, 3, 4, 1,
    ])
    expect(queryDelimited(data, '003', true, null)).toEqual([3])
    expect(data.rows[1]!.cells[0]!.value).toBe('001')
    expect(queryDelimited(data, '', false, null)).toEqual([0, 1, 2, 3, 4])
  })
  test('invalid quoting fails visibly, large tables stop at a full row and column labels are familiar', () => {
    expect(parseDelimited('a,b\n"not closed,x').error).toContain('Unclosed')
    expect(parseDelimited('a,b\n"one"junk,two', ',').error).toContain('Unexpected')
    const data = parseDelimited('a,b\n'.repeat(100_001), ',')
    expect(data.truncated).toBe(true)
    expect(data.rows).toHaveLength(100_000)
    expect([0, 25, 26, 51, 52].map(columnName)).toEqual(['A', 'Z', 'AA', 'AZ', 'BA'])
  })
})
