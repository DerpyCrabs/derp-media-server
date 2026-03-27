import { getMediaType } from '@/lib/media-utils'
import { createDefaultBounds, insertWindowAtGroupIndex } from '@/lib/workspace-geometry'
import { MediaType } from '@/lib/types'
import type { PersistedWorkspaceState, WorkspaceWindowDefinition } from '@/lib/use-workspace'
import {
  SPLIT_PANE_FRACTION_DEFAULT,
  clampSplitPaneFraction,
  type TabGroupSplitState,
} from '@/lib/use-workspace'

export function groupIdForWindow(w: WorkspaceWindowDefinition): string {
  return w.tabGroupId ?? w.id
}

export function orderedVisibleGroupIds(windows: WorkspaceWindowDefinition[]): string[] {
  const seen = new Set<string>()
  const order: string[] = []
  for (const win of windows) {
    if (win.layout?.minimized) continue
    const gid = groupIdForWindow(win)
    if (seen.has(gid)) continue
    seen.add(gid)
    order.push(gid)
  }
  return order
}

/** Group ids in first-seen order (includes minimized), for taskbar rows. */
export function orderedAllGroupIds(windows: WorkspaceWindowDefinition[]): string[] {
  const seen = new Set<string>()
  const order: string[] = []
  for (const win of windows) {
    const gid = groupIdForWindow(win)
    if (seen.has(gid)) continue
    seen.add(gid)
    order.push(gid)
  }
  return order
}

export function tabsInGroup(
  windows: WorkspaceWindowDefinition[],
  groupId: string,
): WorkspaceWindowDefinition[] {
  return windows.filter((w) => groupIdForWindow(w) === groupId)
}

/**
 * After removing a tab from a group, pick the next visible tab so the right pane does not
 * fall back to groupTabs[0] (often the split-left browser), which would duplicate the file browser on the right.
 */
export function visibleTabIdAfterPlayerRemoved(
  windows: WorkspaceWindowDefinition[],
  groupId: string,
  tabGroupSplits: PersistedWorkspaceState['tabGroupSplits'],
): string | null {
  const members = tabsInGroup(windows, groupId)
  if (members.length === 0) return null
  const split = tabGroupSplits?.[groupId]
  const leftId = split?.leftTabId
  if (leftId) {
    const right = members.find((m) => m.id !== leftId)
    if (right) return right.id
    return members[0]!.id
  }
  const viewer = members.find((m) => m.type === 'viewer')
  if (viewer) return viewer.id
  return members[members.length - 1]!.id
}

/** Resolve which tab is visible for a group; split-aware fallback never prefers only the left pane on the right. */
export function resolveGroupVisibleTabId(
  state: Pick<PersistedWorkspaceState, 'windows' | 'activeTabMap' | 'tabGroupSplits'>,
  groupId: string,
): string {
  const groupTabs = tabsInGroup(state.windows, groupId)
  if (groupTabs.length === 0) return ''
  const split = state.tabGroupSplits?.[groupId]
  const leftId = split?.leftTabId

  const mapped = state.activeTabMap[groupId]
  if (mapped && groupTabs.some((t) => t.id === mapped)) {
    if (leftId && mapped === leftId) {
      const right = groupTabs.find((t) => t.id !== leftId)
      return right?.id ?? mapped
    }
    return mapped
  }

  if (leftId) {
    const right = groupTabs.find((t) => t.id !== leftId)
    return right?.id ?? groupTabs[0]!.id
  }
  return groupTabs[0]!.id
}

export function getTabGroupSplit(
  state: Pick<PersistedWorkspaceState, 'tabGroupSplits'>,
  groupId: string,
): TabGroupSplitState | undefined {
  return state.tabGroupSplits?.[groupId]
}

export function isSplitLeftTab(
  state: Pick<PersistedWorkspaceState, 'tabGroupSplits'>,
  groupId: string,
  tabId: string,
): boolean {
  return state.tabGroupSplits?.[groupId]?.leftTabId === tabId
}

function withoutTabGroupSplitsForGroup(
  state: PersistedWorkspaceState,
  groupId: string,
): PersistedWorkspaceState {
  const s = state.tabGroupSplits
  if (!s?.[groupId]) return state
  const next = { ...s }
  delete next[groupId]
  const keys = Object.keys(next)
  return { ...state, tabGroupSplits: keys.length ? next : undefined }
}

