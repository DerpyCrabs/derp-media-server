import type { FastifyInstance } from 'fastify'
import { getFilePath } from '@/lib/file-system'
import AdmZip from 'adm-zip'
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
        const zipFileName = `${folderName}.zip`

        const zip = new AdmZip()
        zip.addLocalFolder(fullPath)
        const zipBuffer = zip.toBuffer()

        reply.raw.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${zipFileName}"`,
          'Content-Length': zipBuffer.length,
        })
        reply.raw.end(zipBuffer)
        return reply
      }

      const fileName = path.basename(fullPath)
      const stream = createReadStream(fullPath)

      reply.raw.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${fileName}"`,
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
