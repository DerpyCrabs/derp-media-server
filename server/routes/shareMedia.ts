import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { createReadStream, statSync, existsSync } from 'fs'
import { promises as fs } from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'
import archiver from 'archiver'
import path from 'path'
import { getFilePath, validatePath, isPathEditable, writeBinaryFile } from '@/lib/file-system'
import { getMimeType, formatFileSize } from '@/lib/media-utils'
import { extractAudioMetadata, extractAudioTrack } from '@/server/lib/audio-helpers'
import {
  getShare,
  isShareAccessAuthorized,
  resolveShareSubPath,
  getEffectiveRestrictions,
  checkUploadQuota,
  addShareUsedBytes,
  type ShareLink,
} from '@/lib/shares'
import {
  getKnowledgeBases,
  isKnowledgeBaseImagePath,
  getKnowledgeBaseRootForPath,
} from '@/lib/knowledge-base'
import { broadcastFileChange } from '@/lib/file-change-emitter'

const execAsync = promisify(exec)

// ── Thumbnail helpers (mirrored from thumbnail.ts for share scope) ───

const CACHE_DIR = path.join(process.cwd(), '.thumbnails')

async function ensureCacheDir() {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true })
  } catch {
    /* ignore */
  }
}

function getCacheKey(filePath: string, mtime: Date): string {
  return (
    Buffer.from(`${filePath}-${mtime.getTime()}`)
      .toString('base64')
      .replace(/[^a-zA-Z0-9]/g, '') + '.jpg'
  )
}

let ffmpegAvailable: boolean | null = null
async function checkFFmpeg(): Promise<boolean> {
  if (ffmpegAvailable !== null) return ffmpegAvailable
  try {
    await execAsync('ffmpeg -version')
    ffmpegAvailable = true
  } catch {
    ffmpegAvailable = false
  }
  return ffmpegAvailable
}

