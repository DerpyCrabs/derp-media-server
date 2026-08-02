import { promises as fs } from 'fs'
import { randomUUID } from 'node:crypto'
import { getFilePath } from '@/lib/file-system'
import { collectMarkdownImageTargets } from '@/lib/markdown-parser'
import { resolveMarkdownImageSharePath } from '@/lib/resolve-markdown-image-url'

const cacheLimit = 128
const uploadedShareLimit = 128
const uploadedPathLimit = 128
const rollbackGrantLimit = 512
const rollbackGrantLifetimeMs = 5 * 60_000

type CachedReferences = {
  mtimeNs: bigint
  size: bigint
  paths: ReadonlySet<string>
}

type UploadedImagePreview = {
  finalizedAt: number | null
  expiresAt: number
}

export type ShareImageRollbackGrant = {
  token: string
  sharePath: string
  uploadedPath: string
  accountedBytes: number
  expiresAt: number
}

const referenceCache = new Map<string, CachedReferences>()
// Keeps unsaved previews scoped to exact images uploaded by one token for one shared file.
const uploadedImages = new Map<string, Map<string, UploadedImagePreview>>()
const rollbackGrants = new Map<string, ShareImageRollbackGrant>()
let previewEventSequence = 0

function uploadScope(token: string, sharePath: string): string {
  return `${token}\0${sharePath.replace(/\\/g, '/')}`
}

function canonicalMediaPath(value: string): string | null {
  const segments: string[] = []
  for (const segment of value.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') return null
    segments.push(segment)
  }
  return segments.join('/') || null
}

export function referencedSharedMarkdownImagePaths(
  source: string,
  sharePath: string,
  knowledgeBases: string[],
): ReadonlySet<string> {
  const paths = new Set<string>()
  const share = { token: '', sharePath, isDirectory: false }

  for (const target of collectMarkdownImageTargets(source)) {
    const resolved = resolveMarkdownImageSharePath(sharePath, share, knowledgeBases, target)
    const canonical = resolved && canonicalMediaPath(resolved)
    if (canonical) paths.add(canonical)
  }

  return paths
}

async function referencesForSharedMarkdown(
  sharePath: string,
  knowledgeBases: string[],
): Promise<ReadonlySet<string>> {
  const fullPath = getFilePath(sharePath)
  const cacheKey = `${sharePath}\0${knowledgeBases
    .map((entry) => entry.replace(/\\/g, '/'))
    .join('\0')}`
  const stats = await fs.stat(fullPath, { bigint: true })
  const cached = referenceCache.get(cacheKey)
  if (cached?.mtimeNs === stats.mtimeNs && cached.size === stats.size) return cached.paths

  const source = await fs.readFile(fullPath, 'utf8')
  const paths = referencedSharedMarkdownImagePaths(source, sharePath, knowledgeBases)
  referenceCache.delete(cacheKey)
  referenceCache.set(cacheKey, {
    mtimeNs: stats.mtimeNs,
    size: stats.size,
    paths,
  })
  if (referenceCache.size > cacheLimit) {
    const oldest = referenceCache.keys().next().value
    if (oldest !== undefined) referenceCache.delete(oldest)
  }
  return paths
}

export async function isReferencedSingleFileShareImage(
  sharePath: string,
  requestedPath: string,
  knowledgeBases: string[],
): Promise<boolean> {
  if (!/\.md$/i.test(sharePath)) return false
  const canonicalRequest = canonicalMediaPath(requestedPath)
  if (!canonicalRequest) return false

  try {
    const references = await referencesForSharedMarkdown(sharePath, knowledgeBases)
    return references.has(canonicalRequest)
  } catch {
    return false
  }
}

export function recordSingleFileShareImagePreview(
  token: string,
  sharePath: string,
  uploadedPath: string,
): void {
  const canonical = canonicalMediaPath(uploadedPath)
  if (!canonical) return

  const scope = uploadScope(token, sharePath)
  let paths = uploadedImages.get(scope)
  if (!paths) {
    paths = new Map()
    uploadedImages.set(scope, paths)
  } else {
    uploadedImages.delete(scope)
    uploadedImages.set(scope, paths)
  }
  paths.delete(canonical)
  paths.set(canonical, {
    finalizedAt: null,
    expiresAt: Date.now() + rollbackGrantLifetimeMs,
  })

  if (paths.size > uploadedPathLimit) {
    const oldestPath = paths.keys().next().value
    if (oldestPath !== undefined) paths.delete(oldestPath)
  }
  if (uploadedImages.size > uploadedShareLimit) {
    const oldestToken = uploadedImages.keys().next().value
    if (oldestToken !== undefined) uploadedImages.delete(oldestToken)
  }
}

