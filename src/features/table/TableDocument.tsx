import { Popover } from '@/lib/ui/popover'
import Search from '@effectweb/lucide/icons/search'
import SlidersHorizontal from '@effectweb/lucide/icons/sliders-horizontal'
import X from '@effectweb/lucide/icons/x'
import { Checkbox } from '@/lib/ui/checkbox'
import { Input, Textarea } from '@/lib/ui/input'
import { Button } from '@/lib/ui/button'
import { Select } from '@/lib/ui/select'
import { controllerView, domBinding, list, view } from 'effectweb'
import { columnName, type DelimiterChoice } from './delimited-text'
import { tableController } from './table-controller'
import { tableViewport } from './table-viewport'
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
        <header class='flex h-10 shrink-0 items-center gap-1 border-b px-2'>
          {model.props.toolbar ?? (
            <span class='min-w-0 flex-1 truncate text-sm'>{model.props.path.split('/').pop()}</span>
          )}
          <Button
            variant='ghost'
            size='icon'
            aria-label='Filter table'
            onClick={() => actions.showFilter(!model.filterOpen)}
          >
            <Search size={16} />
          </Button>
          <Popover
            aria-label='Table options'
            open={model.options}
            onOpenChange={actions.options}
            align='end'
            class='w-64 space-y-3'
            trigger={
              <Button variant='ghost' size='icon' aria-label='Table options'>
                <SlidersHorizontal size={16} />
              </Button>
            }
          >
            <label class='grid gap-1 text-sm'>
              Separator
              <Select
                aria-label='Table separator'
                class='w-full'
                value={model.choice}
                onValueChange={(value) => actions.delimiter(value as DelimiterChoice)}
                options={[
                  { value: 'auto', label: 'Auto' },
                  { value: ',', label: 'Comma' },
                  { value: ';', label: 'Semicolon' },
                  { value: '\t', label: 'Tab' },
                  { value: '|', label: 'Pipe' },
                ]}
              />
            </label>
            <label class='flex items-center gap-2 text-sm'>
              <Checkbox checked={model.header} onCheckedChange={actions.header} />
              First row as headers
            </label>
            {!model.props.readOnly ? (
              <div class='flex gap-2'>
                <Button
                  variant='outline'
                  disabled={!model.undo.length}
                  onClick={() => actions.history(false)}
                >
                  Undo
                </Button>
                <Button
                  variant='outline'
                  disabled={!model.redo.length}
                  onClick={() => actions.history(true)}
                >
                  Redo
                </Button>
              </div>
            ) : null}
            <p class='text-xs text-muted-foreground'>
              {model.order.length.toLocaleString()} rows · {data?.columns ?? 0} columns
            </p>
          </Popover>
          {model.props.toolbarEnd}
        </header>
        {model.filterOpen ? (
          <div class='flex shrink-0 items-center gap-2 border-b px-2 py-1'>
            <Input
              type='search'
              autofocus
              aria-label='Filter table rows'
              placeholder='Filter rows…'
              class='min-w-0 flex-1'
              value={model.filter}
              onInput={(event) => actions.filter(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation()
                  actions.filter('')
                  actions.showFilter(false)
                }
              }}
            />
            <Button
              variant='ghost'
              size='icon'
              aria-label='Close table filter'
              onClick={() => {
                actions.filter('')
                actions.showFilter(false)
              }}
            >
              <X size={16} />
            </Button>
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
                      class='h-8 w-[180px] border-b border-r border-border p-0 justify-start text-left font-medium'
                      aria-colindex={column + 2}
                      aria-sort={model.sort?.column === column ? model.sort.direction : 'none'}
                    >
                      <Button
                        variant='ghost'
                        class='block h-[31px] w-full truncate px-2 justify-start text-left hover:bg-accent'
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
                      </Button>
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
                          <Button
                            variant='ghost'
                            class='block h-[31px] w-full truncate px-2 justify-start text-left hover:bg-accent aria-pressed:bg-accent'
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
                          </Button>
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
                {model.props.readOnly ? ' · Read only' : ''}
              </label>
              <div class='flex gap-2'>
                {!model.props.readOnly ? (
                  <Button variant='outline' aria-label='Cancel cell edit' onClick={actions.cancel}>
                    Cancel
                  </Button>
                ) : null}
                <Button variant='outline' onClick={actions.finish}>
                  Done
                </Button>
              </div>
            </div>
            <Textarea
              id='table-cell-value'
              aria-label='Cell value'
              rows={Math.min(4, Math.max(1, selected.value.split('\n').length))}
              readOnly={model.props.readOnly}
              class='block min-h-8 max-h-48 w-full resize-y font-mono'
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
      </div>
    )
  }),
)
