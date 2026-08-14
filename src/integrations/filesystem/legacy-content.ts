import type { ContentInstance, ResourceContentInstance } from '@/lib/domain/content'
import { adaptFileItemResource } from '@/lib/domain/file-item-resource'
import { getMediaTypeFromPath } from '@/lib/media-utils'
import { MediaType, type FileItem } from '@/lib/types'
import type { OpenDisposition, OpenSurface } from '@/src/features/open/open-resource'
import { openResource } from '../open-resource'
import { filesystemLegacyPathForResourceKey, legacyFilesystemResourceKey } from './module'

export type LegacyFilesystemContentRequest = Readonly<{
  id: string
  path: string
  contextPath?: string
  readerKind?: 'pdf' | 'folder' | 'book' | null
  surface: OpenSurface
  disposition: OpenDisposition
}>

export function legacyFilesystemContentInstance(
  request: LegacyFilesystemContentRequest,
): ResourceContentInstance | null {
  if (!request.path) return null
  const type =
    request.readerKind === 'folder'
      ? MediaType.FOLDER
      : request.readerKind === 'book'
        ? MediaType.BOOK
        : request.readerKind === 'pdf'
          ? MediaType.PDF
          : getMediaTypeFromPath(request.path)
  if (type === MediaType.AUDIO || type === MediaType.VIDEO) return null
  const file: FileItem = {
    path: request.path,
    name: request.path.split(/[/\\]/).at(-1) || request.path || 'Files',
    type,
    size: 0,
    extension:
      type === MediaType.FOLDER
        ? ''
        : request.path.toLowerCase().endsWith('.fb2.zip')
          ? 'fb2.zip'
          : (request.path.split('.').at(-1) ?? ''),
    isDirectory: type === MediaType.FOLDER,
  }
  const resource = adaptFileItemResource(file).resource
  const plan = openResource(resource, request.readerKind ? 'read' : 'view', {
    surface: request.surface,
    disposition: request.disposition,
  })
  if (plan.status !== 'ready' || plan.kind !== 'render') return null
  return {
    id: request.id,
    type: 'resource',
    resource: plan.resource,
    renderer: plan.renderer,
    ...(request.contextPath === undefined
      ? {}
      : { context: legacyFilesystemResourceKey(request.contextPath) }),
  }
}

export function legacyFilesystemPathForContent(instance: ContentInstance): string | null {
  return instance.type === 'resource' ? filesystemLegacyPathForResourceKey(instance.resource) : null
}
