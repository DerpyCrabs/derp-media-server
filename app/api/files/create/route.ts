import { NextRequest, NextResponse } from 'next/server'
import { createDirectory, writeFile, isPathEditable } from '@/lib/file-system'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { type, path: relativePath, content } = body

    if (!relativePath) {
      return NextResponse.json({ error: 'Path is required' }, { status: 400 })
    }

    // Check if path is editable
    if (!isPathEditable(relativePath)) {
      return NextResponse.json({ error: 'Path is not in an editable folder' }, { status: 403 })
    }

    if (type === 'folder') {
      await createDirectory(relativePath)
      return NextResponse.json({ success: true, message: 'Folder created' })
    } else if (type === 'file') {
      if (content === undefined) {
        return NextResponse.json({ error: 'Content is required for files' }, { status: 400 })
      }
      await writeFile(relativePath, content)
      return NextResponse.json({ success: true, message: 'File saved' })
    } else {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }
  } catch (error) {
    console.error('Error creating file/folder:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create' },
      { status: 500 },
    )
  }
}
