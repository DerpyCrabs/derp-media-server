import { NextResponse } from 'next/server'
import { clearAuthSession } from '@/lib/auth'

export async function POST(request: Request) {
  await clearAuthSession()
  const url = new URL(request.url)
  return NextResponse.redirect(new URL('/login', url.origin))
}