async function getVideoDuration(videoPath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`,
      { timeout: 5000 },
    )
    const d = parseFloat(stdout.trim())
    return isNaN(d) ? 0 : d
  } catch {
    return 0
  }
}

async function generateThumbnail(videoPath: string, outputPath: string): Promise<void> {
  if (!(await checkFFmpeg())) throw new Error('ffmpeg not available')
  const duration = await getVideoDuration(videoPath)
  const startTime = duration > 0 ? Math.min(duration * 0.05, 3.0) : 3.0
  await execAsync(
    `ffmpeg -ss ${startTime} -i "${videoPath}" -vf "thumbnail=n=100,scale='min(300,iw)':-1" -frames:v 1 "${outputPath}" -y`,
    { timeout: 15000 },
  )
}

const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

function sendPlaceholder(reply: FastifyReply, maxAge: string) {
  reply.raw.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': PLACEHOLDER_PNG.length,
    'Cache-Control': maxAge,
  })
  reply.raw.end(PLACEHOLDER_PNG)
}

// ── Share access validation for HTTP routes ──────────────────────────

function validateShareAccessHTTP(
  request: FastifyRequest,
  share: ShareLink,
  reply: FastifyReply,
): boolean {
  const cookies = request.cookies || {}
  const cookieObj = {
    get: (name: string) => (cookies[name] ? { value: cookies[name]! } : undefined),
  }
  if (!isShareAccessAuthorized(share, cookieObj)) {
    reply.status(401).send({ error: 'Passcode required' })
    return false
  }
  return true
}

function resolveSharePathHTTP(share: ShareLink, subPath: string): string | null {
  return resolveShareSubPath(share, subPath)
}

export function registerShareMediaRoutes(app: FastifyInstance) {
  // ── Stream shared media with range support ─────────────────────────
  app.get('/api/share/:token/media/*', async (request, reply) => {
    try {
      const { token } = request.params as { token: string }
      const filePath = (request.params as { '*': string })['*']

      const share = await getShare(token)
      if (!share) return reply.status(404).send({ error: 'Share not found' })
      if (!validateShareAccessHTTP(request, share, reply)) return reply

      let resolvedPath: string | null

      if (share.isDirectory) {
        resolvedPath = resolveSharePathHTTP(share, filePath)
      } else {
        resolvedPath = filePath === share.path || filePath === '.' ? share.path : null
      }

      if (resolvedPath === null) {
        const knowledgeBases = await getKnowledgeBases()
        if (isKnowledgeBaseImagePath(filePath, share.path, knowledgeBases)) {
          resolvedPath = filePath
        } else {
          return reply.status(403).send({ error: 'Invalid path' })
        }
      }

      const fullPath = getFilePath(resolvedPath)
      const stats = statSync(fullPath)

      if (!stats.isFile()) {
        return reply.status(400).send({ error: 'Not a file' })
      }

      const extension = path.extname(fullPath).slice(1)
      const mimeType = getMimeType(extension)
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
          'Cache-Control': 'no-cache',
        })
        stream.pipe(reply.raw)
        return reply
      }

      const stream = createReadStream(fullPath)
      reply.raw.writeHead(200, {
        'Content-Type': mimeType,
        'Content-Length': stats.size,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
      })
      stream.pipe(reply.raw)
      return reply
    } catch (error) {
      console.error('Error streaming shared media:', error)
      return reply.status(404).send({ error: 'File not found' })
    }
  })

  // ── Thumbnails for shared media ────────────────────────────────────
  app.get('/api/share/:token/thumbnail/*', async (request, reply) => {
    try {
      const { token } = request.params as { token: string }
      const filePath = (request.params as { '*': string })['*']

      const share = await getShare(token)
      if (!share) return reply.status(404).send({ error: 'Share not found' })
      if (!validateShareAccessHTTP(request, share, reply)) return reply

      const resolved = resolveSharePathHTTP(share, filePath)
      if (resolved === null) {
        sendPlaceholder(reply, 'public, max-age=31536000')
        return reply
      }

      const fullPath = getFilePath(resolved)

      if (!existsSync(fullPath)) {
        sendPlaceholder(reply, 'public, max-age=31536000')
        return reply
      }

      const stats = statSync(fullPath)
      if (!stats.isFile()) {
        sendPlaceholder(reply, 'public, max-age=31536000')
        return reply
      }

      await ensureCacheDir()
      const cacheKey = getCacheKey(fullPath, stats.mtime)
      const cachedPath = path.join(CACHE_DIR, cacheKey)

      if (existsSync(cachedPath)) {
        const data = await fs.readFile(cachedPath)
        reply.raw.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Content-Length': data.length,
          'Cache-Control': 'public, max-age=31536000',
        })
        reply.raw.end(data)
        return reply
      }

      try {
        await generateThumbnail(fullPath, cachedPath)
        const data = await fs.readFile(cachedPath)
        reply.raw.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Content-Length': data.length,
          'Cache-Control': 'public, max-age=31536000',
        })
        reply.raw.end(data)
        return reply
      } catch {
        sendPlaceholder(reply, 'public, max-age=3600')
        return reply
      }
    } catch (error) {
      console.error('Error in share thumbnail endpoint:', error)
      sendPlaceholder(reply, 'public, max-age=3600')
      return reply
    }
  })

  // ── Download shared files/folders ──────────────────────────────────
  app.get('/api/share/:token/download', async (request, reply) => {
    try {
      const { token } = request.params as { token: string }

      const share = await getShare(token)
      if (!share) return reply.status(404).send({ error: 'Share not found' })
      if (!validateShareAccessHTTP(request, share, reply)) return reply

      const subPath = (request.query as { path?: string }).path || ''
      const resolved = resolveSharePathHTTP(share, subPath)
      if (resolved === null) {
        return reply.status(403).send({ error: 'Path outside share boundary' })
      }

      const fullPath = getFilePath(resolved)
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
      console.error('Share download error:', error)
      return reply
        .status(500)
        .send({ error: error instanceof Error ? error.message : 'Failed to download' })
    }
  })

  // ── Upload to shares via multipart ─────────────────────────────────
  app.post('/api/share/:token/upload', async (request, reply) => {
    try {
      const { token } = request.params as { token: string }

      const share = await getShare(token)
      if (!share) return reply.status(404).send({ error: 'Share not found' })
      if (!validateShareAccessHTTP(request, share, reply)) return reply

      if (!share.editable) {
        return reply.status(403).send({ error: 'Share is not editable' })
      }

      const restrictions = getEffectiveRestrictions(share)
      if (!restrictions.allowUpload) {
        return reply.status(403).send({ error: 'Uploads are not allowed for this share' })
      }

      const parts = request.parts()
      let targetSubDir = ''
      const files: { name: string; data: Buffer }[] = []

      for await (const part of parts) {
        if (part.type === 'field' && part.fieldname === 'targetDir') {
          targetSubDir = part.value as string
        } else if (part.type === 'file') {
          const chunks: Buffer[] = []
          for await (const chunk of part.file) chunks.push(chunk)
          files.push({ name: part.filename!, data: Buffer.concat(chunks) })
        }
      }

      if (files.length === 0) {
        return reply.status(400).send({ error: 'No files provided' })
      }

      let totalBytes = 0
      for (const file of files) totalBytes += file.data.length

      const quota = checkUploadQuota(share, totalBytes)
      if (!quota.allowed) {
        return reply.status(413).send({
          error: `Upload exceeds quota (${formatFileSize(quota.remaining)} remaining, ${formatFileSize(totalBytes)} requested)`,
          remaining: quota.remaining,
          requested: totalBytes,
        })
      }

      const broadcastEvents = new Map<string, string>()
      let uploadedCount = 0

      const uploaded = await Promise.all(
        files.map(async (file) => {
          const subPath = targetSubDir ? `${targetSubDir}/${file.name}` : file.name
          const resolved = resolveSharePathHTTP(share, subPath)
          if (resolved === null) return null

          const fullPath = validatePath(resolved)
          await fs.mkdir(path.dirname(fullPath), { recursive: true })
          await fs.writeFile(fullPath, file.data)

          const parentDir = path.dirname(resolved).replace(/\\/g, '/')
          const normalizedParent = parentDir === '.' ? '' : parentDir
          return { normalizedParent, resolved }
        }),
      )
      for (const entry of uploaded) {
        if (!entry) continue
        broadcastEvents.set(entry.normalizedParent, entry.resolved)
        uploadedCount++
      }

      if (totalBytes > 0) {
        await addShareUsedBytes(token, totalBytes)
      }

      broadcastEvents.forEach((changedPath, dir) => broadcastFileChange(dir, changedPath))

      return reply.send({ success: true, uploaded: uploadedCount })
    } catch (error) {
      console.error('Error uploading to share:', error)
      return reply
        .status(500)
        .send({ error: error instanceof Error ? error.message : 'Upload failed' })
    }
  })

  // ── Audio metadata for shared files ────────────────────────────────
  app.get('/api/share/:token/audio/metadata/*', async (request, reply) => {
    try {
      const { token } = request.params as { token: string }
      const filePath = (request.params as { '*': string })['*']

      const share = await getShare(token)
      if (!share) return reply.status(404).send({ error: 'Share not found' })
      if (!validateShareAccessHTTP(request, share, reply)) return reply

      const resolved = share.isDirectory
        ? resolveSharePathHTTP(share, filePath)
        : filePath === '.'
          ? share.path
          : null
      if (resolved === null) return reply.status(403).send({ error: 'Invalid path' })

      const fullPath = getFilePath(resolved)
      const metadata = await extractAudioMetadata(fullPath)
      return reply.send(metadata)
    } catch (error) {
      console.error('Error reading shared audio metadata:', error)
      return reply.status(500).send({ error: 'Failed to read audio metadata' })
    }
  })

  // ── Extract audio from shared video ───────────────────────────────
  app.get('/api/share/:token/audio/extract/*', async (request, reply) => {
    try {
      const { token } = request.params as { token: string }
      const filePath = (request.params as { '*': string })['*']

      const share = await getShare(token)
      if (!share) return reply.status(404).send({ error: 'Share not found' })
      if (!validateShareAccessHTTP(request, share, reply)) return reply

      const resolved = share.isDirectory
        ? resolveSharePathHTTP(share, filePath)
        : filePath === '.'
          ? share.path
          : null
      if (resolved === null) return reply.status(403).send({ error: 'Invalid path' })

      const fullPath = getFilePath(resolved)
      return await extractAudioTrack(fullPath, request, reply)
    } catch (error) {
      if (error instanceof Error && error.message.includes('ENOENT')) {
        return reply.status(501).send({
          error: 'FFmpeg not found. Please install ffmpeg on the server.',
        })
      }
      return reply.status(500).send({ error: 'Audio extraction failed' })
    }
  })

  // ── Upload base64 images to shares ─────────────────────────────────
  app.post('/api/share/:token/upload-image', async (request, reply) => {
    try {
      const { token } = request.params as { token: string }

      const share = await getShare(token)
      if (!share) return reply.status(404).send({ error: 'Share not found' })
      if (!validateShareAccessHTTP(request, share, reply)) return reply

      if (!share.editable) {
        return reply.status(403).send({ error: 'Share is not editable' })
      }

      const restrictions = getEffectiveRestrictions(share)
      if (!restrictions.allowUpload) {
        return reply.status(403).send({ error: 'Uploads are not allowed for this share' })
      }

      const body = request.body as { base64Content?: string; mimeType?: string }
      const { base64Content, mimeType } = body

      if (!base64Content || typeof base64Content !== 'string') {
        return reply.status(400).send({ error: 'base64Content is required' })
      }

      const contentSize = Math.ceil((base64Content.length * 3) / 4)
      const quota = checkUploadQuota(share, contentSize)
      if (!quota.allowed) {
        return reply.status(413).send({ error: 'Upload quota exceeded for this share' })
      }

      const knowledgeBases = await getKnowledgeBases()
      const sharePath = share.path.replace(/\\/g, '/')
      const kbRoot = getKnowledgeBaseRootForPath(sharePath, knowledgeBases)

      let imagesDir: string
      if (kbRoot && share.isDirectory) {
        // For directory shares at or below KB root, write images inside the share
        if (sharePath === kbRoot) {
          imagesDir = `${kbRoot}/images`
        } else {
          imagesDir = `${sharePath}/images`
        }
      } else if (kbRoot && !share.isDirectory) {
        // Single-file shares write to an images dir next to the file
        const fileDir = path.dirname(sharePath).replace(/\\/g, '/')
        imagesDir = `${fileDir}/images`
      } else {
        const fileDir = path.dirname(sharePath).replace(/\\/g, '/')
        imagesDir = `${fileDir}/images`
      }

      if (!isPathEditable(imagesDir)) {
        return reply.status(403).send({ error: 'Images folder is not in an editable directory' })
      }

      const ext = (mimeType || 'image/png').split('/')[1] || 'png'
      const safeExt = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext) ? ext : 'png'
      const fileName = `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`
      const imagePath = `${imagesDir}/${fileName}`

      await writeBinaryFile(imagePath, base64Content)
      await addShareUsedBytes(token, contentSize)

      const parentDir = path.dirname(imagePath).replace(/\\/g, '/')
      broadcastFileChange(parentDir === '.' ? '' : parentDir, imagePath)

      return reply.send({ success: true, path: imagePath })
    } catch (error) {
      console.error('Error uploading image:', error)
      return reply
        .status(500)
        .send({ error: error instanceof Error ? error.message : 'Failed to upload image' })
    }
  })
}
