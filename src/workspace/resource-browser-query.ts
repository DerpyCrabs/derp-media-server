import { queryKeys } from '@/lib/query-keys'
import type { OpenSurface } from '@/src/lib/open-resource'

export function ownerResourceBrowserQuery(
  dir: string,
  offset: number,
  requestedSurface?: OpenSurface,
) {
  const surface = requestedSurface === 'canvas' ? 'canvas' : 'workspace'
  return {
    queryKey: [...queryKeys.files(dir), 'surface', surface, offset] as const,
    url: `/api/files?surface=${surface}&dir=${encodeURIComponent(dir)}&offset=${offset}`,
  }
}
