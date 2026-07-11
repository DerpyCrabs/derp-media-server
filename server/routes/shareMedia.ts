import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { createReadStream, statSync, existsSync } from 'fs'
import { promises as fs } from 'fs'
import { ZipArchive } from 'archiver'
import path from 'path'
import {
  getFilePath,
  validatePath,
  isPathEditable,
  writeBinaryFile,
  fileExists,
} from '@/lib/file-system'
import { getMimeType, formatFileSize } from '@/lib/media-utils'
import { extractAudioMetadata, extractAudioTrack } from '@/server/lib/audio-helpers'
import {
  isThumbnailAbortError,
  readThumbnail,
  sendPlaceholder,
  sendThumbnailData,
} from '@/server/lib/thumbnails'
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

/** Safe basename for KB pasted images (Obsidian-style names include spaces). */
function sanitizeKbPastedImageFileName(name: unknown): string | null {
  if (typeof name !== 'string') return null
  const t = name.trim()
  if (t.length === 0 || t.length > 180) return null
  const base = path.basename(t.replace(/\\/g, '/'))
  if (base !== t.replace(/\\/g, '/') || base.includes('..')) return null
  if (!/\.(png|jpe?g|gif|webp)$/i.test(base)) return null
  if (!/^[\w\s().-]+$/i.test(base.replace(/\.[^.]+$/, ''))) return null
  return base
}

// ── Share access validation for HTTP routes ──────────────────────────

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

function validateShareAccessHTTP(
  request: FastifyRequest,
  share: ShareLink,
  reply: FastifyReply,
): boolean {
  if (share.unavailable) {
    reply.status(410).send({ error: 'Share mount is unavailable' })
    return false
  }
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

      try {
        const data = await readThumbnail(
          fullPath,
          stats.mtime,
          createReplyAbortSignal(request, reply),
        )
        sendThumbnailData(reply, data)
        return reply
      } catch (error) {
        if (isThumbnailAbortError(error)) return reply
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

        const archive = new ZipArchive({ zlib: { level: 1 } })
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

      const body = request.body as { base64Content?: string; mimeType?: string; fileName?: string }
      const { base64Content, mimeType, fileName: requestedName } = body

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
      if (kbRoot) {
        imagesDir = `${kbRoot}/images`
      } else if (share.isDirectory) {
        imagesDir = `${sharePath}/images`
      } else {
        const fileDir = path.dirname(sharePath).replace(/\\/g, '/')
        imagesDir = `${fileDir}/images`
      }

      if (!isPathEditable(imagesDir)) {
        return reply.status(403).send({ error: 'Images folder is not in an editable directory' })
      }

      const ext = (mimeType || 'image/png').split('/')[1] || 'png'
      const safeExt = ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext) ? ext : 'png'
      const sanitized = sanitizeKbPastedImageFileName(requestedName)
      let baseFileName =
        sanitized ??
        `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt === 'jpeg' ? 'jpg' : safeExt}`

      let imagePath = `${imagesDir}/${baseFileName}`
      let n = 1
      while (await fileExists(imagePath)) {
        const stem = baseFileName.replace(/\.[^.]+$/, '')
        const dotExt =
          baseFileName.match(/(\.[^.]+)$/)?.[1] ?? `.${safeExt === 'jpeg' ? 'jpg' : safeExt}`
        baseFileName = `${stem}_${n}${dotExt}`
        n++
        imagePath = `${imagesDir}/${baseFileName}`
      }

      await writeBinaryFile(imagePath, base64Content)
      await addShareUsedBytes(token, contentSize)

      const parentDir = path.dirname(imagePath).replace(/\\/g, '/')
      broadcastFileChange(parentDir === '.' ? '' : parentDir, imagePath)

      return reply.send({ success: true, path: imagePath, fileName: baseFileName })
    } catch (error) {
      console.error('Error uploading image:', error)
      return reply
        .status(500)
        .send({ error: error instanceof Error ? error.message : 'Failed to upload image' })
    }
  })
}
