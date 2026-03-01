import { promises as fs } from 'fs'
import path from 'path'
import {
  randomBytes,
  createHmac,
  timingSafeEqual,
  createCipheriv,
  createDecipheriv,
  scryptSync,
} from 'crypto'
import { cookies } from 'next/headers'
import { config } from '@/lib/config'
import { getMediaType } from '@/lib/media-utils'
import type { FileItem } from '@/lib/types'
import { MediaType } from '@/lib/types'
import { Mutex } from '@/lib/mutex'

export interface ShareRestrictions {
  allowDelete?: boolean
  allowUpload?: boolean
  allowEdit?: boolean
  maxUploadBytes?: number
}

export interface ShareLink {
  token: string
  path: string
  isDirectory: boolean
  editable: boolean
  passcode?: string
  createdAt: number
  restrictions?: ShareRestrictions
  usedBytes?: number
}

const DEFAULT_MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024 // 2 GB

export function getEffectiveRestrictions(share: ShareLink): Required<ShareRestrictions> {
  const r = share.restrictions || {}
  return {
    allowDelete: r.allowDelete !== false,
    allowUpload: r.allowUpload !== false,
    allowEdit: r.allowEdit !== false,
    maxUploadBytes: r.maxUploadBytes ?? DEFAULT_MAX_UPLOAD_BYTES,
  }
}

export function checkUploadQuota(
  share: ShareLink,
  contentSizeBytes: number,
): { allowed: boolean; remaining: number } {
  const restrictions = getEffectiveRestrictions(share)
  if (restrictions.maxUploadBytes === 0) return { allowed: true, remaining: Infinity }
  const used = share.usedBytes || 0
  const remaining = Math.max(0, restrictions.maxUploadBytes - used)
  return { allowed: contentSizeBytes <= remaining, remaining }
}

interface SharesData {
  shares: ShareLink[]
}

interface SharesFile {
  [mediaDir: string]: SharesData
}

const SHARES_FILE = path.join(process.cwd(), 'shares.json')
const SHARE_SESSION_MAX_AGE = 60 * 60 * 24 * 7 // 7 days

// One mutex per shares file to serialise all read-modify-write operations.
const sharesMutex = new Mutex()

const ENCRYPTION_SALT = 'derp-media-server-passcode-v1'
let _encKey: Buffer | null = null

function getEncryptionKey(): Buffer {
  if (_encKey) return _encKey
  const password = config.auth?.password || 'derp-media-server-default'
  _encKey = scryptSync(password, ENCRYPTION_SALT, 32)
  return _encKey
}

