import type { FileItem } from '@/lib/types'
import type { ViewerId } from '@/lib/resource'
import { navigate, parseRoute } from '../lib/routes'
import { viewerReaderKind } from '../lib/viewer-registry'

export type ReaderSourceKind = 'pdf' | 'folder' | 'book'

export function openInReader(
  file: Pick<FileItem, 'path' | 'isDirectory' | 'type'>,
  viewerId?: ViewerId,
): void {
  const url = new URL(window.location.href)
  url.searchParams.set('reader', file.path)
  const plannedKind = viewerId ? viewerReaderKind(viewerId) : null
  url.searchParams.set(
    'readerKind',
    plannedKind ?? (file.isDirectory ? 'folder' : file.type === 'book' ? 'book' : 'pdf'),
  )
  navigate(parseRoute(url))
}

export function closeReader(): void {
  const url = new URL(window.location.href)
  url.searchParams.delete('reader')
  url.searchParams.delete('readerKind')
  navigate(parseRoute(url))
}
