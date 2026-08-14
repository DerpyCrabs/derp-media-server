import type { Accessor } from 'solid-js'
import { createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { updateRouteSearch, type RouteLocation, type RouteQueryUpdates } from './lib/routes'

export type BrowserLocation = Required<RouteLocation>

/**
 * Single reactive `URLSearchParams` per location update. Prefer this over repeating
 * `new URLSearchParams(history().search)` in multiple memos.
 */
export function createUrlSearchParamsMemo(history: Accessor<BrowserLocation>) {
  const memo = createMemo(() => {
    const loc = history()
    return new URLSearchParams(loc.search)
  })
  return memo
}

const subscribers = new Set<() => void>()

function notify() {
  for (const cb of subscribers) cb()
}

let patched = false

function patchHistory() {
  if (patched) return
  patched = true
  const origPush = history.pushState.bind(history)
  const origReplace = history.replaceState.bind(history)
  history.pushState = function (...args: Parameters<typeof origPush>) {
    origPush(...args)
    notify()
  }
  history.replaceState = function (...args: Parameters<typeof origReplace>) {
    origReplace(...args)
    notify()
  }
}

patchHistory()

/**
 * Reactive snapshot of pathname, search, and hash; updates on browser and patched history.
 */
export function useBrowserHistory() {
  const [tick, setTick] = createSignal(0)

  onMount(() => {
    const bump = () => setTick((t) => t + 1)
    subscribers.add(bump)
    window.addEventListener('popstate', bump)
    window.addEventListener('hashchange', bump)
    onCleanup(() => {
      window.removeEventListener('popstate', bump)
      window.removeEventListener('hashchange', bump)
      subscribers.delete(bump)
    })
  })

  const locationMemo = createMemo(() => {
    void tick()
    return {
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
    }
  })
  return locationMemo
}

export function navigateSearchParams(updates: RouteQueryUpdates, mode: 'push' | 'replace') {
  navigateHref(
    updateRouteSearch(
      {
        pathname: window.location.pathname,
        search: window.location.search,
        hash: window.location.hash,
      },
      updates,
    ),
    mode,
  )
}

export function navigateHref(href: string, mode: 'push' | 'replace') {
  if (mode === 'push') history.pushState(null, '', href)
  else history.replaceState(null, '', href)
}
