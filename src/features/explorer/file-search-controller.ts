import { Cause, Effect, Schema } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { modelOwner } from 'effectweb'
import { queryCache } from '@/lib/api/cache'
import { apiSchemaEffect, postSchemaEffect } from '@/lib/api/client'
import { fileSearchResponseSchema, fileSearchStatusSchema } from '@/lib/files/file-schemas'
import {
  FILE_SEARCH_DEFAULT_LIMIT,
  FILE_SEARCH_MIN_QUERY_LENGTH,
  fileSearchCodePointLength,
  normalizeFileSearchText,
  type FileSearchResult,
  type FileSearchStatus,
  type FileSearchResponse,
} from '@/lib/files/file-search'
import { observeQuery, query } from '@effectweb/query'
import { showAppConfirmEffect } from '@/lib/ui/app-dialog'

export type FileSearchPaletteProps = {
  title: string
  onClose: () => void
  onSelect: (result: FileSearchResult) => void
}
type Selection = { key: string; index: number }
type ReindexMode = 'reconcile' | 'full'
type FileSearchModel = {
  props: FileSearchPaletteProps
  listId: string
  query: string
  debouncedQuery: string
  selection: Selection
  statusResult: AsyncResult.AsyncResult<FileSearchStatus, Error>
  searchResult: AsyncResult.AsyncResult<FileSearchResponse, Error>
  reindexResult: AsyncResult.AsyncResult<void, Error>
  setQuery: (text: string) => void
  setSelection: (selection: Selection) => void
  reindex: (mode: ReindexMode) => void
  confirmRebuild: () => void
}
const statusQuery = query({
  name: 'file-search-status',
  load: () => apiSchemaEffect(fileSearchStatusSchema, '/api/files/search/status'),
})
const searchQuery = query({
  name: 'file-search',
  load: (text: string) =>
    apiSchemaEffect(
      fileSearchResponseSchema,
      `/api/files/search?q=${encodeURIComponent(text)}&limit=${FILE_SEARCH_DEFAULT_LIMIT}`,
    ),
})
const reindexResponseSchema = Schema.Struct({ accepted: Schema.Literal(true) })
const debounceSlot = 'file-search-debounce'
const pollingSlot = 'file-search-poll'
const reindexSlot = 'file-search-reindex'
const confirmRebuildSlot = 'file-search-confirm-rebuild'

export function createFileSearchPalette(props: FileSearchPaletteProps) {
  const owner = modelOwner<FileSearchModel>({
    props,
    listId: `file-search-${crypto.randomUUID()}`,
    query: '',
    debouncedQuery: '',
    selection: { key: '', index: 0 },
    statusResult: AsyncResult.initial(),
    searchResult: AsyncResult.initial(),
    reindexResult: AsyncResult.initial(),
    setQuery,
    setSelection: (selection) => owner.patch({ selection }),
    reindex,
    confirmRebuild,
  })
  const status = observeQuery(owner, queryCache, statusQuery, 'statusResult')
  const search = observeQuery(owner, queryCache, searchQuery, 'searchResult')
  function setQuery(text: string): void {
    owner.patch({ query: text })
    owner.run(
      debounceSlot,
      Effect.sleep(120).pipe(
        Effect.andThen(
          Effect.sync(() => {
            const normalized = normalizeFileSearchText(text.trim())
            owner.patch({ debouncedQuery: normalized })
            search.select(
              fileSearchCodePointLength(normalized) >= FILE_SEARCH_MIN_QUERY_LENGTH
                ? normalized
                : undefined,
            )
          }),
        ),
      ),
      'replace',
    )
  }
  function reindex(mode: ReindexMode): void {
    owner.run(
      reindexSlot,
      Effect.sync(() =>
        owner.patch({ reindexResult: AsyncResult.waiting(AsyncResult.initial()) }),
      ).pipe(
        Effect.andThen(
          postSchemaEffect(reindexResponseSchema, '/api/files/search/reindex', { mode }),
        ),
        Effect.tap(() =>
          Effect.sync(() => {
            status.refresh()
            search.refresh()
            owner.patch({ reindexResult: AsyncResult.success(undefined) })
          }),
        ),
        Effect.catch((error) =>
          Effect.sync(() => owner.patch({ reindexResult: AsyncResult.failure(Cause.fail(error)) })),
        ),
      ),
      'drop',
    )
  }
  // One confirmation at a time: a second click while the dialog is open is dropped.
  function confirmRebuild(): void {
    owner.run(
      confirmRebuildSlot,
      showAppConfirmEffect({
        title: 'Rebuild file search index?',
        message: 'A complete rebuild may take a while.',
        confirmLabel: 'Rebuild',
      }).pipe(
        Effect.tap((confirmed) =>
          Effect.sync(() => {
            if (confirmed) reindex('full')
          }),
        ),
      ),
      'drop',
    )
  }
  status.select(true)
  owner.run(
    pollingSlot,
    Effect.forever(
      Effect.sleep(2000).pipe(
        Effect.andThen(
          Effect.sync(() => {
            status.refresh()
            if (owner.read().debouncedQuery) search.refresh()
          }),
        ),
      ),
    ),
    'replace',
  )
  return {
    source: owner.source,
    receive: (next: FileSearchPaletteProps) => owner.patch({ props: next }),
    lifetime: owner,
  }
}
