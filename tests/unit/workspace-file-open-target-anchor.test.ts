import { describe, expect, test } from 'bun:test'
import { MediaType } from '@/lib/types'
import {
  normalizePersistedWorkspaceState,
  resolveNewTabAnchorWindowId,
  type PersistedWorkspaceState,
} from '@/lib/use-workspace'
import { DEFAULT_WORKSPACE_SOURCE } from '@/src/workspace/workspace-page-persistence'

function minimalState(windows: PersistedWorkspaceState['windows']): PersistedWorkspaceState {
  return {
    windows,
    activeWindowId: windows[0]?.id ?? null,
    activeTabMap: {},
    nextWindowId: 10,
    pinnedTaskbarItems: [],
  }
}

describe('resolveNewTabAnchorWindowId', () => {
  test('falls back to browser id when no target', () => {
    const state = minimalState([
      {
        id: 'workspace-window-1',
        type: 'browser',
        title: 'A',
        iconName: null,
        iconPath: '',
        iconType: MediaType.FOLDER,
        iconIsVirtual: false,
        source: DEFAULT_WORKSPACE_SOURCE,
        initialState: {},
        tabGroupId: null,
        layout: {},
      },
    ])
    expect(resolveNewTabAnchorWindowId(state, 'workspace-window-1')).toBe('workspace-window-1')
  })

  test('uses fileOpenTargetWindowId when present and valid', () => {
    const state = minimalState([
      {
        id: 'workspace-window-1',
        type: 'browser',
        title: 'A',
        iconName: null,
        iconPath: '',
        iconType: MediaType.FOLDER,
        iconIsVirtual: false,
        source: DEFAULT_WORKSPACE_SOURCE,
        initialState: {},
        tabGroupId: null,
        layout: {},
        fileOpenTargetWindowId: 'workspace-window-2',
      },
      {
        id: 'workspace-window-2',
        type: 'viewer',
        title: 'V',
        iconName: null,
        iconPath: '/x',
        iconType: MediaType.VIDEO,
        iconIsVirtual: false,
        source: DEFAULT_WORKSPACE_SOURCE,
        initialState: { viewing: '/x' },
        tabGroupId: null,
        layout: {},
      },
    ])
    expect(resolveNewTabAnchorWindowId(state, 'workspace-window-1')).toBe('workspace-window-2')
  })

  test('falls back when target id missing', () => {
    const state = minimalState([
      {
        id: 'workspace-window-1',
        type: 'browser',
        title: 'A',
        iconName: null,
        iconPath: '',
        iconType: MediaType.FOLDER,
        iconIsVirtual: false,
        source: DEFAULT_WORKSPACE_SOURCE,
        initialState: {},
        tabGroupId: null,
        layout: {},
        fileOpenTargetWindowId: 'missing',
      },
    ])
    expect(resolveNewTabAnchorWindowId(state, 'workspace-window-1')).toBe('workspace-window-1')
  })
})

describe('normalizePersistedWorkspaceState fileOpenTargetWindowId', () => {
  test('strips target equal to browser id', () => {
    const raw = {
      windows: [
        {
          id: 'workspace-window-1',
          type: 'browser',
          title: 'A',
          iconName: null,
          iconPath: '',
          iconType: MediaType.FOLDER,
          iconIsVirtual: false,
          source: DEFAULT_WORKSPACE_SOURCE,
          initialState: {},
          tabGroupId: null,
          layout: { bounds: { x: 0, y: 0, width: 400, height: 300 } },
          fileOpenTargetWindowId: 'workspace-window-1',
        },
      ],
      activeWindowId: 'workspace-window-1',
      activeTabMap: {},
      nextWindowId: 2,
      pinnedTaskbarItems: [],
    }
    const n = normalizePersistedWorkspaceState(raw, { reconcileSnapZones: false })
    expect(n?.windows[0]?.fileOpenTargetWindowId).toBeUndefined()
  })

  test('strips target when referenced window missing', () => {
    const raw = {
      windows: [
        {
          id: 'workspace-window-1',
          type: 'browser',
          title: 'A',
          iconName: null,
          iconPath: '',
          iconType: MediaType.FOLDER,
          iconIsVirtual: false,
          source: DEFAULT_WORKSPACE_SOURCE,
          initialState: {},
          tabGroupId: null,
          layout: { bounds: { x: 0, y: 0, width: 400, height: 300 } },
          fileOpenTargetWindowId: 'nope',
        },
      ],
      activeWindowId: 'workspace-window-1',
      activeTabMap: {},
      nextWindowId: 2,
      pinnedTaskbarItems: [],
    }
    const n = normalizePersistedWorkspaceState(raw, { reconcileSnapZones: false })
    expect(n?.windows[0]?.fileOpenTargetWindowId).toBeUndefined()
  })
})
