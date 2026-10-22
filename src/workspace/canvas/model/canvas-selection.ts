import { modelOwner } from 'effectweb'
type Accessor<T> = () => T
import type { PersistedWindowState } from '@/lib/models/window-model'

export type CanvasSelectionState = {
  activeWindowId: string | null
  focusedId: string | null
  selectedIds: string[]
}

export function resolveCanvasSelection(
  state: CanvasSelectionState,
  snapshot: PersistedWindowState | null,
): CanvasSelectionState {
  const ids = new Set(snapshot?.windows.map((window) => window.id) ?? [])
  const activeWindowId =
    snapshot?.activeWindowId && ids.has(snapshot.activeWindowId) ? snapshot.activeWindowId : null
  if (state.activeWindowId !== activeWindowId) {
    return {
      activeWindowId,
      focusedId: activeWindowId,
      selectedIds: activeWindowId ? [activeWindowId] : [],
    }
  }
  const focusedId = state.focusedId && ids.has(state.focusedId) ? state.focusedId : null
  const selectedIds = state.selectedIds.every((id) => ids.has(id))
    ? state.selectedIds
    : state.selectedIds.filter((id) => ids.has(id))
  return focusedId === state.focusedId && selectedIds === state.selectedIds
    ? state
    : { activeWindowId, focusedId, selectedIds }
}

export function createCanvasSelection(options: {
  workspace: Accessor<PersistedWindowState | null>
}) {
  const initial = options.workspace()
  const initialActiveWindowId =
    initial?.activeWindowId &&
    initial.windows.some((window) => window.id === initial.activeWindowId)
      ? initial.activeWindowId
      : null
  const owner = modelOwner<CanvasSelectionState>({
    activeWindowId: initialActiveWindowId,
    focusedId: initialActiveWindowId,
    selectedIds: initialActiveWindowId ? [initialActiveWindowId] : [],
  })
  let previousState: CanvasSelectionState | undefined
  let previousDocument: PersistedWindowState | null | undefined
  let current: CanvasSelectionState
  const resolved = () => {
    const state = owner.read()
    const document = options.workspace()
    if (state !== previousState || document !== previousDocument) {
      const next = resolveCanvasSelection(state, document)
      const unchanged =
        current &&
        current.activeWindowId === next.activeWindowId &&
        current.focusedId === next.focusedId &&
        current.selectedIds.length === next.selectedIds.length &&
        current.selectedIds.every((id, index) => id === next.selectedIds[index])
      if (!unchanged) current = next
      previousState = state
      previousDocument = document
    }
    return current
  }
  const setLocal = (value: CanvasSelectionState) => owner.patch(value)

  function replace(id: string) {
    const current = resolved()
    setLocal({ ...current, focusedId: id, selectedIds: [id] })
  }

  function toggle(id: string) {
    const current = resolved()
    setLocal({
      ...current,
      focusedId: id,
      selectedIds: current.selectedIds.includes(id)
        ? current.selectedIds.filter((selectedId) => selectedId !== id)
        : [...current.selectedIds, id],
    })
  }

  function clear() {
    const current = resolved()
    setLocal({ ...current, focusedId: null, selectedIds: [] })
  }

  function selectAll(ids: string[]) {
    const current = resolved()
    setLocal({ ...current, selectedIds: ids })
  }

  function remove(ids: ReadonlySet<string>) {
    const current = resolved()
    setLocal({
      ...current,
      focusedId: current.focusedId && ids.has(current.focusedId) ? null : current.focusedId,
      selectedIds: current.selectedIds.filter((id) => !ids.has(id)),
    })
  }

  return {
    source: owner.source,
    dispose: owner.dispose,
    focusedId: () => resolved().focusedId,
    selectedIds: () => resolved().selectedIds,
    replace,
    toggle,
    clear,
    selectAll,
    remove,
  }
}
