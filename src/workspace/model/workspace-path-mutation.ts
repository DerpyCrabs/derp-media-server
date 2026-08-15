import type { PersistedWindowState, WindowDefinition } from '@/lib/models/window-model'
import {
  applyWindowPathMutation,
  movePath,
  pathIsWithin,
  type PathMutation,
} from '@/lib/files/path-mutation'

function groupId(window: WindowDefinition): string {
  return window.tabGroupId ?? window.id
}

function sanitizeSplits(
  windows: WindowDefinition[],
  splits: PersistedWindowState['tabGroupSplits'],
): PersistedWindowState['tabGroupSplits'] {
  if (!splits) return undefined
  const next: NonNullable<PersistedWindowState['tabGroupSplits']> = {}
  for (const [id, split] of Object.entries(splits)) {
    const members = windows.filter((window) => groupId(window) === id)
    if (!members.some((window) => window.id === split.leftTabId) || members.length < 2) continue
    next[id] = split
  }
  return Object.keys(next).length > 0 ? next : undefined
}

function sanitizeFocus(
  state: PersistedWindowState,
  windows: WindowDefinition[],
  splits: PersistedWindowState['tabGroupSplits'],
): Pick<PersistedWindowState, 'activeTabMap' | 'activeWindowId'> {
  const byId = new Map(windows.map((window) => [window.id, window]))
  const previousActive = state.windows.find((window) => window.id === state.activeWindowId)
  const preferredGroup = previousActive ? groupId(previousActive) : null
  const activeTabMap: Record<string, string> = {}

  for (const [id, activeId] of Object.entries(state.activeTabMap)) {
    const active = byId.get(activeId)
    if (active && groupId(active) === id) {
      activeTabMap[id] = activeId
      continue
    }
    const splitLeftId = splits?.[id]?.leftTabId
    const replacement = windows.find(
      (window) => groupId(window) === id && window.id !== splitLeftId,
    )
    if (replacement) activeTabMap[id] = replacement.id
  }

  let activeWindowId = state.activeWindowId
  if (!activeWindowId || !byId.has(activeWindowId)) {
    activeWindowId =
      (preferredGroup ? activeTabMap[preferredGroup] : undefined) ??
      (preferredGroup
        ? windows.find((window) => groupId(window) === preferredGroup)?.id
        : undefined) ??
      windows.at(-1)?.id ??
      null
  }

  if (activeWindowId) {
    const activeGroup = groupId(byId.get(activeWindowId)!)
    const split = splits?.[activeGroup]
    if (split?.leftTabId === activeWindowId) {
      const right = windows.find(
        (window) => groupId(window) === activeGroup && window.id !== split.leftTabId,
      )
      if (right) activeWindowId = right.id
    }
  }

  return { activeTabMap, activeWindowId }
}

export function applyWorkspacePathMutation(
  state: PersistedWindowState,
  mutation: PathMutation,
): PersistedWindowState {
  if (mutation.type === 'path-moved') {
    let changed = false
    const windows = state.windows.map((window) => {
      const next = applyWindowPathMutation(window, mutation)
      if (next !== window) changed = true
      return next ?? window
    })
    const pinnedTaskbarItems = state.pinnedTaskbarItems.map((pin) => {
      if (pin.source.kind !== 'local' || !pathIsWithin(pin.path, mutation.oldPath)) return pin
      changed = true
      return { ...pin, path: movePath(pin.path, mutation.oldPath, mutation.newPath) }
    })
    return changed ? { ...state, windows, pinnedTaskbarItems } : state
  }

  const removedIds = new Set<string>()
  let changed = false
  const windows = state.windows.flatMap((window) => {
    const next = applyWindowPathMutation(window, mutation)
    if (!next) {
      removedIds.add(window.id)
      changed = true
      return []
    }
    if (next !== window) changed = true
    return [next]
  })

  const pinnedTaskbarItems = state.pinnedTaskbarItems.filter((pin) => {
    const remove = pin.source.kind === 'local' && pathIsWithin(pin.path, mutation.path)
    if (remove) changed = true
    return !remove
  })
  if (!changed) return state
  if (removedIds.size === 0) return { ...state, windows, pinnedTaskbarItems }

  const tabGroupSplits = sanitizeSplits(windows, state.tabGroupSplits)
  const focus = sanitizeFocus(state, windows, tabGroupSplits)
  return { ...state, windows, pinnedTaskbarItems, tabGroupSplits, ...focus }
}
