import { useQueryClient } from '@tanstack/solid-query'
import { VIRTUAL_FOLDERS } from '@/lib/files/constants'
import { queryKeys } from '@/lib/api/query-keys'
import { parsePathMutation, type PathMutation } from '@/lib/files/path-mutation'
import { subscribeSseAdmin } from './sse-shared-worker-client'
import type { SseEventPayload } from './sse-shared-worker-client'
import { onSettled } from 'solid-js'

export function useAdminEventsStream(
  enabled = true,
  onPathMutation?: (mutation: PathMutation) => void,
) {
  const queryClient = useQueryClient()

  onSettled(() => {
    if (!enabled) return undefined

    const onData = (data: SseEventPayload) => {
      try {
        const pathMutation = parsePathMutation(data)
        if (pathMutation) onPathMutation?.(pathMutation)
        if (data.type === 'connected') {
          console.log('[Admin SSE] Connected to events stream')
        } else if (data.type === 'files-changed' || pathMutation) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
          void queryClient.invalidateQueries({ queryKey: queryKeys.adminContent() })
        } else if (data.type === 'settings-changed') {
          void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
          void queryClient.invalidateQueries({
            queryKey: queryKeys.files(VIRTUAL_FOLDERS.FAVORITES),
          })
        }
      } catch (error) {
        console.error('[Admin SSE] Error handling message:', error)
      }
    }

    const unsubscribe = subscribeSseAdmin(onData)
    return unsubscribe
  })
}
