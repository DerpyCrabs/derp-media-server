import { directoryListingSchema } from '@/lib/files/file-schemas'
import { apiSchemaEffect, type ApiRequestOptions } from '@/lib/api/client'
import { queryKeys } from '@/lib/api/query-keys'
import type { DirectoryListing } from '@/lib/files/virtual-directory'
export const FILE_BROWSER_INITIAL_PAGE = 0
export function fileBrowserListingQueryKey(path: string) {
  return [...queryKeys.files(path), 'file-browser'] as const
}
export function fetchFileBrowserListingEffect(
  path: string,
  offset: number,
  options?: ApiRequestOptions,
) {
  return apiSchemaEffect(
    directoryListingSchema,
    `/api/files?virtual_browser=true&dir=${encodeURIComponent(path)}&offset=${offset}`,
    options,
  )
}
export function nextFileBrowserListingPage(lastPage: DirectoryListing) {
  return lastPage.virtualDirectory?.nextOffset
}
