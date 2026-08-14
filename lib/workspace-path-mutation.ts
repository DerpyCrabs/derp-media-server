import type {
  PersistedWorkspaceState,
  TabGroupSplitState,
  WorkspaceWindowDefinition,
} from '@/lib/use-workspace'
import type { InfiniteCanvasState } from '@/lib/infinite-canvas'
import { workspaceTaskbarPinPath } from '@/lib/workspace-taskbar-pins'
import { filesystemResourceKey, physicalFilesystemResourceAddress } from '@/lib/domain/resource'
import { liveContentInstance } from '@/lib/content-window'
import type { ContentInstance } from '@/lib/domain/content'

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

function primaryPath(instance: ContentInstance): string | null {
  const key =
    instance.type === 'explorer'
      ? instance.location
      : instance.type === 'resource'
        ? instance.resource
        : null
  return key ? (physicalFilesystemResourceAddress(key)?.path ?? null) : null
}

function movedKey(
  key: { provider: string; id: string },
  oldPath: string,
  newPath: string,
): { provider: string; id: string } {
  const address = physicalFilesystemResourceAddress(key)
  if (!address || !pathIsWithin(address.path, oldPath)) return key
  return filesystemResourceKey(address.rootId, movePath(address.path, oldPath, newPath))
}

function moveWindow(
  window: WorkspaceWindowDefinition,
  oldPath: string,
  newPath: string,
): WorkspaceWindowDefinition {
  const instance = liveContentInstance(window)
  if (!instance || instance.type === 'integration') return window
  if (instance.type === 'explorer') {
    const location = movedKey(instance.location, oldPath, newPath)
    return location === instance.location
      ? window
      : { ...window, content: undefined, contentInstance: { ...instance, location } }
  }
  const resource = movedKey(instance.resource, oldPath, newPath)
  const context = instance.context ? movedKey(instance.context, oldPath, newPath) : undefined
  if (resource === instance.resource && context === instance.context) return window
  return {
    ...window,
    content: undefined,
    contentInstance: { ...instance, resource, ...(context ? { context } : {}) },
  }
}

export function applyWorkspaceWindowPathMutation(
  window: WorkspaceWindowDefinition,
  mutation: WorkspacePathMutation,
): WorkspaceWindowDefinition | null {
  if (mutation.type === 'path-moved') return moveWindow(window, mutation.oldPath, mutation.newPath)
  const instance = liveContentInstance(window)
  const path = instance ? primaryPath(instance) : null
  if (path !== null && pathIsWithin(path, mutation.path)) return null
  if (instance?.type !== 'resource' || !instance.context) return window
  const context = physicalFilesystemResourceAddress(instance.context)
  if (!context || !pathIsWithin(context.path, mutation.path)) return window
  const { context: _context, ...withoutContext } = instance
  return { ...window, content: undefined, contentInstance: withoutContext }
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
      const path = workspaceTaskbarPinPath(pin)
      if (path === null || !pathIsWithin(path, mutation.oldPath)) return pin
      const address = physicalFilesystemResourceAddress(pin.resource)
      if (!address) return pin
      changed = true
      return {
        ...pin,
        resource: filesystemResourceKey(
          address.rootId,
          movePath(path, mutation.oldPath, mutation.newPath),
        ),
      }
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
    const path = workspaceTaskbarPinPath(pin)
    const remove = path !== null && pathIsWithin(path, mutation.path)
    if (remove) changed = true
    return !remove
  })
  if (!changed) return state
  if (removedIds.size === 0) return { ...state, windows, pinnedTaskbarItems }

  const tabGroupSplits = sanitizeSplits(windows, state.tabGroupSplits)
  const focus = sanitizeFocus(state, windows, tabGroupSplits)
  return { ...state, windows, pinnedTaskbarItems, tabGroupSplits, ...focus }
}
