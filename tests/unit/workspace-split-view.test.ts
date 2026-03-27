import { describe, expect, test } from 'bun:test'
import { MediaType } from '@/lib/types'
import type { PersistedWorkspaceState, WorkspaceWindowDefinition } from '@/lib/use-workspace'
import { normalizePersistedWorkspaceState } from '@/lib/use-workspace'
import {
  enterSplitViewState,
  exitSplitViewState,
  mergeWindowIntoGroupState,
  openInNewTabInGroupState,
  openInSplitViewFromBrowserState,
  splitWindowFromGroupState,
  tabsInGroup,
} from '@/src/workspace/tab-group-ops'

function browserTab(
  id: string,
  opts?: { tabGroupId?: string | null; tabPinned?: boolean },
): WorkspaceWindowDefinition {
  const gid = opts?.tabGroupId ?? 'g1'
  return {
    id,
    type: 'browser',
    title: id,
    iconName: null,
    iconPath: '',
    iconType: MediaType.FOLDER,
    iconIsVirtual: false,
    source: { kind: 'local', rootPath: null },
    initialState: { dir: '/' },
    tabGroupId: gid,
    layout: { minimized: false, zIndex: 1 },
    ...(opts?.tabPinned ? { tabPinned: true } : {}),
  }
}

function viewerTab(id: string, gid = 'g1'): WorkspaceWindowDefinition {
  return {
    id,
    type: 'viewer',
    title: id,
    iconName: null,
    iconPath: '/f',
    iconType: MediaType.OTHER,
    iconIsVirtual: false,
    source: { kind: 'local', rootPath: null },
    initialState: { dir: '/', viewing: '/f' },
    tabGroupId: gid,
    layout: { minimized: false, zIndex: 1 },
  }
}

function baseState(windows: WorkspaceWindowDefinition[]): PersistedWorkspaceState {
  return {
    windows,
    activeWindowId: windows[0]?.id ?? '',
    activeTabMap: { g1: windows.find((w) => (w.tabGroupId ?? w.id) === 'g1')?.id ?? '' },
    nextWindowId: 10,
    pinnedTaskbarItems: [],
  }
}

describe('workspace split view', () => {
  test('enterSplitViewState sets split and keeps active on a right tab', () => {
    const state = baseState([browserTab('b1'), viewerTab('v1')])
    const next = enterSplitViewState({ ...state, activeTabMap: { g1: 'v1' } }, 'g1', 'b1')
    expect(next.tabGroupSplits?.g1?.leftTabId).toBe('b1')
    expect(next.activeTabMap.g1).toBe('v1')
    expect(next.activeWindowId).toBe('v1')
  })

  test('enterSplitViewState moves active off split left tab', () => {
    const state = baseState([browserTab('b1'), viewerTab('v1')])
    const next = enterSplitViewState(
      { ...state, activeTabMap: { g1: 'b1' }, activeWindowId: 'b1' },
      'g1',
      'b1',
    )
    expect(next.activeTabMap.g1).toBe('v1')
    expect(next.activeWindowId).toBe('v1')
  })

  test('exitSplitViewState removes tabGroupSplits entry', () => {
    const state = enterSplitViewState(baseState([browserTab('b1'), viewerTab('v1')]), 'g1', 'b1')
    const next = exitSplitViewState(state, 'g1')
    expect(next.tabGroupSplits).toBeUndefined()
  })

  test('openInNewTabInGroupState from split left inserts after all right tabs', () => {
    let state = baseState([browserTab('b1'), viewerTab('v1')])
    state = enterSplitViewState(state, 'g1', 'b1')
    const next = openInNewTabInGroupState(
      state,
      'b1',
      { path: '/new.txt', isDirectory: false },
      '/',
    )
    const order = tabsInGroup(next.windows, 'g1').map((w) => w.id)
    expect(order).toEqual(['b1', 'v1', 'workspace-window-10'])
    expect(next.activeTabMap.g1).toBe('workspace-window-10')
    expect(next.activeWindowId).toBe('workspace-window-10')
  })

  test('openInSplitViewFromBrowserState opens on right then sets split', () => {
    const state = baseState([browserTab('only')])
    const next = openInSplitViewFromBrowserState(
      state,
      'only',
      { path: '/y.txt', isDirectory: false },
      '/',
    )
    expect(next.tabGroupSplits?.g1?.leftTabId).toBe('only')
    const order = tabsInGroup(next.windows, 'g1').map((w) => w.id)
    expect(order).toContain('only')
    expect(order.length).toBe(2)
    expect(next.activeWindowId).not.toBe('only')
  })

  test('normalizePersistedWorkspaceState drops invalid split metadata', () => {
    const raw = {
      windows: [
        {
          id: 'a',
          type: 'browser',
          title: 'a',
          source: { kind: 'local', rootPath: null },
          initialState: {},
          tabGroupId: 'g1',
          layout: { minimized: false, zIndex: 1 },
        },
      ],
      activeWindowId: 'a',
      activeTabMap: { g1: 'a' },
      nextWindowId: 2,
      pinnedTaskbarItems: [],
      tabGroupSplits: { g1: { leftTabId: 'a', leftPaneFraction: 0.5 } },
    }
    const n = normalizePersistedWorkspaceState(raw, { reconcileSnapZones: false })
    expect(n?.tabGroupSplits).toBeUndefined()
  })

  test('mergeWindowIntoGroupState clears split on destination group', () => {
    const a = browserTab('a', { tabGroupId: null })
    const b = browserTab('b', { tabGroupId: null })
    a.tabGroupId = 'g1'
    b.tabGroupId = 'b-alone'
    let state: PersistedWorkspaceState = {
      windows: [a, { ...b, id: 'b', tabGroupId: 'b-alone' }],
      activeWindowId: 'a',
      activeTabMap: { g1: 'a' },
      nextWindowId: 10,
      pinnedTaskbarItems: [],
      tabGroupSplits: { g1: { leftTabId: 'a', leftPaneFraction: 0.5 } },
    }
    const v = viewerTab('v2', 'g1')
    state = { ...state, windows: [...state.windows, v] }
    const merged = mergeWindowIntoGroupState(state, 'b', 'a', 1)
    expect(merged.tabGroupSplits?.g1).toBeUndefined()
  })

  test('splitWindowFromGroupState dissolves group and clears split metadata', () => {
    const w1 = browserTab('t1', { tabGroupId: 'g1' })
    const w2 = viewerTab('t2', 'g1')
    let state = enterSplitViewState(baseState([w1, w2]), 'g1', 't1')
    state = splitWindowFromGroupState(state, 't2')
    expect(state.windows.every((w) => w.tabGroupId !== 'g1')).toBe(true)
    expect(state.tabGroupSplits?.g1).toBeUndefined()
    expect(state.activeWindowId).toBe('t2')
  })
})