/** Invalidate split when group membership no longer supports it. */
export function pruneTabGroupSplitsState(state: PersistedWorkspaceState): PersistedWorkspaceState {
  const splits = state.tabGroupSplits
  if (!splits) return state
  const next: Record<string, TabGroupSplitState> = {}
  for (const [gid, sp] of Object.entries(splits)) {
    const members = tabsInGroup(state.windows, gid)
    const left = members.find((w) => w.id === sp.leftTabId)
    if (!left) continue
    if (members.filter((w) => w.id !== sp.leftTabId).length < 1) continue
    next[gid] = {
      ...sp,
      leftPaneFraction: clampSplitPaneFraction(sp.leftPaneFraction),
    }
  }
  const keys = Object.keys(next)
  let out: PersistedWorkspaceState = {
    ...state,
    tabGroupSplits: keys.length ? next : undefined,
  }
  out = ensureSplitActiveNotLeft(out)
  return out
}

export function ensureSplitActiveNotLeft(state: PersistedWorkspaceState): PersistedWorkspaceState {
  const splits = state.tabGroupSplits
  if (!splits) return state
  let activeTabMap = { ...state.activeTabMap }
  let activeWindowId = state.activeWindowId
  let changed = false
  for (const [gid, sp] of Object.entries(splits)) {
    const members = tabsInGroup(state.windows, gid)
    const firstRight = members.find((w) => w.id !== sp.leftTabId)
    if (activeTabMap[gid] === sp.leftTabId && firstRight) {
      activeTabMap[gid] = firstRight.id
      changed = true
    }
    if (activeWindowId === sp.leftTabId && firstRight) {
      activeWindowId = firstRight.id
      changed = true
    }
  }
  return changed ? { ...state, activeTabMap, activeWindowId } : state
}

export function insertIndexAfterAllRightTabs(
  groupMembers: WorkspaceWindowDefinition[],
  leftTabId: string,
): number {
  let lastRight = -1
  for (let i = 0; i < groupMembers.length; i++) {
    if (groupMembers[i].id !== leftTabId) lastRight = i
  }
  return lastRight + 1
}

/** Map a right-strip-only tab index to a group-local insert index (for file drop / open). */
export function rightStripIndexToGroupInsertIndex(
  groupMembers: WorkspaceWindowDefinition[],
  leftTabId: string | undefined,
  rightStripIndex: number,
): number {
  if (!leftTabId) return rightStripIndex
  const rightOrdered = groupMembers.filter((m) => m.id !== leftTabId)
  if (rightStripIndex >= rightOrdered.length) {
    return insertIndexAfterAllRightTabs(groupMembers, leftTabId)
  }
  const targetId = rightOrdered[rightStripIndex]!.id
  const i = groupMembers.findIndex((m) => m.id === targetId)
  return i < 0 ? groupMembers.length : i
}

/** Map a merge-target insert index (full group order) to a drop slot index in a right-only strip. */
export function mergeInsertIndexToRightStripSlot(
  groupMembers: WorkspaceWindowDefinition[],
  leftTabId: string | undefined,
  fullGroupInsertIndex: number,
): number {
  if (!leftTabId) return fullGroupInsertIndex
  let rightSlot = 0
  for (let i = 0; i < fullGroupInsertIndex && i < groupMembers.length; i++) {
    if (groupMembers[i].id !== leftTabId) rightSlot++
  }
  return rightSlot
}

export function enterSplitViewState(
  state: PersistedWorkspaceState,
  groupId: string,
  leftTabId: string,
  leftPaneFraction: number = SPLIT_PANE_FRACTION_DEFAULT,
): PersistedWorkspaceState {
  const members = tabsInGroup(state.windows, groupId)
  const left = members.find((w) => w.id === leftTabId)
  if (!left) return state
  if (members.filter((w) => w.id !== leftTabId).length < 1) return state
  const nextSplits = {
    ...(state.tabGroupSplits ?? {}),
    [groupId]: {
      leftTabId,
      leftPaneFraction: clampSplitPaneFraction(leftPaneFraction),
    },
  }
  let next: PersistedWorkspaceState = {
    ...state,
    tabGroupSplits: nextSplits,
  }
  next = ensureSplitActiveNotLeft(next)
  return next
}

export function exitSplitViewState(
  state: PersistedWorkspaceState,
  groupId: string,
): PersistedWorkspaceState {
  return withoutTabGroupSplitsForGroup(state, groupId)
}

