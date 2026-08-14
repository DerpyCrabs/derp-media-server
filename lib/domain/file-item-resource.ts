import { getMimeType } from '../media-utils'
import { MediaType, type FileItem } from '../types'
import {
  RESOURCE_CAPABILITY,
  RESOURCE_KIND,
  RESOURCE_PRESENTATION,
  filesystemResourceKey,
  type ResourceKey,
  type ResourceSummary,
} from './resource'

export const LEGACY_FILESYSTEM_ROOT_ID = 'configured-default'

export type FileItemResourceOptions = Readonly<{
  key?: ResourceKey
  rootId?: string
  logicalPath?: string
  kind?: string
  presentation?: string
  mime?: string | null
  capabilities?: readonly string[]
}>

export type AdaptedFileItemResource = Readonly<{
  resource: ResourceSummary
  legacyPath: string
  file: FileItem
}>

function isFolder(file: FileItem): boolean {
  return file.isDirectory || file.type === MediaType.FOLDER
}

function presentationFor(file: FileItem): string {
  if (isFolder(file)) return RESOURCE_PRESENTATION.browse
  switch (file.type) {
    case MediaType.VIDEO:
      return RESOURCE_PRESENTATION.video
    case MediaType.AUDIO:
      return RESOURCE_PRESENTATION.audio
    case MediaType.IMAGE:
      return RESOURCE_PRESENTATION.image
    case MediaType.TEXT:
      return RESOURCE_PRESENTATION.text
    case MediaType.PDF:
      return RESOURCE_PRESENTATION.pdf
    case MediaType.BOOK:
      return RESOURCE_PRESENTATION.book
    default:
      return RESOURCE_PRESENTATION.unsupported
  }
}

function capabilitiesFor(file: FileItem): readonly string[] {
  if (isFolder(file)) return [RESOURCE_CAPABILITY.browse, RESOURCE_CAPABILITY.download]
  if (file.type === MediaType.AUDIO || file.type === MediaType.VIDEO) {
    return [RESOURCE_CAPABILITY.read, RESOURCE_CAPABILITY.stream, RESOURCE_CAPABILITY.download]
  }
  return [RESOURCE_CAPABILITY.read, RESOURCE_CAPABILITY.download]
}

export function adaptFileItemResource(
  file: FileItem,
  options: FileItemResourceOptions = {},
): AdaptedFileItemResource {
  if (options.key && (options.rootId !== undefined || options.logicalPath !== undefined)) {
    throw new Error('Explicit ResourceKey cannot be combined with filesystem address options')
  }
  if (file.isVirtual && !options.key) {
    throw new Error('Virtual FileItem requires an explicit ResourceKey')
  }

  const key =
    options.key ??
    filesystemResourceKey(
      options.rootId ?? LEGACY_FILESYSTEM_ROOT_ID,
      options.logicalPath ?? file.path,
    )
  const folder = isFolder(file)
  const mime = folder
    ? undefined
    : options.mime === null
      ? undefined
      : (options.mime ?? getMimeType(file.extension))
  const resource: ResourceSummary = {
    key,
    name: file.name,
    kind: options.kind ?? (folder ? RESOURCE_KIND.folder : RESOURCE_KIND.file),
    ...(mime === undefined ? {} : { mime }),
    capabilities: [...(options.capabilities ?? capabilitiesFor(file))],
    presentation: options.presentation ?? presentationFor(file),
    size: file.size,
  }

  return { resource, legacyPath: file.path, file }
}
