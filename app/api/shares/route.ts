import { NextRequest, NextResponse } from 'next/server'
import { createShare, getAllShares, deleteShare, updateShareRestrictions } from '@/lib/shares'
import type { ShareRestrictions } from '@/lib/shares'
import { isPathEditable } from '@/lib/file-system'

function parseRestrictions(raw: unknown): ShareRestrictions | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const restrictions: ShareRestrictions = {}
  if (typeof r.allowDelete === 'boolean') restrictions.allowDelete = r.allowDelete
  if (typeof r.allowUpload === 'boolean') restrictions.allowUpload = r.allowUpload
  if (typeof r.allowEdit === 'boolean') restrictions.allowEdit = r.allowEdit
  if (typeof r.maxUploadBytes === 'number' && r.maxUploadBytes >= 0)
    restrictions.maxUploadBytes = r.maxUploadBytes
  return Object.keys(restrictions).length > 0 ? restrictions : undefined
}

export async function GET() {
  try {
    const shares = await getAllShares()
    return NextResponse.json({ shares })
  } catch (error) {
    console.error('Error listing shares:', error)
    return NextResponse.json({ error: 'Failed to list shares' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { path: sharePath, isDirectory, editable, restrictions: rawRestrictions } = body

    if (typeof sharePath !== 'string' || sharePath.length === 0) {
      return NextResponse.json({ error: 'Path is required' }, { status: 400 })
    }

    const shouldBeEditable = Boolean(editable) && Boolean(isDirectory) && isPathEditable(sharePath)
    const restrictions = shouldBeEditable ? parseRestrictions(rawRestrictions) : undefined

    const share = await createShare(sharePath, Boolean(isDirectory), shouldBeEditable, restrictions)

    const origin = request.nextUrl.origin
    const url = `${origin}/share/${share.token}`

    return NextResponse.json({ share, url })
  } catch (error) {
    console.error('Error creating share:', error)
    return NextResponse.json({ error: 'Failed to create share' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { token, restrictions: rawRestrictions } = body

    if (typeof token !== 'string' || token.length === 0) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 })
    }

    const restrictions = parseRestrictions(rawRestrictions)
    if (!restrictions) {
      return NextResponse.json({ error: 'Valid restrictions are required' }, { status: 400 })
    }

    const share = await updateShareRestrictions(token, restrictions)
    if (!share) {
      return NextResponse.json({ error: 'Share not found' }, { status: 404 })
    }

    return NextResponse.json({ share })
  } catch (error) {
    console.error('Error updating share:', error)
    return NextResponse.json({ error: 'Failed to update share' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json()
    const { token } = body

    if (typeof token !== 'string' || token.length === 0) {
      return NextResponse.json({ error: 'Token is required' }, { status: 400 })
    }

    const deleted = await deleteShare(token)
    if (!deleted) {
      return NextResponse.json({ error: 'Share not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error deleting share:', error)
    return NextResponse.json({ error: 'Failed to delete share' }, { status: 500 })
  }
}
