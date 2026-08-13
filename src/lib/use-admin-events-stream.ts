import { useQueryClient } from '@tanstack/solid-query'
import { VIRTUAL_FOLDERS } from '@/lib/constants'
import { queryKeys } from '@/lib/query-keys'
import {
  parseWorkspacePathMutation,
  type WorkspacePathMutation,
} from '@/lib/workspace-path-mutation'
import { subscribeSseAdmin } from './sse-shared-worker-client'
import type { SseEventPayload } from './sse-shared-worker-client'
import { onCleanup, onMount } from 'solid-js'

export function useAdminEventsStream(
  enabled = true,
  onPathMutation?: (mutation: WorkspacePathMutation) => void,
) {
  const queryClient = useQueryClient()

  onMount(() => {
    if (!enabled) return

    const onData = (data: SseEventPayload) => {
      try {
        const pathMutation = parseWorkspacePathMutation(data)
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
    onCleanup(unsubscribe)
  })
}
