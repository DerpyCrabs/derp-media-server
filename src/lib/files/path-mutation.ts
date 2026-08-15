import type { WindowDefinition } from '@/lib/models/window-model'

export type PathMutation =
  | { type: 'path-moved'; oldPath: string; newPath: string }
  | { type: 'path-removed'; path: string }

export function parsePathMutation(data: {
  type?: unknown
  path?: unknown
  oldPath?: unknown
  newPath?: unknown
}): PathMutation | null {
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

export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '')
}

export function pathIsWithin(path: string, parent: string): boolean {
  const normalizedPath = normalizePath(path)
  const normalizedParent = normalizePath(parent)
  return (
    normalizedPath === normalizedParent ||
    (normalizedParent.length > 0 && normalizedPath.startsWith(`${normalizedParent}/`))
  )
}

export function movePath(path: string, oldPath: string, newPath: string): string {
  const normalizedPath = normalizePath(path)
  const normalizedOldPath = normalizePath(oldPath)
  const normalizedNewPath = normalizePath(newPath)
  if (normalizedPath === normalizedOldPath) return normalizedNewPath
  return `${normalizedNewPath}${normalizedPath.slice(normalizedOldPath.length)}`
}

function authoritativeWindowPath(window: WindowDefinition): string | null | undefined {
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

function moveWindow(window: WindowDefinition, oldPath: string, newPath: string): WindowDefinition {
  if (window.source.kind !== 'local' || window.type === 'hermes') return window
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

function clearRemovedSecondaryPaths(
  window: WindowDefinition,
  removedPath: string,
): WindowDefinition {
  if (window.source.kind !== 'local' || window.type === 'hermes') return window
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

export function applyWindowPathMutation(
  window: WindowDefinition,
  mutation: PathMutation,
): WindowDefinition | null {
  if (mutation.type === 'path-moved') return moveWindow(window, mutation.oldPath, mutation.newPath)
  if (window.source.kind !== 'local' || window.type === 'hermes') return window
  const authoritativePath = authoritativeWindowPath(window)
  const shouldRemove =
    authoritativePath === undefined
      ? typeof window.iconPath === 'string' && pathIsWithin(window.iconPath, mutation.path)
      : authoritativePath !== null && pathIsWithin(authoritativePath, mutation.path)
  return shouldRemove ? null : clearRemovedSecondaryPaths(window, mutation.path)
}
