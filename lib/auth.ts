import { createHmac, scrypt, timingSafeEqual } from 'crypto'
import { promisify } from 'util'
import { config } from '@/lib/config'

const scryptAsync = promisify(scrypt)
const SALT = 'derp-media-server'
const KEY_LEN = 64
export const SESSION_COOKIE = 'auth_session'
const DEFAULT_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7 // 7 days

export function getAuthSessionMaxAgeSeconds(): number {
  const n = config.auth?.sessionMaxAgeSeconds
  if (typeof n === 'number' && n > 0 && Number.isFinite(n)) return Math.floor(n)
  return DEFAULT_SESSION_MAX_AGE_SECONDS
}

function signSession(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function verifySignedCookie(value: string, secret: string): boolean {
  const dot = value.indexOf('.')
  if (dot <= 0 || dot >= value.length - 1) return false
  const payload = value.slice(0, dot)
  const sig = value.slice(dot + 1)
  const expected = signSession(secret, payload)
  if (sig.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(sig, 'base64url'), Buffer.from(expected, 'base64url'))
  } catch {
    return false
  }
}

// Pre-derive the expected password hash once at startup so login only hashes the input.
let expectedHashCache: Buffer | null = null
async function getExpectedHash(password: string): Promise<Buffer> {
  if (!expectedHashCache) {
    expectedHashCache = (await scryptAsync(password, SALT, KEY_LEN)) as Buffer
  }
  return expectedHashCache
}

export async function verifyPassword(password: string): Promise<boolean> {
  const expected = config.auth?.password
  if (!expected || expected.length === 0) return false
  if (password.length === 0) return false

  try {
    const [inputHash, expectedHash] = await Promise.all([
      scryptAsync(password, SALT, KEY_LEN) as Promise<Buffer>,
      getExpectedHash(expected),
    ])
    if (inputHash.length === expectedHash.length) {
      return timingSafeEqual(inputHash, expectedHash)
    }
  } catch {
    // ignore
  }
  return false
}

export function createAuthSessionValue(): {
  name: string
  value: string
  options: {
    httpOnly: boolean
    secure: boolean
    sameSite: 'lax' | 'strict' | 'none'
    maxAge: number
    path: string
  }
} | null {
  const secret = config.auth?.password
  if (!secret) return null

  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signature = signSession(secret, timestamp)
  const value = `${timestamp}.${signature}`
  const maxAge = getAuthSessionMaxAgeSeconds()

  return {
    name: SESSION_COOKIE,
    value,
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge,
      path: '/',
    },
  }
}

/** Synchronously verifies a raw cookie value without needing next/headers (for use in middleware). */
export function verifySessionValue(value: string | undefined): boolean {
  const secret = config.auth?.password
  if (!secret || !value) return false
  if (!verifySignedCookie(value, secret)) return false
  const dot = value.indexOf('.')
  const timestamp = parseInt(value.slice(0, dot), 10)
  const now = Math.floor(Date.now() / 1000)
  return now - timestamp <= getAuthSessionMaxAgeSeconds()
}
