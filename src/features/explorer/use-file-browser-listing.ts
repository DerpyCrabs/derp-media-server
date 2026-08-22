import { createInfiniteQuery } from '@tanstack/solid-query'
import { createMemo, type Accessor } from 'solid-js'
import type { FileItem } from '@/lib/files/types'
import type { DirectoryListing, VirtualEntry } from '@/lib/files/virtual-directory'
import { useDeferredLoading } from '@/lib/ui/use-deferred-loading'
import {
  fetchFileBrowserListing,
  FILE_BROWSER_INITIAL_PAGE,
  fileBrowserListingQueryKey,
  nextFileBrowserListingPage,
} from './file-browser-listing-query'

export type FileBrowserListingOptions = Readonly<{
  currentPath: Accessor<string>
}>

export function useFileBrowserListing(options: FileBrowserListingOptions) {
  const query = createInfiniteQuery<
    DirectoryListing,
    Error,
    DirectoryListing[],
    readonly unknown[],
    number
  >(() => ({
    queryKey: fileBrowserListingQueryKey(options.currentPath()),
    initialPageParam: FILE_BROWSER_INITIAL_PAGE,
    queryFn: ({ pageParam }) => fetchFileBrowserListing(options.currentPath(), pageParam),
    getNextPageParam: nextFileBrowserListingPage,
    select: (data) => data.pages,
    refetchInterval: (state) =>
      state.state.data?.pages.some((page) => !!page.virtualDirectory) ? 5_000 : false,
  }))

  const pages = createMemo(() => query.data ?? [])
  const firstPage = createMemo(() => pages()[0])
  const files = createMemo(() => {
    const seen = new Set<string>()
    return pages()
      .flatMap((page) => page.files)
      .filter((file) => !seen.has(file.path) && !!seen.add(file.path))
  })
  const virtualEntries = createMemo(
    () =>
      Object.assign({}, ...pages().map((page) => page.virtualEntries ?? {})) as Record<
        string,
        VirtualEntry
      >,
  )
  const virtualEntry = (file: FileItem) => virtualEntries()[file.path]
  const virtualDirectory = createMemo(() => firstPage()?.virtualDirectory)
  const loading = createMemo(() => query.isPending && query.data === undefined)
  const deferredLoading = useDeferredLoading(() => loading())

  function loadNextPage() {
    if (!query.hasNextPage || query.isFetchingNextPage) return
    void query.fetchNextPage()
  }

  return {
    query,
    files,
    virtualDirectory,
    virtualEntries,
    virtualEntry,
    loading,
    deferredLoading,
    loadNextPage,
  }
}
