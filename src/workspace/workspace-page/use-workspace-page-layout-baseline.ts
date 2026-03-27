import {
  normalizePersistedWorkspaceState,
  serializeWorkspaceLayoutState,
  type PersistedWorkspaceState,
} from '@/lib/use-workspace'
import { createMemo, createSignal, type Accessor, type Setter } from 'solid-js'

export function useWorkspacePageLayoutBaseline(
  workspace: Accessor<PersistedWorkspaceState | null>,
  setWorkspace: Setter<PersistedWorkspaceState | null>,
) {
  const [layoutBaselinePresetId, setLayoutBaselinePresetId] = createSignal<string | null>(null)
  const [layoutBaselineSerialized, setLayoutBaselineSerialized] = createSignal<string | null>(null)
  const [layoutBaselineSnapshot, setLayoutBaselineSnapshot] =
    createSignal<PersistedWorkspaceState | null>(null)

  function collectLayoutSnapshot(): PersistedWorkspaceState {
    const w = workspace()
    if (!w) {
      return {
        windows: [],
        activeWindowId: null,
        activeTabMap: {},
        nextWindowId: 2,
        pinnedTaskbarItems: [],
      }
    }
    return {
      windows: w.windows,
      activeWindowId: w.activeWindowId,
      activeTabMap: { ...w.activeTabMap },
      nextWindowId: w.nextWindowId,
      pinnedTaskbarItems: w.pinnedTaskbarItems ?? [],
      ...(w.browserTabTitle ? { browserTabTitle: w.browserTabTitle } : {}),
      ...(w.browserTabIcon ? { browserTabIcon: w.browserTabIcon } : {}),
      ...(w.browserTabIconColor ? { browserTabIconColor: w.browserTabIconColor } : {}),
    }
  }

  function applyLayoutSnapshot(
    snapshot: PersistedWorkspaceState,
    options?: { baselinePresetId?: string | null },
  ) {
    const normalized = normalizePersistedWorkspaceState(snapshot)
    if (!normalized?.windows.length) return
    const prev = workspace()
    const merged: PersistedWorkspaceState = {
      ...normalized,
      browserTabTitle: normalized.browserTabTitle ?? prev?.browserTabTitle,
      browserTabIcon: normalized.browserTabIcon ?? prev?.browserTabIcon,
      browserTabIconColor: normalized.browserTabIconColor ?? prev?.browserTabIconColor,
    }
    const clone = structuredClone(merged)
    setWorkspace(merged)
    setLayoutBaselineSerialized(serializeWorkspaceLayoutState(clone))
    setLayoutBaselineSnapshot(clone)
    if (options && 'baselinePresetId' in options) {
      setLayoutBaselinePresetId(options.baselinePresetId ?? null)
    }
  }

  function revertLayoutToBaseline() {
    const snap = layoutBaselineSnapshot()
    if (!snap) return
    applyLayoutSnapshot(structuredClone(snap))
  }

  function syncLayoutBaselineToCurrent() {
    const snap = collectLayoutSnapshot()
    const clone = structuredClone(snap)
    setLayoutBaselineSerialized(serializeWorkspaceLayoutState(clone))
    setLayoutBaselineSnapshot(clone)
  }

  function declareBaselinePresetId(id: string | null) {
    setLayoutBaselinePresetId(id)
  }

  function resetLayoutBaseline() {
    setLayoutBaselinePresetId(null)
    setLayoutBaselineSerialized(null)
    setLayoutBaselineSnapshot(null)
  }

  const isLayoutDirty = createMemo(() => {
    const b = layoutBaselineSerialized()
    if (b == null) return false
    return serializeWorkspaceLayoutState(collectLayoutSnapshot()) !== b
  })

  return {
    layoutBaselinePresetId,
    layoutBaselineSerialized,
    layoutBaselineSnapshot,
    setLayoutBaselinePresetId,
    setLayoutBaselineSerialized,
    setLayoutBaselineSnapshot,
    resetLayoutBaseline,
    collectLayoutSnapshot,
    applyLayoutSnapshot,
    revertLayoutToBaseline,
    syncLayoutBaselineToCurrent,
    declareBaselinePresetId,
    isLayoutDirty,
  }
}
