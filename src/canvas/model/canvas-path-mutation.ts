import { applyWindowPathMutation, type PathMutation } from '@/lib/files/path-mutation'
import type { InfiniteCanvasState } from './infinite-canvas'

export function applyCanvasPathMutation(
  state: InfiniteCanvasState,
  mutation: PathMutation,
): InfiniteCanvasState {
  let changed = false
  const windows = state.windows.flatMap((window) => {
    const definition = applyWindowPathMutation(window.definition, mutation)
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
