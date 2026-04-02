import { describe, expect, test } from 'bun:test'
import { MediaType } from '@/lib/types'
import {
  computeLayoutPreviewDetail,
  computeLayoutPreviewNorm,
} from '@/lib/workspace-layout-preview'
import type { PersistedWorkspaceState, WorkspaceSource } from '@/lib/use-workspace'

const localSource: WorkspaceSource = { kind: 'local', rootPath: null }

function baseState(windows: PersistedWorkspaceState['windows']): PersistedWorkspaceState {
  return {
    windows,
    activeWindowId: windows[0]?.id ?? null,
    activeTabMap: {},
    nextWindowId: windows.length + 1,
    pinnedTaskbarItems: [],
  }
}

describe('computeLayoutPreviewDetail', () => {
  test('two snapped groups: one tab strip per window', () => {
    const snap: PersistedWorkspaceState = baseState([
      {
        id: 'a',
        type: 'browser',
        title: 'First',
        iconName: null,
        iconPath: '',
        iconType: MediaType.FOLDER,
        iconIsVirtual: false,
        source: localSource,
        initialState: { dir: '/a' },
        tabGroupId: null,
        layout: { snapZone: 'left', zIndex: 1, minimized: false },
      },
      {
        id: 'b',
        type: 'browser',
        title: 'Second',
        iconName: null,
        iconPath: '',
        iconType: MediaType.FOLDER,
        iconIsVirtual: false,
        source: localSource,
        initialState: { dir: '/b' },
        tabGroupId: null,
        layout: { snapZone: 'right', zIndex: 2, minimized: false },
      },
    ])
    const detail = computeLayoutPreviewDetail(snap)
    expect(detail).not.toBeNull()
    if (!detail) return
    expect(detail.groups.length).toBe(2)
    const g0 = detail.groups[0]!
    const g1 = detail.groups[1]!
    expect(g0.mode).toBe('tabs')
    expect(g1.mode).toBe('tabs')
    if (g0.mode !== 'tabs' || g1.mode !== 'tabs') return
    expect(g0.tabs).toEqual([{ id: 'a', label: 'First', pinned: false }])
    expect(g1.tabs).toEqual([{ id: 'b', label: 'Second', pinned: false }])
    expect(g0.widthPct + g1.widthPct).toBeGreaterThan(95)
  })

  test('tab group lists every tab in one window', () => {
    const snap: PersistedWorkspaceState = {
      ...baseState([]),
      windows: [
        {
          id: 't1',
          type: 'browser',
          title: 'Alpha',
          iconName: null,
          iconPath: '',
          iconType: MediaType.FOLDER,
          iconIsVirtual: false,
          source: localSource,
          initialState: { dir: '/a' },
          tabGroupId: 'grp',
          layout: { zIndex: 1, minimized: false },
        },
        {
          id: 't2',
          type: 'browser',
          title: 'Beta',
          iconName: null,
          iconPath: '',
          iconType: MediaType.FOLDER,
          iconIsVirtual: false,
          source: localSource,
          initialState: { dir: '/b' },
          tabGroupId: 'grp',
          layout: { zIndex: 1, minimized: false },
        },
      ],
      activeWindowId: 't1',
    }
    const detail = computeLayoutPreviewDetail(snap)
    expect(detail).not.toBeNull()
    if (!detail) return
    expect(detail.groups.length).toBe(1)
    const g = detail.groups[0]!
    expect(g.mode).toBe('tabs')
    if (g.mode !== 'tabs') return
    expect(g.tabs.map((t) => t.id)).toEqual(['t1', 't2'])
  })

  test('split group: separate tab strips per pane', () => {
    const snap: PersistedWorkspaceState = {
      ...baseState([]),
      windows: [
        {
          id: 'left',
          type: 'browser',
          title: 'Browser',
          iconName: null,
          iconPath: '',
          iconType: MediaType.FOLDER,
          iconIsVirtual: false,
          source: localSource,
          initialState: { dir: '/a' },
          tabGroupId: 'grp',
          layout: { zIndex: 1, minimized: false },
        },
        {
          id: 'right',
          type: 'viewer',
          title: 'Video',
          iconName: null,
          iconPath: '',
          iconType: MediaType.VIDEO,
          iconIsVirtual: false,
          source: localSource,
          initialState: {},
          tabGroupId: 'grp',
          layout: { zIndex: 1, minimized: false },
        },
      ],
      activeWindowId: 'right',
      tabGroupSplits: {
        grp: { leftTabId: 'left', leftPaneFraction: 0.4 },
      },
    }
    const detail = computeLayoutPreviewDetail(snap)
    expect(detail).not.toBeNull()
    if (!detail) return
    expect(detail.groups.length).toBe(1)
    const g = detail.groups[0]!
    expect(g.mode).toBe('split')
    if (g.mode !== 'split') return
    expect(g.leftTabs).toEqual([{ id: 'left', label: 'Browser', pinned: false }])
    expect(g.rightTabs).toEqual([{ id: 'right', label: 'Video', pinned: false }])
    expect(g.leftPaneFraction).toBeCloseTo(0.4, 5)
  })

  test('pinned tabs are flagged', () => {
    const snap: PersistedWorkspaceState = {
      ...baseState([]),
      windows: [
        {
          id: 't1',
          type: 'browser',
          title: 'Pinned',
          iconName: null,
          iconPath: '',
          iconType: MediaType.FOLDER,
          iconIsVirtual: false,
          source: localSource,
          initialState: { dir: '/a' },
          tabGroupId: 'grp',
          tabPinned: true,
          layout: { zIndex: 1, minimized: false },
        },
        {
          id: 't2',
          type: 'browser',
          title: 'Free',
          iconName: null,
          iconPath: '',
          iconType: MediaType.FOLDER,
          iconIsVirtual: false,
          source: localSource,
          initialState: { dir: '/b' },
          tabGroupId: 'grp',
          layout: { zIndex: 1, minimized: false },
        },
      ],
      activeWindowId: 't2',
    }
    const detail = computeLayoutPreviewDetail(snap)
    expect(detail).not.toBeNull()
    if (!detail) return
    const g = detail.groups[0]!
    expect(g.mode).toBe('tabs')
    if (g.mode !== 'tabs') return
    expect(g.tabs.find((t) => t.id === 't1')?.pinned).toBe(true)
    expect(g.tabs.find((t) => t.id === 't2')?.pinned).toBeFalsy()
  })

  test('floating window uses full workspace frame (not stretched to fill preview)', () => {
    const snap: PersistedWorkspaceState = baseState([
      {
        id: 'w1',
        type: 'browser',
        title: 'Home',
        iconName: null,
        iconPath: '',
        iconType: MediaType.FOLDER,
        iconIsVirtual: false,
        source: localSource,
        initialState: { dir: '/' },
        tabGroupId: null,
        layout: {
          minimized: false,
          zIndex: 1,
          bounds: { x: 220, y: 72, width: 520, height: 340 },
        },
      },
    ])
    const detail = computeLayoutPreviewDetail(snap)
    expect(detail).not.toBeNull()
    if (!detail) return
    const g = detail.groups[0]!
    expect(g.mode).toBe('tabs')
    if (g.mode !== 'tabs') return
    expect(g.widthPct).toBeLessThan(92)
    expect(g.heightPct).toBeLessThan(92)
    expect(g.leftPct + g.widthPct).toBeLessThan(98)
  })

  test('returns null for empty windows', () => {
    expect(
      computeLayoutPreviewDetail({
        windows: [],
        activeWindowId: null,
        activeTabMap: {},
        nextWindowId: 1,
        pinnedTaskbarItems: [],
      }),
    ).toBeNull()
  })
})

describe('computeLayoutPreviewNorm', () => {
  test('matches group bounding boxes', () => {
    const snap: PersistedWorkspaceState = baseState([
      {
        id: 'a',
        type: 'browser',
        title: 'a',
        iconName: null,
        iconPath: '',
        iconType: MediaType.FOLDER,
        iconIsVirtual: false,
        source: localSource,
        initialState: { dir: '/a' },
        tabGroupId: null,
        layout: { snapZone: 'left', zIndex: 1, minimized: false },
      },
      {
        id: 'b',
        type: 'browser',
        title: 'b',
        iconName: null,
        iconPath: '',
        iconType: MediaType.FOLDER,
        iconIsVirtual: false,
        source: localSource,
        initialState: { dir: '/b' },
        tabGroupId: null,
        layout: { snapZone: 'right', zIndex: 2, minimized: false },
      },
    ])
    const norm = computeLayoutPreviewNorm(snap)
    expect(norm).not.toBeNull()
    if (!norm) return
    expect(norm.panes.length).toBe(2)
  })
})
