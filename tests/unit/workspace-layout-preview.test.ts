import { describe, expect, test } from 'bun:test'
import '@/src/integrations/current-window-content'
import {
  computeLayoutPreviewDetail,
  computeLayoutPreviewNorm,
} from '@/lib/workspace-layout-preview'
import { serializeWorkspacePersistedState, type PersistedWorkspaceState } from '@/lib/use-workspace'
import { workspaceWindow } from './workspace-window-fixture'

function baseState(windows: PersistedWorkspaceState['windows']): PersistedWorkspaceState {
  return {
    windows,
    activeWindowId: windows[0]?.id ?? null,
    activeTabMap: {},
    nextWindowId: windows.length + 1,
    pinnedTaskbarItems: [],
  }
}

function currentSnapshot(state: PersistedWorkspaceState): PersistedWorkspaceState {
  return JSON.parse(serializeWorkspacePersistedState(state)) as PersistedWorkspaceState
}

describe('computeLayoutPreviewDetail', () => {
  test('two snapped groups: one tab strip per window', () => {
    const snap: PersistedWorkspaceState = baseState([
      workspaceWindow({
        id: 'a',
        title: 'First',
        path: 'a',
        tabGroupId: null,
        layout: { snapZone: 'left', zIndex: 1, minimized: false },
      }),
      workspaceWindow({
        id: 'b',
        title: 'Second',
        path: 'b',
        tabGroupId: null,
        layout: { snapZone: 'right', zIndex: 2, minimized: false },
      }),
    ])
    const detail = computeLayoutPreviewDetail(currentSnapshot(snap))
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
        workspaceWindow({
          id: 't1',
          title: 'Alpha',
          path: 'a',
          tabGroupId: 'grp',
          layout: { zIndex: 1, minimized: false },
        }),
        workspaceWindow({
          id: 't2',
          title: 'Beta',
          path: 'b',
          tabGroupId: 'grp',
          layout: { zIndex: 1, minimized: false },
        }),
      ],
      activeWindowId: 't1',
    }
    const detail = computeLayoutPreviewDetail(currentSnapshot(snap))
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
        workspaceWindow({
          id: 'left',
          title: 'Browser',
          path: 'a',
          tabGroupId: 'grp',
          layout: { zIndex: 1, minimized: false },
        }),
        workspaceWindow({
          id: 'right',
          title: 'Video',
          contentKind: 'resource',
          path: 'video.mp4',
          renderer: 'filesystem.video',
          tabGroupId: 'grp',
          layout: { zIndex: 1, minimized: false },
        }),
      ],
      activeWindowId: 'right',
      tabGroupSplits: {
        grp: { leftTabId: 'left', leftPaneFraction: 0.4 },
      },
    }
    const detail = computeLayoutPreviewDetail(currentSnapshot(snap))
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
        workspaceWindow({
          id: 't1',
          title: 'Pinned',
          path: 'a',
          tabGroupId: 'grp',
          tabPinned: true,
          layout: { zIndex: 1, minimized: false },
        }),
        workspaceWindow({
          id: 't2',
          title: 'Free',
          path: 'b',
          tabGroupId: 'grp',
          layout: { zIndex: 1, minimized: false },
        }),
      ],
      activeWindowId: 't2',
    }
    const detail = computeLayoutPreviewDetail(currentSnapshot(snap))
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
      workspaceWindow({
        id: 'w1',
        title: 'Home',
        tabGroupId: null,
        layout: {
          minimized: false,
          zIndex: 1,
          bounds: { x: 220, y: 72, width: 520, height: 340 },
        },
      }),
    ])
    const detail = computeLayoutPreviewDetail(currentSnapshot(snap))
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
      workspaceWindow({
        id: 'a',
        title: 'a',
        path: 'a',
        tabGroupId: null,
        layout: { snapZone: 'left', zIndex: 1, minimized: false },
      }),
      workspaceWindow({
        id: 'b',
        title: 'b',
        path: 'b',
        tabGroupId: null,
        layout: { snapZone: 'right', zIndex: 2, minimized: false },
      }),
    ])
    const norm = computeLayoutPreviewNorm(currentSnapshot(snap))
    expect(norm).not.toBeNull()
    if (!norm) return
    expect(norm.panes.length).toBe(2)
  })
})
