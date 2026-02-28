import { NextRequest } from 'next/server'
import { addFileClient, removeFileClient } from '@/lib/file-change-emitter'

export async function GET(request: NextRequest) {
  const stream = new ReadableStream({
    start(controller) {
      addFileClient(controller)

      const message = `data: ${JSON.stringify({ type: 'connected', timestamp: Date.now() })}\n\n`
      controller.enqueue(new TextEncoder().encode(message))

      const keepAlive = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(': keep-alive\n\n'))
        } catch {
          clearInterval(keepAlive)
        }
      }, 30000)

      request.signal.addEventListener('abort', () => {
        removeFileClient(controller)
        clearInterval(keepAlive)
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
