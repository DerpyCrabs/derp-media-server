import { NextRequest, NextResponse } from 'next/server'
import { getFilePath } from '@/lib/file-system'
import AdmZip from 'adm-zip'
import { statSync, createReadStream } from 'fs'
import path from 'path'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const filePath = searchParams.get('path')

    if (!filePath) {
      return NextResponse.json({ error: 'Path is required' }, { status: 400 })
    }

    // Validate and get the full file path
    const fullPath = getFilePath(filePath)

    // Check if path exists
    const stats = statSync(fullPath)

    if (stats.isDirectory()) {
      // Download folder as ZIP
      const folderName = path.basename(fullPath)
      const zipFileName = `${folderName}.zip`

      // Create ZIP archive
      const zip = new AdmZip()

      // Add directory contents to archive recursively
      zip.addLocalFolder(fullPath)

      // Get ZIP buffer
      const zipBuffer = zip.toBuffer()

      // Set response headers for ZIP download
      const headers = new Headers()
      headers.set('Content-Type', 'application/zip')
      headers.set('Content-Disposition', `attachment; filename="${zipFileName}"`)
      headers.set('Content-Length', zipBuffer.length.toString())

      return new Response(zipBuffer, { headers })
    } else {
      // Download single file
      const fileName = path.basename(fullPath)

      // Create file stream
      const fileStream = createReadStream(fullPath)

      // Set response headers
      const headers = new Headers()
      headers.set('Content-Type', 'application/octet-stream')
      headers.set('Content-Disposition', `attachment; filename="${fileName}"`)
      headers.set('Content-Length', stats.size.toString())

      // Convert Node.js stream to Web ReadableStream
      const stream = new ReadableStream({
        start(controller) {
          fileStream.on('data', (chunk) => {
            controller.enqueue(chunk)
          })

          fileStream.on('end', () => {
            controller.close()
          })

          fileStream.on('error', (err) => {
            controller.error(err)
          })
        },
      })

      return new Response(stream, { headers })
    }
  } catch (error) {
    console.error('Download error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to download' },
      { status: 500 },
    )
  }
}
