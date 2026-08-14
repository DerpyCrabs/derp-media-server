import { filesystemResourceKey } from '@/lib/domain/resource'
import type { ContentInstance } from '@/lib/domain/content'
import type { WorkspaceWindowDefinition } from '@/lib/use-workspace'

type WindowInput = Omit<WorkspaceWindowDefinition, 'title' | 'contentInstance'> &
  Readonly<{
    title?: string
    contentKind?: 'explorer' | 'resource' | 'integration'
    path?: string
    renderer?: string
  }>

export function workspaceWindow(input: WindowInput): WorkspaceWindowDefinition {
  const {
    id,
    title = id,
    contentKind = 'explorer',
    path = '',
    renderer = 'filesystem.text',
    ...window
  } = input
  return {
    ...window,
    id,
    title,
    contentInstance: workspaceContent(id, contentKind, path, renderer),
  }
}

export function workspaceContent(
  id: string,
  kind: 'explorer' | 'resource' | 'integration' = 'explorer',
  path = '',
  renderer = 'filesystem.text',
): ContentInstance {
  if (kind === 'explorer') {
    return { id, type: 'explorer', location: filesystemResourceKey('configured-default', path) }
  }
  if (kind === 'resource') {
    return {
      id,
      type: 'resource',
      resource: filesystemResourceKey('configured-default', path || `${id}.txt`),
      renderer,
    }
  }
  return { id, type: 'integration', integration: 'fixture', view: 'test', state: null }
}
