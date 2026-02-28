import { NextRequest, NextResponse } from 'next/server'
import { validateShareAccess, resolveSharePath } from '@/lib/share-access'
import { getFilePath } from '@/lib/file-system'
import AdmZip from 'adm-zip'
import { statSync, createReadStream } from 'fs'
import path from 'path'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params
    const result = await validateShareAccess(request, token)
    if (result instanceof NextResponse) return result
    const { share } = result

    const filePath = request.nextUrl.searchParams.get('path') || ''
    const resolved = resolveSharePath(share, filePath)
    if (resolved instanceof NextResponse) return resolved

    const fullPath = getFilePath(resolved)
    const stats = statSync(fullPath)

    if (stats.isDirectory()) {
      const folderName = path.basename(fullPath)
      const zip = new AdmZip()
      zip.addLocalFolder(fullPath)
      const zipBuffer = zip.toBuffer()

      const headers = new Headers()
      headers.set('Content-Type', 'application/zip')
      headers.set('Content-Disposition', `attachment; filename="${folderName}.zip"`)
      headers.set('Content-Length', zipBuffer.length.toString())

      return new Response(zipBuffer as unknown as BodyInit, { headers })
    }

    const fileName = path.basename(fullPath)
    const fileStream = createReadStream(fullPath)

    const headers = new Headers()
    headers.set('Content-Type', 'application/octet-stream')
    headers.set('Content-Disposition', `attachment; filename="${fileName}"`)
    headers.set('Content-Length', stats.size.toString())

    const stream = new ReadableStream({
      start(controller) {
        fileStream.on('data', (chunk) => controller.enqueue(chunk))
        fileStream.on('end', () => controller.close())
        fileStream.on('error', (err) => controller.error(err))
      },
    })

    return new Response(stream, { headers })
  } catch (error) {
    console.error('Share download error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to download' },
      { status: 500 },
    )
  }
}
