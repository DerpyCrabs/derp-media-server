import { NextRequest, NextResponse } from 'next/server'
import { deleteDirectory, deleteFile, validatePath } from '@/lib/file-system'
import { broadcastFileChange } from '@/lib/file-change-emitter'
import { promises as fs } from 'fs'
import path from 'path'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { path: relativePath } = body

    if (!relativePath) {
      return NextResponse.json({ error: 'Path is required' }, { status: 400 })
    }

    // Check if it's a directory or file
    const fullPath = validatePath(relativePath)
    const stats = await fs.stat(fullPath)

    const parentDir = path.dirname(relativePath).replace(/\\/g, '/')
    const normalizedParent = parentDir === '.' ? '' : parentDir

    if (stats.isDirectory()) {
      await deleteDirectory(relativePath)
      broadcastFileChange(normalizedParent)
      return NextResponse.json({ success: true, message: 'Folder deleted' })
    } else {
      await deleteFile(relativePath)
      broadcastFileChange(normalizedParent)
      return NextResponse.json({ success: true, message: 'File deleted' })
    }
  } catch (error) {
    console.error('Error deleting:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete' },
      { status: 500 },
    )
  }
}
