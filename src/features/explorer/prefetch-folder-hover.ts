import type { QueryClient } from '@tanstack/solid-query'
import { api } from '@/lib/api/client'
import { queryKeys } from '@/lib/api/query-keys'
import type { FileItem } from '@/lib/files/types'
import { getKnowledgeBaseRoot } from '@/lib/files/path-utils'
import {
  fetchFileBrowserListing,
  FILE_BROWSER_INITIAL_PAGE,
  fileBrowserListingQueryKey,
  nextFileBrowserListingPage,
} from './file-browser-listing-query'

export type PrefetchFolderHoverContext = {
  queryClient: QueryClient
  knowledgeBases?: string[]
}

type RecentResult = { path: string; name: string; modifiedAt: string }

function prefetchKbRecentForPath(queryClient: QueryClient, pathWithinKb: string) {
  void queryClient.prefetchQuery({
    queryKey: queryKeys.kbRecent(pathWithinKb),
    queryFn: () =>
      api<{ results: RecentResult[] }>(`/api/kb/recent?root=${encodeURIComponent(pathWithinKb)}`),
  })
}

function prefetchDirectoryListingAtPath(ctx: PrefetchFolderHoverContext, dirPath: string) {
  const norm = dirPath.replace(/\\/g, '/')
  void ctx.queryClient.prefetchInfiniteQuery({
    queryKey: fileBrowserListingQueryKey(norm),
    initialPageParam: FILE_BROWSER_INITIAL_PAGE,
    queryFn: ({ pageParam }) => fetchFileBrowserListing(norm, pageParam),
    getNextPageParam: nextFileBrowserListingPage,
  })
  const kbs = ctx.knowledgeBases
  if (kbs?.length && getKnowledgeBaseRoot(norm, kbs)) {
    prefetchKbRecentForPath(ctx.queryClient, norm)
  }
}

export function prefetchFolderContentsOnHover(ctx: PrefetchFolderHoverContext, file: FileItem) {
  if (!file.isDirectory) return
  prefetchDirectoryListingAtPath(ctx, file.path)
}

export function prefetchParentDirectoryHover(
  ctx: PrefetchFolderHoverContext,
  args: { currentPath: string; isVirtualFolder: boolean },
) {
  const cur = args.currentPath.replace(/\\/g, '/')
  if (!cur) return
  let parentPath: string
  if (args.isVirtualFolder) parentPath = ''
  else {
    const parts = cur.split(/[/\\]/).filter(Boolean)
    if (parts.length === 0) return
    parentPath = parts.slice(0, -1).join('/')
  }
  prefetchDirectoryListingAtPath(ctx, parentPath)
}
