import { NextRequest } from 'next/server'
import { createReadStream, statSync } from 'fs'
import { getFilePath } from '@/lib/file-system'
import { getMimeType } from '@/lib/media-utils'
import { validateShareAccess, resolveSharePath } from '@/lib/share-access'
import path from 'path'

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

    // For file shares, the path must match the share path exactly
    const resolvedPath = share.isDirectory ? resolveSharePath(share, filePath) : share.path

    if (resolvedPath instanceof Response) return resolvedPath

    // For file shares, verify the requested path matches
    if (!share.isDirectory && filePath !== share.path && filePath !== '.') {
      return new Response(JSON.stringify({ error: 'Invalid path' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const fullPath = getFilePath(resolvedPath)
    const stats = statSync(fullPath)

    if (!stats.isFile()) {
      return new Response(JSON.stringify({ error: 'Not a file' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const extension = path.extname(fullPath).slice(1)
    const mimeType = getMimeType(extension)

    const range = request.headers.get('range')

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-')
      const start = parseInt(parts[0], 10)
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1
      const chunkSize = end - start + 1

      const stream = createReadStream(fullPath, { start, end })

      return new Response(stream as unknown as ReadableStream, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${stats.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize.toString(),
          'Content-Type': mimeType,
          'Cache-Control': 'no-cache',
        },
      })
    }

    const stream = createReadStream(fullPath)

    return new Response(stream as unknown as ReadableStream, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': stats.size.toString(),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
      },
    })
  } catch (error) {
    console.error('Error streaming shared media:', error)
    return new Response(JSON.stringify({ error: 'File not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
