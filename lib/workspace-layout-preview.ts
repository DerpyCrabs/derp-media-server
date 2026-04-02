import { createFullscreenBounds, getViewportSize } from '@/lib/workspace-geometry'
import {
  clampSplitPaneFraction,
  normalizePersistedWorkspaceState,
  type PersistedWorkspaceState,
  type WorkspaceWindowDefinition,
} from '@/lib/use-workspace'
import { orderedAllGroupIds, tabsInGroup } from '@/src/workspace/tab-group-ops'

const TAB_LABEL_MAX = 22

export type LayoutPreviewTab = { id: string; label: string; pinned: boolean }

export type LayoutPreviewGroupTabs = {
  leftPct: number
  topPct: number
  widthPct: number
  heightPct: number
  z: number
  minimized: boolean
  mode: 'tabs'
  tabs: LayoutPreviewTab[]
}

export type LayoutPreviewGroupSplit = {
  leftPct: number
  topPct: number
  widthPct: number
  heightPct: number
  z: number
  minimized: boolean
  mode: 'split'
  leftPaneFraction: number
  leftTabs: LayoutPreviewTab[]
  rightTabs: LayoutPreviewTab[]
}

export type LayoutPreviewGroup = LayoutPreviewGroupTabs | LayoutPreviewGroupSplit

export type LayoutPreviewDetail = {
  groups: LayoutPreviewGroup[]
  aspectRatio: number
}

function truncateTabTitle(title: string): string {
  const t = title.trim() || 'Untitled'
  if (t.length <= TAB_LABEL_MAX) return t
  return `${t.slice(0, TAB_LABEL_MAX - 1)}…`
}

function previewTab(win: WorkspaceWindowDefinition): LayoutPreviewTab {
  return { id: win.id, label: truncateTabTitle(win.title), pinned: Boolean(win.tabPinned) }
}

function groupZIndex(windows: PersistedWorkspaceState['windows'], groupId: string): number {
  const members = tabsInGroup(windows, groupId)
  let z = 1
  for (const m of members) {
    const zi = m.layout?.zIndex ?? 1
    if (zi > z) z = zi
  }
  return z
}

function groupOuterBounds(
  windows: PersistedWorkspaceState['windows'],
  groupId: string,
): { x: number; y: number; width: number; height: number } | null {
  const members = tabsInGroup(windows, groupId)
  if (members.length === 0) return null
  if (members.some((m) => m.layout?.fullscreen)) {
    return createFullscreenBounds()
  }
  const withBounds = members.find((m) => m.layout?.bounds)
  const b = withBounds?.layout?.bounds
  if (!b) return null
  return { ...b }
}

type PixelGroup =
  | {
      x: number
      y: number
      width: number
      height: number
      z: number
      minimized: boolean
      mode: 'tabs'
      tabs: LayoutPreviewTab[]
    }
  | {
      x: number
      y: number
      width: number
      height: number
      z: number
      minimized: boolean
      mode: 'split'
      leftPaneFraction: number
      leftTabs: LayoutPreviewTab[]
      rightTabs: LayoutPreviewTab[]
    }

function pixelGroupsFromState(state: PersistedWorkspaceState): PixelGroup[] {
  const splits = state.tabGroupSplits
  const out: PixelGroup[] = []
  for (const gid of orderedAllGroupIds(state.windows)) {
    const members = tabsInGroup(state.windows, gid)
    if (members.length === 0) continue
    const outer = groupOuterBounds(state.windows, gid)
    if (!outer) continue
    const z = groupZIndex(state.windows, gid)
    const minimized = members.every((m) => m.layout?.minimized)
    const split = splits?.[gid]
    if (split?.leftTabId) {
      const leftMembers = members.filter((m) => m.id === split.leftTabId)
      const rightMembers = members.filter((m) => m.id !== split.leftTabId)
      out.push({
        ...outer,
        z,
        minimized,
        mode: 'split',
        leftPaneFraction: clampSplitPaneFraction(split.leftPaneFraction),
        leftTabs: leftMembers.map(previewTab),
        rightTabs: rightMembers.map(previewTab),
      })
    } else {
      out.push({
        ...outer,
        z,
        minimized,
        mode: 'tabs',
        tabs: members.map(previewTab),
      })
    }
  }
  return out.sort((a, b) => a.z - b.z)
}

export function computeLayoutPreviewDetail(
  snapshot: PersistedWorkspaceState,
): LayoutPreviewDetail | null {
  const raw = JSON.parse(JSON.stringify(snapshot)) as unknown
  const state = normalizePersistedWorkspaceState(raw)
  if (!state) return null
  const pixel = pixelGroupsFromState(state)
  if (pixel.length === 0) return null
  const canvas = getViewportSize()
  const uw = canvas.width
  const uh = canvas.height
  if (!(uw > 0) || !(uh > 0)) return null

  const groups: LayoutPreviewGroup[] = pixel.map((g) => {
    const base = {
      leftPct: (g.x / uw) * 100,
      topPct: (g.y / uh) * 100,
      widthPct: (g.width / uw) * 100,
      heightPct: (g.height / uh) * 100,
      z: g.z,
      minimized: g.minimized,
    }
    if (g.mode === 'split') {
      return {
        ...base,
        mode: 'split' as const,
        leftPaneFraction: g.leftPaneFraction,
        leftTabs: g.leftTabs,
        rightTabs: g.rightTabs,
      }
    }
    return {
      ...base,
      mode: 'tabs' as const,
      tabs: g.tabs,
    }
  })

  return { groups, aspectRatio: uw / uh }
}

export function computeLayoutPreviewNorm(snapshot: PersistedWorkspaceState): {
  panes: Array<{
    leftPct: number
    topPct: number
    widthPct: number
    heightPct: number
    z: number
  }>
  aspectRatio: number
} | null {
  const detail = computeLayoutPreviewDetail(snapshot)
  if (!detail) return null
  return {
    aspectRatio: detail.aspectRatio,
    panes: detail.groups.map((g) => ({
      leftPct: g.leftPct,
      topPct: g.topPct,
      widthPct: g.widthPct,
      heightPct: g.heightPct,
      z: g.z,
    })),
  }
}