function hasSingleFileShareUploadPreview(
  token: string,
  sharePath: string,
  requestedPath: string,
): boolean {
  pruneUploadedImagePreviews()
  const canonical = canonicalMediaPath(requestedPath)
  if (!canonical) return false
  return uploadedImages.get(uploadScope(token, sharePath))?.has(canonical) === true
}

function pruneUploadedImagePreviews(now = Date.now()): void {
  for (const [scope, paths] of uploadedImages) {
    for (const [uploadedPath, preview] of paths) {
      if (preview.finalizedAt === null && preview.expiresAt <= now) paths.delete(uploadedPath)
    }
    if (paths.size === 0) uploadedImages.delete(scope)
  }
}

export function finalizeSingleFileShareImagePreview(
  token: string,
  sharePath: string,
  uploadedPath: string,
): void {
  const canonical = canonicalMediaPath(uploadedPath)
  if (!canonical) return
  const preview = uploadedImages.get(uploadScope(token, sharePath))?.get(canonical)
  if (!preview) return
  preview.finalizedAt = ++previewEventSequence
  preview.expiresAt = Number.POSITIVE_INFINITY
}

export function beginSingleFileShareImagePreviewSave(): number {
  return ++previewEventSequence
}

export function settleSingleFileShareImagePreviewsAfterSave(
  token: string,
  sharePath: string,
  source: string,
  knowledgeBases: string[],
  saveStartedAt: number,
): void {
  const scope = uploadScope(token, sharePath)
  const paths = uploadedImages.get(scope)
  const references = referencedSharedMarkdownImagePaths(source, sharePath, knowledgeBases)
  if (paths) {
    for (const [uploadedPath, preview] of paths) {
      if (
        references.has(uploadedPath) ||
        (preview.finalizedAt !== null && preview.finalizedAt <= saveStartedAt)
      ) {
        paths.delete(uploadedPath)
      }
    }
    if (paths.size === 0) uploadedImages.delete(scope)
  }
  const normalizedSharePath = sharePath.replace(/\\/g, '/')
  for (const [id, grant] of rollbackGrants) {
    if (
      grant.token === token &&
      grant.sharePath === normalizedSharePath &&
      references.has(grant.uploadedPath)
    ) {
      rollbackGrants.delete(id)
    }
  }
}

export function forgetSingleFileShareImagePreview(
  token: string,
  sharePath: string,
  uploadedPath: string,
): void {
  const canonical = canonicalMediaPath(uploadedPath)
  if (!canonical) return
  const scope = uploadScope(token, sharePath)
  const paths = uploadedImages.get(scope)
  paths?.delete(canonical)
  if (paths?.size === 0) uploadedImages.delete(scope)
}

function pruneRollbackGrants(now = Date.now()): void {
  for (const [id, grant] of rollbackGrants) {
    if (grant.expiresAt <= now) rollbackGrants.delete(id)
  }
  while (rollbackGrants.size > rollbackGrantLimit) {
    const oldest = rollbackGrants.keys().next().value
    if (oldest === undefined) break
    rollbackGrants.delete(oldest)
  }
}

export function createShareImageRollbackGrant(
  token: string,
  sharePath: string,
  uploadedPath: string,
  accountedBytes: number,
): string {
  const canonical = canonicalMediaPath(uploadedPath)
  if (!canonical) throw new Error('Invalid uploaded image path')
  const id = randomUUID()
  rollbackGrants.set(id, {
    token,
    sharePath: sharePath.replace(/\\/g, '/'),
    uploadedPath: canonical,
    accountedBytes,
    expiresAt: Date.now() + rollbackGrantLifetimeMs,
  })
  pruneRollbackGrants()
  return id
}

export function consumeShareImageRollbackGrant(
  id: string,
  token: string,
  sharePath: string,
): ShareImageRollbackGrant | null {
  pruneRollbackGrants()
  const grant = rollbackGrants.get(id)
  if (!grant || grant.token !== token || grant.sharePath !== sharePath.replace(/\\/g, '/')) {
    return null
  }
  rollbackGrants.delete(id)
  return grant
}

export function restoreShareImageRollbackGrant(id: string, grant: ShareImageRollbackGrant): void {
  if (grant.expiresAt > Date.now()) rollbackGrants.set(id, grant)
}

export async function isAuthorizedSingleFileShareImage(
  token: string,
  sharePath: string,
  requestedPath: string,
  knowledgeBases: string[],
): Promise<boolean> {
  if (await isReferencedSingleFileShareImage(sharePath, requestedPath, knowledgeBases)) {
    forgetSingleFileShareImagePreview(token, sharePath, requestedPath)
    return true
  }
  return hasSingleFileShareUploadPreview(token, sharePath, requestedPath)
}
