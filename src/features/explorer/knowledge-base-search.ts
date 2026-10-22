import { knowledgeBaseSearchSchema } from '@/lib/files/file-schemas'
import { Effect } from 'effect'
import { AsyncResult } from 'effect/reactivity'
import { available, modelOwner, resourceError } from 'effectweb'
import { apiSchemaEffect } from '@/lib/api/client'
import { queryCache } from '@/lib/api/cache'
import { getKnowledgeBaseRoot } from '@/lib/files/path-utils'
import { registerKbSearchHotkeys } from './kb-search-hotkey'
import { observeQuery, query } from '@effectweb/query'
type SearchResponse = { results: { path: string; name: string; snippet: string }[] }
const searchQuery = query({
  name: 'kb-search',
  load: (args: { root: string; text: string }) =>
    apiSchemaEffect(
      knowledgeBaseSearchSchema,
      `/api/kb/search?root=${encodeURIComponent(args.root)}&q=${encodeURIComponent(args.text)}`,
    ),
})
const debounceSlot = 'kb-search-debounce'
const focusSlot = 'kb-search-focus'
type Context = { currentPath: string; knowledgeBases: readonly string[]; active: boolean }
export function createKnowledgeBaseSearch(context: () => Context) {
  const owner = modelOwner({
    query: '',
    debouncedQuery: '',
    open: false,
    result: AsyncResult.initial<SearchResponse, Error>(),
  })
  let input: HTMLInputElement | undefined
  const observer = observeQuery(owner, queryCache, searchQuery, 'result')
  const focus = () =>
    owner.run(
      focusSlot,
      Effect.sleep(16).pipe(Effect.andThen(Effect.sync(() => input?.focus()))),
      'replace',
    )
  const clear = () => {
    owner.patch({ query: '', debouncedQuery: '', open: false })
    observer.select(undefined)
    owner.run(debounceSlot, Effect.void, 'replace')
  }
  const setOpen = (open: boolean) => {
    if (!open) clear()
    else {
      owner.patch({ open })
      void focus()
    }
  }
  const setQuery = (text: string) => {
    owner.patch({ query: text })
    owner.run(
      debounceSlot,
      Effect.sleep(300).pipe(
        Effect.andThen(
          Effect.sync(() => {
            owner.patch({ debouncedQuery: text })
            const value = context(),
              root = getKnowledgeBaseRoot(value.currentPath, [...value.knowledgeBases])
            observer.select(root && owner.read().open && text.trim() ? { root, text } : undefined)
          }),
        ),
      ),
      'replace',
    )
  }
  owner.own(
    registerKbSearchHotkeys({
      active: () => {
        const value = context()
        return !!getKnowledgeBaseRoot(value.currentPath, [...value.knowledgeBases]) && value.active
      },
      isOpen: () => owner.read().open,
      setOpen,
      focusInput: focus,
    }),
  )
  const setInputElement = (element: HTMLInputElement | undefined) => {
    input = element
    if (element && owner.read().open) void focus()
  }
  return {
    source: owner.source,
    read: owner.read,
    dispose: owner.dispose,
    clear,
    snapshot: (state: ReturnType<typeof owner.read>, value: Context) => {
      const active = getKnowledgeBaseRoot(value.currentPath, [...value.knowledgeBases]) !== null
      return {
        active: active,
        query: state.query,
        setQuery,
        debouncedQuery: state.debouncedQuery,
        open: state.open,
        setOpen,
        setInputElement,
        onClear: clear,
        results: [...(available(state.result)?.results ?? [])],
        error: resourceError(state.result) || undefined,
        loading: state.result.waiting,
        showingResults: active && state.open && !!state.query.trim(),
      }
    },
  }
}
