import type { WindowDefinition as WorkspaceWindowDefinition } from '@/lib/models/window-model'
import type { PersistedWorkspaceState } from './use-workspace'
import { groupIdForWindow, pruneTabGroupSplitsState } from '@/workspace/tabs/tab-group-ops'

export async function confirmWorkspaceWindowsSequentially(
  windows: readonly WorkspaceWindowDefinition[],
  confirm: (hermes: WorkspaceWindowDefinition['hermes']) => Promise<boolean>,
) {
  for (const window of windows) {
    if (!(await confirm(window.hermes))) return false
  }
  return true
}

export function closeWorkspaceWindows(
  state: PersistedWorkspaceState,
  windowIds: ReadonlySet<string>,
): { state: PersistedWorkspaceState; removed: WorkspaceWindowDefinition[] } {
  const removed = state.windows.filter((window) => windowIds.has(window.id))
  if (removed.length === 0) return { state, removed }

  const selectedIds = new Set(removed.map((window) => window.id))
  const touchedGroups = new Set(removed.map(groupIdForWindow))
  const replacements = new Map<string, WorkspaceWindowDefinition>()
  const nextGroupByOriginalGroup = new Map<string, string | null>()
  const activeTabMap = { ...state.activeTabMap }
  const tabGroupSplits = { ...state.tabGroupSplits }

  for (const group of touchedGroups) {
    const members = state.windows.filter((window) => groupIdForWindow(window) === group)
    const remaining = members.filter((window) => !selectedIds.has(window.id))
    const split = state.tabGroupSplits?.[group]
    delete activeTabMap[group]
    delete tabGroupSplits[group]

    if (remaining.length === 0) {
      nextGroupByOriginalGroup.set(group, null)
      continue
    }

    if (remaining.length === 1) {
      nextGroupByOriginalGroup.set(group, null)
      replacements.set(remaining[0]!.id, { ...remaining[0]!, tabGroupId: null })
      continue
    }

    const nextGroup = remaining.some((window) => window.id === group) ? group : remaining[0]!.id
    nextGroupByOriginalGroup.set(group, nextGroup)
    if (nextGroup !== group) {
      for (const window of remaining) {
        replacements.set(window.id, { ...window, tabGroupId: nextGroup })
      }
    }

    const active = state.activeTabMap[group]
    activeTabMap[nextGroup] =
      active && remaining.some((window) => window.id === active) ? active : remaining[0]!.id

    if (split && !selectedIds.has(split.leftTabId)) {
      tabGroupSplits[nextGroup] = { ...split }
    }
  }

  const windows = state.windows
    .filter((window) => !selectedIds.has(window.id))
    .map((window) => replacements.get(window.id) ?? window)
  let activeWindowId = state.activeWindowId
  if (
    !activeWindowId ||
    selectedIds.has(activeWindowId) ||
    !windows.some((w) => w.id === activeWindowId)
  ) {
    const previousActive = state.windows.find((window) => window.id === state.activeWindowId)
    const previousGroup = previousActive ? groupIdForWindow(previousActive) : undefined
    const activeGroup =
      previousGroup && touchedGroups.has(previousGroup)
        ? (nextGroupByOriginalGroup.get(previousGroup) ?? null)
        : previousGroup
    activeWindowId =
      (activeGroup ? activeTabMap[activeGroup] : undefined) ??
      (activeGroup
        ? windows.find((window) => groupIdForWindow(window) === activeGroup)?.id
        : undefined) ??
      windows.at(-1)?.id ??
      null
  }

  const next = pruneTabGroupSplitsState({
    ...state,
    windows,
    activeWindowId,
    activeTabMap,
    tabGroupSplits: Object.keys(tabGroupSplits).length ? tabGroupSplits : undefined,
    canvas:
      state.canvas?.maximizedWindowId && selectedIds.has(state.canvas.maximizedWindowId)
        ? { ...state.canvas, maximizedWindowId: null }
        : state.canvas,
  })

  return { state: next, removed }
}
