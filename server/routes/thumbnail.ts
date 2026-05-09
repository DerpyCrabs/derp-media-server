import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { getFilePath } from '@/lib/file-system'
import { existsSync, statSync } from 'fs'
import {
  isThumbnailAbortError,
  readThumbnail,
  sendPlaceholder,
  sendThumbnailData,
} from '@/server/lib/thumbnails'

function createReplyAbortSignal(request: FastifyRequest, reply: FastifyReply): AbortSignal {
  const controller = new AbortController()
  const abort = () => {
    if (!reply.raw.writableEnded) controller.abort()
  }
  request.raw.once('aborted', abort)
  reply.raw.once('close', abort)
  reply.raw.once('finish', () => {
    request.raw.off('aborted', abort)
    reply.raw.off('close', abort)
  })
  return controller.signal
}

export function registerThumbnailRoutes(app: FastifyInstance) {
  app.get('/api/thumbnail/*', async (request, reply) => {
    try {
      const filePath = (request.params as { '*': string })['*']
      const fullPath = getFilePath(filePath)

      if (!existsSync(fullPath)) {
        sendPlaceholder(reply, 'public, max-age=31536000')
        return reply
      }

      const stats = statSync(fullPath)
      if (!stats.isFile()) {
        sendPlaceholder(reply, 'public, max-age=31536000')
        return reply
      }

      try {
        const thumbnailData = await readThumbnail(
          fullPath,
          stats.mtime,
          createReplyAbortSignal(request, reply),
        )
        sendThumbnailData(reply, thumbnailData)
        return reply
      } catch (error) {
        if (isThumbnailAbortError(error)) return reply
        console.error('Error generating thumbnail:', error)
        sendPlaceholder(reply, 'public, max-age=3600')
        return reply
      }
    } catch (error) {
      console.error('Error in thumbnail endpoint:', error)
      sendPlaceholder(reply, 'public, max-age=3600')
      return reply
    }
  })
}