export function setSplitFractionState(
  state: PersistedWorkspaceState,
  groupId: string,
  fraction: number,
): PersistedWorkspaceState {
  const sp = state.tabGroupSplits?.[groupId]
  if (!sp) return state
  return {
    ...state,
    tabGroupSplits: {
      ...(state.tabGroupSplits ?? {}),
      [groupId]: { ...sp, leftPaneFraction: clampSplitPaneFraction(fraction) },
    },
  }
}

export function setSplitLeftTabFromContextState(
  state: PersistedWorkspaceState,
  tabId: string,
): PersistedWorkspaceState {
  const w = state.windows.find((win) => win.id === tabId)
  if (!w) return state
  const groupId = groupIdForWindow(w)
  return enterSplitViewState(state, groupId, tabId)
}

/** Open file/folder on the right, then pin this browser as the split left tab. */
export function openInSplitViewFromBrowserState(
  state: PersistedWorkspaceState,
  browserWindowId: string,
  file: { path: string; isDirectory: boolean; isVirtual?: boolean },
  currentPath: string,
  sourceOverride?: WorkspaceWindowDefinition['source'],
): PersistedWorkspaceState {
  const browser = state.windows.find((w) => w.id === browserWindowId)
  if (!browser || browser.type !== 'browser') return state
  const groupId = browser.tabGroupId || browserWindowId
  const withOpen = openInNewTabInGroupState(
    state,
    browserWindowId,
    file,
    currentPath,
    undefined,
    sourceOverride,
  )
  if (withOpen === state) return state
  return enterSplitViewState(withOpen, groupId, browserWindowId)
}

export function pinnedCountInGroup(windows: WorkspaceWindowDefinition[], groupId: string): number {
  return tabsInGroup(windows, groupId).filter((w) => w.tabPinned).length
}

/** Pinned tabs are contiguous at the start of the strip; count that prefix. */
export function leadingPinnedTabCount(tabs: WorkspaceWindowDefinition[]): number {
  let n = 0
  for (const t of tabs) {
    if (t.tabPinned) n++
    else break
  }
  return n
}

/** New tabs and merges cannot insert before the pinned block. */
export function clampTabInsertIndex(
  windows: WorkspaceWindowDefinition[],
  groupId: string,
  insertIndex: number,
): number {
  return Math.max(insertIndex, pinnedCountInGroup(windows, groupId))
}

export function replaceGroupMemberOrder(
  fullWindows: WorkspaceWindowDefinition[],
  groupId: string,
  orderedMembers: WorkspaceWindowDefinition[],
): WorkspaceWindowDefinition[] {
  const queue = [...orderedMembers]
  return fullWindows.map((w) => {
    if (groupIdForWindow(w) !== groupId) return w
    const next = queue.shift()
    return next ?? w
  })
}

export function setTabPinnedAndReorderState(
  state: PersistedWorkspaceState,
  tabId: string,
  pinned: boolean,
): PersistedWorkspaceState {
  const victim = state.windows.find((w) => w.id === tabId)
  if (!victim) return state
  const groupId = groupIdForWindow(victim)
  const members = tabsInGroup(state.windows, groupId)
  const pinnedExisting = members.filter((m) => m.tabPinned && m.id !== tabId)
  const unpinned = members.filter((m) => !m.tabPinned && m.id !== tabId)
  const nextMembers = pinned
    ? [...pinnedExisting, { ...victim, tabPinned: true }, ...unpinned]
    : [...pinnedExisting, { ...victim, tabPinned: false }, ...unpinned]
  return {
    ...state,
    windows: replaceGroupMemberOrder(state.windows, groupId, nextMembers),
  }
}

export function mergeWindowIntoGroupState(
  state: PersistedWorkspaceState,
  windowId: string,
  targetWindowId: string,
  insertIndex?: number,
): PersistedWorkspaceState {
  const current = state.windows
  const target = current.find((w) => w.id === targetWindowId)
  const moved = current.find((w) => w.id === windowId)
  if (!target || !moved) return state

  const sourceGid = groupIdForWindow(moved)
  const destGid = target.tabGroupId || targetWindowId

  if (sourceGid === destGid) return state

  const sourceMembers = current.filter((w) => groupIdForWindow(w) === sourceGid)
  const sharedBounds = target.layout?.bounds ?? moved.layout?.bounds
  const sharedZ = target.layout?.zIndex ?? moved.layout?.zIndex ?? 1

  const migrated = sourceMembers.map((w) => ({
    ...w,
    tabGroupId: destGid,
    layout: {
      ...w.layout,
      bounds: sharedBounds ?? w.layout?.bounds,
      zIndex: sharedZ,
      minimized: false,
    },
  }))

  const withoutSource = current.filter((w) => groupIdForWindow(w) !== sourceGid)

  let work = withoutSource.map((w) => {
    if (w.id === targetWindowId && !w.tabGroupId) {
      return { ...w, tabGroupId: destGid }
    }
    return w
  })

  const destCount = work.filter((w) => groupIdForWindow(w) === destGid).length
  let idx = insertIndex ?? destCount
  idx = clampTabInsertIndex(work, destGid, idx)

  for (let i = 0; i < migrated.length; i++) {
    work = insertWindowAtGroupIndex(work, migrated[i], destGid, idx + i)
  }

  const nextTabMap = { ...state.activeTabMap, [destGid]: windowId }
  delete nextTabMap[sourceGid]

  const merged: PersistedWorkspaceState = {
    ...state,
    windows: work,
    activeWindowId: windowId,
    activeTabMap: nextTabMap,
  }
  return withoutTabGroupSplitsForGroup(merged, destGid)
}

