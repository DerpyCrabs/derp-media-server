import { describe, expect, test } from 'bun:test'
import { currentContentWindowPersistence } from '@/src/integrations/current-window-content'
import { filesystemResourceKey } from '@/lib/domain/resource'
import {
  normalizePersistedWorkspaceState as normalizePersistedWorkspaceStateWithPersistence,
  resolveNewTabAnchorWindowId,
  serializeWorkspacePersistedState as serializeWorkspacePersistedStateWithPersistence,
  type NormalizePersistedWorkspaceOptions,
  type PersistedWorkspaceState,
  type WorkspaceWindowDefinition,
} from '@/lib/use-workspace'

const serializeWorkspacePersistedState = (state: PersistedWorkspaceState) =>
  serializeWorkspacePersistedStateWithPersistence(state, currentContentWindowPersistence)
const normalizePersistedWorkspaceState = (
  value: unknown,
  options?: NormalizePersistedWorkspaceOptions,
) =>
  normalizePersistedWorkspaceStateWithPersistence(value, currentContentWindowPersistence, options)

function explorerWindow(
  id: string,
  extra: Partial<WorkspaceWindowDefinition> = {},
): WorkspaceWindowDefinition {
  return {
    id,
    title: id,
    contentInstance: {
      id,
      type: 'explorer',
      location: filesystemResourceKey('configured-default', ''),
    },
    tabGroupId: null,
    layout: {},
    ...extra,
  }
}

function viewerWindow(id: string): WorkspaceWindowDefinition {
  return {
    id,
    title: id,
    contentInstance: {
      id,
      type: 'resource',
      resource: filesystemResourceKey('configured-default', 'x.mp4'),
      renderer: 'video-player',
    },
    tabGroupId: null,
    layout: {},
  }
}

function minimalState(windows: PersistedWorkspaceState['windows']): PersistedWorkspaceState {
  return {
    windows,
    activeWindowId: windows[0]?.id ?? null,
    activeTabMap: {},
    nextWindowId: 10,
    pinnedTaskbarItems: [],
  }
}

function currentPersistedState(value: PersistedWorkspaceState): unknown {
  return JSON.parse(serializeWorkspacePersistedState(value))
}

describe('resolveNewTabAnchorWindowId', () => {
  test('falls back to browser id when no target', () => {
    const state = minimalState([explorerWindow('workspace-window-1')])
    expect(resolveNewTabAnchorWindowId(state, 'workspace-window-1')).toBe('workspace-window-1')
  })

  test('uses fileOpenTargetWindowId when present and valid', () => {
    const state = minimalState([
      explorerWindow('workspace-window-1', {
        fileOpenTargetWindowId: 'workspace-window-2',
      }),
      viewerWindow('workspace-window-2'),
    ])
    expect(resolveNewTabAnchorWindowId(state, 'workspace-window-1')).toBe('workspace-window-2')
  })

  test('falls back when target id missing', () => {
    const state = minimalState([
      explorerWindow('workspace-window-1', { fileOpenTargetWindowId: 'missing' }),
    ])
    expect(resolveNewTabAnchorWindowId(state, 'workspace-window-1')).toBe('workspace-window-1')
  })
})

describe('normalizePersistedWorkspaceState fileOpenTargetWindowId', () => {
  test('strips target equal to browser id', () => {
    const state = minimalState([
      explorerWindow('workspace-window-1', {
        layout: { bounds: { x: 0, y: 0, width: 400, height: 300 } },
        fileOpenTargetWindowId: 'workspace-window-1',
      }),
    ])
    const normalized = normalizePersistedWorkspaceState(currentPersistedState(state), {
      reconcileSnapZones: false,
    })
    expect(normalized?.windows[0]?.fileOpenTargetWindowId).toBeUndefined()
  })

  test('strips target when referenced window missing', () => {
    const state = minimalState([
      explorerWindow('workspace-window-1', {
        layout: { bounds: { x: 0, y: 0, width: 400, height: 300 } },
        fileOpenTargetWindowId: 'nope',
      }),
    ])
    const normalized = normalizePersistedWorkspaceState(currentPersistedState(state), {
      reconcileSnapZones: false,
    })
    expect(normalized?.windows[0]?.fileOpenTargetWindowId).toBeUndefined()
  })
})
