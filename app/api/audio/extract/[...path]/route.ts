import { NextRequest } from 'next/server'
import { spawn } from 'child_process'
import { statSync } from 'fs'
import { getFilePath } from '@/lib/file-system'
import path from 'path'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const resolvedParams = await params
    const filePath = resolvedParams.path.join('/')

    // Validate and get the full file path
    const fullPath = getFilePath(filePath)

    // Check if file exists
    const stats = statSync(fullPath)
    if (!stats.isFile()) {
      return new Response(JSON.stringify({ error: 'Not a file' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Get file extension to verify it's a video
    const extension = path.extname(fullPath).slice(1).toLowerCase()
    const videoExtensions = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv']

    if (!videoExtensions.includes(extension)) {
      return new Response(JSON.stringify({ error: 'Not a video file' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // FFmpeg command to extract audio
    // Copy audio stream without re-encoding (fastest, preserves quality)
    const ffmpegArgs = [
      '-i',
      fullPath,
      '-vn', // No video
      '-c:a',
      'copy', // Copy audio codec without re-encoding
      '-f',
      'webm', // WebM container
      'pipe:1', // Output to stdout
    ]

    // Extract the complete audio to a buffer first (enables seeking)
    const audioBuffer = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = []
      let errorOutput = ''

      const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      ffmpeg.stdout.on('data', (chunk) => {
        chunks.push(chunk)
      })

      ffmpeg.stderr.on('data', (data) => {
        errorOutput += data.toString()
      })

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve(Buffer.concat(chunks))
        } else {
          console.error(`FFmpeg exited with code ${code}`)
          console.error('FFmpeg stderr:', errorOutput)
          reject(new Error(`FFmpeg failed with code ${code}`))
        }
      })

      ffmpeg.on('error', (error) => {
        console.error('FFmpeg spawn error:', error)
        reject(error)
      })
    })

    // Get range header for partial content support
    const range = request.headers.get('range')

    if (range) {
      // Handle range request for seeking
      const parts = range.replace(/bytes=/, '').split('-')
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : audioBuffer.length - 1
      const chunkSize = end - start + 1

      return new Response(new Uint8Array(audioBuffer.slice(start, end + 1)), {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${audioBuffer.length}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize.toString(),
          'Content-Type': 'audio/webm',
          'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
        },
      })
    }

    // Return full audio
    return new Response(new Uint8Array(audioBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'audio/webm',
        'Content-Length': audioBuffer.length.toString(),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
      },
    })
  } catch (error) {
    console.error('Error extracting audio:', error)

    // Check if ffmpeg is not found
    if (error instanceof Error && error.message.includes('ENOENT')) {
      return new Response(
        JSON.stringify({
          error: 'FFmpeg not found. Please install ffmpeg on the server.',
        }),
        {
          status: 501,
          headers: { 'Content-Type': 'application/json' },
        },
      )
    }

    if (error instanceof Error && error.message.includes('Invalid path')) {
      return new Response(JSON.stringify({ error: 'Invalid path' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: 'Audio extraction failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
