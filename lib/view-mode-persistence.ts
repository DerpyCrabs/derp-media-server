import { post } from './api'

type ViewMode = 'list' | 'grid'

const pendingWrites = new Map<string, Promise<unknown>>()

export function persistViewMode(path: string, viewMode: ViewMode): Promise<unknown> {
  const previous = pendingWrites.get(path) ?? Promise.resolve()
  const next = previous
    .catch(() => undefined)
    .then(() => post('/api/settings/viewMode', { path, viewMode }))
  pendingWrites.set(path, next)
  void next.finally(() => {
    if (pendingWrites.get(path) === next) pendingWrites.delete(path)
  })
  return next
}
