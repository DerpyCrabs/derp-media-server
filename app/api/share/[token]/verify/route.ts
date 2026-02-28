import { NextRequest, NextResponse } from 'next/server'
import { getShare, setShareSession } from '@/lib/shares'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params
    const share = await getShare(token)
    if (!share) {
      return NextResponse.json({ error: 'Share not found' }, { status: 404 })
    }

    if (!share.passcode) {
      return NextResponse.json({ success: true })
    }

    const body = await request.json()
    const passcode = typeof body?.passcode === 'string' ? body.passcode : ''

    if (passcode !== share.passcode) {
      return NextResponse.json({ error: 'Invalid passcode' }, { status: 401 })
    }

    await setShareSession(share.token)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error verifying share passcode:', error)
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
  }
}
