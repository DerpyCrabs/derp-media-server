import { controllerView, domBinding, list, view } from 'effectweb'
import { columnName, type DelimiterChoice } from './delimited-text'
import { tableController } from './table-controller'
import { tableViewport } from './table-viewport'
const field = 'rounded border border-input bg-background px-2 py-1 text-sm'
export default controllerView(
  { controller: tableController },
  view((model) => {
    const { actions, data } = model
    const firstRow = Math.max(0, Math.floor(model.top / 32) - 4)
    const visibleRows = model.order.slice(firstRow, firstRow + Math.ceil(model.height / 32) + 10)
    const firstColumn = Math.max(0, Math.floor(Math.max(0, model.left - 48) / 180) - 1)
    const columns = Array.from(
      {
        length: Math.max(
          0,
          Math.min(data?.columns ?? 0, firstColumn + Math.ceil(model.width / 180) + 3) -
            firstColumn,
        ),
      },
      (_, i) => i + firstColumn,
    )
    const selected = model.selection
    const span =
      1 +
      columns.length +
      (firstColumn > 0 ? 1 : 0) +
      ((data?.columns ?? 0) > firstColumn + columns.length ? 1 : 0)
    return (
      <div class='flex h-full min-h-0 flex-col'>
        <div class='flex shrink-0 flex-wrap items-center gap-2 border-b border-border p-2'>
          <input
            type='search'
            aria-label='Filter table rows'
            placeholder='Filter rows…'
            class={`${field} min-w-24 flex-1`}
            value={model.filter}
            onInput={(event) => actions.filter(event.currentTarget.value)}
          />
          <button
            class={`${field} shrink-0 hover:bg-accent`}
            aria-label='Table options'
            aria-expanded={model.options}
            onClick={actions.options}
          >
            {data?.delimiter === '\t'
              ? 'Tab'
              : data?.delimiter === ';'
                ? 'Semicolon'
                : data?.delimiter === '|'
                  ? 'Pipe'
                  : 'Comma'}
            {model.header ? ' · Headers' : ''} ▾
          </button>
        </div>
        {model.options ? (
          <div
            class='flex shrink-0 flex-wrap items-center gap-3 border-b border-border px-2 py-2'
            role='group'
            aria-label='Table options'
          >
            <label class='flex items-center gap-1 text-xs'>
              Separator
              <select
                aria-label='Table separator'
                class={field}
                value={model.choice}
                onChange={(event) =>
                  actions.delimiter(event.currentTarget.value as DelimiterChoice)
                }
              >
                <option value='auto'>Auto</option>
                <option value=','>Comma</option>
                <option value=';'>Semicolon</option>
                <option value={'\t'}>Tab</option>
                <option value='|'>Pipe</option>
              </select>
            </label>
            <label class='flex items-center gap-1 text-xs'>
              <input
                type='checkbox'
                checked={model.header}
                onChange={(event) => actions.header(event.currentTarget.checked)}
              />
              First row as headers
            </label>
          </div>
        ) : null}
        {model.error ? (
          <p role='alert' class='border-b border-border p-2 text-sm text-destructive'>
            {model.error}
          </p>
        ) : null}
        {data?.truncated ? (
          <p role='status' class='border-b border-border p-2 text-xs text-muted-foreground'>
            Preview limit reached. The complete file is preserved; use Text to inspect the remaining
            records.
          </p>
        ) : null}
        <div
          class='relative min-h-0 flex-1 overflow-auto'
          tabIndex={0}
          aria-label='Table records'
          use={domBinding(
            {
              update: actions.viewport,
              save: actions.save,
              history: actions.history,
              reset: model.scrollReset,
              order: model.order,
              data,
              focus: actions.focus,
            },
            tableViewport,
          )}
        >
          <table
            class='table-fixed border-collapse text-sm'
            style={{ width: `${48 + (data?.columns ?? 0) * 180}px` }}
            aria-label='Delimited text table'
            aria-rowcount={model.order.length + 1}
            aria-colcount={(data?.columns ?? 0) + 1}
          >
            <thead class='sticky top-0 z-20 bg-muted'>
              <tr class='h-8'>
                <th
                  class='sticky left-0 z-10 w-12 border-b border-r border-border bg-muted text-xs text-muted-foreground'
                  scope='col'
                >
                  #
                </th>
                {firstColumn > 0 ? (
                  <th aria-hidden='true' style={{ width: `${firstColumn * 180}px` }} />
                ) : null}
                {list(
                  columns,
                  (column) => column,
                  (column) => (
                    <th
                      scope='col'
                      class='h-8 w-[180px] border-b border-r border-border p-0 text-left font-medium'
                      aria-colindex={column + 2}
                      aria-sort={model.sort?.column === column ? model.sort.direction : 'none'}
                    >
                      <button
                        class='block h-[31px] w-full truncate px-2 text-left hover:bg-accent'
                        title={`Sort by ${model.header ? data?.rows[0]?.cells[column]?.value || columnName(column) : columnName(column)}`}
                        onClick={() => actions.sort(column)}
                      >
                        {model.header
                          ? data?.rows[0]?.cells[column]?.value || columnName(column)
                          : columnName(column)}
                        {model.sort?.column === column
                          ? model.sort.direction === 'ascending'
                            ? ' ↑'
                            : ' ↓'
                          : ''}
                      </button>
                    </th>
                  ),
                )}
                {(data?.columns ?? 0) > firstColumn + columns.length ? (
                  <th
                    aria-hidden='true'
                    style={{
                      width: `${((data?.columns ?? 0) - firstColumn - columns.length) * 180}px`,
                    }}
                  />
                ) : null}
              </tr>
            </thead>
            <tbody>
              {firstRow > 0 ? (
                <tr aria-hidden='true' style={{ height: `${firstRow * 32}px` }}>
                  <td colSpan={span} />
                </tr>
              ) : null}
              {list(
                visibleRows,
                (row) => row,
                (row) => (
                  <tr class='h-8' aria-rowindex={model.order.indexOf(row) + 2}>
                    <th
                      scope='row'
                      class='sticky left-0 z-10 h-8 w-12 border-b border-r border-border bg-muted text-xs font-normal text-muted-foreground'
                    >
                      {row + 1}
                    </th>
                    {firstColumn > 0 ? (
                      <td aria-hidden='true' style={{ width: `${firstColumn * 180}px` }} />
                    ) : null}
                    {list(
                      columns,
                      (column) => column,
                      (column) => (
                        <td
                          class='h-8 w-[180px] border-b border-r border-border p-0'
                          aria-colindex={column + 2}
                        >
                          <button
                            class='block h-[31px] w-full truncate px-2 text-left hover:bg-accent aria-pressed:bg-accent'
                            aria-label={`Cell ${columnName(column)}${row + 1}`}
                            data-table-row={row}
                            data-table-column={column}
                            tabIndex={
                              (
                                model.active &&
                                visibleRows.includes(model.active.row) &&
                                columns.includes(model.active.column)
                                  ? model.active.row === row && model.active.column === column
                                  : row === model.order[0] && column === 0
                              )
                                ? 0
                                : -1
                            }
                            aria-pressed={selected?.row === row && selected.column === column}
                            title={data?.rows[row]?.cells[column]?.value ?? ''}
                            onClick={() => actions.select(row, column)}
                          >
                            {data?.rows[row]?.cells[column]?.value ?? ''}
                          </button>
                        </td>
                      ),
                    )}
                    {(data?.columns ?? 0) > firstColumn + columns.length ? (
                      <td aria-hidden='true' />
                    ) : null}
                  </tr>
                ),
              )}
              {model.order.length > firstRow + visibleRows.length ? (
                <tr
                  aria-hidden='true'
                  style={{
                    height: `${(model.order.length - firstRow - visibleRows.length) * 32}px`,
                  }}
                >
                  <td colSpan={span} />
                </tr>
              ) : null}
            </tbody>
          </table>
          {!model.loading && !model.order.length ? (
            <p class='p-4 text-sm text-muted-foreground'>
              {model.filter ? 'No matching rows.' : 'No data rows.'}
            </p>
          ) : null}
        </div>
        {selected ? (
          <div class='shrink-0 border-t border-border p-2'>
            <div class='mb-1 flex items-center justify-between gap-2 text-xs'>
              <label for='table-cell-value'>
                Cell {columnName(selected.column)}
                {selected.row + 1}
                {model.props.readOnly
                  ? ' · Read only'
                  : ' · Changes are backed up with this document'}
              </label>
              <div class='flex gap-2'>
                {!model.props.readOnly ? (
                  <button class='hover:underline' onClick={actions.cancel}>
                    Cancel cell edit
                  </button>
                ) : null}
                <button class='hover:underline' onClick={actions.finish}>
                  Done
                </button>
              </div>
            </div>
            <textarea
              id='table-cell-value'
              aria-label='Cell value'
              rows={3}
              readOnly={model.props.readOnly}
              class={`${field} block max-h-48 w-full resize-y font-mono`}
              value={selected.value}
              onInput={(event) => actions.edit(event.currentTarget.value)}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.key === 'Escape') {
                  event.preventDefault()
                  actions.cancel()
                }
                if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                  event.preventDefault()
                  actions.finish()
                }
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
                  event.preventDefault()
                  actions.save()
                }
              }}
            />
          </div>
        ) : null}
        <div
          role='status'
          class='flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border px-2 py-1 text-xs text-muted-foreground'
        >
          <span>
            {model.loading
              ? 'Preparing table…'
              : `${model.order.length.toLocaleString()} rows · ${data?.columns ?? 0} columns`}
            {model.sort ? ' · View sorted' : ''}
          </span>
          <span>
            Click a cell to {model.props.readOnly ? 'inspect or copy' : 'inspect or edit'}
            {!model.props.readOnly ? (
              <>
                {' '}
                ·{' '}
                <button
                  disabled={!model.undo.length}
                  class='hover:underline disabled:opacity-40'
                  onClick={() => actions.history(false)}
                >
                  Undo
                </button>{' '}
                ·{' '}
                <button
                  disabled={!model.redo.length}
                  class='hover:underline disabled:opacity-40'
                  onClick={() => actions.history(true)}
                >
                  Redo
                </button>
              </>
            ) : null}
          </span>
        </div>
      </div>
    )
  }),
)
