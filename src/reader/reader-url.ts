import type { FileItem } from '@/lib/types'
import { navigateSearchParams } from '../browser-history'

export type ReaderSourceKind = 'pdf' | 'folder' | 'book'

export function openInReader(file: Pick<FileItem, 'path' | 'isDirectory' | 'type'>): void {
  navigateSearchParams(
    {
      reader: file.path,
      readerKind: file.isDirectory ? 'folder' : file.type === 'book' ? 'book' : 'pdf',
    },
    'push',
  )
}

export function closeReader(): void {
  navigateSearchParams({ reader: null, readerKind: null }, 'push')
}
