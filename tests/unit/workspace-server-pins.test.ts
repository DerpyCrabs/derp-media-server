import { describe, expect, test } from 'bun:test'
import { filesystemResourceKey } from '@/lib/domain/resource'
import type { PersistedWorkspaceState } from '@/lib/use-workspace'
import { withAuthoritativeServerPins } from '@/src/workspace/workspace-page/use-workspace-page-server-data'

describe('authoritative workspace pins', () => {
  test('empty server pins remove stale local pins instead of resurrecting them', () => {
    const workspace: PersistedWorkspaceState = {
      windows: [],
      activeWindowId: null,
      activeTabMap: {},
      nextWindowId: 1,
      pinnedTaskbarItems: [
        {
          id: 'stale',
          resource: filesystemResourceKey('configured-default', 'Documents'),
          title: 'Documents',
          customIconName: null,
        },
      ],
    }

    expect(withAuthoritativeServerPins(workspace, []).pinnedTaskbarItems).toEqual([])
    expect(workspace.pinnedTaskbarItems).toHaveLength(1)
  })
})
