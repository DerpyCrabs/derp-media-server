import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from 'solid-js'
import type { SearchCoordinator } from './coordinator'
import { normalizeSearchText } from './coordinator'
import type { SearchHit, SearchResponse } from './contracts'

const EMPTY_RESPONSE: SearchResponse = {
  results: [],
  contributors: [],
  truncated: false,
}

export type SearchController = Readonly<{
  query: Accessor<string>
  setQuery(value: string): void
  normalizedQuery: Accessor<string>
  queryLongEnough: Accessor<boolean>
  activeIndex: Accessor<number>
  setActiveIndex(value: number): void
  results: Accessor<readonly SearchHit[]>
  response: Accessor<SearchResponse>
  loading: Accessor<boolean>
  error: Accessor<Error | null>
  onKeyDown(event: KeyboardEvent, choose: (hit: SearchHit) => void): void
}>

export function createSearchController(options: {
  coordinator: SearchCoordinator
  minimumQueryLength?: number
  limit?: number
  debounceMs?: number
  contributorIds?: Accessor<readonly string[] | undefined>
}): SearchController {
  const [query, setQuery] = createSignal('')
  const [debounced, setDebounced] = createSignal('')
  const [activeIndex, setActiveIndex] = createSignal(0)
  const [response, setResponse] = createSignal<SearchResponse>(EMPTY_RESPONSE)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal<Error | null>(null)
  const normalizedQuery = createMemo(() => normalizeSearchText(debounced()))
  const minimumQueryLength = options.minimumQueryLength ?? 1
  const queryLongEnough = createMemo(
    () => Array.from(normalizedQuery()).length >= minimumQueryLength,
  )
  let sequence = 0

  createEffect(() => {
    const value = query()
    const timer = window.setTimeout(() => setDebounced(value.trim()), options.debounceMs ?? 120)
    onCleanup(() => window.clearTimeout(timer))
  })

  createEffect(() => {
    const value = debounced()
    const normalized = normalizedQuery()
    const contributorIds = options.contributorIds?.()
    const current = ++sequence
    setActiveIndex(0)
    if (!queryLongEnough()) {
      setResponse(EMPTY_RESPONSE)
      setLoading(false)
      setError(null)
      return
    }
    const abort = new AbortController()
    setLoading(true)
    setError(null)
    void options.coordinator
      .search(
        {
          query: value,
          limit: options.limit ?? 50,
          signal: abort.signal,
        },
        contributorIds,
      )
      .then((next) => {
        if (current === sequence && !abort.signal.aborted) setResponse(next)
      })
      .catch((reason) => {
        if (current !== sequence || abort.signal.aborted) return
        setResponse(EMPTY_RESPONSE)
        setError(reason instanceof Error ? reason : new Error(String(reason)))
      })
      .finally(() => {
        if (current === sequence && !abort.signal.aborted) setLoading(false)
      })
    onCleanup(() => abort.abort())
    void normalized
  })

  return {
    query,
    setQuery,
    normalizedQuery,
    queryLongEnough,
    activeIndex,
    setActiveIndex,
    results: () => response().results,
    response,
    loading,
    error,
    onKeyDown(event, choose) {
      const items = response().results
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        if (items.length) setActiveIndex((index) => (index + 1) % items.length)
      } else if (event.key === 'ArrowUp') {
        event.preventDefault()
        if (items.length) setActiveIndex((index) => (index - 1 + items.length) % items.length)
      } else if (event.key === 'Home') {
        event.preventDefault()
        setActiveIndex(0)
      } else if (event.key === 'End') {
        event.preventDefault()
        if (items.length) setActiveIndex(items.length - 1)
      } else if (event.key === 'Enter') {
        const item = items[activeIndex()]
        if (!item) return
        event.preventDefault()
        choose(item)
      }
    },
  }
}
