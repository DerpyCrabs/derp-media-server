import { promises as fs } from 'fs'
import path from 'path'
import { randomBytes, createHmac, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'
import { config } from '@/lib/config'

export interface ShareLink {
  token: string
  path: string
  isDirectory: boolean
  editable: boolean
  passcode?: string
  createdAt: number
}

interface SharesData {
  shares: ShareLink[]
}

interface SharesFile {
  [mediaDir: string]: SharesData
}

const SHARES_FILE = path.join(process.cwd(), 'shares.json')
const SHARE_SESSION_MAX_AGE = 60 * 60 * 24 * 7 // 7 days

function generateToken(): string {
  return randomBytes(16).toString('base64url')
}

function generatePasscode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let result = ''
  const bytes = randomBytes(6)
  for (let i = 0; i < 6; i++) {
    result += chars[bytes[i] % chars.length]
  }
  return result
}

async function readSharesFile(): Promise<SharesFile> {
  try {
    const data = await fs.readFile(SHARES_FILE, 'utf-8')
    return JSON.parse(data)
  } catch {
    return {}
  }
}

async function writeSharesFile(allShares: SharesFile): Promise<void> {
  await fs.writeFile(SHARES_FILE, JSON.stringify(allShares, null, 2), 'utf-8')
}

async function readShares(): Promise<SharesData> {
  const all = await readSharesFile()
  return all[config.mediaDir] || { shares: [] }
}

async function writeShares(data: SharesData): Promise<void> {
  const all = await readSharesFile()
  all[config.mediaDir] = data
  await writeSharesFile(all)
}

export async function createShare(
  sharePath: string,
  isDirectory: boolean,
  editable: boolean,
): Promise<ShareLink> {
  const data = await readShares()

  const existing = data.shares.find((s) => s.path === sharePath)
  if (existing) {
    return existing
  }

  const share: ShareLink = {
    token: generateToken(),
    path: sharePath,
    isDirectory,
    editable,
    passcode: config.auth?.enabled ? generatePasscode() : undefined,
    createdAt: Date.now(),
  }

  data.shares.push(share)
  await writeShares(data)
  return share
}

export async function getShare(token: string): Promise<ShareLink | null> {
  const data = await readShares()
  return data.shares.find((s) => s.token === token) || null
}

export async function deleteShare(token: string): Promise<boolean> {
  const data = await readShares()
  const index = data.shares.findIndex((s) => s.token === token)
  if (index === -1) return false
  data.shares.splice(index, 1)
  await writeShares(data)
  return true
}

export async function getAllShares(): Promise<ShareLink[]> {
  const data = await readShares()
  return data.shares
}

export async function getSharesForPath(targetPath: string): Promise<ShareLink[]> {
  const data = await readShares()
  const normalized = targetPath.replace(/\\/g, '/')
  return data.shares.filter((s) => {
    const sp = s.path.replace(/\\/g, '/')
    return sp === normalized
  })
}

/**
 * Validates that a sub-path is within the share's root directory.
 * Returns the full relative path (from mediaDir root) or null if invalid.
 */
export function resolveShareSubPath(share: ShareLink, subPath: string): string | null {
  if (!share.isDirectory) {
    return subPath === '' || subPath === '.' ? share.path : null
  }

  const shareRoot = share.path.replace(/\\/g, '/')
  const normalizedSub = subPath.replace(/\\/g, '/')

  if (normalizedSub === '' || normalizedSub === '.') {
    return shareRoot
  }

  // Prevent traversal above share root
  const segments = normalizedSub.split('/')
  if (segments.some((s) => s === '..')) return null

  const fullPath = `${shareRoot}/${normalizedSub}`
  const normalized = path.posix.normalize(fullPath)

  if (!normalized.startsWith(shareRoot + '/') && normalized !== shareRoot) {
    return null
  }

  return normalized
}

// --- Share session cookies (for passcode-protected shares) ---

function signShareSession(token: string, payload: string): string {
  const secret = token + (config.auth?.password || 'share-secret')
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function verifyShareSignedCookie(value: string, token: string): boolean {
  const dot = value.indexOf('.')
  if (dot <= 0 || dot >= value.length - 1) return false
  const payload = value.slice(0, dot)
  const sig = value.slice(dot + 1)
  const expected = signShareSession(token, payload)
  if (sig.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(sig, 'base64url'), Buffer.from(expected, 'base64url'))
  } catch {
    return false
  }
}

function getShareCookieName(token: string): string {
  return `share_${token.slice(0, 8)}`
}

export async function setShareSession(token: string): Promise<void> {
  const timestamp = Math.floor(Date.now() / 1000).toString()
  const signature = signShareSession(token, timestamp)
  const value = `${timestamp}.${signature}`

  const cookieStore = await cookies()
  cookieStore.set(getShareCookieName(token), value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SHARE_SESSION_MAX_AGE,
    path: '/',
  })
}

export function verifyShareSessionValue(token: string, value: string | undefined): boolean {
  if (!value) return false
  if (!verifyShareSignedCookie(value, token)) return false
  const dot = value.indexOf('.')
  const timestamp = parseInt(value.slice(0, dot), 10)
  const now = Math.floor(Date.now() / 1000)
  return now - timestamp <= SHARE_SESSION_MAX_AGE
}

/**
 * Checks whether a share request is authorized.
 * Shares without passcode are always accessible.
 * Shares with passcode require a valid session cookie.
 */
export async function isShareAccessAuthorized(
  share: ShareLink,
  requestCookies: { get: (name: string) => { value: string } | undefined },
): Promise<boolean> {
  if (!share.passcode) return true
  const cookieValue = requestCookies.get(getShareCookieName(share.token))?.value
  return verifyShareSessionValue(share.token, cookieValue)
}
