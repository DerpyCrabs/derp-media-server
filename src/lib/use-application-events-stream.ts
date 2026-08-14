import { useQueryClient } from '@tanstack/solid-query'
import { queryKeys } from '@/lib/query-keys'
import {
  parseWorkspacePathMutation,
  type WorkspacePathMutation,
} from '@/lib/workspace-path-mutation'
import { subscribeSseApplication, type SseEventPayload } from './sse-shared-worker-client'
import { onCleanup, onMount } from 'solid-js'

export function useApplicationEventsStream(
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
          console.log('[Application SSE] Connected to events stream')
        } else if (data.type === 'files-changed' || pathMutation) {
          void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
          void queryClient.invalidateQueries({ queryKey: queryKeys.applicationContent() })
        } else if (data.type === 'settings-changed') {
          void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
          void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
        }
      } catch (error) {
        console.error('[Application SSE] Error handling message:', error)
      }
    }

    const unsubscribe = subscribeSseApplication(onData)
    onCleanup(unsubscribe)
  })
}
