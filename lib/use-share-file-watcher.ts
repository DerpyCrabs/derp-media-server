import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { createReconnectScheduler } from '@/lib/sse-reconnect'

function isTabVisible(): boolean {
  return typeof document !== 'undefined' && !document.hidden
}

export function useShareFileWatcher(token: string | null | undefined, enabled = true) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!token || !enabled) return

    let eventSource: EventSource | null = null

    const connect = () => {
      if (!isTabVisible()) return
      if (eventSource) return

      eventSource = new EventSource(`/api/share/${encodeURIComponent(token)}/stream`)
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

      eventSource.onerror = () => {
        console.warn('[Share SSE] Connection error, reconnecting...')
        if (eventSource) {
          eventSource.close()
          eventSource = null
        }
        schedule()
      }
    }

    const handleVisibilityChange = () => {
      if (!isTabVisible() && eventSource) {
        eventSource.close()
        eventSource = null
      } else if (isTabVisible()) {
        connect()
      }
    }

    const { schedule, cleanup } = createReconnectScheduler(connect)
    connect()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      cleanup()
      if (eventSource) {
        eventSource.close()
      }
    }
  }, [queryClient, token, enabled])
}
