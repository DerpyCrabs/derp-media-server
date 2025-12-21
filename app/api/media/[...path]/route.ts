import { NextRequest } from 'next/server'
import { createReadStream, statSync } from 'fs'
import { getFilePath } from '@/lib/file-system'
import { getMimeType } from '@/lib/media-utils'
import path from 'path'

export async function GET(request: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    const resolvedParams = await params
    const filePath = resolvedParams.path.join('/')

    // Validate and get the full file path
    const fullPath = getFilePath(filePath)

    // Check if file exists (using sync to avoid issues with streaming)
    const stats = statSync(fullPath)
    if (!stats.isFile()) {
      return new Response(JSON.stringify({ error: 'Not a file' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Get file extension and MIME type
    const extension = path.extname(fullPath).slice(1)
    const mimeType = getMimeType(extension)

    // Get range header for partial content support (video seeking)
    const range = request.headers.get('range')

    if (range) {
      // Handle range request
      const parts = range.replace(/bytes=/, '').split('-')
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1
      const chunkSize = end - start + 1

      // Create a readable stream for the requested range
      const stream = createReadStream(fullPath, { start, end })

      // Return partial content with stream
      return new Response(stream as unknown as ReadableStream, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${stats.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize.toString(),
          'Content-Type': mimeType,
          'Cache-Control': 'public, max-age=31536000',
        },
      })
    } else {
      // Return full file as stream (no memory loading!)
      const stream = createReadStream(fullPath)

      return new Response(stream as unknown as ReadableStream, {
        status: 200,
        headers: {
          'Content-Type': mimeType,
          'Content-Length': stats.size.toString(),
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'public, max-age=31536000',
        },
      })
    }
  } catch (error) {
    console.error('Error streaming media:', error)

    if (error instanceof Error && error.message.includes('Invalid path')) {
      return new Response(JSON.stringify({ error: 'Invalid path' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: 'File not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
