import type { FastifyRequest, FastifyReply } from 'fastify'
import { config } from '@/lib/config'
import { verifySessionValue, SESSION_COOKIE } from '@/lib/auth'

const PUBLIC_PREFIXES = ['/login', '/api/auth/', '/share', '/api/share/']

function isAssetRequest(pathname: string): boolean {
  if (pathname.startsWith('/@') || pathname.startsWith('/node_modules/')) return true
  if (pathname.startsWith('/src/')) return true
  const lastSegment = pathname.split('/').pop() || ''
  return lastSegment.includes('.') && !pathname.startsWith('/api/')
}

function isPublic(pathname: string): boolean {
  if (isAssetRequest(pathname)) return true
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))
}

function getRequestHost(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-host']
  const hostHeader =
    (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : undefined) ??
    request.headers.host
  if (hostHeader) {
    const hostname = hostHeader.split(':')[0].trim().toLowerCase()
    if (hostname) return hostname
  }
  return ''
}

function isAdminDomainAllowed(request: FastifyRequest): boolean {
  const domains = config.auth?.adminAccessDomains
  if (!domains || domains.length === 0) return true
  const host = getRequestHost(request)
  return Boolean(host && domains.includes(host))
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!config.auth?.enabled) return

  const pathname = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`).pathname
  if (isPublic(pathname)) return

  const sessionValue = (request.cookies as Record<string, string | undefined>)?.[SESSION_COOKIE]

  if (verifySessionValue(sessionValue)) {
    if (!isAdminDomainAllowed(request)) {
      if (pathname.startsWith('/api/')) {
        reply.code(403).send({ error: 'Admin access not allowed from this domain' })
        return
      }
      reply.redirect('/login')
      return
    }
    return
  }

  if (pathname.startsWith('/api/')) {
    reply.code(401).send({ error: 'Unauthorized' })
    return
  }

  reply.redirect('/login')
}
