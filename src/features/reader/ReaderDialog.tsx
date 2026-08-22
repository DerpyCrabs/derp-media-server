import { createMemo } from 'solid-js'
import { useBrowserHistory } from '@/lib/browser/browser-history'
import { Reader } from './Reader'

export type ReaderDialogProps = {
  sourcePath?: string
  sourceKind?: 'pdf' | 'folder' | 'book'
  onClose?: () => void
}

export function ReaderDialog(props: ReaderDialogProps = {}) {
  const history = useBrowserHistory()
  const params = createMemo(() => new URLSearchParams(history().search))
  const sourcePath = createMemo(() => props.sourcePath ?? params().get('reader') ?? '')
  const sourceKind = createMemo(
    () =>
      props.sourceKind ??
      (params().get('readerKind') === 'folder'
        ? 'folder'
        : params().get('readerKind') === 'book'
          ? 'book'
          : 'pdf'),
  )
  const kind = createMemo(() => {
    const value = sourceKind()
    return value === 'folder' ? 'directory' : value
  })

  return (
    <Reader
      sourcePath={sourcePath()}
      kind={kind()}
      embedded={false}
      showClose
      onClose={props.onClose}
    />
  )
}
