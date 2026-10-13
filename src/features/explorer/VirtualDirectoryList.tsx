import { sequence } from 'effectweb'
import { collection, domBinding, list, component, view, type JSX } from 'effectweb'
import type { FileItem } from '@/lib/files/types'
import { directoryViewport } from './virtual-directory-binding'
type VirtualDirectoryListProps = {
  files: readonly FileItem[]
  includeParent: boolean
  scrollTarget:
    | { kind: 'window' }
    | { kind: 'element'; getScrollElement: () => HTMLElement | undefined }
  colSpan: number
  columns?: readonly { class?: string }[]
  tableClass?: string
  estimateSize?: number
  overscan?: number
  scrollScope?: string | undefined
  sizeColumnClass?: string
  renderParentRow: () => JSX.Element
  renderFileRow: (file: FileItem) => JSX.Element
  renderEmptyRow?: () => JSX.Element
  class?: string
}
const byPath = collection<FileItem>((file) => file.path)
export const VirtualDirectoryList = component(
  {
    init: (_props: VirtualDirectoryListProps) => ({
      start: 0,
      end: 100,
      columns: 1,
      rowHeight: 48,
    }),
  },
  view((model, patch) => {
    const props = model.props
    const files = props.files
    const parent = props.includeParent
    const count = files.length + (parent ? 1 : 0)
    const span = props.colSpan
    const tableClass = props.tableClass
    const virtual = count > 100
    const start = virtual ? model.start : 0
    const end = virtual ? model.end : count
    const rows = files.slice(
      Math.max(0, start - (parent ? 1 : 0)),
      Math.max(0, end - (parent ? 1 : 0)),
    )
    return (
      <div
        class={props.class}
        use={domBinding(
          {
            files,
            includeParent: parent,
            target: props.scrollTarget,
            scope: props.scrollScope,
            grid: false,
            estimateSize: props.estimateSize,
            overscan: props.overscan,
            range: model,
            patch,
          },
          directoryViewport,
        )}
      >
        <table class={`w-full table-fixed caption-bottom text-sm ${tableClass ?? ''}`}>
          <colgroup>
            {props.columns ? (
              list(sequence(props.columns), (column) => <col class={column.class} />)
            ) : (
              <>
                <col class='w-[40px]' />
                <col />
                <col class={props.sizeColumnClass ?? 'w-24'} />
                {span >= 4 ? <col class='w-[52px]' /> : null}
              </>
            )}
          </colgroup>
          <tbody class='[&_tr:last-child]:border-0'>
            {start > 0 ? (
              <tr aria-hidden='true'>
                <td
                  colspan={span}
                  style={{ height: `${start * model.rowHeight}px`, padding: '0' }}
                />
              </tr>
            ) : null}
            {parent && start === 0 ? props.renderParentRow() : null}
            {list(byPath.from(rows), (file) => props.renderFileRow(file))}
            {props.renderEmptyRow?.()}
            {virtual && end < count ? (
              <tr aria-hidden='true'>
                <td
                  colspan={span}
                  style={{ height: `${(count - end) * model.rowHeight}px`, padding: '0' }}
                />
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    )
  }),
)
