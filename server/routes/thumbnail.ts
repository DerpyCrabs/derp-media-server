import type { FastifyInstance } from 'fastify'
import { getFilePath } from '@/lib/file-system'
import { existsSync, statSync } from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs/promises'

const execAsync = promisify(exec)

const CACHE_DIR = path.join(process.cwd(), '.thumbnails')

async function ensureCacheDir() {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true })
  } catch (err) {
    console.error('Failed to create cache directory:', err)
  }
}

function getCacheKey(filePath: string, mtime: Date): string {
  const hash = Buffer.from(`${filePath}-${mtime.getTime()}`)
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '')
  return `${hash}.jpg`
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
    const command = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
    const { stdout } = await execAsync(command, { timeout: 5000 })
    const duration = parseFloat(stdout.trim())
    return isNaN(duration) ? 0 : duration
  } catch {
    return 0
  }
}

async function generateThumbnail(videoPath: string, outputPath: string): Promise<void> {
  const hasFfmpeg = await checkFFmpeg()
  if (!hasFfmpeg) throw new Error('ffmpeg not available')

  const duration = await getVideoDuration(videoPath)
  let startTime = 3.0
  if (duration > 0) startTime = Math.min(duration * 0.05, 3.0)

  const command = `ffmpeg -ss ${startTime} -i "${videoPath}" -vf "thumbnail=n=100,scale='min(300,iw)':-1" -frames:v 1 "${outputPath}" -y`
  await execAsync(command, { timeout: 15000 })
}

const PLACEHOLDER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

function sendPlaceholder(reply: import('fastify').FastifyReply, maxAge: string) {
  reply.raw.writeHead(200, {
    'Content-Type': 'image/png',
    'Content-Length': PLACEHOLDER_PNG.length,
    'Cache-Control': maxAge,
  })
  reply.raw.end(PLACEHOLDER_PNG)
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

      await ensureCacheDir()

      const cacheKey = getCacheKey(fullPath, stats.mtime)
      const cachedPath = path.join(CACHE_DIR, cacheKey)

      if (existsSync(cachedPath)) {
        const thumbnailData = await fs.readFile(cachedPath)
        reply.raw.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Content-Length': thumbnailData.length,
          'Cache-Control': 'public, max-age=31536000',
        })
        reply.raw.end(thumbnailData)
        return reply
      }

      try {
        await generateThumbnail(fullPath, cachedPath)
        const thumbnailData = await fs.readFile(cachedPath)
        reply.raw.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Content-Length': thumbnailData.length,
          'Cache-Control': 'public, max-age=31536000',
        })
        reply.raw.end(thumbnailData)
        return reply
      } catch (error) {
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
