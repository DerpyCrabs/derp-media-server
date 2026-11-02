import { modelOwner, type JSX } from 'effectweb'
import type { Effect } from 'effect'
import {
  replaceDelimitedCell,
  type DelimitedData,
  type DelimiterChoice,
  type TableSort,
} from './delimited-text'
import type { TableWorkerRequest, TableWorkerResponse } from './delimited-worker'
export type TableDocumentProps = {
  path: string
  toolbar?: JSX.Element
  toolbarEnd?: JSX.Element
  content: string
  readOnly: boolean
  onChange: (content: string) => void
  onBlur: () => void
  onSave: () => Effect.Effect<void, unknown>
}
type Selection = { row: number; column: number; baseline: string; value: string; output: string }
export function tableController(props: TableDocumentProps) {
  const owner = modelOwner({
    props,
    data: null as DelimitedData | null,
    order: [] as number[],
    loading: true,
    error: '',
    filter: '',
    options: false,
    filterOpen: false,
    header: true,
    choice: 'auto' as DelimiterChoice,
    sort: null as TableSort,
    scrollReset: 0,
    top: 0,
    left: 0,
    height: 600,
    width: 800,
    selection: null as Selection | null,
    active: null as { row: number; column: number } | null,
    undo: [] as string[],
    redo: [] as string[],
  })
  const worker = new Worker(new URL('./delimited-worker.ts', import.meta.url), { type: 'module' })
  let sequence = 0
  let pendingSelection: { row: number; column: number } | undefined
  let parsedSource = ''
  let requestedSource = ''
  let parsedChoice: DelimiterChoice | undefined
  owner.own({ dispose: () => worker.terminate() })
  function refresh() {
    const m = owner.read()
    const parse =
      !m.data || m.loading || parsedSource !== m.props.content || parsedChoice !== m.choice
    requestedSource = m.props.content
    const request: TableWorkerRequest = {
      id: ++sequence,
      ...(parse ? { source: requestedSource } : {}),
      choice: m.choice,
      preferred: /\.tsv$/i.test(m.props.path) ? '\t' : ',',
      filter: m.filter,
      header: m.header,
      sort: m.sort,
    }
    owner.patch({ loading: true, error: '' })
    worker.postMessage(request)
  }
  worker.onmessage = (event: MessageEvent<TableWorkerResponse>) => {
    const result = event.data
    if (owner.disposed || result.id !== sequence) return
    if (result.data) {
      parsedSource = requestedSource
      parsedChoice = owner.read().choice
    }
    owner.patch({
      ...(result.data ? { data: result.data } : {}),
      order: result.order,
      error: result.error ?? result.data?.error ?? owner.read().data?.error ?? '',
      loading: false,
    })
    if (pendingSelection) {
      const target = pendingSelection
      pendingSelection = undefined
      actions.select(target.row, target.column)
    }
  }
  worker.onerror = () =>
    owner.patch({
      loading: false,
      error: 'The table could not be loaded. Switch to Text to continue.',
    })
  function finish() {
    const m = owner.read(),
      selection = m.selection
    if (!selection) return
    const changed = selection.baseline !== selection.output
    const history = changed ? [...m.undo, selection.baseline].slice(-20) : m.undo
    while (history.length > 1 && history.reduce((sum, value) => sum + value.length, 0) > 32_000_000)
      history.shift()
    owner.patch({ selection: null, undo: history, redo: changed ? [] : m.redo })
    if (changed) {
      refresh()
      m.props.onBlur()
    }
  }
  const actions = {
    finish,
    options: (options: boolean) => owner.patch({ options }),
    showFilter: (filterOpen: boolean) => owner.patch({ filterOpen }),
    focus: (row: number, column: number) => owner.patch({ active: { row, column } }),
    select: (row: number, column: number) => {
      finish()
      const m = owner.read()
      if (!m.data || m.loading || parsedSource !== m.props.content) {
        pendingSelection = { row, column }
        return
      }
      const value = m.data.rows[row]?.cells[column]?.value ?? ''
      owner.patch({
        selection: { row, column, baseline: m.props.content, value, output: m.props.content },
      })
    },
    edit: (value: string) => {
      const m = owner.read(),
        selection = m.selection
      if (!selection || !m.data || m.props.readOnly) return
      const row = m.data.rows[selection.row]
      if (!row) return
      const output = replaceDelimitedCell(
        selection.baseline,
        row,
        selection.column,
        value,
        m.data.delimiter,
      )
      owner.patch({
        selection: { ...selection, value, output },
        props: { ...m.props, content: output },
      })
      m.props.onChange(output)
    },
    cancel: () => {
      const m = owner.read()
      if (!m.selection) return
      const content = m.selection.baseline
      owner.patch({ selection: null, props: { ...m.props, content } })
      m.props.onChange(content)
      refresh()
    },
    filter: (filter: string) => {
      finish()
      owner.patch({ filter, top: 0, scrollReset: owner.read().scrollReset + 1 })
      refresh()
    },
    header: (header: boolean) => {
      finish()
      owner.patch({ header, top: 0, scrollReset: owner.read().scrollReset + 1 })
      refresh()
    },
    delimiter: (choice: DelimiterChoice) => {
      finish()
      owner.patch({ choice, top: 0, scrollReset: owner.read().scrollReset + 1 })
      refresh()
    },
    sort: (column: number) => {
      finish()
      const sort = owner.read().sort
      owner.patch({
        sort:
          sort?.column === column
            ? sort.direction === 'ascending'
              ? { column, direction: 'descending' }
              : null
            : { column, direction: 'ascending' },
        top: 0,
        scrollReset: owner.read().scrollReset + 1,
      })
      refresh()
    },
    viewport: (top: number, left: number, height: number, width: number) =>
      owner.patch({ top, left, height, width }),
    history: (redo: boolean) => {
      finish()
      const m = owner.read(),
        stack = redo ? m.redo : m.undo,
        content = stack.at(-1)
      if (m.props.readOnly || content === undefined) return
      owner.patch({
        props: { ...m.props, content },
        undo: redo ? [...m.undo, m.props.content] : m.undo.slice(0, -1),
        redo: redo ? m.redo.slice(0, -1) : [...m.redo, m.props.content],
      })
      m.props.onChange(content)
      refresh()
    },
    save: () => {
      finish()
      owner.run('save', owner.read().props.onSave(), 'drop')
    },
  }
  refresh()
  return {
    source: owner.source,
    ...actions,
    receive: (next: TableDocumentProps) => {
      const old = owner.read()
      owner.patch({ props: next })
      if (next.content !== old.props.content) {
        owner.patch({ selection: null, undo: [], redo: [] })
        refresh()
      }
      if (next.readOnly && old.selection) finish()
    },
    lifetime: owner,
  }
}