export function openInNewTabInGroupState(
  state: PersistedWorkspaceState,
  sourceWindowId: string,
  file: { path: string; isDirectory: boolean; isVirtual?: boolean },
  currentPath: string,
  insertIndex?: number,
  sourceOverride?: WorkspaceWindowDefinition['source'],
): PersistedWorkspaceState {
  if (file.isVirtual) return state
  const sourceWindow = state.windows.find((w) => w.id === sourceWindowId)
  if (!sourceWindow) return state
  const groupId = sourceWindow.tabGroupId || sourceWindowId
  const source = sourceOverride ?? sourceWindow.source
  const n = state.nextWindowId
  const id = `workspace-window-${n}`
  const zIndex = sourceWindow.layout?.zIndex ?? 1
  const layoutBase = sourceWindow.layout
  const sharedLayout = layoutBase
    ? {
        bounds: layoutBase.bounds,
        fullscreen: layoutBase.fullscreen,
        snapZone: layoutBase.snapZone,
        minimized: false,
        zIndex: layoutBase.zIndex ?? zIndex,
        restoreBounds: layoutBase.restoreBounds,
      }
    : undefined

  let newWindow: WorkspaceWindowDefinition
  if (file.isDirectory) {
    const folderTitle = file.path.split(/[/\\]/).filter(Boolean).pop() ?? 'Folder'
    newWindow = {
      id,
      type: 'browser',
      title: folderTitle,
      iconName: null,
      iconPath: file.path,
      iconType: MediaType.FOLDER,
      iconIsVirtual: false,
      source,
      initialState: { dir: file.path },
      tabGroupId: groupId,
      layout: sharedLayout ?? {
        minimized: false,
        zIndex,
      },
    }
  } else {
    const dir = file.path.split(/[/\\]/).slice(0, -1).join('/') || currentPath
    const title = file.path.split(/[/\\]/).filter(Boolean).at(-1) || 'Viewer'
    newWindow = {
      id,
      type: 'viewer',
      title,
      iconName: null,
      iconPath: file.path,
      iconType: getMediaType(file.path.split('.').pop() ?? ''),
      iconIsVirtual: false,
      source,
      initialState: { dir, viewing: file.path },
      tabGroupId: groupId,
      layout: sharedLayout ?? {
        minimized: false,
        zIndex,
      },
    }
  }

  const withTabGroup = state.windows.map((w) => {
    if (w.id === sourceWindowId && !w.tabGroupId) {
      return { ...w, tabGroupId: groupId }
    }
    return w
  })
  const groupMembers = withTabGroup.filter((w) => groupIdForWindow(w) === groupId)
  const split = state.tabGroupSplits?.[groupId]
  let idx: number
  if (split && sourceWindowId === split.leftTabId) {
    idx = insertIndexAfterAllRightTabs(groupMembers, split.leftTabId)
  } else if (insertIndex !== undefined) {
    idx = insertIndex
  } else {
    const sourceIdx = groupMembers.findIndex((w) => w.id === sourceWindowId)
    if (sourceIdx < 0) {
      idx = groupMembers.length
    } else {
      let anchorIdx = sourceIdx
      for (let i = 0; i < groupMembers.length; i++) {
        if (groupMembers[i].openedFromWindowId === sourceWindowId) {
          anchorIdx = Math.max(anchorIdx, i)
        }
      }
      idx = anchorIdx + 1
      newWindow = { ...newWindow, openedFromWindowId: sourceWindowId }
    }
  }
  idx = clampTabInsertIndex(withTabGroup, groupId, idx)
  const nextWindows = insertWindowAtGroupIndex(withTabGroup, newWindow, groupId, idx)

  return {
    ...state,
    windows: nextWindows,
    nextWindowId: n + 1,
    activeWindowId: id,
    activeTabMap: { ...state.activeTabMap, [groupId]: id },
  }
}

