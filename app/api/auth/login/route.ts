import { NextRequest, NextResponse } from 'next/server'
import { config } from '@/lib/config'
import { verifyPassword, setAuthSession } from '@/lib/auth'

const loginAttempts = new Map<string, { count: number; resetAt: number }>()
const MAX_ATTEMPTS = 10
const WINDOW_MS = 15 * 60 * 1000

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    request.headers.get('x-real-ip') ??
    'unknown'
  )
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const entry = loginAttempts.get(ip)
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + WINDOW_MS })
    return true
  }
  if (entry.count >= MAX_ATTEMPTS) return false
  entry.count++
  return true
}

export async function POST(request: NextRequest) {
  if (!config.auth?.enabled || !config.auth.password) {
    return NextResponse.json({ error: 'Auth not enabled' }, { status: 400 })
  }

  const ip = getClientIp(request)
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again in 15 minutes.' },
      { status: 429 },
    )
  }

  const body = await request.json()
  const password = typeof body?.password === 'string' ? body.password : ''
  const valid = await verifyPassword(password)
  if (!valid) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

  await setAuthSession()
  return NextResponse.json({ success: true })
}
