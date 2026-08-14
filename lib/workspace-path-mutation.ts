import type {
  PersistedWorkspaceState,
  TabGroupSplitState,
  WorkspaceWindowDefinition,
} from '@/lib/use-workspace'
import type { InfiniteCanvasState } from '@/lib/infinite-canvas'

export type WorkspacePathMutation =
  | { type: 'path-moved'; oldPath: string; newPath: string }
  | { type: 'path-removed'; path: string }

export function parseWorkspacePathMutation(data: {
  type?: unknown
  path?: unknown
  oldPath?: unknown
  newPath?: unknown
}): WorkspacePathMutation | null {
  if (
    data.type === 'path-moved' &&
    typeof data.oldPath === 'string' &&
    typeof data.newPath === 'string'
  ) {
    return { type: data.type, oldPath: data.oldPath, newPath: data.newPath }
  }
  if (data.type === 'path-removed' && typeof data.path === 'string') {
    return { type: data.type, path: data.path }
  }
  return null
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

function pathIsWithin(path: string, parent: string): boolean {
  const normalizedPath = normalizePath(path)
  const normalizedParent = normalizePath(parent)
  return (
    normalizedPath === normalizedParent ||
    (normalizedParent.length > 0 && normalizedPath.startsWith(`${normalizedParent}/`))
  )
}

function movePath(path: string, oldPath: string, newPath: string): string {
  const normalizedPath = normalizePath(path)
  const normalizedOldPath = normalizePath(oldPath)
  const normalizedNewPath = normalizePath(newPath)
  if (normalizedPath === normalizedOldPath) return normalizedNewPath
  return `${normalizedNewPath}${normalizedPath.slice(normalizedOldPath.length)}`
}

function groupId(window: WorkspaceWindowDefinition): string {
  return window.tabGroupId ?? window.id
}

function authoritativeWindowPath(window: WorkspaceWindowDefinition): string | null | undefined {
  if (window.type === 'browser') {
    return typeof window.initialState.dir === 'string' ? window.initialState.dir : ''
  }
  if (window.type === 'viewer') {
    if (typeof window.initialState.viewing === 'string' && window.initialState.viewing.length > 0) {
      return window.initialState.viewing
    }
    if (typeof window.initialState.playing === 'string' && window.initialState.playing.length > 0) {
      return window.initialState.playing
    }
    return undefined
  }
  return null
}

function moveWindow(
  window: WorkspaceWindowDefinition,
  oldPath: string,
  newPath: string,
): WorkspaceWindowDefinition {
  let changed = false
  const initialState = { ...window.initialState }
  for (const key of ['dir', 'viewing', 'playing'] as const) {
    const path = initialState[key]
    if (typeof path !== 'string' || !pathIsWithin(path, oldPath)) continue
    initialState[key] = movePath(path, oldPath, newPath)
    changed = true
  }

  let iconPath = window.iconPath
  if (typeof iconPath === 'string' && pathIsWithin(iconPath, oldPath)) {
    iconPath = movePath(iconPath, oldPath, newPath)
    changed = true
  }

  let source = window.source
  if (typeof source.rootPath === 'string' && pathIsWithin(source.rootPath, oldPath)) {
    source = { ...source, rootPath: movePath(source.rootPath, oldPath, newPath) }
    changed = true
  }

  return changed ? { ...window, source, iconPath, initialState } : window
}

export function applyWorkspaceWindowPathMutation(
  window: WorkspaceWindowDefinition,
  mutation: WorkspacePathMutation,
): WorkspaceWindowDefinition | null {
  if (mutation.type === 'path-moved') return moveWindow(window, mutation.oldPath, mutation.newPath)
  const authoritativePath = authoritativeWindowPath(window)
  const shouldRemove =
    authoritativePath === undefined
      ? typeof window.iconPath === 'string' && pathIsWithin(window.iconPath, mutation.path)
      : authoritativePath !== null && pathIsWithin(authoritativePath, mutation.path)
  return shouldRemove ? null : clearRemovedSecondaryPaths(window, mutation.path)
}

export function applyCanvasPathMutation(
  state: InfiniteCanvasState,
  mutation: WorkspacePathMutation,
): InfiniteCanvasState {
  let changed = false
  const windows = state.windows.flatMap((window) => {
    const definition = applyWorkspaceWindowPathMutation(window.definition, mutation)
    if (!definition) {
      changed = true
      return []
    }
    if (definition === window.definition) return [window]
    changed = true
    return [{ ...window, definition }]
  })
  if (!changed) return state
  const maximizedWindowId = windows.some((window) => window.id === state.maximizedWindowId)
    ? state.maximizedWindowId
    : null
  return { ...state, windows, maximizedWindowId }
}

function clearRemovedSecondaryPaths(
  window: WorkspaceWindowDefinition,
  removedPath: string,
): WorkspaceWindowDefinition {
  let changed = false
  const initialState = { ...window.initialState }
  for (const key of ['dir', 'viewing', 'playing'] as const) {
    const path = initialState[key]
    if (typeof path !== 'string' || !pathIsWithin(path, removedPath)) continue
    initialState[key] = null
    changed = true
  }

  let iconPath = window.iconPath
  if (typeof iconPath === 'string' && pathIsWithin(iconPath, removedPath)) {
    iconPath = null
    changed = true
  }

  let source = window.source
  if (typeof source.rootPath === 'string' && pathIsWithin(source.rootPath, removedPath)) {
    source = { ...source, rootPath: null }
    changed = true
  }

  return changed ? { ...window, source, iconPath, initialState } : window
}

function sanitizeSplits(
  windows: WorkspaceWindowDefinition[],
  splits: Record<string, TabGroupSplitState> | undefined,
): Record<string, TabGroupSplitState> | undefined {
  if (!splits) return undefined
  const next: Record<string, TabGroupSplitState> = {}
  for (const [id, split] of Object.entries(splits)) {
    const members = windows.filter((window) => groupId(window) === id)
    if (!members.some((window) => window.id === split.leftTabId) || members.length < 2) continue
    next[id] = split
  }
  return Object.keys(next).length > 0 ? next : undefined
}

function sanitizeFocus(
  state: PersistedWorkspaceState,
  windows: WorkspaceWindowDefinition[],
  splits: Record<string, TabGroupSplitState> | undefined,
): Pick<PersistedWorkspaceState, 'activeTabMap' | 'activeWindowId'> {
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
  state: PersistedWorkspaceState,
  mutation: WorkspacePathMutation,
): PersistedWorkspaceState {
  if (mutation.type === 'path-moved') {
    let changed = false
    const windows = state.windows.map((window) => {
      const next = moveWindow(window, mutation.oldPath, mutation.newPath)
      if (next !== window) changed = true
      return next
    })
    const pinnedTaskbarItems = state.pinnedTaskbarItems.map((pin) => {
      if (!pathIsWithin(pin.path, mutation.oldPath)) return pin
      changed = true
      return { ...pin, path: movePath(pin.path, mutation.oldPath, mutation.newPath) }
    })
    return changed ? { ...state, windows, pinnedTaskbarItems } : state
  }

  const removedIds = new Set<string>()
  let changed = false
  const windows = state.windows.flatMap((window) => {
    const next = applyWorkspaceWindowPathMutation(window, mutation)
    if (!next) {
      removedIds.add(window.id)
      changed = true
      return []
    }
    if (next !== window) changed = true
    return [next]
  })

  const pinnedTaskbarItems = state.pinnedTaskbarItems.filter((pin) => {
    const remove = pathIsWithin(pin.path, mutation.path)
    if (remove) changed = true
    return !remove
  })
  if (!changed) return state
  if (removedIds.size === 0) return { ...state, windows, pinnedTaskbarItems }

  const tabGroupSplits = sanitizeSplits(windows, state.tabGroupSplits)
  const focus = sanitizeFocus(state, windows, tabGroupSplits)
  return { ...state, windows, pinnedTaskbarItems, tabGroupSplits, ...focus }
}
