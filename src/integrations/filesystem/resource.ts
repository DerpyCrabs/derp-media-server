import {
  FILESYSTEM_PROVIDER,
  DEFAULT_FILESYSTEM_ROOT_ID,
  RESOURCE_CAPABILITY,
  RESOURCE_KIND,
  RESOURCE_PRESENTATION,
  filesystemResourceAddress,
  filesystemResourceKey,
  type ResourceKey,
  type ResourceSummary,
} from '@/lib/domain/resource'
import { MediaType } from '@/lib/types'

export { DEFAULT_FILESYSTEM_ROOT_ID }

export function filesystemResourceKeyForPath(path: string, rootId = DEFAULT_FILESYSTEM_ROOT_ID) {
  return filesystemResourceKey(rootId, path)
}

export function filesystemPathForResourceKey(key: ResourceKey): string | null {
  return filesystemResourceAddress(key)?.path ?? null
}

export function filesystemResourceIsDirectory(resource: ResourceSummary): boolean {
  return (
    resource.key.provider === FILESYSTEM_PROVIDER &&
    (resource.kind === RESOURCE_KIND.folder ||
      resource.kind === RESOURCE_KIND.root ||
      resource.kind === RESOURCE_KIND.collection ||
      resource.capabilities.includes(RESOURCE_CAPABILITY.browse) ||
      resource.presentation === RESOURCE_PRESENTATION.browse)
  )
}

export function filesystemResourceMediaType(resource: ResourceSummary): MediaType {
  if (resource.key.provider !== FILESYSTEM_PROVIDER) return MediaType.OTHER
  if (filesystemResourceIsDirectory(resource)) return MediaType.FOLDER
  switch (resource.presentation) {
    case RESOURCE_PRESENTATION.video:
      return MediaType.VIDEO
    case RESOURCE_PRESENTATION.audio:
      return MediaType.AUDIO
    case RESOURCE_PRESENTATION.image:
      return MediaType.IMAGE
    case RESOURCE_PRESENTATION.text:
      return MediaType.TEXT
    case RESOURCE_PRESENTATION.pdf:
      return MediaType.PDF
    case RESOURCE_PRESENTATION.book:
      return MediaType.BOOK
    default:
      break
  }
  return MediaType.OTHER
}

export function filesystemResourceExtension(resource: ResourceSummary): string {
  const metadataExtension = resource.metadata?.extension
  if (typeof metadataExtension === 'string') return metadataExtension
  return resource.name.includes('.') ? (resource.name.split('.').at(-1) ?? '') : ''
}
