import { NextRequest, NextResponse } from 'next/server'
import { validateShareAccess, resolveSharePath } from '@/lib/share-access'
import { deleteDirectory, deleteFile, validatePath } from '@/lib/file-system'
import { broadcastFileChange } from '@/lib/file-change-emitter'
import { promises as fs } from 'fs'
import path from 'path'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params
    const result = await validateShareAccess(request, token)
    if (result instanceof NextResponse) return result
    const { share } = result

    if (!share.editable) {
      return NextResponse.json({ error: 'Share is not editable' }, { status: 403 })
    }

    const body = await request.json()
    const { path: subPath } = body

    if (!subPath) {
      return NextResponse.json({ error: 'Path is required' }, { status: 400 })
    }

    const resolved = resolveSharePath(share, subPath)
    if (resolved instanceof NextResponse) return resolved

    // Prevent deleting the share root itself
    if (resolved === share.path) {
      return NextResponse.json({ error: 'Cannot delete share root' }, { status: 403 })
    }

    const fullPath = validatePath(resolved)
    const stats = await fs.stat(fullPath)

    const parentDir = path.dirname(resolved).replace(/\\/g, '/')
    const normalizedParent = parentDir === '.' ? '' : parentDir

    if (stats.isDirectory()) {
      await deleteDirectory(resolved)
      broadcastFileChange(normalizedParent)
      return NextResponse.json({ success: true, message: 'Folder deleted' })
    }

    await deleteFile(resolved)
    broadcastFileChange(normalizedParent)
    return NextResponse.json({ success: true, message: 'File deleted' })
  } catch (error) {
    console.error('Error deleting in share:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete' },
      { status: 500 },
    )
  }
}
