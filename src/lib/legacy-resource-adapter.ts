import { getMimeType } from '@/lib/media-utils'
import type {
  ProviderOperation,
  ResourceAppearance,
  ResourceKind,
  ResourceOpenTarget,
  ResourcePresentation,
  ResourceSummary,
} from '@/lib/resource'
import { MediaType, type FileItem } from '@/lib/types'
import type { OpenScope } from './open-resource'

export const OWNER_OPEN_SCOPE: OpenScope = Object.freeze({ kind: 'owner', id: 'owner' })

export type LegacyResourceHints = Readonly<{
  kind?: ResourceKind
  presentation?: ResourcePresentation
  mimeType?: string
  providerOperations?: readonly ProviderOperation[]
  appearance?: ResourceAppearance
  openTarget?: ResourceOpenTarget
}>

function normalizedLegacyPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '')
}

function stablePublicId(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

export function grantOpenScope(sharePath: string): OpenScope {
  const publicPath = normalizedLegacyPath(sharePath)
  return { kind: 'grant', id: `legacy-share-${stablePublicId(publicPath)}` }
}

function presentationFor(file: FileItem): ResourcePresentation {
  if (file.isDirectory || file.type === MediaType.FOLDER) return 'browse'
  switch (file.type) {
    case MediaType.VIDEO:
      return 'video'
    case MediaType.AUDIO:
      return 'audio'
    case MediaType.IMAGE:
      return 'image'
    case MediaType.TEXT:
      return 'text'
    case MediaType.PDF:
      return 'pdf'
    case MediaType.BOOK:
      return 'book'
    default:
      return 'unsupported'
  }
}

function operationsFor(presentation: ResourcePresentation): ProviderOperation[] {
  if (presentation === 'browse') return ['browse', 'download']
  if (presentation === 'audio' || presentation === 'video') {
    return ['read', 'stream', 'download']
  }
  return ['read', 'download']
}

export function resourceForFileItem(
  file: FileItem,
  hints: LegacyResourceHints = {},
): ResourceSummary {
  if (file.resource) return file.resource

  const legacyLocator = file.path.replace(/\\/g, '/')
  const normalizedPath = normalizedLegacyPath(legacyLocator)
  const presentation = hints.presentation ?? presentationFor(file)
  const kind =
    hints.kind ?? (file.isDirectory ? (file.isVirtual ? 'collection' : 'folder') : 'file')

  return {
    ref: {
      libraryId: 'legacy-library',
      resourceId: `legacy-path-${encodeURIComponent(normalizedPath)}`,
    },
    locator: {
      sourceId: 'legacy-source',
      providerLocator: legacyLocator,
    },
    legacyLocator,
    name: file.name,
    kind,
    presentation,
    ...(presentation === 'browse'
      ? {}
      : { mimeType: hints.mimeType ?? getMimeType(file.extension) }),
    size: file.size,
    providerOperations: [...(hints.providerOperations ?? operationsFor(presentation))],
    availability: 'present',
    ...(hints.appearance ? { appearance: hints.appearance } : {}),
    ...(hints.openTarget ? { openTarget: hints.openTarget } : {}),
  }
}
