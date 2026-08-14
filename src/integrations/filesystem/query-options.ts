import { queryOptions } from '@tanstack/solid-query'
import { queryKeys } from '@/lib/query-keys'
import { browseIntegrationResource } from '../http-client'
import { filesystemResourceKeyForPath } from './resource'

export type FilesystemListParameters = Readonly<{
  dir: string
  surface?: 'library' | 'workspace' | 'canvas'
  offset?: number
}>

export async function listFilesystemResources(
  parameters: FilesystemListParameters,
  signal?: AbortSignal,
) {
  const page = await browseIntegrationResource({
    location: filesystemResourceKeyForPath(parameters.dir),
    ...(parameters.offset ? { cursor: String(parameters.offset) } : {}),
    signal,
  })
  return {
    resources: page.items,
    total: page.total,
    offset: parameters.offset ?? 0,
  }
}

export function filesystemResourcesQueryOptions(parameters: FilesystemListParameters) {
  return queryOptions({
    queryKey: queryKeys.filesPage(parameters.dir, parameters.surface, parameters.offset),
    queryFn: ({ signal }) => listFilesystemResources(parameters, signal),
  })
}
