import { getMediaType, getMimeType } from '@/lib/media-utils'
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

export type LegacyFileItemHints = Readonly<{
  displayName?: string
  isDirectory?: boolean
  isVirtual?: boolean
  resource?: ResourceSummary
}>

function normalizedLegacyPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/+|\/+$/g, '')
}

function stableGrantId(value: string): string {
  const hashes = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    for (let lane = 0; lane < hashes.length; lane += 1) {
      hashes[lane] ^= code + lane * 0x9e37
      hashes[lane] = Math.imul(hashes[lane], 0x01000193 + lane * 2)
      hashes[lane] ^= hashes[lane] >>> (13 + lane)
    }
  }
  return hashes.map((hash) => (hash >>> 0).toString(16).padStart(8, '0')).join('')
}

export function grantOpenScope(grantToken: string): OpenScope {
  return { kind: 'grant', id: `grant-${stableGrantId(grantToken)}` }
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

/** Compatibility seam for path-only persisted state and legacy responses. */
export function legacyFileItemFromPath(path: string, hints: LegacyFileItemHints = {}): FileItem {
  const name = hints.displayName ?? path.split(/[/\\]/).filter(Boolean).pop() ?? 'file'
  const isDirectory = hints.isDirectory ?? false
  const extension = isDirectory
    ? ''
    : name.includes('.')
      ? (name.split('.').pop()?.toLowerCase() ?? '')
      : ''
  return {
    path,
    name,
    isDirectory,
    isVirtual: hints.isVirtual ?? false,
    size: hints.resource?.size ?? 0,
    type: isDirectory ? MediaType.FOLDER : getMediaType(extension),
    extension,
    ...(hints.resource ? { resource: hints.resource } : {}),
  }
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
