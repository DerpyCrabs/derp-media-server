import type { FastifyInstance } from 'fastify'
import { promises as fs } from 'fs'
import path from 'path'
import { validatePath, isPathEditable } from '@/lib/file-system'
import { broadcastFileChange } from '@/lib/file-change-emitter'

export function registerUploadRoutes(app: FastifyInstance) {
  app.post('/api/files/upload', async (request, reply) => {
    try {
      const parts = request.parts()
      let targetDir = ''
      const files: { name: string; data: Buffer }[] = []

      for await (const part of parts) {
        if (part.type === 'field' && part.fieldname === 'targetDir') {
          targetDir = part.value as string
        } else if (part.type === 'file') {
          const chunks: Buffer[] = []
          for await (const chunk of part.file) chunks.push(chunk)
          files.push({ name: part.filename!, data: Buffer.concat(chunks) })
        }
      }

      if (files.length === 0) {
        return reply.status(400).send({ error: 'No files provided' })
      }

      const broadcastEvents = new Map<string, string>()
      let uploadedCount = 0

      const written = await Promise.all(
        files.map(async (file) => {
          const relativePath = targetDir ? `${targetDir}/${file.name}` : file.name
          const parentDir = path.dirname(relativePath).replace(/\\/g, '/')
          const normalizedParent = parentDir === '.' ? '' : parentDir

          if (!isPathEditable(normalizedParent) && !isPathEditable(relativePath)) {
            return null
          }

          const fullPath = validatePath(relativePath)
          await fs.mkdir(path.dirname(fullPath), { recursive: true })
          await fs.writeFile(fullPath, file.data)

          return { normalizedParent, rel: relativePath.replace(/\\/g, '/') }
        }),
      )
      for (const entry of written) {
        if (!entry) continue
        broadcastEvents.set(entry.normalizedParent, entry.rel)
        uploadedCount++
      }

      if (uploadedCount === 0) {
        return reply
          .status(403)
          .send({ error: 'No files were uploaded — target path is not editable' })
      }

      broadcastEvents.forEach((changedPath, dir) => broadcastFileChange(dir, changedPath))

      return reply.send({ success: true, uploaded: uploadedCount })
    } catch (error) {
      console.error('Error uploading files:', error)
      return reply
        .status(500)
        .send({ error: error instanceof Error ? error.message : 'Upload failed' })
    }
  })
}
