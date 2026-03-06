import type { FastifyInstance } from 'fastify'
import { createReadStream, statSync } from 'fs'
import { getFilePath, isPathEditable } from '@/lib/file-system'
import { getMimeType } from '@/lib/media-utils'
import { extractAudioMetadata, extractAudioTrack } from '@/server/lib/audio-helpers'
import path from 'path'

const TEXT_EXTENSIONS = [
  'txt',
  'md',
  'json',
  'xml',
  'csv',
  'log',
  'yaml',
  'yml',
  'ini',
  'conf',
  'sh',
  'bat',
  'ps1',
  'js',
  'ts',
  'jsx',
  'tsx',
  'css',
  'scss',
  'html',
  'py',
  'java',
  'c',
  'cpp',
  'h',
  'cs',
  'go',
  'rs',
  'php',
  'rb',
  'swift',
  'kt',
  'sql',
]

export function registerMediaRoutes(app: FastifyInstance) {
  // ── Stream media files with range support ──────────────────────────
  app.get('/api/media/*', async (request, reply) => {
    try {
      const filePath = (request.params as { '*': string })['*']
      const fullPath = getFilePath(filePath)

      const stats = statSync(fullPath)
      if (!stats.isFile()) {
        return reply.status(400).send({ error: 'Not a file' })
      }

      const extension = path.extname(fullPath).slice(1)
      const mimeType = getMimeType(extension)
      const isTextFile = TEXT_EXTENSIONS.includes(extension.toLowerCase())
      const isEditable = isPathEditable(filePath)
      const cacheControl =
        isTextFile || isEditable
          ? 'no-cache, no-store, must-revalidate'
          : 'public, max-age=31536000'

      const range = request.headers.range

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-')
        const start = parseInt(parts[0], 10)
        const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1
        const chunkSize = end - start + 1

        const stream = createReadStream(fullPath, { start, end })
        reply.raw.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stats.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': mimeType,
          'Cache-Control': cacheControl,
        })
        stream.pipe(reply.raw)
        return reply
      }

      const stream = createReadStream(fullPath)
      reply.raw.writeHead(200, {
        'Content-Type': mimeType,
        'Content-Length': stats.size,
        'Accept-Ranges': 'bytes',
        'Cache-Control': cacheControl,
      })
      stream.pipe(reply.raw)
      return reply
    } catch (error) {
      if (error instanceof Error && error.message.includes('Invalid path')) {
        return reply.status(403).send({ error: 'Invalid path' })
      }
      return reply.status(404).send({ error: 'File not found' })
    }
  })

  // ── Audio metadata (music-metadata) ────────────────────────────────
  app.get('/api/audio/metadata/*', async (request, reply) => {
    try {
      const filePath = (request.params as { '*': string })['*']
      if (!filePath) {
        return reply.status(400).send({ error: 'Path is required' })
      }

      const fullPath = getFilePath(filePath)
      const metadata = await extractAudioMetadata(fullPath)
      return reply.send(metadata)
    } catch (error) {
      console.error('Error reading audio metadata:', error)
      return reply.status(500).send({ error: 'Failed to read audio metadata' })
    }
  })

  // ── Extract audio track from video via ffmpeg ──────────────────────
  app.get('/api/audio/extract/*', async (request, reply) => {
    try {
      const filePath = (request.params as { '*': string })['*']
      const fullPath = getFilePath(filePath)
      return await extractAudioTrack(fullPath, request, reply)
    } catch (error) {
      if (error instanceof Error && error.message.includes('ENOENT')) {
        return reply.status(501).send({
          error: 'FFmpeg not found. Please install ffmpeg on the server.',
        })
      }
      if (error instanceof Error && error.message.includes('Invalid path')) {
        return reply.status(403).send({ error: 'Invalid path' })
      }
      return reply.status(500).send({ error: 'Audio extraction failed' })
    }
  })
}
