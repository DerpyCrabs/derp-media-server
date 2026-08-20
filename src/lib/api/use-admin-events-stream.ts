import { useQueryClient } from '@tanstack/solid-query'
import { VIRTUAL_FOLDERS } from '@/lib/files/constants'
import { queryKeys } from '@/lib/api/query-keys'
import { parsePathMutation, type PathMutation } from '@/lib/files/path-mutation'
import { subscribeSseAdmin } from './sse-shared-worker-client'
import type { SseEventPayload } from './sse-shared-worker-client'
import { onSettled } from 'solid-js'

export function handleAdminEvent(
  data: SseEventPayload,
  handlers: {
    invalidate: (queryKey: readonly unknown[]) => void
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
      handlers.invalidate(queryKeys.files())
      handlers.invalidate(queryKeys.adminContent())
      handlers.invalidate(queryKeys.settings())
      handlers.invalidate(queryKeys.stats())
    }
    handlers.onWorkspacesChanged?.()
  } else if (data.type === 'files-changed' || pathMutation) {
    handlers.invalidate(queryKeys.files())
    handlers.invalidate(queryKeys.adminContent())
    if (pathMutation) {
      handlers.invalidate(queryKeys.settings())
      handlers.invalidate(queryKeys.stats())
    }
  } else if (data.type === 'settings-changed') {
    handlers.invalidate(queryKeys.settings())
    handlers.invalidate(queryKeys.files(VIRTUAL_FOLDERS.FAVORITES))
  } else if (data.type === 'workspaces-changed') {
    handlers.onWorkspacesChanged?.()
  } else if (data.type === 'stats-changed') {
    handlers.invalidate(queryKeys.stats())
  }
}

export function useAdminEventsStream(
  enabled = true,
  onPathMutation?: (mutation: PathMutation) => void,
  onWorkspacesChanged?: () => void,
) {
  const queryClient = useQueryClient()

  onSettled(() => {
    if (!enabled) return undefined

    const onData = (data: SseEventPayload) => {
      try {
        handleAdminEvent(data, {
          onPathMutation,
          onWorkspacesChanged,
          invalidateAll: () => {
            void queryClient.invalidateQueries()
          },
          invalidate: (queryKey) => {
            void queryClient.invalidateQueries({ queryKey })
          },
        })
      } catch (error) {
        console.error('[Admin SSE] Error handling message:', error)
      }
    }

    const unsubscribe = subscribeSseAdmin(onData)
    return unsubscribe
  })
}
