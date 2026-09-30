import { groups, queryCache, invalidateAllQueries } from './cache'
import { parsePathMutation, type PathMutation } from '@/lib/files/path-mutation'
import { subscribeSseAdmin } from './sse-shared-worker-client'
import type { SseEventPayload } from './sse-shared-worker-client'

export function createAdminEventInvalidationGuard() {
  const handled = new WeakSet<object>()
  return (event: object) => {
    if (handled.has(event)) return false
    handled.add(event)
    return true
  }
}

const claimAdminEventInvalidation = createAdminEventInvalidationGuard()

export function handleAdminEvent(
  data: SseEventPayload,
  handlers: {
    invalidate: (domain: keyof typeof groups) => void
    invalidateAll?: () => void
    onPathMutation?: (mutation: PathMutation) => void
    onWorkspacesChanged?: () => void
  },
) {
  const pathMutation = parsePathMutation(data)
  if (pathMutation) handlers.onPathMutation?.(pathMutation)
  if (data.type === 'connected' || data.type === 'resync-required') {
    console.log('[Admin SSE] Connected to events stream')
    if (handlers.invalidateAll) handlers.invalidateAll()
    else {
      handlers.invalidate('files')
      handlers.invalidate('content')
      handlers.invalidate('settings')
      handlers.invalidate('stats')
    }
    handlers.onWorkspacesChanged?.()
  } else if (data.type === 'files-changed' || pathMutation) {
    handlers.invalidate('files')
    handlers.invalidate('content')
    handlers.invalidate('playback')
    if (pathMutation) {
      handlers.invalidate('settings')
      handlers.invalidate('stats')
    }
  } else if (data.type === 'settings-changed') {
    handlers.invalidate('settings')
    handlers.invalidate('files')
  } else if (data.type === 'book-recommendations-changed') {
    handlers.invalidate('mediaAi')
    handlers.invalidate('recommendations')
  } else if (data.type === 'reader-state-changed') {
    handlers.invalidate('mediaAi')
  } else if (data.type === 'playback-preferences-changed') {
    handlers.invalidate('playback')
  } else if (data.type === 'workspaces-changed') {
    handlers.onWorkspacesChanged?.()
  } else if (data.type === 'stats-changed') {
    handlers.invalidate('stats')
  }
}

export function subscribeAdminEvents(
  onPathMutation?: (mutation: PathMutation) => void,
  onWorkspacesChanged?: () => void,
) {
  return subscribeSseAdmin((data) => {
    const invalidate = claimAdminEventInvalidation(data)
    handleAdminEvent(data, {
      onPathMutation,
      onWorkspacesChanged,
      invalidateAll: () => {
        if (invalidate) invalidateAllQueries({ preserveRecommendations: data.type === 'connected' })
      },
      invalidate: (domain) => {
        if (invalidate) queryCache.invalidateGroup(groups[domain])
      },
    })
  })
}
