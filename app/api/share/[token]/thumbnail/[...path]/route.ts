import { NextRequest } from 'next/server'
import { getFilePath } from '@/lib/file-system'
import { validateShareAccess, resolveSharePath } from '@/lib/share-access'
import { existsSync, statSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs/promises'

const execFileAsync = promisify(execFile)
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
    await execFileAsync('ffmpeg', ['-version'])
    ffmpegAvailable = true
  } catch {
    ffmpegAvailable = false
  }
  return ffmpegAvailable
}

async function getVideoDuration(videoPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        videoPath,
      ],
      { timeout: 5000 },
    )
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

  await execFileAsync(
    'ffmpeg',
    [
      '-ss',
      String(startTime),
      '-i',
      videoPath,
      '-vf',
      "thumbnail=n=100,scale='min(300,iw)':-1",
      '-frames:v',
      '1',
      outputPath,
      '-y',
    ],
    { timeout: 15000 },
  )
}

function createPlaceholderImage(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64',
  )
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string; path: string[] }> },
) {
  try {
    const { token, path: pathSegments } = await params
    const result = await validateShareAccess(request, token)
    if (result instanceof Response) return result
    const { share } = result

    const filePath = pathSegments.join('/')
    const resolved = resolveSharePath(share, filePath)
    if (resolved instanceof Response) return resolved

    const fullPath = getFilePath(resolved)

    if (!existsSync(fullPath)) {
      const placeholder = createPlaceholderImage()
      return new Response(new Uint8Array(placeholder), {
        status: 200,
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000' },
      })
    }

    const stats = statSync(fullPath)
    if (!stats.isFile()) {
      const placeholder = createPlaceholderImage()
      return new Response(new Uint8Array(placeholder), {
        status: 200,
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000' },
      })
    }

    await ensureCacheDir()
    const cacheKey = getCacheKey(fullPath, stats.mtime)
    const cachedPath = path.join(CACHE_DIR, cacheKey)

    if (existsSync(cachedPath)) {
      const thumbnailData = await fs.readFile(cachedPath)
      return new Response(new Uint8Array(thumbnailData), {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000' },
      })
    }

    try {
      await generateThumbnail(fullPath, cachedPath)
      const thumbnailData = await fs.readFile(cachedPath)
      return new Response(new Uint8Array(thumbnailData), {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000' },
      })
    } catch {
      const placeholder = createPlaceholderImage()
      return new Response(new Uint8Array(placeholder), {
        status: 200,
        headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' },
      })
    }
  } catch (error) {
    console.error('Error in share thumbnail endpoint:', error)
    const placeholder = createPlaceholderImage()
    return new Response(new Uint8Array(placeholder), {
      status: 200,
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' },
    })
  }
}
