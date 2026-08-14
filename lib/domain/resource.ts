export const RESOURCE_CAPABILITY = {
  browse: 'browse',
  search: 'search',
  create: 'create',
  upload: 'upload',
  paste: 'paste',
  read: 'read',
  stream: 'stream',
  edit: 'edit',
  rename: 'rename',
  move: 'move',
  copy: 'copy',
  delete: 'delete',
  download: 'download',
} as const

export const RESOURCE_KIND = {
  root: 'root',
  folder: 'folder',
  collection: 'collection',
  file: 'file',
} as const

export const RESOURCE_PRESENTATION = {
  browse: 'browse',
  video: 'video',
  audio: 'audio',
  image: 'image',
  text: 'text',
  pdf: 'pdf',
  book: 'book',
  unsupported: 'unsupported',
} as const

export const FILESYSTEM_PROVIDER = 'filesystem'

export type ResourceCapability = string
export type ResourceKind = string
export type ResourcePresentation = string

export type ResourceKey = Readonly<{
  provider: string
  id: string
}>

export type ResourceSummary = Readonly<{
  key: ResourceKey
  name: string
  kind: ResourceKind
  mime?: string
  capabilities: readonly ResourceCapability[]
  presentation?: ResourcePresentation
  size?: number
}>

export type ResourcePage = Readonly<{
  schemaVersion: 1
  location: ResourceKey
  items: readonly ResourceSummary[]
  nextCursor?: string
  total: number
}>

export type ResourceErrorCode =
  | 'badRequest'
  | 'notFound'
  | 'unavailable'
  | 'unsupported'
  | 'internal'

export type ResourceError = Readonly<{
  schemaVersion: 1
  code: ResourceErrorCode
  message: string
  resource?: ResourceKey
  retryable?: boolean
}>

export type FilesystemResourceAddress = Readonly<{
  rootId: string
  path: string
}>

const FILESYSTEM_KEY_PREFIX = 'v1:'
const resourceErrorCodes = new Set<ResourceErrorCode>([
  'badRequest',
  'notFound',
  'unavailable',
  'unsupported',
  'internal',
])

function requireIdentifier(value: string, label: string): string {
  if (!value.trim()) throw new Error(`${label} must not be empty`)
  if (value.includes('\0')) throw new Error(`${label} must not contain NUL`)
  return value
}

export function resourceKey(provider: string, id: string): ResourceKey {
  return {
    provider: requireIdentifier(provider, 'Resource provider'),
    id: requireIdentifier(id, 'Resource id'),
  }
}

export function normalizeLogicalResourcePath(path: string): string {
  if (path.includes('\0')) throw new Error('Logical resource path must not contain NUL')
  const parts: string[] = []
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue
    if (part === '..') throw new Error('Logical resource path must not contain ..')
    parts.push(part)
  }
  return parts.join('/')
}

export function filesystemResourceKey(rootId: string, path: string): ResourceKey {
  const root = requireIdentifier(rootId, 'Filesystem root id')
  const normalizedPath = normalizeLogicalResourcePath(path)
  return resourceKey(
    FILESYSTEM_PROVIDER,
    `${FILESYSTEM_KEY_PREFIX}${root.length}:${root}${normalizedPath}`,
  )
}

export function filesystemResourceAddress(key: ResourceKey): FilesystemResourceAddress | null {
  if (key.provider !== FILESYSTEM_PROVIDER || !key.id.startsWith(FILESYSTEM_KEY_PREFIX)) return null
  const encoded = key.id.slice(FILESYSTEM_KEY_PREFIX.length)
  const separator = encoded.indexOf(':')
  if (separator <= 0) return null
  const rootLengthText = encoded.slice(0, separator)
  if (!/^\d+$/.test(rootLengthText)) return null
  const rootLength = Number(rootLengthText)
  const value = encoded.slice(separator + 1)
  if (!Number.isSafeInteger(rootLength) || rootLength <= 0 || rootLength > value.length) return null
  const rootId = value.slice(0, rootLength)
  const path = value.slice(rootLength)
  try {
    requireIdentifier(rootId, 'Filesystem root id')
    if (normalizeLogicalResourcePath(path) !== path) return null
  } catch {
    return null
  }
  return { rootId, path }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function isResourceKey(value: unknown): value is ResourceKey {
  const key = record(value)
  return !!(
    key &&
    typeof key.provider === 'string' &&
    key.provider.trim() &&
    !key.provider.includes('\0') &&
    typeof key.id === 'string' &&
    key.id.trim() &&
    !key.id.includes('\0')
  )
}

export function isResourceSummary(value: unknown): value is ResourceSummary {
  const summary = record(value)
  return !!(
    summary &&
    isResourceKey(summary.key) &&
    typeof summary.name === 'string' &&
    typeof summary.kind === 'string' &&
    summary.kind.length > 0 &&
    (summary.mime === undefined || typeof summary.mime === 'string') &&
    Array.isArray(summary.capabilities) &&
    summary.capabilities.every((capability) => typeof capability === 'string') &&
    (summary.presentation === undefined || typeof summary.presentation === 'string') &&
    (summary.size === undefined ||
      (typeof summary.size === 'number' && Number.isFinite(summary.size) && summary.size >= 0))
  )
}

export function isResourcePage(value: unknown): value is ResourcePage {
  const page = record(value)
  return !!(
    page &&
    page.schemaVersion === 1 &&
    isResourceKey(page.location) &&
    Array.isArray(page.items) &&
    page.items.every(isResourceSummary) &&
    (page.nextCursor === undefined || typeof page.nextCursor === 'string') &&
    typeof page.total === 'number' &&
    Number.isSafeInteger(page.total) &&
    page.total >= 0
  )
}

export function isResourceError(value: unknown): value is ResourceError {
  const error = record(value)
  return !!(
    error &&
    error.schemaVersion === 1 &&
    resourceErrorCodes.has(error.code as ResourceErrorCode) &&
    typeof error.message === 'string' &&
    (error.resource === undefined || isResourceKey(error.resource)) &&
    (error.retryable === undefined || typeof error.retryable === 'boolean')
  )
}
