import type { QueryClient } from '@tanstack/solid-query'
import { api } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import type { FileItem } from '@/lib/types'
import { stripSharePrefix } from '@/lib/source-context'
import { getKnowledgeBaseRoot } from '@/lib/utils'

export type PrefetchFolderHoverContext = {
  queryClient: QueryClient
  share?: { token: string; sharePath: string }
  knowledgeBases?: string[]
  shareIsKnowledgeBase?: boolean
}

type RecentResult = { path: string; name: string; modifiedAt: string }

function fetchShareFiles(token: string, subDir: string) {
  return api<{ files: FileItem[] }>(`/api/share/${token}/files?dir=${encodeURIComponent(subDir)}`)
}

function prefetchKbRecentForPath(queryClient: QueryClient, pathWithinKb: string) {
  void queryClient.prefetchQuery({
    queryKey: queryKeys.kbRecent(pathWithinKb),
    queryFn: () =>
      api<{ results: RecentResult[] }>(`/api/kb/recent?root=${encodeURIComponent(pathWithinKb)}`),
  })
}

function prefetchShareKbRecent(queryClient: QueryClient, token: string, subDir: string) {
  const dirArg = subDir || undefined
  void queryClient.prefetchQuery({
    queryKey: queryKeys.shareKbRecent(token, dirArg),
    queryFn: () => {
      const params = new URLSearchParams()
      if (subDir) params.set('dir', subDir)
      return api<{ results: RecentResult[] }>(`/api/share/${token}/kb/recent?${params}`)
    },
  })
}

function prefetchDirectoryListingAtPath(ctx: PrefetchFolderHoverContext, dirPath: string) {
  const sh = ctx.share
  const norm = dirPath.replace(/\\/g, '/')
  if (sh) {
    const subDir = stripSharePrefix(norm, sh.sharePath.replace(/\\/g, '/'))
    void ctx.queryClient.prefetchQuery({
      queryKey: queryKeys.shareFiles(sh.token, subDir),
      queryFn: () => fetchShareFiles(sh.token, subDir),
    })
    if (ctx.shareIsKnowledgeBase) prefetchShareKbRecent(ctx.queryClient, sh.token, subDir)
    return
  }
  void ctx.queryClient.prefetchQuery({
    queryKey: queryKeys.files(norm),
    queryFn: () => api<{ files: FileItem[] }>(`/api/files?dir=${encodeURIComponent(norm)}`),
  })
  const kbs = ctx.knowledgeBases
  if (kbs?.length && getKnowledgeBaseRoot(norm, kbs)) prefetchKbRecentForPath(ctx.queryClient, norm)
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

/** Share link browser: `subDir` is relative to the share root (same as the `dir` query param). */
export function prefetchShareDirHover(
  ctx: PrefetchFolderHoverContext,
  subDirRelativeToShare: string,
) {
  const sh = ctx.share
  if (!sh) return
  const sub = subDirRelativeToShare.replace(/\\/g, '/')
  void ctx.queryClient.prefetchQuery({
    queryKey: queryKeys.shareFiles(sh.token, sub),
    queryFn: () => fetchShareFiles(sh.token, sub),
  })
  if (ctx.shareIsKnowledgeBase) prefetchShareKbRecent(ctx.queryClient, sh.token, sub)
}
