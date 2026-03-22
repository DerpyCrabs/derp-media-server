import { useQueryClient } from '@tanstack/solid-query'
import { queryKeys } from '@/lib/query-keys'
import { subscribeSseShare } from './sse-shared-worker-client'
import { createEffect, onCleanup } from 'solid-js'

export function useShareFileWatcher(getToken: () => string | null | undefined, enabled = true) {
  const queryClient = useQueryClient()

  createEffect(() => {
    const token = enabled ? getToken() : null
    if (!token) return

    const onData = (data: { type?: string }) => {
      try {
        if (data.type === 'connected') {
          console.log('[Share SSE] Connected to share stream')
          return
        }
        if (data.type !== 'files-changed') return

        void queryClient.invalidateQueries({ queryKey: queryKeys.shareInfo(token) })
        void queryClient.invalidateQueries({ queryKey: queryKeys.shareFiles(token) })
        void queryClient.invalidateQueries({ queryKey: queryKeys.shareKbRecent(token) })
        void queryClient.invalidateQueries({ queryKey: ['share-kb-search', token] })
        void queryClient.invalidateQueries({ queryKey: ['share-text', token] })
      } catch (error) {
        console.error('[Share SSE] Error handling message:', error)
      }
    }

    const unsubscribe = subscribeSseShare(token, onData)
    onCleanup(unsubscribe)
  })
}
