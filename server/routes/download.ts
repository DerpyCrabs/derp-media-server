import type { FastifyInstance } from 'fastify'
import { getFilePath } from '@/lib/file-system'
import archiver from 'archiver'
import { statSync, createReadStream } from 'fs'
import path from 'path'

export function registerDownloadRoutes(app: FastifyInstance) {
  app.get('/api/files/download', async (request, reply) => {
    try {
      const filePath = (request.query as { path?: string }).path

      if (!filePath) {
        return reply.status(400).send({ error: 'Path is required' })
      }

      const fullPath = getFilePath(filePath)
      const stats = statSync(fullPath)

      if (stats.isDirectory()) {
        const folderName = path.basename(fullPath)

        reply.raw.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(folderName + '.zip')}`,
        })

        const archive = archiver('zip', { zlib: { level: 1 } })
        archive.on('error', (err) => reply.raw.destroy(err))
        archive.pipe(reply.raw)
        archive.directory(fullPath, false)
        await archive.finalize()
        return reply
      }

      const fileName = path.basename(fullPath)
      const stream = createReadStream(fullPath)

      reply.raw.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        'Content-Length': stats.size,
      })
      stream.pipe(reply.raw)
      return reply
    } catch (error) {
      console.error('Download error:', error)
      return reply
        .status(500)
        .send({ error: error instanceof Error ? error.message : 'Failed to download' })
    }
  })
}
