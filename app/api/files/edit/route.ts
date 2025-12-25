import { NextRequest, NextResponse } from 'next/server'
import { writeFile, writeBinaryFile, isPathEditable } from '@/lib/file-system'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { path: relativePath, content, base64Content } = body

    if (!relativePath) {
      return NextResponse.json({ error: 'Path is required' }, { status: 400 })
    }

    // Check if path is editable
    if (!isPathEditable(relativePath)) {
      return NextResponse.json({ error: 'Path is not in an editable folder' }, { status: 403 })
    }

    if (content === undefined && base64Content === undefined) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 })
    }

    // Handle binary content (base64 encoded)
    if (base64Content) {
      await writeBinaryFile(relativePath, base64Content)
    } else {
      await writeFile(relativePath, content)
    }

    return NextResponse.json({ success: true, message: 'File saved' })
  } catch (error) {
    console.error('Error editing file:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save file' },
      { status: 500 },
    )
  }
}
