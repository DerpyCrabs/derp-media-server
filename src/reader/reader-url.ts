import type { FileItem } from '@/lib/types'

export type ReaderSourceKind = 'pdf' | 'folder' | 'book'

export function openInReader(file: Pick<FileItem, 'path' | 'isDirectory' | 'type'>): void {
  const url = new URL(window.location.href)
  url.searchParams.set('reader', file.path)
  url.searchParams.set(
    'readerKind',
    file.isDirectory ? 'folder' : file.type === 'book' ? 'book' : 'pdf',
  )
  window.history.pushState({}, '', url)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

export function closeReader(): void {
  const url = new URL(window.location.href)
  url.searchParams.delete('reader')
  url.searchParams.delete('readerKind')
  window.history.pushState({}, '', url)
  window.dispatchEvent(new PopStateEvent('popstate'))
}
