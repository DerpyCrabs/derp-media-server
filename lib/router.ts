import { useSyncExternalStore } from 'react'

const listeners = new Set<() => void>()

function notify() {
  for (const fn of listeners) fn()
}

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

function subscribe(cb: () => void) {
  listeners.add(cb)
  window.addEventListener('popstate', cb)
  return () => {
    listeners.delete(cb)
    window.removeEventListener('popstate', cb)
  }
}

function getPathnameSnapshot() {
  return window.location.pathname
}

function getSearchSnapshot() {
  return window.location.search
}

export function usePathname() {
  return useSyncExternalStore(subscribe, getPathnameSnapshot)
}

export function useSearchParams() {
  const search = useSyncExternalStore(subscribe, getSearchSnapshot)
  return new URLSearchParams(search)
}

export function navigate(to: string, opts?: { replace?: boolean }) {
  if (opts?.replace) {
    history.replaceState(null, '', to)
  } else {
    history.pushState(null, '', to)
  }
}