export function addTabToGroupState(
  state: PersistedWorkspaceState,
  sourceWindowId: string,
): PersistedWorkspaceState {
  const arr = state.windows
  const sourceWindow = arr.find((w) => w.id === sourceWindowId)
  if (!sourceWindow) return state

  const groupId = sourceWindow.tabGroupId || sourceWindowId
  const id = `workspace-window-${state.nextWindowId}`
  const zIndex = sourceWindow.layout?.zIndex ?? 1

  const newWindow: WorkspaceWindowDefinition = {
    id,
    type: sourceWindow.type,
    title: '',
    iconName: null,
    iconPath: '',
    iconType: sourceWindow.type === 'browser' ? MediaType.FOLDER : MediaType.OTHER,
    iconIsVirtual: false,
    source: sourceWindow.source,
    initialState:
      sourceWindow.type === 'browser' ? { dir: sourceWindow.initialState.dir ?? null } : {},
    tabGroupId: groupId,
    layout: {
      bounds: sourceWindow.layout?.bounds,
      fullscreen: sourceWindow.layout?.fullscreen,
      snapZone: sourceWindow.layout?.snapZone,
      minimized: false,
      zIndex,
      restoreBounds: sourceWindow.layout?.restoreBounds,
    },
  }
  const updated = arr.map((w) => {
    if (w.id === sourceWindowId && !w.tabGroupId) {
      return { ...w, tabGroupId: groupId }
    }
    return w
  })
  return {
    ...state,
    windows: [...updated, newWindow],
    nextWindowId: state.nextWindowId + 1,
    activeWindowId: id,
    activeTabMap: { ...state.activeTabMap, [groupId]: id },
  }
}

export function splitWindowFromGroupState(
  state: PersistedWorkspaceState,
  windowId: string,
  offsetBounds?: { x: number; y: number; width: number; height: number },
): PersistedWorkspaceState {
  const current = state.windows
  const w = current.find((win) => win.id === windowId)
  if (!w?.tabGroupId) return state

  const groupId = w.tabGroupId
  const groupWindows = current.filter((win) => win.tabGroupId === groupId)
  const groupLayout = w.layout
  const maxZ = Math.max(...current.map((x) => x.layout?.zIndex ?? 1), 1)
  let nextZ = maxZ + 1

  const defaultBounds =
    offsetBounds ??
    (() => {
      const base = w.layout?.bounds ?? createDefaultBounds(0, w.type)
      return { x: base.x + 30, y: base.y + 30, width: base.width, height: base.height }
    })()

  let nextWindows = current.map((win) => {
    if (win.id === windowId) {
      const z = nextZ++
      return {
        ...win,
        tabGroupId: null,
        layout: {
          ...win.layout,
          bounds: defaultBounds,
          snapZone: null,
          fullscreen: false,
          restoreBounds: win.layout?.bounds ?? win.layout?.restoreBounds ?? null,
          zIndex: z,
        },
      }
    }
    return win
  })

  if (groupWindows.length === 2) {
    nextWindows = nextWindows.map((win) => {
      if (win.tabGroupId !== groupId) return win
      const fallbackBounds = createDefaultBounds(0, win.type)
      return {
        ...win,
        tabGroupId: null,
        layout: groupLayout
          ? {
              ...groupLayout,
              bounds: groupLayout.bounds ?? win.layout?.bounds ?? fallbackBounds,
              snapZone: groupLayout.snapZone ?? null,
              restoreBounds: groupLayout.restoreBounds ?? groupLayout.bounds ?? null,
            }
          : win.layout,
      }
    })
  }

  const hasGroupAfter = nextWindows.some((win) => win.tabGroupId === groupId)
  const nextActiveMap = { ...state.activeTabMap }
  if (!hasGroupAfter) {
    delete nextActiveMap[groupId]
  } else if (state.activeTabMap[groupId] === windowId) {
    const still = nextWindows.filter((x) => x.tabGroupId === groupId)
    if (still[0]) nextActiveMap[groupId] = still[0].id
  }

  return pruneTabGroupSplitsState({
    ...state,
    windows: nextWindows,
    activeWindowId: windowId,
    activeTabMap: nextActiveMap,
  })
}
