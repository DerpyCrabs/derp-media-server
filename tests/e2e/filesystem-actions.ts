import type { APIRequestContext, APIResponse } from '@playwright/test'
import { filesystemResourceKey } from '../../lib/domain/resource'

const DEFAULT_ROOT_ID = 'configured-default'

function actionUrl(origin = '') {
  return `${origin}/api/integrations/filesystem/actions`
}

export function filesystemAction(
  request: APIRequestContext,
  path: string,
  action: string,
  input: Record<string, unknown> = {},
  origin = '',
): Promise<APIResponse> {
  return request.post(actionUrl(origin), {
    data: {
      key: filesystemResourceKey(DEFAULT_ROOT_ID, path),
      action: action.startsWith('filesystem.') ? action : `filesystem.${action}`,
      ...(typeof input.name === 'string' ? { name: input.name } : {}),
      metadata: input,
    },
  })
}

export function createFilesystemFile(
  request: APIRequestContext,
  path: string,
  content = '',
  origin = '',
) {
  const segments = path.replace(/\\/g, '/').split('/').filter(Boolean)
  const name = segments.pop()
  if (!name) throw new Error('File name is required')
  return filesystemAction(request, segments.join('/'), 'createFile', { name, content }, origin)
}

export function editFilesystemFile(
  request: APIRequestContext,
  path: string,
  content: string,
  origin = '',
) {
  return filesystemAction(request, path, 'edit', { content }, origin)
}

export function deleteFilesystemResource(request: APIRequestContext, path: string, origin = '') {
  return filesystemAction(request, path, 'delete', {}, origin)
}

export function browseFilesystem(request: APIRequestContext, path: string, origin = '') {
  const key = filesystemResourceKey(DEFAULT_ROOT_ID, path)
  return request.get(
    `${origin}/api/integrations/filesystem/browse?${new URLSearchParams({ id: key.id })}`,
  )
}
