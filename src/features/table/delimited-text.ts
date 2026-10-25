export type Delimiter = ',' | ';' | '\t' | '|'
export type DelimiterChoice = Delimiter | 'auto'
export type DelimitedCell = { value: string; from: number; to: number; quoted: boolean }
export type DelimitedRow = { cells: DelimitedCell[]; end: number }
export type DelimitedData = {
  rows: DelimitedRow[]
  columns: number
  delimiter: Delimiter
  truncated: boolean
  directive: boolean
  error: string
}
export const TABLE_MAX_ROWS = 100_000
export const TABLE_MAX_CELLS = 250_000
export const TABLE_MAX_COLUMNS = 512
function prefix(source: string) {
  const bom = source.startsWith('\ufeff') ? 1 : 0
  const directive = /^sep=([,;\t|])(?:\r\n|\n|\r|$)/i.exec(source.slice(bom))
  return {
    start: bom + (directive?.[0].length ?? 0),
    delimiter: directive?.[1] as Delimiter | undefined,
  }
}
function parse(
  source: string,
  delimiter: Delimiter,
  maxRows: number,
  maxCells: number,
): DelimitedData {
  const beginning = prefix(source)
  const result: DelimitedData = {
    rows: [],
    columns: 0,
    delimiter,
    truncated: false,
    directive: !!beginning.delimiter,
    error: '',
  }
  let index = beginning.start,
    cells = 0
  while (index < source.length) {
    const row: DelimitedRow = { cells: [], end: index }
    while (true) {
      if (row.cells.length >= TABLE_MAX_COLUMNS || cells >= maxCells) {
        result.truncated = true
        return result
      }
      const from = index,
        quoted = source[index] === '"'
      let value = ''
      if (quoted) {
        index++
        let segment = index,
          closed = false
        while (index < source.length) {
          if (source[index] !== '"') {
            index++
            continue
          }
          value += source.slice(segment, index)
          if (source[index + 1] === '"') {
            value += '"'
            index += 2
            segment = index
          } else {
            index++
            closed = true
            break
          }
        }
        if (!closed) {
          result.error = `Unclosed quoted field in record ${result.rows.length + 1}. Open the text view to correct it.`
          return result
        }
        while (source[index] === ' ' || (delimiter !== '\t' && source[index] === '\t')) index++
        if (
          index < source.length &&
          source[index] !== delimiter &&
          source[index] !== '\r' &&
          source[index] !== '\n'
        ) {
          result.error = `Unexpected text after a closing quote in record ${result.rows.length + 1}. Check the separator or open the text view.`
          return result
        }
      } else {
        while (
          index < source.length &&
          source[index] !== delimiter &&
          source[index] !== '\r' &&
          source[index] !== '\n'
        )
          index++
        value = source.slice(from, index)
      }
      row.cells.push({ value, from, to: index, quoted })
      cells++
      row.end = index
      if (source[index] === delimiter) {
        index++
        continue
      }
      if (source[index] === '\r') index += source[index + 1] === '\n' ? 2 : 1
      else if (source[index] === '\n') index++
      break
    }
    result.rows.push(row)
    result.columns = Math.max(result.columns, row.cells.length)
    if (result.rows.length >= maxRows && index < source.length) {
      result.truncated = true
      break
    }
  }
  return result
}
export function detectDelimiter(source: string, preferred: Delimiter = ','): Delimiter {
  const declared = prefix(source).delimiter
  if (declared) return declared
  let best = preferred,
    score = -Infinity
  for (const candidate of [
    preferred,
    ...([',', ';', '\t', '|'] as const).filter((item) => item !== preferred),
  ]) {
    const sample = parse(source, candidate, 24, 10_000)
    if (sample.error) continue
    const frequencies = new Map<number, number>()
    for (const row of sample.rows)
      if (row.cells.length > 1)
        frequencies.set(row.cells.length, (frequencies.get(row.cells.length) ?? 0) + 1)
    let value = 0
    for (const [columns, count] of frequencies)
      value = Math.max(
        value,
        count * 100 + Math.min(columns, 50) - (sample.rows.length - count) * 20,
      )
    if (value > score) {
      score = value
      best = candidate
    }
  }
  return score > 0 ? best : preferred
}
export function parseDelimited(
  source: string,
  choice: DelimiterChoice = 'auto',
  preferred: Delimiter = ',',
): DelimitedData {
  return parse(
    source,
    choice === 'auto' ? detectDelimiter(source, preferred) : choice,
    TABLE_MAX_ROWS,
    TABLE_MAX_CELLS,
  )
}
export function columnName(index: number): string {
  let name = ''
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26))
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name
  return name
}
export function encodeCell(value: string, delimiter: Delimiter, quoted = false): string {
  return quoted || value.includes(delimiter) || /["\r\n]/.test(value)
    ? `"${value.replace(/"/g, '""')}"`
    : value
}
export function replaceDelimitedCell(
  source: string,
  row: DelimitedRow,
  column: number,
  value: string,
  delimiter: Delimiter,
): string {
  const cell = row.cells[column]
  if (cell) {
    if (cell.value === value) return source
    return (
      source.slice(0, cell.from) + encodeCell(value, delimiter, cell.quoted) + source.slice(cell.to)
    )
  }
  if (!value) return source
  return (
    source.slice(0, row.end) +
    delimiter.repeat(column - row.cells.length + 1) +
    encodeCell(value, delimiter) +
    source.slice(row.end)
  )
}
export type TableSort = { column: number; direction: 'ascending' | 'descending' } | null
export function queryDelimited(
  data: DelimitedData,
  filter: string,
  header: boolean,
  sort: TableSort,
): number[] {
  const needle = filter.toLocaleLowerCase()
  const rows: number[] = []
  for (let index = header ? 1 : 0; index < data.rows.length; index++) {
    if (
      !needle ||
      data.rows[index]!.cells.some((cell) => cell.value.toLocaleLowerCase().includes(needle))
    )
      rows.push(index)
  }
  if (sort) {
    const compare = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
    rows.sort((a, b) => {
      const left = data.rows[a]!.cells[sort.column]?.value ?? '',
        right = data.rows[b]!.cells[sort.column]?.value ?? ''
      const number = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i
      const order =
        number.test(left) &&
        number.test(right) &&
        Number.isFinite(Number(left)) &&
        Number.isFinite(Number(right))
          ? Number(left) - Number(right)
          : compare.compare(left, right)
      return (sort.direction === 'ascending' ? order : -order) || a - b
    })
  }
  return rows
}
