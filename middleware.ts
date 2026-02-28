import { NextRequest, NextResponse } from 'next/server'
import { config as appConfig } from '@/lib/config'
import { verifySessionValue } from '@/lib/auth'

export const runtime = 'nodejs'

const PUBLIC_PREFIXES = ['/login', '/api/auth/', '/share', '/api/share/']

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))
}

export function middleware(request: NextRequest) {
  if (!appConfig.auth?.enabled) return NextResponse.next()

  const { pathname } = request.nextUrl
  if (isPublic(pathname)) return NextResponse.next()

  const sessionValue = request.cookies.get('auth_session')?.value
  if (verifySessionValue(sessionValue)) return NextResponse.next()

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.redirect(new URL('/login', request.url))
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
}
