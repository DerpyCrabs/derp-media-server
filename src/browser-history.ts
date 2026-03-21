import { createMemo, createSignal, onCleanup, onMount } from 'solid-js'

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
 * Reactive snapshot of pathname + search; updates on popstate and patched history.
 */
export function useBrowserHistory() {
  const [tick, setTick] = createSignal(0)

  onMount(() => {
    const bump = () => setTick((t) => t + 1)
    subscribers.add(bump)
    window.addEventListener('popstate', bump)
    onCleanup(() => {
      window.removeEventListener('popstate', bump)
      subscribers.delete(bump)
    })
  })

  const locationMemo = createMemo(() => {
    void tick()
    return {
      pathname: window.location.pathname,
      search: window.location.search,
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
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
  if (mode === 'push') history.pushState(null, '', url)
  else history.replaceState(null, '', url)
}
