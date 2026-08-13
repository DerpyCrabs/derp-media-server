import type { QueryClient } from '@tanstack/solid-query'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import type { FileItem } from '@/lib/types'
import { getKnowledgeBaseRoot } from '@/lib/utils'

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
  void ctx.queryClient.prefetchQuery({
    queryKey: queryKeys.files(norm),
    queryFn: () => api<{ files: FileItem[] }>(`/api/files?dir=${encodeURIComponent(norm)}`),
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
