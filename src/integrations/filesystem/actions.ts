import { runIntegrationAction } from '../http-client'
import { filesystemResourceKeyForPath } from './resource'

export async function runFilesystemActionByPath(
  path: string,
  action: string,
  input?: unknown,
  signal?: AbortSignal,
) {
  const outcome = await runIntegrationAction(
    filesystemResourceKeyForPath(path),
    action.startsWith('filesystem.') ? action : `filesystem.${action}`,
    input,
    signal,
  )
  if (!outcome.success) throw new Error(`Filesystem action failed: ${action}`)
  return outcome
}

export function createFilesystemFile(
  path: string,
  input: Readonly<{ content?: string; base64Content?: string }>,
  signal?: AbortSignal,
) {
  const segments = path.replace(/\\/g, '/').split('/').filter(Boolean)
  const name = segments.pop()
  if (!name) throw new Error('File name is required')
  return runFilesystemActionByPath(segments.join('/'), 'createFile', { name, ...input }, signal)
}

export function editFilesystemFile(
  path: string,
  input: Readonly<{
    content?: string
    base64Content?: string
    expectedVersion?: number
  }>,
  signal?: AbortSignal,
) {
  return runFilesystemActionByPath(path, 'edit', input, signal)
}

export function deleteFilesystemResource(path: string, signal?: AbortSignal) {
  return runFilesystemActionByPath(path, 'delete', undefined, signal)
}
