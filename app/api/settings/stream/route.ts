import { NextRequest } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'

const SETTINGS_FILE = path.join(process.cwd(), 'settings.json')

// Store active clients
const clients = new Set<ReadableStreamDefaultController>()

// Track last modified time
let lastModified = 0
let watchInterval: NodeJS.Timeout | null = null

async function watchSettings() {
  try {
    const stats = await fs.stat(SETTINGS_FILE)
    const currentModified = stats.mtimeMs

    if (lastModified !== 0 && currentModified !== lastModified) {
      // Settings file changed, notify all clients
      const message = `data: ${JSON.stringify({ type: 'settings-changed', timestamp: Date.now() })}\n\n`

      clients.forEach((controller) => {
        try {
          controller.enqueue(new TextEncoder().encode(message))
        } catch (error) {
          console.error('Error sending message to client:', error)
          // Client disconnected, remove from set
          clients.delete(controller)
        }
      })
    }

    lastModified = currentModified
  } catch (error) {
    console.error('Error watching settings:', error)
  }
}

// Initialize watching when first client connects
function startWatching() {
  if (!watchInterval && clients.size > 0) {
    watchInterval = setInterval(watchSettings, 500)
  }
}

// Stop watching when no clients are connected
function stopWatching() {
  if (watchInterval && clients.size === 0) {
    clearInterval(watchInterval)
    watchInterval = null
  }
}

export async function GET(request: NextRequest) {
  // Set up SSE
  const stream = new ReadableStream({
    start(controller) {
      clients.add(controller)
      startWatching()

      // Send initial connection message
      const message = `data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`
      controller.enqueue(new TextEncoder().encode(message))

      // Keep-alive ping every 30 seconds
      const keepAlive = setInterval(() => {
        try {
          const ping = `: keep-alive\n\n`
          controller.enqueue(new TextEncoder().encode(ping))
        } catch {
          clearInterval(keepAlive)
        }
      }, 30000)

      // Cleanup on close
      request.signal.addEventListener('abort', () => {
        clients.delete(controller)
        clearInterval(keepAlive)
        stopWatching()
        try {
          controller.close()
        } catch {
          // Already closed
        }
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
