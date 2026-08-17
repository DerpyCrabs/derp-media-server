import { post } from '@/lib/api/client'
import { createKeyedAsyncTaskQueue } from '@/lib/async-task-queue'
import type { FileColumnVisibility, FileSortOrder } from '@/lib/models/settings-types'

const writes = createKeyedAsyncTaskQueue<string>()

export function persistFileSortOrder(path: string, sortOrder: FileSortOrder): Promise<unknown> {
  return writes.run(`sort:${path}`, () => post('/api/settings/sortOrder', { path, ...sortOrder }))
}

export function persistFileColumns(fileColumns: FileColumnVisibility): Promise<unknown> {
  return writes.run('columns', () => post('/api/settings/fileColumns', fileColumns))
}
