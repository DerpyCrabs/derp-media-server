import { useQueryClient } from '@tanstack/solid-query'
import { VIRTUAL_FOLDERS } from '@/lib/constants'
import { queryKeys } from '@/lib/query-keys'
import { subscribeSseAdmin } from './sse-shared-worker-client'
import { onCleanup, onMount } from 'solid-js'

export function useAdminEventsStream(enabled = true) {
  const queryClient = useQueryClient()

  onMount(() => {
    if (!enabled) return

    const onData = (data: { type?: string }) => {
      try {
        if (data.type === 'connected') {
          console.log('[Admin SSE] Connected to events stream')
        } else if (data.type === 'files-changed') {
          void queryClient.invalidateQueries({ queryKey: queryKeys.files() })
          void queryClient.invalidateQueries({ queryKey: queryKeys.shareFiles() })
          void queryClient.invalidateQueries({ queryKey: queryKeys.kb() })
          void queryClient.invalidateQueries({ queryKey: queryKeys.shareKbRecent() })
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
