import {
  ExplorerAdapterError,
  type ExplorerActionPlan,
  type ExplorerBrowseQuery,
  type ExplorerPage,
  type ExplorerResourceAdapter,
  type ExplorerViewMode,
} from '@/lib/explorer-model'

export type FallbackExplorerAdapter = ExplorerResourceAdapter & {
  isUsingFallback(): boolean
}

export type FallbackResourceAdapterOptions = Readonly<{
  isFallbackAvailable?: (query: ExplorerBrowseQuery, page: ExplorerPage) => boolean
}>

function shouldFallback(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof ExplorerAdapterError && error.explorerError.code === 'network')
  )
}

export function createFallbackResourceAdapter(
  primary: ExplorerResourceAdapter,
  fallback: ExplorerResourceAdapter,
  options: FallbackResourceAdapterOptions = {},
): FallbackExplorerAdapter {
  let usingFallback = false
  return {
    scope: primary.scope,
    async browse(query, signal) {
      try {
        const page = await primary.browse(query, signal)
        usingFallback = false
        return page
      } catch (error) {
        if (signal.aborted || !shouldFallback(error)) throw error
        let page: ExplorerPage
        try {
          page = await fallback.browse(query, signal)
        } catch {
          usingFallback = false
          throw error
        }
        const available = options.isFallbackAvailable?.(query, page) ?? page.items.length > 0
        if (!available) {
          usingFallback = false
          throw error
        }
        usingFallback = true
        return page
      }
    },
    async prefetch(query, signal) {
      if (usingFallback) return fallback.prefetch?.(query, signal)
      return primary.prefetch?.(query, signal)
    },
    execute(command, signal) {
      return usingFallback ? fallback.execute(command, signal) : primary.execute(command, signal)
    },
    plan(action, item): ExplorerActionPlan {
      const adapter = usingFallback ? fallback : primary
      const plan = adapter.plan?.(action, item)
      if (!plan) throw new Error(`Action ${action} has no plan`)
      return plan
    },
    itemForPath(path) {
      const adapter = usingFallback ? fallback : primary
      return adapter.itemForPath?.(path)
    },
    capabilitiesForPath(path) {
      const adapter = usingFallback ? fallback : primary
      return adapter.capabilitiesForPath?.(path) ?? []
    },
    provisionalPageCapabilitiesForPath(path) {
      const adapter = usingFallback ? fallback : primary
      return adapter.provisionalPageCapabilitiesForPath?.(path) ?? []
    },
    persistViewMode(path: string, viewMode: ExplorerViewMode, signal: AbortSignal) {
      if (usingFallback || !primary.persistViewMode) return Promise.resolve()
      return primary.persistViewMode(path, viewMode, signal)
    },
    subscribe(listener) {
      const primaryUnsubscribe = primary.subscribe?.(listener)
      const fallbackUnsubscribe = fallback.subscribe?.(listener)
      return () => {
        primaryUnsubscribe?.()
        fallbackUnsubscribe?.()
      }
    },
    dispose() {
      primary.dispose?.()
      fallback.dispose?.()
    },
    isUsingFallback: () => usingFallback,
  }
}
