'use client'

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { VIRTUAL_FOLDERS } from './constants'

let globalEventSource: EventSource | null = null
let connectionRefCount = 0

function connectToSSE(queryClient: ReturnType<typeof useQueryClient>) {
  if (!globalEventSource) {
    console.log('[Files SSE] Connecting to files stream...')
    globalEventSource = new EventSource('/api/files/stream')

    globalEventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'connected') {
          console.log('[Files SSE] Connected to files stream')
        } else if (data.type === 'files-changed') {
          console.log('[Files SSE] Files changed in:', data.directory)

          // Only invalidate the affected directory and its parent instead of
          // every ['files'] query — avoids cascading re-renders in components
          // (like the audio player) that hold unrelated file queries.
          const dir: string = data.directory ?? ''
          queryClient.invalidateQueries({ queryKey: ['files', dir] })

          const parentDir = dir.includes('/') ? dir.slice(0, dir.lastIndexOf('/')) : ''
          if (parentDir !== dir) {
            queryClient.invalidateQueries({ queryKey: ['files', parentDir] })
          }

          // Virtual folders aggregate across all directories
          queryClient.invalidateQueries({ queryKey: ['files', VIRTUAL_FOLDERS.MOST_PLAYED] })
          queryClient.invalidateQueries({ queryKey: ['files', VIRTUAL_FOLDERS.FAVORITES] })
          queryClient.invalidateQueries({ queryKey: ['files', VIRTUAL_FOLDERS.SHARES] })

          queryClient.invalidateQueries({ queryKey: ['share-files'] })
          queryClient.invalidateQueries({ queryKey: ['kb-recent'] })
          queryClient.invalidateQueries({ queryKey: ['text-content'] })
          queryClient.invalidateQueries({ queryKey: ['share-text'] })
        }
      } catch (error) {
        console.error('[Files SSE] Error parsing message:', error)
      }
    }

    globalEventSource.onerror = () => {
      console.warn('[Files SSE] Connection error, reconnecting...')
      if (globalEventSource) {
        globalEventSource.close()
        globalEventSource = null
      }
      setTimeout(() => {
        if (connectionRefCount > 0) {
          connectToSSE(queryClient)
        }
      }, 5000)
    }
  }
  connectionRefCount++
}

function disconnectFromSSE() {
  connectionRefCount--
  if (connectionRefCount === 0 && globalEventSource) {
    console.log('[Files SSE] Closing connection')
    globalEventSource.close()
    globalEventSource = null
  }
}

export function useFileWatcher() {
  const queryClient = useQueryClient()

  useEffect(() => {
    connectToSSE(queryClient)
    return () => {
      disconnectFromSSE()
    }
  }, [queryClient])
}
