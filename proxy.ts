import { NextRequest, NextResponse } from 'next/server'
import { config as appConfig } from '@/lib/config'
import { verifySessionValue } from '@/lib/auth'

const PUBLIC_PREFIXES = ['/login', '/api/auth/', '/share', '/api/share/', '/api/files/stream']

function isPublic(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))
}

function getRequestHost(request: NextRequest): string {
  const hostHeader =
    request.headers.get('x-forwarded-host')?.split(',')[0].trim() ?? request.headers.get('host')
  if (hostHeader) {
    const hostname = hostHeader.split(':')[0].trim().toLowerCase()
    if (hostname) return hostname
  }
  return request.nextUrl.hostname?.toLowerCase() ?? ''
}

function isAdminDomainAllowed(request: NextRequest): boolean {
  const domains = appConfig.auth?.adminAccessDomains
  if (!domains || domains.length === 0) return true
  const host = getRequestHost(request)
  return Boolean(host && domains.includes(host))
}

export function proxy(request: NextRequest) {
  if (!appConfig.auth?.enabled) return NextResponse.next()

  const { pathname } = request.nextUrl
  if (isPublic(pathname)) return NextResponse.next()

  const sessionValue = request.cookies.get('auth_session')?.value
  if (verifySessionValue(sessionValue)) {
    if (!isAdminDomainAllowed(request)) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json(
          { error: 'Admin access not allowed from this domain' },
          { status: 403 },
        )
      }
      return NextResponse.redirect(new URL('/login', request.url))
    }
    return NextResponse.next()
  }

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.redirect(new URL('/login', request.url))
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
}
