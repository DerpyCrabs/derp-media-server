import { modelOwner } from 'effectweb'
import {
  acquireWindowHistory,
  navigateWindowSearchParams,
  type BrowserLocation,
} from './window-history'
export type { BrowserLocation } from './window-history'

const owner = modelOwner<BrowserLocation>(
  typeof window === 'undefined'
    ? { pathname: '/', search: '' }
    : { pathname: window.location.pathname, search: window.location.search },
)
export const browserHistory = owner.source

export function createBrowserHistoryLifetime() {
  const history = acquireWindowHistory(window)
  const stop = history.source.subscribe((location) => owner.patch(location))
  owner.patch(history.source.model())
  return {
    dispose() {
      stop()
      history.dispose()
    },
  }
}

export function navigateSearchParams(
  updates: Record<string, string | null>,
  mode: 'push' | 'replace',
) {
  navigateWindowSearchParams(window, updates, mode)
}
