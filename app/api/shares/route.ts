import { NextRequest, NextResponse } from 'next/server'
import { createShare, getAllShares, deleteShare } from '@/lib/shares'
import { isPathEditable } from '@/lib/file-system'

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
    const { path: sharePath, isDirectory, editable } = body

    if (typeof sharePath !== 'string' || sharePath.length === 0) {
      return NextResponse.json({ error: 'Path is required' }, { status: 400 })
    }

    const shouldBeEditable = Boolean(editable) && Boolean(isDirectory) && isPathEditable(sharePath)

    const share = await createShare(sharePath, Boolean(isDirectory), shouldBeEditable)

    const origin = request.nextUrl.origin
    const url = `${origin}/share/${share.token}`

    return NextResponse.json({ share, url })
  } catch (error) {
    console.error('Error creating share:', error)
    return NextResponse.json({ error: 'Failed to create share' }, { status: 500 })
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
