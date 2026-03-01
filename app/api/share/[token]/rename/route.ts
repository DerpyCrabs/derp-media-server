import { NextRequest, NextResponse } from 'next/server'
import { validateShareAccess, resolveSharePath } from '@/lib/share-access'
import { renameFileOrDirectory } from '@/lib/file-system'
import { broadcastFileChange } from '@/lib/file-change-emitter'
import { getEffectiveRestrictions } from '@/lib/shares'
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

    if (!getEffectiveRestrictions(share).allowEdit) {
      return NextResponse.json({ error: 'Editing is not allowed for this share' }, { status: 403 })
    }

    const body = await request.json()
    const { oldPath, newPath } = body

    if (!oldPath || !newPath) {
      return NextResponse.json({ error: 'Both oldPath and newPath are required' }, { status: 400 })
    }

    const resolvedOld = resolveSharePath(share, oldPath)
    if (resolvedOld instanceof NextResponse) return resolvedOld

    const resolvedNew = resolveSharePath(share, newPath)
    if (resolvedNew instanceof NextResponse) return resolvedNew

    await renameFileOrDirectory(resolvedOld, resolvedNew)
    const oldParent = path.dirname(resolvedOld).replace(/\\/g, '/')
    const newParent = path.dirname(resolvedNew).replace(/\\/g, '/')
    broadcastFileChange(oldParent === '.' ? '' : oldParent)
    if (newParent !== oldParent) {
      broadcastFileChange(newParent === '.' ? '' : newParent)
    }
    return NextResponse.json({ success: true, message: 'Renamed successfully' })
  } catch (error) {
    console.error('Error renaming in share:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to rename' },
      { status: 500 },
    )
  }
}
