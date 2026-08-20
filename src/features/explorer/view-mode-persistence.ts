import { post } from '@/lib/api/client'
import { createKeyedAsyncTaskQueue } from '@/lib/async-task-queue'

type ViewMode = 'list' | 'grid'

const writes = createKeyedAsyncTaskQueue<string>()

export function persistViewMode(path: string, viewMode: ViewMode): Promise<unknown> {
  return writes.run(path, () => post('/api/settings/viewMode', { path, viewMode }))
}
