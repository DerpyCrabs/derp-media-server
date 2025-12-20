import { NextRequest } from 'next/server'
import { getFilePath } from '@/lib/file-system'
import { existsSync, statSync } from 'fs'
import { exec } from 'child_process'
import { promisify } from 'util'
import path from 'path'
import fs from 'fs/promises'

const execAsync = promisify(exec)

// Cache directory for thumbnails
const CACHE_DIR = path.join(process.cwd(), '.thumbnails')

// Ensure cache directory exists
async function ensureCacheDir() {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true })
  } catch (err) {
    console.error('Failed to create cache directory:', err)
  }
}

// Generate a cache key from file path and modification time
function getCacheKey(filePath: string, mtime: Date): string {
  const hash = Buffer.from(`${filePath}-${mtime.getTime()}`)
    .toString('base64')
    .replace(/[^a-zA-Z0-9]/g, '')
  return `${hash}.jpg`
}

// Check if ffmpeg is available
let ffmpegAvailable: boolean | null = null
async function checkFFmpeg(): Promise<boolean> {
  if (ffmpegAvailable !== null) return ffmpegAvailable

  try {
    await execAsync('ffmpeg -version')
    ffmpegAvailable = true
    return true
  } catch {
    ffmpegAvailable = false
    return false
  }
}

// Get video duration in seconds using ffprobe
async function getVideoDuration(videoPath: string): Promise<number> {
  try {
    const command = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
    const { stdout } = await execAsync(command, {
      timeout: 5000,
    })
    const duration = parseFloat(stdout.trim())
    return isNaN(duration) ? 0 : duration
  } catch (error) {
    console.error('Failed to get video duration:', error)
    return 0
  }
}

// Generate thumbnail using ffmpeg
async function generateThumbnail(videoPath: string, outputPath: string): Promise<void> {
  const hasFfmpeg = await checkFFmpeg()

  if (!hasFfmpeg) {
    throw new Error('ffmpeg not available')
  }

  // Get video duration to determine sample range
  const duration = await getVideoDuration(videoPath)

  // Determine where to start sampling frames
  // Skip the first 5% or first 3 seconds (whichever is less) to avoid intros/black screens
  let startTime = 3.0

  if (duration > 0) {
    startTime = Math.min(duration * 0.05, 3.0)
  }

  // Use ffmpeg's thumbnail filter which automatically selects the most representative frame
  // It analyzes frames and picks one that's not black, not a fade, and has good visual content
  // The thumbnail filter examines frames and scores them based on visual complexity
  // n=100 means it will analyze up to 100 frames and pick the best one
  const command = `ffmpeg -ss ${startTime} -i "${videoPath}" -vf "thumbnail=n=100,scale='min(300,iw)':-1" -frames:v 1 "${outputPath}" -y`

  await execAsync(command, {
    timeout: 15000, // 15 second timeout (analyzing frames takes longer)
  })
}

// Create a fallback placeholder image
async function createPlaceholderImage(): Promise<Buffer> {
  // Return a simple 1x1 transparent PNG
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  )
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    const resolvedParams = await params
    const filePath = resolvedParams.path.join('/')

    // Validate and get the full file path
    const fullPath = getFilePath(filePath)

    // Check if file exists
    if (!existsSync(fullPath)) {
      const placeholder = await createPlaceholderImage()
      return new Response(new Uint8Array(placeholder), {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=31536000',
        },
      })
    }

    const stats = statSync(fullPath)
    if (!stats.isFile()) {
      const placeholder = await createPlaceholderImage()
      return new Response(new Uint8Array(placeholder), {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=31536000',
        },
      })
    }

    // Ensure cache directory exists
    await ensureCacheDir()

    // Check cache
    const cacheKey = getCacheKey(fullPath, stats.mtime)
    const cachedPath = path.join(CACHE_DIR, cacheKey)

    if (existsSync(cachedPath)) {
      // Return cached thumbnail
      const thumbnailData = await fs.readFile(cachedPath)
      return new Response(new Uint8Array(thumbnailData), {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=31536000',
        },
      })
    }

    // Generate new thumbnail
    try {
      await generateThumbnail(fullPath, cachedPath)
      const thumbnailData = await fs.readFile(cachedPath)

      return new Response(new Uint8Array(thumbnailData), {
        status: 200,
        headers: {
          'Content-Type': 'image/jpeg',
          'Cache-Control': 'public, max-age=31536000',
        },
      })
    } catch (error) {
      console.error('Error generating thumbnail:', error)

      // Return placeholder on error
      const placeholder = await createPlaceholderImage()
      return new Response(new Uint8Array(placeholder), {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=3600',
        },
      })
    }
  } catch (error) {
    console.error('Error in thumbnail endpoint:', error)

    const placeholder = await createPlaceholderImage()
    return new Response(new Uint8Array(placeholder), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  }
}
