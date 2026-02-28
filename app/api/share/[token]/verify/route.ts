import { NextRequest, NextResponse } from 'next/server'
import { getShare, setShareSession } from '@/lib/shares'

const verifyAttempts = new Map<string, { count: number; resetAt: number }>()
const MAX_ATTEMPTS = 10
const WINDOW_MS = 15 * 60 * 1000

function checkRateLimit(token: string): boolean {
  const now = Date.now()
  const entry = verifyAttempts.get(token)
  if (!entry || now > entry.resetAt) {
    verifyAttempts.set(token, { count: 1, resetAt: now + WINDOW_MS })
    return true
  }
  if (entry.count >= MAX_ATTEMPTS) return false
  entry.count++
  return true
}

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

    if (!checkRateLimit(token)) {
      return NextResponse.json(
        { error: 'Too many attempts. Try again in 15 minutes.' },
        { status: 429 },
      )
    }

    const body = await request.json()
    const passcode = typeof body?.passcode === 'string' ? body.passcode : ''

    if (passcode !== share.passcode) {
      return NextResponse.json({ error: 'Invalid passcode' }, { status: 401 })
    }

    verifyAttempts.delete(token)

    await setShareSession(share.token)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Error verifying share passcode:', error)
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 })
  }
}
