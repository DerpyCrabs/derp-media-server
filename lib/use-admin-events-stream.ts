import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-keys'
import { createReconnectScheduler } from '@/lib/sse-reconnect'
import { VIRTUAL_FOLDERS } from './constants'

let globalEventSource: EventSource | null = null
let connectionRefCount = 0
let reconnectCleanup: (() => void) | null = null

function isTabVisible(): boolean {
  return typeof document !== 'undefined' && !document.hidden
}

function connectToSSE(queryClient: ReturnType<typeof useQueryClient>) {
  if (!globalEventSource) {
    reconnectCleanup?.()
    const { schedule, cleanup } = createReconnectScheduler(() => {
      if (connectionRefCount > 0) connectToSSE(queryClient)
    })
    reconnectCleanup = cleanup

    const doConnect = () => {
      if (!isTabVisible() || connectionRefCount === 0) return
      if (globalEventSource) return

      console.log('[Admin SSE] Connecting to events stream...')
      globalEventSource = new EventSource('/api/events/stream')

      globalEventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
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
          console.error('[Admin SSE] Error parsing message:', error)
        }
      }

      globalEventSource.onerror = () => {
        console.warn('[Admin SSE] Connection error, reconnecting...')
        if (globalEventSource) {
          globalEventSource.close()
          globalEventSource = null
        }
        if (connectionRefCount > 0) schedule()
      }
    }

    doConnect()

    const handleVisibilityChange = () => {
      if (!isTabVisible() && globalEventSource && connectionRefCount > 0) {
        console.log('[Admin SSE] Tab hidden, closing connection')
        globalEventSource.close()
        globalEventSource = null
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    const origCleanup = cleanup
    reconnectCleanup = () => {
      origCleanup()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }
  connectionRefCount++
}

function disconnectFromSSE() {
  connectionRefCount--
  if (connectionRefCount === 0) {
    if (globalEventSource) {
      console.log('[Admin SSE] Closing connection')
      globalEventSource.close()
      globalEventSource = null
    }
    reconnectCleanup?.()
    reconnectCleanup = null
  }
}

export function useAdminEventsStream(enabled = true) {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!enabled) return
    connectToSSE(queryClient)
    return () => disconnectFromSSE()
  }, [queryClient, enabled])
}
