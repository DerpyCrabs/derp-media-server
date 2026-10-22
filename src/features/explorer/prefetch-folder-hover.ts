import { Effect } from 'effect'
import { queryCache } from '@/lib/api/cache'
import type { FileItem } from '@/lib/files/types'
import { fileBrowserQuery } from './file-browser-listing'
export type PrefetchFolderHoverContext = {
  run: (path: string, effect: Effect.Effect<unknown, Error>) => void
  knowledgeBases?: readonly string[]
}
const prefetch = (context: PrefetchFolderHoverContext, path: string) => {
  const directory = path.replace(/\\/g, '/')
  context.run(
    directory,
    Effect.suspend(() =>
      queryCache.prefetch(fileBrowserQuery.query, directory, {
        refresh: queryCache.getQueryData(fileBrowserQuery.query, directory) === undefined,
      }),
    ),
  )
}
export function prefetchFolderContentsOnHover(context: PrefetchFolderHoverContext, file: FileItem) {
  if (file.isDirectory) prefetch(context, file.path)
}
export function prefetchParentDirectoryHover(
  context: PrefetchFolderHoverContext,
  args: { currentPath: string; isVirtualFolder: boolean },
) {
  const path = args.currentPath.replace(/\\/g, '/')
  if (path)
    prefetch(
      context,
      args.isVirtualFolder ? '' : path.split('/').filter(Boolean).slice(0, -1).join('/'),
    )
}
