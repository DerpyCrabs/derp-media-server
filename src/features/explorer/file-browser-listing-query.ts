import { api } from '@/lib/api/client'
import { queryKeys } from '@/lib/api/query-keys'
import type { DirectoryListing } from '@/lib/files/virtual-directory'

export const FILE_BROWSER_INITIAL_PAGE = 0

export function fileBrowserListingQueryKey(path: string) {
  return [...queryKeys.files(path), 'file-browser'] as const
}

export function fetchFileBrowserListing(path: string, offset: number) {
  return api<DirectoryListing>(
    `/api/files?virtual_browser=true&dir=${encodeURIComponent(path)}&offset=${offset}`,
  )
}

export function nextFileBrowserListingPage(lastPage: DirectoryListing) {
  return lastPage.virtualDirectory?.nextOffset
}
