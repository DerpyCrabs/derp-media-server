import {
  normalizePersistedWorkspaceState,
  serializeWorkspaceLayoutState,
  type PersistedWorkspaceState,
} from '@/lib/use-workspace'
import { getWorkspaceFileOpenTarget } from '@/lib/workspace-file-open-target'
import { createMemo, createSignal, type Accessor, type Setter } from 'solid-js'

/** Deep copy via JSON — safe for layout baselines; `structuredClone` throws on non-cloneable runtime refs. */
function clonePersistedWorkspaceJson(s: PersistedWorkspaceState): PersistedWorkspaceState {
  return JSON.parse(JSON.stringify(s)) as PersistedWorkspaceState
}

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
        fileOpenTarget: getWorkspaceFileOpenTarget(),
      }
    }
    return {
      windows: w.windows,
      activeWindowId: w.activeWindowId,
      activeTabMap: { ...w.activeTabMap },
      nextWindowId: w.nextWindowId,
      pinnedTaskbarItems: w.pinnedTaskbarItems ?? [],
      fileOpenTarget: w.fileOpenTarget ?? getWorkspaceFileOpenTarget(),
      ...(w.tabGroupSplits && Object.keys(w.tabGroupSplits).length > 0
        ? { tabGroupSplits: { ...w.tabGroupSplits } }
        : {}),
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
      fileOpenTarget: normalized.fileOpenTarget ?? prev?.fileOpenTarget,
    }
    const clone = clonePersistedWorkspaceJson(merged)
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
    applyLayoutSnapshot(clonePersistedWorkspaceJson(snap))
  }

  function syncLayoutBaselineToCurrent() {
    const snap = collectLayoutSnapshot()
    const clone = clonePersistedWorkspaceJson(snap)
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
