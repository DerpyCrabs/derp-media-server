import { create } from 'zustand'

export interface WindowLayoutOverlay {
  zIndex?: number
  minimized?: boolean
  /** Ephemeral bounds during snapped resize (committed to session on resize end). */
  bounds?: { x: number; y: number; width: number; height: number }
}

export interface WorkspaceFocusState {
  activeWindowId: string | null
  activeTabMap: Record<string, string>
  /**
   * Per tab-group most-recently-used order (most recent first). Drives which tab is
   * activated after closing the current tab (browser-like). Not persisted.
   */
  tabMruByGroup?: Record<string, string[]>
  /** Overlay layout (zIndex, minimized) so focus/minimize don't mutate windows array. */
  layoutByWindowId?: Record<string, WindowLayoutOverlay>
}

export function seedTabMruFromActiveTabMap(
  activeTabMap: Record<string, string>,
): Record<string, string[]> | undefined {
  const out: Record<string, string[]> = {}
  for (const [groupId, windowId] of Object.entries(activeTabMap)) {
    if (windowId) out[groupId] = [windowId]
  }
  return Object.keys(out).length > 0 ? out : undefined
}

const DEFAULT_FOCUS: WorkspaceFocusState = {
  activeWindowId: null,
  activeTabMap: {},
}

interface WorkspaceFocusStore {
  /** Focus state per storage key (main app vs share view). */
  byKey: Record<string, WorkspaceFocusState>

  /** Hydrate focus state for a key (e.g. from persisted state). Only sets if key not yet hydrated. */
  hydrateIfNeeded: (key: string, state: Partial<WorkspaceFocusState> | null) => void

  setActiveWindowId: (key: string, windowId: string | null) => void
  setActiveTab: (key: string, tabGroupId: string, windowId: string) => void

  /** Set layout overlay for a window (zIndex, minimized). Keeps windows ref stable on focus. */
  setWindowLayoutOverlay: (key: string, windowId: string, overlay: WindowLayoutOverlay) => void
  /** Set layout overlay for all windows in a group (e.g. on focus). */
  setGroupLayoutOverlay: (key: string, windowIds: string[], overlay: WindowLayoutOverlay) => void

  /** Batch-merge layout overlays in one store update (e.g. live snapped resize). */
  mergeLayoutOverlays: (key: string, partials: Record<string, Partial<WindowLayoutOverlay>>) => void
  /** Remove ephemeral `bounds` from overlays after resize commit. */
  clearLayoutOverlayBounds: (key: string, windowIds: string[]) => void

  /** Update activeTabMap for a key (e.g. when closing a tab or merging groups). */
  setActiveTabMap: (
    key: string,
    updater: (prev: Record<string, string>) => Record<string, string>,
  ) => void

  /** Remove a window id from a group's MRU list (e.g. tab closed or split out). */
  pruneTabFromGroupMru: (key: string, tabGroupId: string, windowId: string) => void

  /** Get focus state for a key (for selectors and persistence). */
  getFocusState: (key: string) => WorkspaceFocusState

  /** Replace focus state entirely (e.g. restore named layout). */
  replaceFocusState: (key: string, state: WorkspaceFocusState) => void
}

