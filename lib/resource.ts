export type LibraryId = string
export type SourceId = string
export type ResourceId = string
export type ResourceVersion = string
export type PageCursor = string

export type ResourceRef = {
  libraryId: LibraryId
  resourceId: ResourceId
}

export type PersistedResourceTarget = {
  ref: ResourceRef
  legacyLocator: string
}

export type ResourceLocator = {
  sourceId: SourceId
  providerLocator: string
}

export type ResourceKind =
  | 'library'
  | 'source'
  | 'folder'
  | 'collection'
  | 'file'
  | 'conversation'
  | 'conversationProject'
  | 'draft'

export type ResourcePresentation =
  | 'browse'
  | 'video'
  | 'audio'
  | 'image'
  | 'text'
  | 'pdf'
  | 'book'
  | 'conversation'
  | 'unsupported'

export type ViewerId =
  | 'audio-player'
  | 'video-player'
  | 'image-viewer'
  | 'text-viewer'
  | 'pdf-reader'
  | 'book-reader'
  | 'folder-reader'
  | 'conversation'
  | 'unsupported-file'

export type ProviderOperation = 'browse' | 'read' | 'stream' | 'download' | 'export'
export type ResourceAvailability = 'present' | 'missing' | 'sourceUnavailable'

export type ResourceAppearance = {
  icon: string
  tone: string
  color?: string
}

export type ResourcePreview = {
  kind: 'thumbnail'
  available: boolean
}

export type ResourceOpenTarget =
  | { type: 'hermesSession'; sessionId: string; readOnly: boolean }
  | { type: 'hermesDraft'; projectPath?: string; readOnly: boolean }

export type ResourceSummary = {
  ref: ResourceRef
  locator: ResourceLocator
  legacyLocator?: string
  version?: ResourceVersion
  name: string
  kind: ResourceKind
  presentation: ResourcePresentation
  mimeType?: string
  size?: number
  preview?: ResourcePreview
  providerOperations: ProviderOperation[]
  availability: ResourceAvailability
  appearance?: ResourceAppearance
  openTarget?: ResourceOpenTarget
}

export type ResourcePage = {
  schemaVersion: 1
  parent: ResourceSummary
  items: ResourceSummary[]
  nextCursor?: PageCursor
  total: number
}

export type ResourceDetail = {
  schemaVersion: 1
  summary: ResourceSummary
}

export type CatalogErrorCode =
  | 'invalidRequest'
  | 'forbidden'
  | 'resourceNotFound'
  | 'resourceMissing'
  | 'sourceUnavailable'
  | 'unsupported'
  | 'internal'

export type CatalogError = {
  code: CatalogErrorCode
  message: string
}

const catalogErrorCodes = new Set<CatalogErrorCode>([
  'invalidRequest',
  'forbidden',
  'resourceNotFound',
  'resourceMissing',
  'sourceUnavailable',
  'unsupported',
  'internal',
])

const resourceKinds = new Set<ResourceKind>([
  'library',
  'source',
  'folder',
  'collection',
  'file',
  'conversation',
  'conversationProject',
  'draft',
])
const presentations = new Set<ResourcePresentation>([
  'browse',
  'video',
  'audio',
  'image',
  'text',
  'pdf',
  'book',
  'conversation',
  'unsupported',
])
const operations = new Set<ProviderOperation>(['browse', 'read', 'stream', 'download', 'export'])
const availabilities = new Set<ResourceAvailability>(['present', 'missing', 'sourceUnavailable'])
const viewerIds = new Set<ViewerId>([
  'audio-player',
  'video-player',
  'image-viewer',
  'text-viewer',
  'pdf-reader',
  'book-reader',
  'folder-reader',
  'conversation',
  'unsupported-file',
])

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function persistedResourceTarget(
  resource: ResourceSummary | null | undefined,
): PersistedResourceTarget | undefined {
  if (!resource?.legacyLocator) return undefined
  return {
    ref: { ...resource.ref },
    legacyLocator: resource.legacyLocator,
  }
}

export function isPersistedResourceTarget(value: unknown): value is PersistedResourceTarget {
  const target = record(value)
  const reference = record(target?.ref)
  return !!(
    target &&
    reference &&
    typeof reference.libraryId === 'string' &&
    reference.libraryId.length > 0 &&
    typeof reference.resourceId === 'string' &&
    reference.resourceId.length > 0 &&
    typeof target.legacyLocator === 'string' &&
    target.legacyLocator.length > 0
  )
}

export function isResourceSummary(value: unknown): value is ResourceSummary {
  const summary = record(value)
  const reference = record(summary?.ref)
  const locator = record(summary?.locator)
  const appearance = summary?.appearance === undefined ? undefined : record(summary.appearance)
  const preview = summary?.preview === undefined ? undefined : record(summary.preview)
  const openTarget = summary?.openTarget === undefined ? undefined : record(summary.openTarget)
  const validOpenTarget =
    openTarget === undefined ||
    (openTarget !== null &&
      ((openTarget.type === 'hermesSession' &&
        typeof openTarget.sessionId === 'string' &&
        typeof openTarget.readOnly === 'boolean') ||
        (openTarget.type === 'hermesDraft' &&
          (openTarget.projectPath === undefined || typeof openTarget.projectPath === 'string') &&
          typeof openTarget.readOnly === 'boolean')))
  return !!(
    summary &&
    reference &&
    typeof reference.libraryId === 'string' &&
    typeof reference.resourceId === 'string' &&
    locator &&
    typeof locator.sourceId === 'string' &&
    typeof locator.providerLocator === 'string' &&
    (summary.legacyLocator === undefined || typeof summary.legacyLocator === 'string') &&
    (summary.version === undefined || typeof summary.version === 'string') &&
    typeof summary.name === 'string' &&
    resourceKinds.has(summary.kind as ResourceKind) &&
    presentations.has(summary.presentation as ResourcePresentation) &&
    Array.isArray(summary.providerOperations) &&
    summary.providerOperations.every((item) => operations.has(item as ProviderOperation)) &&
    availabilities.has(summary.availability as ResourceAvailability) &&
    (summary.mimeType === undefined || typeof summary.mimeType === 'string') &&
    (summary.size === undefined ||
      (typeof summary.size === 'number' && Number.isFinite(summary.size) && summary.size >= 0)) &&
    (preview === undefined ||
      (preview !== null &&
        preview.kind === 'thumbnail' &&
        typeof preview.available === 'boolean')) &&
    (appearance === undefined ||
      (appearance !== null &&
        typeof appearance.icon === 'string' &&
        typeof appearance.tone === 'string' &&
        (appearance.color === undefined || typeof appearance.color === 'string'))) &&
    validOpenTarget
  )
}

export function isResourcePage(value: unknown): value is ResourcePage {
  const page = record(value)
  return !!(
    page &&
    page.schemaVersion === 1 &&
    isResourceSummary(page.parent) &&
    Array.isArray(page.items) &&
    page.items.every(isResourceSummary) &&
    typeof page.total === 'number'
  )
}

export function isCatalogError(value: unknown): value is CatalogError {
  const error = record(value)
  return !!(
    error &&
    catalogErrorCodes.has(error.code as CatalogErrorCode) &&
    typeof error.message === 'string'
  )
}

export function isViewerId(value: unknown): value is ViewerId {
  return typeof value === 'string' && viewerIds.has(value as ViewerId)
}
