import { observe, view } from 'effectweb'
import { browserHistory } from '@/lib/browser/browser-history'
import { Reader } from './Reader'
export type ReaderDialogProps = {
  sourcePath?: string
  sourceKind?: 'pdf' | 'folder' | 'book'
  onClose?: () => void
}
export const ReaderDialog = view<ReaderDialogProps>((props) =>
  observe(browserHistory, (location) => {
    const params = new URLSearchParams(location.search)
    const sourcePath = props.sourcePath ?? params.get('reader') ?? ''
    const sourceKind =
      props.sourceKind ??
      (params.get('readerKind') === 'folder'
        ? 'folder'
        : params.get('readerKind') === 'book'
          ? 'book'
          : 'pdf')
    return (
      <Reader
        sourcePath={sourcePath}
        kind={sourceKind === 'folder' ? 'directory' : sourceKind}
        embedded={false}
        showClose
        onClose={props.onClose}
      />
    )
  }),
)
