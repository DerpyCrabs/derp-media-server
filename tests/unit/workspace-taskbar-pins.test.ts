import { describe, expect, test } from 'bun:test'
import {
  FILESYSTEM_APPLICATION_COLLECTION_ROOT_ID,
  filesystemResourceKey,
} from '@/lib/domain/resource'
import {
  parseWorkspaceTaskbarPins,
  serializeWorkspaceTaskbarPins,
  workspaceTaskbarPinPath,
  type WorkspaceTaskbarPin,
} from '@/lib/workspace-taskbar-pins'
import { hermesResourceKey } from '@/src/integrations/hermes/module'

const validFilesystem: WorkspaceTaskbarPin = {
  id: '1',
  resource: filesystemResourceKey('media', 'Docs'),
  title: 'Docs',
}

describe('workspace taskbar pins', () => {
  test('accepts canonical ResourceKey pins and derives filesystem presentation path', () => {
    expect(parseWorkspaceTaskbarPins([validFilesystem])).toEqual([validFilesystem])
    expect(workspaceTaskbarPinPath(validFilesystem)).toBe('Docs')
    expect(serializeWorkspaceTaskbarPins([validFilesystem])).toEqual([validFilesystem])
  })

  test('accepts opaque provider resources without fabricated paths', () => {
    const pin: WorkspaceTaskbarPin = {
      id: 'session',
      resource: hermesResourceKey('session', 'session-1'),
      title: 'Session one',
    }
    expect(parseWorkspaceTaskbarPins([pin])).toEqual([pin])
    expect(workspaceTaskbarPinPath(pin)).toBeNull()
    expect(JSON.stringify(serializeWorkspaceTaskbarPins([pin]))).not.toContain('/session/')
  })

  test('does not expose application collections as physical pin paths', () => {
    const pin: WorkspaceTaskbarPin = {
      id: 'favorites',
      resource: filesystemResourceKey(FILESYSTEM_APPLICATION_COLLECTION_ROOT_ID, 'favorites'),
      title: 'Favorites',
    }

    expect(workspaceTaskbarPinPath(pin)).toBeNull()
    expect(serializeWorkspaceTaskbarPins([pin])).toEqual([pin])
  })

  test('rejects absent, path-based, and malformed identities', () => {
    expect(parseWorkspaceTaskbarPins(null)).toEqual([])
    expect(
      parseWorkspaceTaskbarPins([
        { id: 'path', path: 'Docs', title: 'Docs' },
        { id: 'missing', title: 'Docs' },
        {
          id: 'bad-resource',
          resource: { provider: '', id: 'opaque' },
          title: 'Bad',
        },
      ]),
    ).toEqual([])
  })
})
