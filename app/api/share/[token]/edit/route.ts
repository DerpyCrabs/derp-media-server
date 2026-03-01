import { NextRequest, NextResponse } from 'next/server'
import { validateShareAccess, resolveSharePath } from '@/lib/share-access'
import { writeFile, writeBinaryFile } from '@/lib/file-system'
import { broadcastFileChange } from '@/lib/file-change-emitter'
import { getEffectiveRestrictions, checkUploadQuota, addShareUsedBytes } from '@/lib/shares'
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

    const restrictions = getEffectiveRestrictions(share)
    if (!restrictions.allowEdit) {
      return NextResponse.json(
        { error: 'Editing files is not allowed for this share' },
        { status: 403 },
      )
    }

    const body = await request.json()
    const { path: subPath, content, base64Content } = body

    if (!subPath && subPath !== '') {
      return NextResponse.json({ error: 'Path is required' }, { status: 400 })
    }

    const resolved = resolveSharePath(share, subPath)
    if (resolved instanceof NextResponse) return resolved

    if (content === undefined && base64Content === undefined) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 })
    }

    const contentSize = base64Content
      ? Math.ceil((base64Content.length * 3) / 4)
      : Buffer.byteLength(content || '', 'utf8')

    const quota = checkUploadQuota(share, contentSize)
    if (!quota.allowed) {
      return NextResponse.json({ error: 'Upload quota exceeded for this share' }, { status: 413 })
    }

    if (base64Content) {
      await writeBinaryFile(resolved, base64Content)
    } else {
      await writeFile(resolved, content)
    }

    if (contentSize > 0) await addShareUsedBytes(token, contentSize)
    const parentDir = path.dirname(resolved).replace(/\\/g, '/')
    broadcastFileChange(parentDir === '.' ? '' : parentDir)
    return NextResponse.json({ success: true, message: 'File saved' })
  } catch (error) {
    console.error('Error editing shared file:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save file' },
      { status: 500 },
    )
  }
}
