export type LibraryId = string
export type SourceId = string
export type ResourceId = string
export type ResourceVersion = string
export type PageCursor = string

export type ResourceRef = {
  libraryId: LibraryId
  resourceId: ResourceId
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

export type ProviderOperation = 'browse' | 'read' | 'stream' | 'download' | 'export'
export type ResourceAvailability = 'present' | 'missing' | 'sourceUnavailable'

export type ResourceAppearance = {
  icon: string
  tone: string
  color?: string
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

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function isResourceSummary(value: unknown): value is ResourceSummary {
  const summary = record(value)
  const reference = record(summary?.ref)
  const locator = record(summary?.locator)
  return !!(
    summary &&
    reference &&
    typeof reference.libraryId === 'string' &&
    typeof reference.resourceId === 'string' &&
    locator &&
    typeof locator.sourceId === 'string' &&
    typeof locator.providerLocator === 'string' &&
    typeof summary.name === 'string' &&
    resourceKinds.has(summary.kind as ResourceKind) &&
    presentations.has(summary.presentation as ResourcePresentation) &&
    Array.isArray(summary.providerOperations) &&
    summary.providerOperations.every((item) => operations.has(item as ProviderOperation)) &&
    availabilities.has(summary.availability as ResourceAvailability)
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
