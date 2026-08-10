import type { Accessor } from 'solid-js'
import { createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { navigate, parseRoute } from './lib/routes'
import { captureSharePasscodeFromLocation } from './lib/share-url'

export type BrowserLocation = { pathname: string; search: string; hash: string }

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
  captureSharePasscodeFromLocation()
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
 * Reactive snapshot of pathname + search + hash. Raw history mutation remains a
 * compatibility bridge; owned navigation emits `derp:navigation` explicitly.
 */
export function useBrowserHistory() {
  const [tick, setTick] = createSignal(0)

  onMount(() => {
    const bump = () => setTick((t) => t + 1)
    subscribers.add(bump)
    window.addEventListener('popstate', bump)
    window.addEventListener('hashchange', bump)
    window.addEventListener('derp:navigation', bump)
    onCleanup(() => {
      window.removeEventListener('popstate', bump)
      window.removeEventListener('hashchange', bump)
      window.removeEventListener('derp:navigation', bump)
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

export function navigateSearchParams(
  updates: Record<string, string | null>,
  mode: 'push' | 'replace',
) {
  const params = new URLSearchParams(window.location.search)
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) params.delete(key)
    else params.set(key, value)
  }
  const qs = params.toString()
  navigate(
    parseRoute({
      pathname: window.location.pathname,
      search: qs ? `?${qs}` : '',
      hash: window.location.hash,
    }),
    { replace: mode === 'replace' },
  )
}
