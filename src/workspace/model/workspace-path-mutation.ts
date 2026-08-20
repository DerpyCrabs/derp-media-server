import type { PersistedWindowState } from '@/lib/models/window-model'
import { applyWindowPathMutation, type PathMutation } from '@/lib/files/path-mutation'
import { closeWorkspaceWindows } from './workspace-close'

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
    return changed ? { ...state, windows } : state
  }

  const removedIds = new Set<string>()
  let changed = false
  const windows = state.windows.map((window) => {
    const next = applyWindowPathMutation(window, mutation)
    if (!next) {
      removedIds.add(window.id)
      changed = true
      return window
    }
    if (next !== window) changed = true
    return next
  })

  if (!changed) return state
  const next = { ...state, windows }
  return removedIds.size === 0 ? next : closeWorkspaceWindows(next, removedIds).state
}
