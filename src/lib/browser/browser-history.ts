import { modelOwner } from 'effectweb'

export type BrowserLocation = { pathname: string; search: string }
const readLocation = (): BrowserLocation =>
  typeof window === 'undefined'
    ? { pathname: '/', search: '' }
    : { pathname: window.location.pathname, search: window.location.search }
const owner = modelOwner(readLocation())
export const browserHistory = owner.source

export function createBrowserHistoryLifetime() {
  const publish = () => owner.patch(readLocation())
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
  window.addEventListener('popstate', publish)
  publish()
  return {
    dispose() {
      window.removeEventListener('popstate', publish)
      if (history.pushState === push) history.pushState = previousPush
      if (history.replaceState === replace) history.replaceState = previousReplace
    },
  }
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
  const query = params.toString()
  const url = query ? `${window.location.pathname}?${query}` : window.location.pathname
  if (mode === 'push') history.pushState(null, '', url)
  else history.replaceState(null, '', url)
}
