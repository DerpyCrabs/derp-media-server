import { directoryListingSchema } from '@/lib/files/file-schemas'
import { Cause, Effect, Schema } from 'effect'
import { AsyncResult } from 'effect/unstable/reactivity'
import { available, commandSlot, modelOwner, resourceError, type Snapshot } from 'effectweb'
import { isApiError } from '@/lib/api/client'
import { pushForbiddenNotice } from '@/lib/state/forbidden-notify'
import { groups, initialData, queryCache } from '@/lib/api/cache'
import type { DirectoryListing, VirtualEntry } from '@/lib/files/virtual-directory'
import type { FileItem } from '@/lib/files/types'
import {
  fetchFileBrowserListingEffect,
  nextFileBrowserListingPage,
  fileBrowserListingQueryKey,
} from './file-browser-listing-query'
import { infiniteQuery, infiniteResource, type InfiniteData } from '@effectweb/query'
export const fileBrowserQuery = infiniteQuery({
  name: 'file-browser',
  initial: 0,
  groups: [groups.files],
  load: (path: string, offset: number) =>
    fetchFileBrowserListingEffect(path, offset, { notifyForbidden: false }),
  next: nextFileBrowserListingPage,
})
const directoryListingBootstrapSchema = Schema.Struct({
  pages: Schema.mutable(Schema.Array(directoryListingSchema)),
  pageParams: Schema.mutable(Schema.Array(Schema.Number)),
})
const pageSlot = commandSlot('directory-next-page')
const pollSlot = commandSlot('directory-poll')
const loadingSlot = commandSlot('directory-deferred-loading')
export function createFileBrowserListing(path: string) {
  const owner = modelOwner({
    result: AsyncResult.initial<
      InfiniteData<DirectoryListing, number>,
      Error
    >() as AsyncResult.AsyncResult<Snapshot<InfiniteData<DirectoryListing, number>>, Error>,
    loadingMore: false,
    deferredLoading: false,
  })
  const resource = owner.own(infiniteResource(queryCache, fileBrowserQuery))
  const decoded = Schema.decodeUnknownExit(directoryListingBootstrapSchema)(
    initialData(fileBrowserListingQueryKey(path)),
  )
  const boot = decoded._tag === 'Success' ? decoded.value : undefined
  if (boot?.pages.length && !queryCache.getQueryData(fileBrowserQuery.query, path))
    resource.seed(path, {
      pages: boot.pages.map((value, index) => ({ value, param: boot.pageParams[index] ?? 0 })),
      next: boot.pages.at(-1)?.virtualDirectory?.nextOffset,
    })
  owner.own(
    resource.subscribe((result) => {
      owner.patch({ result })
      if (AsyncResult.isFailure(result) && !result.waiting) {
        const error = Cause.squash(result.cause)
        if (isApiError(error) && error.status === 403) pushForbiddenNotice(error.message)
      }
      if (result.waiting && !available(result))
        owner.run(
          loadingSlot,
          Effect.sleep(180).pipe(
            Effect.andThen(Effect.sync(() => owner.patch({ deferredLoading: true }))),
          ),
          'replace',
        )
      else
        owner.run(
          loadingSlot,
          Effect.sync(() => owner.patch({ deferredLoading: false })),
          'replace',
        )
    }),
  )
  resource.select(path)
  owner.run(
    pollSlot,
    Effect.forever(
      Effect.sleep(5000).pipe(
        Effect.andThen(
          Effect.sync(() => {
            if (available(owner.read().result)?.pages.some((page) => page.value.virtualDirectory))
              resource.refresh()
          }),
        ),
      ),
    ),
    'replace',
  )
  const loadNextPage = () => {
    if (owner.read().loadingMore || available(owner.read().result)?.next === undefined) return
    owner.run(
      pageSlot,
      Effect.sync(() => owner.patch({ loadingMore: true })).pipe(
        Effect.andThen(resource.loadNext()),
        Effect.catch(() => Effect.void),
        Effect.ensuring(Effect.sync(() => owner.patch({ loadingMore: false }))),
      ),
      'drop',
    )
  }
  return {
    source: owner.source,
    read: owner.read,
    dispose: owner.dispose,
    loadNextPage,
    refresh: resource.refresh,
  }
}
export function fileListingSnapshot(
  state: Snapshot<ReturnType<ReturnType<typeof createFileBrowserListing>['read']>>,
) {
  const pages = available(state.result)?.pages.map((page) => page.value) ?? []
  const seen = new Set<string>()
  const files: FileItem[] = pages
    .flatMap((page) => page.files)
    .filter((file) => !seen.has(file.path) && !!seen.add(file.path))
  const entries = Object.assign({}, ...pages.map((page) => page.virtualEntries ?? {})) as Record<
    string,
    VirtualEntry
  >
  return {
    files,
    virtualDirectory: pages[0]?.virtualDirectory,
    virtualEntries: entries,
    virtualEntry: (file: FileItem) => entries[file.path],
    loading: state.result.waiting && !available(state.result),
    deferredLoading: state.deferredLoading,
    error: resourceError(state.result) || undefined,
  }
}
