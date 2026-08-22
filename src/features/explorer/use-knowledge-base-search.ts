import { useQuery } from '@tanstack/solid-query'
import { createEffect, createMemo, createSignal, type Accessor } from 'solid-js'
import { api } from '@/lib/api/client'
import { queryKeys } from '@/lib/api/query-keys'
import { getKnowledgeBaseRoot } from '@/lib/files/path-utils'
import { registerKbSearchHotkeys } from './use-kb-search-hotkey'

export function useKnowledgeBaseSearch(options: {
  currentPath: Accessor<string>
  knowledgeBases: Accessor<string[]>
  active?: Accessor<boolean>
}) {
  const rootPath = createMemo(() =>
    getKnowledgeBaseRoot(options.currentPath(), options.knowledgeBases()),
  )
  const active = createMemo(() => rootPath() !== null)
  const [query, setQuery] = createSignal('')
  const [debouncedQuery, setDebouncedQuery] = createSignal('')
  const [open, setOpenSignal] = createSignal(false)
  const [inputElement, setInputElement] = createSignal<HTMLInputElement>()

  function clear() {
    setQuery('')
    setDebouncedQuery('')
    setOpenSignal(false)
  }

  function setOpen(next: boolean) {
    setOpenSignal(next)
    if (!next) {
      setQuery('')
      setDebouncedQuery('')
    }
  }

  createEffect(
    () => query(),
    (value) => {
      const id = window.setTimeout(() => setDebouncedQuery(value), 300)
      return () => clearTimeout(id)
    },
  )

  const resultsQuery = useQuery(() => ({
    queryKey: queryKeys.kbSearch(rootPath()!, debouncedQuery()),
    queryFn: () =>
      api<{ results: { path: string; name: string; snippet: string }[] }>(
        `/api/kb/search?root=${encodeURIComponent(rootPath()!)}&q=${encodeURIComponent(debouncedQuery())}`,
      ),
    enabled: !!rootPath() && open() && debouncedQuery().trim().length > 0,
  }))

  registerKbSearchHotkeys({
    active: () => active() && (options.active?.() ?? true),
    isOpen: open,
    setOpen,
    focusInput: () => inputElement()?.focus(),
  })

  const results = createMemo(() => resultsQuery.data?.results ?? [])
  const loading = createMemo(() => resultsQuery.isLoading)
  const showingResults = createMemo(() => active() && open() && query().trim().length > 0)

  return {
    active,
    query,
    setQuery,
    debouncedQuery,
    open,
    setOpen,
    setInputElement,
    clear,
    results,
    loading,
    showingResults,
  }
}
