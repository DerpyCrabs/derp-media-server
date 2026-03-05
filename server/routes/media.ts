import type { FastifyInstance } from 'fastify'
import { createReadStream, statSync } from 'fs'
import { spawn } from 'child_process'
import { parseFile } from 'music-metadata'
import { getFilePath, isPathEditable } from '@/lib/file-system'
import { getMimeType } from '@/lib/media-utils'
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

const VIDEO_EXTENSIONS = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv']

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
      const metadata = await parseFile(fullPath)

      let coverArt: string | null = null
      if (metadata.common.picture && metadata.common.picture.length > 0) {
        const picture = metadata.common.picture[0]
        const base64 = Buffer.from(picture.data).toString('base64')
        coverArt = `data:${picture.format};base64,${base64}`
      }

      return reply.send({
        title: metadata.common.title || null,
        artist: metadata.common.artist || null,
        album: metadata.common.album || null,
        year: metadata.common.year || null,
        genre: metadata.common.genre || null,
        duration: metadata.format.duration || null,
        coverArt,
        trackNumber: metadata.common.track?.no || null,
        albumArtist: metadata.common.albumartist || null,
      })
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

      const stats = statSync(fullPath)
      if (!stats.isFile()) {
        return reply.status(400).send({ error: 'Not a file' })
      }

      const extension = path.extname(fullPath).slice(1).toLowerCase()
      if (!VIDEO_EXTENSIONS.includes(extension)) {
        return reply.status(400).send({ error: 'Not a video file' })
      }

      const audioBuffer = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = []
        let errorOutput = ''

        const ffmpeg = spawn(
          'ffmpeg',
          ['-i', fullPath, '-vn', '-c:a', 'libopus', '-b:a', '128k', '-f', 'webm', 'pipe:1'],
          { stdio: ['ignore', 'pipe', 'pipe'] },
        )

        ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk))
        ffmpeg.stderr.on('data', (data) => {
          errorOutput += data.toString()
        })

        ffmpeg.on('close', (code) => {
          if (code === 0) resolve(Buffer.concat(chunks))
          else {
            console.error(`FFmpeg exited with code ${code}`)
            console.error('FFmpeg stderr:', errorOutput)
            reject(new Error(`FFmpeg failed with code ${code}`))
          }
        })

        ffmpeg.on('error', reject)
      })

      const range = request.headers.range
      if (range) {
        const parts = range.replace(/bytes=/, '').split('-')
        const start = parseInt(parts[0], 10)
        const end = parts[1] ? parseInt(parts[1], 10) : audioBuffer.length - 1
        const chunkSize = end - start + 1

        reply.raw.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${audioBuffer.length}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': 'audio/webm',
          'Cache-Control': 'public, max-age=3600',
        })
        reply.raw.end(audioBuffer.subarray(start, end + 1))
        return reply
      }

      reply.raw.writeHead(200, {
        'Content-Type': 'audio/webm',
        'Content-Length': audioBuffer.length,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
      })
      reply.raw.end(audioBuffer)
      return reply
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
