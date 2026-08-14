import type { ResourceSummary } from '@/lib/domain/resource'
import {
  filesystemPathForResourceKey,
  filesystemResourceIsDirectory,
  filesystemResourceMediaType,
} from '../integrations/filesystem/resource'
import { navigateSearchParams } from '../browser-history'

export type ReaderSourceKind = 'pdf' | 'folder' | 'book'

export function openInReader(resource: ResourceSummary): void {
  const path = filesystemPathForResourceKey(resource.key)
  if (path === null) return
  navigateSearchParams(
    {
      reader: path,
      readerKind: filesystemResourceIsDirectory(resource)
        ? 'folder'
        : filesystemResourceMediaType(resource) === 'book'
          ? 'book'
          : 'pdf',
    },
    'push',
  )
}

export function closeReader(): void {
  navigateSearchParams({ reader: null, readerKind: null }, 'push')
}
