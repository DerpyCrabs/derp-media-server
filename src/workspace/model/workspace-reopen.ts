import type { WindowDefinition, TabGroupSplitState } from '@/lib/models/window-model'
import type { PersistedWorkspaceState } from './workspace'
import { workspaceWindowId } from './workspace-window-open'
import { maxWorkspaceWindowZ } from './workspace-geometry'
import {
  groupIdForWindow,
  mergeWindowIntoGroupState,
  tabsInGroup,
} from '@/workspace/tabs/tab-group-ops'

export type ClosedWorkspaceWindows = {
  windows: readonly WindowDefinition[]
  groups: readonly { ids: readonly string[]; split?: TabGroupSplitState; active?: string }[]
  activeId: string | null
}
export function captureClosedWindows(
  before: PersistedWorkspaceState,
  removed: readonly WindowDefinition[],
): ClosedWorkspaceWindows | null {
  const windows = removed.filter((window) => window.type !== 'hermes' || window.hermes?.sessionId)
  if (!windows.length) return null
  const groups = [...new Set(windows.map(groupIdForWindow))].map((group) => ({
    ids: tabsInGroup(before.windows, group).map((window) => window.id),
    split: before.tabGroupSplits?.[group],
    active: before.activeTabMap[group],
  }))
  return { windows, groups, activeId: before.activeWindowId }
}
export function reopenWorkspaceWindows(
  current: PersistedWorkspaceState,
  closed: ClosedWorkspaceWindows,
): { state: PersistedWorkspaceState; openedIds: string[] } {
  const identities = new Map<string, string>(),
    occupied = new Set(current.windows.map((window) => window.id))
  let nextId = current.nextWindowId
  for (const window of closed.windows) {
    let id: string
    do {
      id = workspaceWindowId(nextId++)
    } while (occupied.has(id))
    identities.set(window.id, id)
    occupied.add(id)
  }
  const reference = (id: string | null | undefined) =>
    id ? (identities.get(id) ?? (occupied.has(id) ? id : null)) : null
  const zIndex = maxWorkspaceWindowZ(current.windows) + 1
  const restored = closed.windows.map((window) => ({
    ...window,
    id: identities.get(window.id)!,
    tabGroupId: null,
    openedFromWindowId: reference(window.openedFromWindowId),
    fileOpenTargetWindowId: reference(window.fileOpenTargetWindowId),
    layout: { ...window.layout, minimized: false, zIndex },
  }))
  let state: PersistedWorkspaceState = {
    ...current,
    windows: [...current.windows, ...restored],
    nextWindowId: nextId,
  }
  for (const group of closed.groups) {
    const closedIds = group.ids.filter((id) => identities.has(id))
    const surviving = group.ids
      .map((id) => current.windows.find((window) => window.id === id))
      .filter((window): window is WindowDefinition => !!window)
    const targetId = surviving[0]?.id ?? identities.get(closedIds[0]!)
    if (!targetId) continue
    const existingGroup = surviving[0] ? groupIdForWindow(surviving[0]) : null
    const existingSplit = existingGroup ? current.tabGroupSplits?.[existingGroup] : undefined
    for (const oldId of closedIds) {
      const id = identities.get(oldId)!
      if (id === targetId) continue
      const target = state.windows.find((window) => window.id === targetId)!
      const members = tabsInGroup(state.windows, groupIdForWindow(target))
      const after = group.ids
        .slice(group.ids.indexOf(oldId) + 1)
        .map((candidate) => reference(candidate))
        .find((candidate) => members.some((window) => window.id === candidate))
      const index = after ? members.findIndex((window) => window.id === after) : members.length
      state = mergeWindowIntoGroupState(state, id, targetId, index)
    }
    const target = state.windows.find((window) => window.id === targetId)!
    const groupId = groupIdForWindow(target)
    const members = tabsInGroup(state.windows, groupId)
    if (members.length > 1) {
      const pinned = members.filter((window) => window.tabPinned),
        regular = members.filter((window) => !window.tabPinned)
      let index = 0
      state = {
        ...state,
        windows: state.windows.map((window) =>
          groupIdForWindow(window) === groupId ? [...pinned, ...regular][index++]! : window,
        ),
      }
      const split =
        existingSplit ??
        (group.split && reference(group.split.leftTabId)
          ? { ...group.split, leftTabId: reference(group.split.leftTabId)! }
          : undefined)
      if (split && members.some((window) => window.id === split.leftTabId))
        state = { ...state, tabGroupSplits: { ...state.tabGroupSplits, [groupId]: split } }
    }
  }
  const openedIds = restored.map((window) => window.id)
  const activeId =
    identities.get(closed.activeId ?? '') ?? openedIds.at(-1) ?? current.activeWindowId
  const active = state.windows.find((window) => window.id === activeId)
  if (active) {
    const group = groupIdForWindow(active),
      split = state.tabGroupSplits?.[group]
    const right =
      split?.leftTabId === active.id
        ? (tabsInGroup(state.windows, group).find((window) => window.id !== active.id)?.id ??
          active.id)
        : active.id
    state = {
      ...state,
      activeWindowId: right,
      activeTabMap: { ...state.activeTabMap, [group]: right },
      windows: state.windows.map((window) =>
        groupIdForWindow(window) === group
          ? { ...window, layout: { ...window.layout, zIndex, minimized: false } }
          : window,
      ),
      ...(state.canvas
        ? { canvas: { ...state.canvas, nextZIndex: Math.max(state.canvas.nextZIndex, zIndex + 1) } }
        : {}),
    }
  }
  return { state, openedIds }
}
