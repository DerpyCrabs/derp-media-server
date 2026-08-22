import { createMemo, createSignal, type Accessor } from 'solid-js'
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
  return {
    activeWindowId,
    focusedId: state.focusedId && ids.has(state.focusedId) ? state.focusedId : null,
    selectedIds: state.selectedIds.filter((id) => ids.has(id)),
  }
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
  const [local, setLocal] = createSignal<CanvasSelectionState>({
    activeWindowId: initialActiveWindowId,
    focusedId: initialActiveWindowId,
    selectedIds: initialActiveWindowId ? [initialActiveWindowId] : [],
  })
  const resolved = createMemo(() => resolveCanvasSelection(local(), options.workspace()))

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
    focusedId: () => resolved().focusedId,
    selectedIds: () => resolved().selectedIds,
    replace,
    toggle,
    clear,
    selectAll,
    remove,
  }
}
