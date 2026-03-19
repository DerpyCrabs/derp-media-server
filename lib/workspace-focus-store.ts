import { create } from 'zustand'

export interface WindowLayoutOverlay {
  zIndex?: number
  minimized?: boolean
}

export interface WorkspaceFocusState {
  activeWindowId: string | null
  activeTabMap: Record<string, string>
  /** Overlay layout (zIndex, minimized) so focus/minimize don't mutate windows array. */
  layoutByWindowId?: Record<string, WindowLayoutOverlay>
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

  /** Update activeTabMap for a key (e.g. when closing a tab or merging groups). */
  setActiveTabMap: (
    key: string,
    updater: (prev: Record<string, string>) => Record<string, string>,
  ) => void

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
    set((s) => ({
      byKey: {
        ...s.byKey,
        [key]: {
          ...(s.byKey[key] ?? DEFAULT_FOCUS),
          activeTabMap: {
            ...(s.byKey[key]?.activeTabMap ?? {}),
            [tabGroupId]: windowId,
          },
        },
      },
    }))
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

  getFocusState(key) {
    return get().byKey[key] ?? DEFAULT_FOCUS
  },

  replaceFocusState(key, state) {
    set((s) => ({
      byKey: {
        ...s.byKey,
        [key]: {
          activeWindowId: state.activeWindowId ?? null,
          activeTabMap: state.activeTabMap ?? {},
          layoutByWindowId: state.layoutByWindowId,
        },
      },
    }))
  },
}))
