import { post } from '@/lib/api/client'
import { createKeyedAsyncTaskQueue } from '@/lib/async-task-queue'
import type {
  FileColumnScope,
  FileColumnVisibility,
  FileSortOrder,
} from '@/lib/models/settings-types'

const writes = createKeyedAsyncTaskQueue<string>()

export function persistFileSortOrder(path: string, sortOrder: FileSortOrder): Promise<unknown> {
  return writes.run(`sort:${path}`, () => post('/api/settings/sortOrder', { path, ...sortOrder }))
}

export function persistFileColumns(
  scope: FileColumnScope,
  fileColumns: FileColumnVisibility,
): Promise<unknown> {
  return writes.run(`columns:${scope}`, () =>
    post('/api/settings/fileColumns', { scope, ...fileColumns }),
  )
}
