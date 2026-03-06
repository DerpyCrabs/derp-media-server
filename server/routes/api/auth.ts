import type { FastifyInstance, FastifyRequest } from 'fastify'
import { config } from '@/lib/config'
import { getEditableFolders } from '@/lib/file-system'
import { createAuthSessionValue, verifyPassword, SESSION_COOKIE } from '@/lib/auth'

const loginAttempts = new Map<string, { count: number; resetAt: number }>()
const MAX_ATTEMPTS = 10
const WINDOW_MS = 15 * 60 * 1000

function getClientIp(req: FastifyRequest): string {
  const forwarded = req.headers['x-forwarded-for']
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim()
  const realIp = req.headers['x-real-ip']
  if (typeof realIp === 'string') return realIp
  return 'unknown'
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

function getRequestHost(req: FastifyRequest): string {
  const forwardedHost = req.headers['x-forwarded-host']
  const hostHeader =
    (typeof forwardedHost === 'string' ? forwardedHost.split(',')[0].trim() : undefined) ??
    (typeof req.headers['host'] === 'string' ? req.headers['host'] : undefined)
  if (hostHeader) {
    const hostname = hostHeader.split(':')[0].trim().toLowerCase()
    if (hostname) return hostname
  }
  return req.hostname?.toLowerCase() ?? ''
}

export function registerAuthApiRoutes(app: FastifyInstance) {
  app.get('/api/auth/config', async (_request, reply) => {
    const enabled = config.auth?.enabled ?? false
    const shareLinkDomain = config.shareLinkDomain ?? undefined
    const editableFolders = getEditableFolders()
    return reply.send({ enabled, shareLinkDomain, editableFolders })
  })

  app.post('/api/auth/login', async (request, reply) => {
    const body = request.body as { password: string }

    if (!config.auth?.enabled || !config.auth.password) {
      return reply.code(400).send({ error: 'Auth not enabled' })
    }

    const domains = config.auth.adminAccessDomains
    if (domains && domains.length > 0) {
      const host = getRequestHost(request)
      if (!host || !domains.includes(host)) {
        return reply.code(403).send({ error: 'Admin access not allowed from this domain' })
      }
    }

    const ip = getClientIp(request)
    if (!checkRateLimit(ip)) {
      return reply.code(429).send({ error: 'Too many attempts. Try again in 15 minutes.' })
    }

    const valid = await verifyPassword(body.password)
    if (!valid) {
      return reply.code(401).send({ error: 'Invalid password' })
    }

    const session = createAuthSessionValue()
    if (session) {
      reply.setCookie(session.name, session.value, session.options)
    }

    return reply.send({ success: true })
  })

  app.post('/api/auth/logout', async (_request, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return reply.send({ success: true })
  })
}
