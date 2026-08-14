import type { ContentInstance, ResourceContentInstance } from '@/lib/domain/content'
import type { OpenDisposition, OpenSurface } from '@/src/features/open/open-resource'
import { openResource } from '../open-resource'
import { inspectIntegrationResource } from '../http-client'
import { filesystemPathForResourceKey, filesystemResourceKeyForPath } from './resource'

export type FilesystemContentRequest = Readonly<{
  id: string
  path: string
  contextPath?: string
  readerKind?: 'pdf' | 'folder' | 'book' | null
  surface: OpenSurface
  disposition: OpenDisposition
}>

export async function filesystemContentInstance(
  request: FilesystemContentRequest,
): Promise<ResourceContentInstance | null> {
  if (!request.path) return null
  const resource = await inspectIntegrationResource(filesystemResourceKeyForPath(request.path))
  const plan = openResource(resource, request.readerKind ? 'read' : 'view', {
    surface: request.surface,
    disposition: request.disposition,
  })
  if (plan.status !== 'ready' || plan.kind !== 'render') return null
  return {
    id: request.id,
    type: 'resource',
    resource: plan.summary.key,
    renderer: plan.renderer,
    ...(request.contextPath === undefined
      ? {}
      : { context: filesystemResourceKeyForPath(request.contextPath) }),
  }
}

export function filesystemPathForContent(instance: ContentInstance): string | null {
  return instance.type === 'resource' ? filesystemPathForResourceKey(instance.resource) : null
}
