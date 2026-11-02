import { modelOwner } from 'effectweb'

export type BrowserLocation = { pathname: string; search: string }
export type NavigationMode = 'push' | 'replace'

function createWindowHistory(target: Window) {
  const read = (): BrowserLocation => ({
    pathname: target.location.pathname,
    search: target.location.search,
  })
  const owner = modelOwner(read())
  const publish = () => owner.patch(read())
  const history = target.history
  // eslint-disable-next-line typescript/unbound-method
  const previousPush = history.pushState
  // eslint-disable-next-line typescript/unbound-method
  const previousReplace = history.replaceState
  const push: History['pushState'] = function (...args) {
    previousPush.apply(history, args)
    publish()
  }
  const replace: History['replaceState'] = function (...args) {
    previousReplace.apply(history, args)
    publish()
  }
  history.pushState = push
  history.replaceState = replace
  target.addEventListener('popstate', publish)
  let disposed = false
  return {
    source: owner.source,
    navigate(this: void, updates: Record<string, string | null>, mode: NavigationMode) {
      if (disposed) return
      navigateWindowSearchParams(target, updates, mode)
    },
    dispose() {
      if (disposed) return
      disposed = true
      target.removeEventListener('popstate', publish)
      if (history.pushState === push) history.pushState = previousPush
      if (history.replaceState === replace) history.replaceState = previousReplace
      owner.dispose()
    },
  }
}

type WindowHistory = ReturnType<typeof createWindowHistory>
const windows = new WeakMap<Window, { history: WindowHistory; references: number }>()

export function acquireWindowHistory(target: Window) {
  let entry = windows.get(target)
  if (!entry) {
    entry = { history: createWindowHistory(target), references: 0 }
    windows.set(target, entry)
  }
  entry.references++
  const owned = entry
  let released = false
  return {
    source: entry.history.source,
    navigate(this: void, updates: Record<string, string | null>, mode: NavigationMode) {
      if (!released) owned.history.navigate(updates, mode)
    },
    dispose() {
      if (released) return
      released = true
      if (--owned.references === 0) {
        windows.delete(target)
        owned.history.dispose()
      }
    },
  }
}

export function navigateWindowSearchParams(
  target: Window,
  updates: Record<string, string | null>,
  mode: NavigationMode,
) {
  const params = new URLSearchParams(target.location.search)
  for (const [key, value] of Object.entries(updates)) {
    if (value === null) params.delete(key)
    else params.set(key, value)
  }
  const query = params.toString()
  const url = `${target.location.pathname}${query ? `?${query}` : ''}${target.location.hash}`
  target.history[mode === 'push' ? 'pushState' : 'replaceState'](null, '', url)
}