function encryptPasscode(passcode: string): string {
  const key = getEncryptionKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(passcode, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return Buffer.concat([iv, authTag, encrypted]).toString('base64url')
}

function decryptPasscode(encrypted: string): string | null {
  try {
    const key = getEncryptionKey()
    const data = Buffer.from(encrypted, 'base64url')
    if (data.length < 28) return null
    const iv = data.subarray(0, 12)
    const authTag = data.subarray(12, 28)
    const ciphertext = data.subarray(28)
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)
    return decipher.update(ciphertext).toString('utf8') + decipher.final('utf8')
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Token / passcode generation
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// File I/O (raw — no decryption; used internally only)
// ---------------------------------------------------------------------------

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

async function readSharesRaw(): Promise<SharesData> {
  const all = await readSharesFile()
  return all[config.mediaDir] || { shares: [] }
}

async function writeSharesData(data: SharesData): Promise<void> {
  const all = await readSharesFile()
  all[config.mediaDir] = data
  await writeSharesFile(all)
}

// ---------------------------------------------------------------------------
// Decrypt passcode fields when returning share objects to callers
// ---------------------------------------------------------------------------

function decryptSharePasscode(share: ShareLink): ShareLink {
  if (share.passcode) {
    const plain = decryptPasscode(share.passcode)
    if (plain) return { ...share, passcode: plain }
  }
  return share
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function createShare(
  sharePath: string,
  isDirectory: boolean,
  editable: boolean,
  restrictions?: ShareRestrictions,
): Promise<ShareLink> {
  const release = await sharesMutex.acquire()
  try {
    const data = await readSharesRaw()

    const existingIndex = data.shares.findIndex((s) => s.path === sharePath)
    if (existingIndex !== -1) {
      const existing = data.shares[existingIndex]
      if (existing.editable !== editable || existing.isDirectory !== isDirectory) {
        const updated: ShareLink = { ...existing, editable, isDirectory }
        if (editable && restrictions) updated.restrictions = restrictions
        data.shares[existingIndex] = updated
        await writeSharesData(data)
        return decryptSharePasscode(updated)
      }
      return decryptSharePasscode(existing)
    }

    const plainPasscode = config.auth?.enabled ? generatePasscode() : undefined
    const share: ShareLink = {
      token: generateToken(),
      path: sharePath,
      isDirectory,
      editable,
      passcode: plainPasscode ? encryptPasscode(plainPasscode) : undefined,
      createdAt: Date.now(),
      ...(editable && restrictions ? { restrictions } : {}),
    }

    data.shares.push(share)
    await writeSharesData(data)

    return { ...share, passcode: plainPasscode }
  } finally {
    release()
  }
}

export async function updateShareRestrictions(
  token: string,
  restrictions: ShareRestrictions,
): Promise<ShareLink | null> {
  const release = await sharesMutex.acquire()
  try {
    const data = await readSharesRaw()
    const index = data.shares.findIndex((s) => s.token === token)
    if (index === -1) return null
    data.shares[index] = { ...data.shares[index], restrictions }
    await writeSharesData(data)
    return decryptSharePasscode(data.shares[index])
  } finally {
    release()
  }
}

export async function addShareUsedBytes(token: string, bytes: number): Promise<boolean> {
  const release = await sharesMutex.acquire()
  try {
    const data = await readSharesRaw()
    const index = data.shares.findIndex((s) => s.token === token)
    if (index === -1) return false
    data.shares[index].usedBytes = (data.shares[index].usedBytes || 0) + bytes
    await writeSharesData(data)
    return true
  } finally {
    release()
  }
}

export async function getShare(token: string): Promise<ShareLink | null> {
  const data = await readSharesRaw()
  const share = data.shares.find((s) => s.token === token)
  return share ? decryptSharePasscode(share) : null
}

export async function deleteShare(token: string): Promise<boolean> {
  const release = await sharesMutex.acquire()
  try {
    const data = await readSharesRaw()
    const index = data.shares.findIndex((s) => s.token === token)
    if (index === -1) return false
    data.shares.splice(index, 1)
    await writeSharesData(data)
    return true
  } finally {
    release()
  }
}

export async function getAllShares(): Promise<ShareLink[]> {
  const data = await readSharesRaw()
  return data.shares.map(decryptSharePasscode)
}

export async function getSharesAsFileItems(): Promise<FileItem[]> {
  const shares = await getAllShares()
  const fileItems: FileItem[] = []

  for (const share of shares) {
    try {
      const fullPath = path.join(config.mediaDir, share.path)
      const stat = await fs.stat(fullPath)

      const fileName = path.basename(share.path)
      const extension = path.extname(fileName).slice(1).toLowerCase()

      fileItems.push({
        name: fileName,
        path: share.path,
        type: stat.isDirectory() ? MediaType.FOLDER : getMediaType(extension),
        size: stat.isDirectory() ? 0 : stat.size,
        extension,
        isDirectory: share.isDirectory,
        shareToken: share.token,
      })
    } catch {
      // Skip shares whose files no longer exist
      continue
    }
  }

  return fileItems
}

export async function getSharesForPath(targetPath: string): Promise<ShareLink[]> {
  const data = await readSharesRaw()
  const normalized = targetPath.replace(/\\/g, '/')
  return data.shares
    .filter((s) => {
      const sp = s.path.replace(/\\/g, '/')
      return sp === normalized
    })
    .map(decryptSharePasscode)
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

// ---------------------------------------------------------------------------
// Share session cookies (for passcode-protected shares)
// ---------------------------------------------------------------------------

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
