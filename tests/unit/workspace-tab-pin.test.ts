import { describe, expect, test } from 'bun:test'
import { MediaType } from '@/lib/types'
import type { PersistedWorkspaceState, WorkspaceWindowDefinition } from '@/lib/use-workspace'
import {
  clampTabInsertIndex,
  leadingPinnedTabCount,
  openInNewTabInGroupState,
  setTabPinnedAndReorderState,
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

function baseState(windows: WorkspaceWindowDefinition[]): PersistedWorkspaceState {
  return {
    windows,
    activeWindowId: windows[0]?.id ?? '',
    activeTabMap: { g1: windows[0]?.id ?? '' },
    nextWindowId: 10,
    pinnedTaskbarItems: [],
  }
}

describe('workspace tab pin ops', () => {
  test('leadingPinnedTabCount stops at first unpinned', () => {
    const tabs = [
      browserTab('a', { tabPinned: true }),
      browserTab('b', { tabPinned: true }),
      browserTab('c'),
    ]
    expect(leadingPinnedTabCount(tabs)).toBe(2)
    expect(leadingPinnedTabCount([browserTab('x')])).toBe(0)
  })

  test('clampTabInsertIndex bumps insert before pinned block', () => {
    const windows = [
      browserTab('a', { tabPinned: true }),
      browserTab('b', { tabPinned: true }),
      browserTab('c'),
    ]
    expect(clampTabInsertIndex(windows, 'g1', 0)).toBe(2)
    expect(clampTabInsertIndex(windows, 'g1', 1)).toBe(2)
    expect(clampTabInsertIndex(windows, 'g1', 2)).toBe(2)
    expect(clampTabInsertIndex(windows, 'g1', 3)).toBe(3)
  })

  test('openInNewTab clamps file-drop insert before pinned tabs', () => {
    const state = baseState([
      browserTab('a', { tabPinned: true }),
      browserTab('b', { tabPinned: true }),
      browserTab('c'),
    ])
    const next = openInNewTabInGroupState(state, 'c', { path: '/x', isDirectory: true }, '/', 0)
    const order = tabsInGroup(next.windows, 'g1').map((w) => w.id)
    expect(order).toEqual(['a', 'b', 'workspace-window-10', 'c'])
  })

  test('setTabPinnedAndReorderState pins to end of pinned block', () => {
    const state = baseState([
      browserTab('a', { tabPinned: true }),
      browserTab('b'),
      browserTab('c'),
    ])
    const next = setTabPinnedAndReorderState(state, 'c', true)
    expect(tabsInGroup(next.windows, 'g1').map((w) => w.id)).toEqual(['a', 'c', 'b'])
    expect(next.windows.find((w) => w.id === 'c')?.tabPinned).toBe(true)
  })

  test('setTabPinnedAndReorderState unpins to first among unpinned', () => {
    const state = baseState([
      browserTab('a', { tabPinned: true }),
      browserTab('b', { tabPinned: true }),
      browserTab('c'),
    ])
    const next = setTabPinnedAndReorderState(state, 'b', false)
    expect(tabsInGroup(next.windows, 'g1').map((w) => w.id)).toEqual(['a', 'b', 'c'])
    expect(next.windows.find((w) => w.id === 'b')?.tabPinned).toBeFalsy()
  })
})