export const useWorkspaceFocusStore = create<WorkspaceFocusStore>((set, get) => ({
  byKey: {},

  hydrateIfNeeded(key, state) {
    const { byKey } = get()
    if (byKey[key] !== undefined) return
    set({
      byKey: {
        ...byKey,
        [key]: state
          ? {
              activeWindowId: state.activeWindowId ?? null,
              activeTabMap: state.activeTabMap ?? {},
              tabMruByGroup:
                state.tabMruByGroup && Object.keys(state.tabMruByGroup).length > 0
                  ? state.tabMruByGroup
                  : seedTabMruFromActiveTabMap(state.activeTabMap ?? {}),
              layoutByWindowId: state.layoutByWindowId,
            }
          : { ...DEFAULT_FOCUS },
      },
    })
  },

  setActiveWindowId(key, windowId) {
    set((s) => ({
      byKey: {
        ...s.byKey,
        [key]: {
          ...(s.byKey[key] ?? DEFAULT_FOCUS),
          activeWindowId: windowId,
        },
      },
    }))
  },

  setActiveTab(key, tabGroupId, windowId) {
    set((s) => {
      const prevFocus = s.byKey[key] ?? DEFAULT_FOCUS
      const prevMru = prevFocus.tabMruByGroup ?? {}
      const groupMru = prevMru[tabGroupId] ?? []
      const bumped = [windowId, ...groupMru.filter((id) => id !== windowId)]
      return {
        byKey: {
          ...s.byKey,
          [key]: {
            ...prevFocus,
            activeTabMap: {
              ...(prevFocus.activeTabMap ?? {}),
              [tabGroupId]: windowId,
            },
            tabMruByGroup: { ...prevMru, [tabGroupId]: bumped },
          },
        },
      }
    })
  },

  setWindowLayoutOverlay(key, windowId, overlay) {
    set((s) => {
      const prev = s.byKey[key]?.layoutByWindowId ?? {}
      const next = { ...prev, [windowId]: { ...prev[windowId], ...overlay } }
      return {
        byKey: {
          ...s.byKey,
          [key]: {
            ...(s.byKey[key] ?? DEFAULT_FOCUS),
            layoutByWindowId: next,
          },
        },
      }
    })
  },

  setGroupLayoutOverlay(key, windowIds, overlay) {
    set((s) => {
      const prev = s.byKey[key]?.layoutByWindowId ?? {}
      let next = prev
      for (const id of windowIds) {
        next = { ...next, [id]: { ...next[id], ...overlay } }
      }
      return {
        byKey: {
          ...s.byKey,
          [key]: {
            ...(s.byKey[key] ?? DEFAULT_FOCUS),
            layoutByWindowId: next,
          },
        },
      }
    })
  },

  mergeLayoutOverlays(key, partials) {
    set((s) => {
      const prev = s.byKey[key]?.layoutByWindowId ?? {}
      let next = { ...prev }
      for (const [windowId, partial] of Object.entries(partials)) {
        next = { ...next, [windowId]: { ...next[windowId], ...partial } }
      }
      return {
        byKey: {
          ...s.byKey,
          [key]: {
            ...(s.byKey[key] ?? DEFAULT_FOCUS),
            layoutByWindowId: next,
          },
        },
      }
    })
  },

  clearLayoutOverlayBounds(key, windowIds) {
    set((s) => {
      const prev = s.byKey[key]?.layoutByWindowId ?? {}
      let next = { ...prev }
      for (const id of windowIds) {
        const cur = next[id]
        if (!cur || cur.bounds === undefined) continue
        const { bounds, ...rest } = cur
        void bounds
        if (Object.keys(rest).length === 0) {
          const { [id]: _, ...restMap } = next
          next = restMap
        } else {
          next = { ...next, [id]: rest }
        }
      }
      return {
        byKey: {
          ...s.byKey,
          [key]: {
            ...(s.byKey[key] ?? DEFAULT_FOCUS),
            layoutByWindowId: next,
          },
        },
      }
    })
  },

  setActiveTabMap(key, updater) {
    set((s) => ({
      byKey: {
        ...s.byKey,
        [key]: {
          ...(s.byKey[key] ?? DEFAULT_FOCUS),
          activeTabMap: updater(s.byKey[key]?.activeTabMap ?? {}),
        },
      },
    }))
  },

  pruneTabFromGroupMru(key, tabGroupId, windowId) {
    set((s) => {
      const prevFocus = s.byKey[key] ?? DEFAULT_FOCUS
      const prevMru = prevFocus.tabMruByGroup ?? {}
      const groupMru = prevMru[tabGroupId]
      if (!groupMru?.length) return s
      const filtered = groupMru.filter((id) => id !== windowId)
      if (filtered.length === groupMru.length) return s
      const nextMru = { ...prevMru, [tabGroupId]: filtered }
      if (filtered.length === 0) {
        const { [tabGroupId]: _, ...rest } = nextMru
        return {
          byKey: {
            ...s.byKey,
            [key]: {
              ...prevFocus,
              tabMruByGroup: Object.keys(rest).length > 0 ? rest : undefined,
            },
          },
        }
      }
      return {
        byKey: {
          ...s.byKey,
          [key]: {
            ...prevFocus,
            tabMruByGroup: nextMru,
          },
        },
      }
    })
  },

  getFocusState(key) {
    return get().byKey[key] ?? DEFAULT_FOCUS
  },

  replaceFocusState(key, state) {
    const tabMruByGroup =
      state.tabMruByGroup && Object.keys(state.tabMruByGroup).length > 0
        ? state.tabMruByGroup
        : seedTabMruFromActiveTabMap(state.activeTabMap ?? {})
    set((s) => ({
      byKey: {
        ...s.byKey,
        [key]: {
          activeWindowId: state.activeWindowId ?? null,
          activeTabMap: state.activeTabMap ?? {},
          tabMruByGroup,
          layoutByWindowId: state.layoutByWindowId,
        },
      },
    }))
  },
}))
