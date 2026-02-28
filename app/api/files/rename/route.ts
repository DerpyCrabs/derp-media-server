import { NextRequest, NextResponse } from 'next/server'
import { renameFileOrDirectory } from '@/lib/file-system'
import { broadcastFileChange } from '@/lib/file-change-emitter'
import path from 'path'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { oldPath, newPath } = body

    if (!oldPath || !newPath) {
      return NextResponse.json({ error: 'Both oldPath and newPath are required' }, { status: 400 })
    }

    await renameFileOrDirectory(oldPath, newPath)
    const oldParent = path.dirname(oldPath).replace(/\\/g, '/')
    const newParent = path.dirname(newPath).replace(/\\/g, '/')
    broadcastFileChange(oldParent === '.' ? '' : oldParent)
    if (newParent !== oldParent) {
      broadcastFileChange(newParent === '.' ? '' : newParent)
    }
    return NextResponse.json({ success: true, message: 'Renamed successfully' })
  } catch (error) {
    console.error('Error renaming:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to rename' },
      { status: 500 },
    )
  }
}
