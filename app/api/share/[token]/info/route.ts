import { NextRequest, NextResponse } from 'next/server'
import { getShare, isShareAccessAuthorized, getEffectiveRestrictions } from '@/lib/shares'
import path from 'path'
import { getMediaType } from '@/lib/media-utils'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params
    const share = await getShare(token)
    if (!share) {
      return NextResponse.json({ error: 'Share not found' }, { status: 404 })
    }

    const needsPasscode = Boolean(share.passcode)
    const authorized = await isShareAccessAuthorized(share, _request.cookies)

    const name = path.basename(share.path) || share.path
    const extension = share.isDirectory ? '' : path.extname(share.path).slice(1).toLowerCase()
    const mediaType = share.isDirectory ? 'folder' : getMediaType(extension)

    const restrictions = share.editable ? getEffectiveRestrictions(share) : undefined
    const usedBytes = share.editable ? share.usedBytes || 0 : undefined

    return NextResponse.json({
      name,
      ...(authorized && { path: share.path }),
      isDirectory: share.isDirectory,
      editable: share.editable,
      mediaType,
      extension,
      needsPasscode,
      authorized,
      ...(restrictions && { restrictions }),
      ...(usedBytes !== undefined && { usedBytes }),
    })
  } catch (error) {
    console.error('Error getting share info:', error)
    return NextResponse.json({ error: 'Failed to get share info' }, { status: 500 })
  }
}
