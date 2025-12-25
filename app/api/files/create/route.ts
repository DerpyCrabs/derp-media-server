import { NextRequest, NextResponse } from 'next/server'
import {
  createDirectory,
  writeFile,
  writeBinaryFile,
  isPathEditable,
  fileExists,
} from '@/lib/file-system'
import path from 'path'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { type, path: relativePath, content, base64Content } = body

    if (!relativePath) {
      return NextResponse.json({ error: 'Path is required' }, { status: 400 })
    }

    // Get the parent directory for the new item
    const parentPath = path.dirname(relativePath).replace(/\\/g, '/')
    const normalizedParent = parentPath === '.' ? '' : parentPath

    // Check if parent directory is editable (or if the path itself is editable for root-level items)
    if (!isPathEditable(normalizedParent) && !isPathEditable(relativePath)) {
      return NextResponse.json({ error: 'Path is not in an editable folder' }, { status: 403 })
    }

    // Check if file/folder already exists
    const exists = await fileExists(relativePath)
    if (exists) {
      const itemType = type === 'folder' ? 'folder' : 'file'
      return NextResponse.json(
        { error: `A ${itemType} with this name already exists` },
        { status: 409 },
      )
    }

    if (type === 'folder') {
      await createDirectory(relativePath)
      return NextResponse.json({ success: true, message: 'Folder created' })
    } else if (type === 'file') {
      if (content === undefined && base64Content === undefined) {
        return NextResponse.json({ error: 'Content is required for files' }, { status: 400 })
      }
      // Handle binary content (base64 encoded)
      if (base64Content) {
        await writeBinaryFile(relativePath, base64Content)
      } else {
        await writeFile(relativePath, content)
      }
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
