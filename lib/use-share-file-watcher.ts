import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'

export function useShareFileWatcher(token: string | null | undefined, enabled = true) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!token || !enabled) return

    const eventSource = new EventSource(`/api/share/${encodeURIComponent(token)}/stream`)
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'connected') {
          console.log('[Share SSE] Connected to share stream')
          return
        }
        if (data.type !== 'files-changed') return

        queryClient.invalidateQueries({ queryKey: queryKeys.shareInfo(token) })
        queryClient.invalidateQueries({ queryKey: queryKeys.shareFiles(token) })
        queryClient.invalidateQueries({ queryKey: queryKeys.shareKbRecent(token) })
        queryClient.invalidateQueries({ queryKey: ['share-kb-search', token] })
        queryClient.invalidateQueries({ queryKey: ['share-text', token] })
      } catch (error) {
        console.error('[Share SSE] Error parsing message:', error)
      }
    }

    eventSource.onerror = (error) => {
      console.warn('[Share SSE] Connection error:', error)
    }

    return () => {
      eventSource.close()
    }
  }, [queryClient, token, enabled])
}
