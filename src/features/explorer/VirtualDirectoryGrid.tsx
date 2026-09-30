import {
  type Snapshot,
  collection,
  domBinding,
  list,
  localComponent,
  view,
  type JSX,
} from 'effectweb'
import type { FileItem } from '@/lib/files/types'
import { cn } from '@/lib/ui/cn'
import { directoryViewport } from './virtual-directory-binding'
type VirtualDirectoryGridProps = {
  files: readonly FileItem[]
  includeParent: boolean
  scrollTarget:
    | { kind: 'window' }
    | { kind: 'element'; getScrollElement: () => HTMLElement | undefined }
  scrollScope?: string | undefined
  class?: string
  renderParentCard: () => JSX.Element
  renderFileCard: (file: FileItem) => JSX.Element
}
const byPath = collection<FileItem>((file) => file.path)
export const VirtualDirectoryGrid = localComponent({
  init: (_props: Snapshot<VirtualDirectoryGridProps>) => ({
    start: 0,
    end: 100,
    columns: 1,
    rowHeight: 224,
  }),
  view: view((model, patch) => {
    const props = model.props
    const files = props.files
    const parent = props.includeParent
    const count = files.length + (parent ? 1 : 0)
    const virtual = count > 100
    const start = virtual ? model.start * model.columns : 0
    const end = virtual ? Math.min(count, model.end * model.columns) : count
    const rows = files.slice(
      Math.max(0, start - (parent ? 1 : 0)),
      Math.max(0, end - (parent ? 1 : 0)),
    )
    const rowCount = Math.ceil(count / model.columns)
    return (
      <div
        class={cn('file-browser-grid', props.class)}
        style={{ display: 'block' }}
        use={domBinding(
          {
            files,
            includeParent: parent,
            target: props.scrollTarget,
            scope: props.scrollScope,
            grid: true,
            range: model,
            patch,
          },
          directoryViewport,
        )}
      >
        {virtual && model.start > 0 ? (
          <div aria-hidden='true' style={{ height: `${model.start * model.rowHeight}px` }} />
        ) : null}
        <div
          class='grid gap-4'
          style={{ 'grid-template-columns': `repeat(${model.columns}, minmax(0, 1fr))` }}
        >
          {parent && start === 0 ? props.renderParentCard() : null}
          {list(byPath.from(rows), (file) => props.renderFileCard(file))}
        </div>
        {virtual && model.end < rowCount ? (
          <div
            aria-hidden='true'
            style={{ height: `${(rowCount - model.end) * model.rowHeight}px` }}
          />
        ) : null}
      </div>
    )
  }),
})
