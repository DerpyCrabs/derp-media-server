import { create } from 'zustand'
import type { NavigationState } from '@/lib/navigation-session'
import { MediaType } from '@/lib/types'
import type {
  PersistedWorkspaceState,
  PinnedTaskbarItem,
  SnapZone,
  WorkspaceSource,
  WorkspaceWindowDefinition,
  WorkspaceWindowLayout,
} from '@/lib/use-workspace'
import { hydrateFocusFromPersisted } from '@/lib/workspace-core'
import {
  createDefaultBounds,
  createFullscreenBounds,
  createWindowLayout,
  getInitialWindowIcon,
  getPlaybackTitle,
  getSourceLabel,
  insertWindowAtGroupIndex,
  isVideoPath,
  PLAYER_WINDOW_ID,
  SNAP_SIBLING_MAP,
  snapZoneToBounds,
  snapZoneToBoundsWithOccupied,
} from '@/lib/workspace-geometry'
import { useWorkspaceFocusStore } from '@/lib/workspace-focus-store'

function sortTabMapKeys(map: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(map).sort(([a], [b]) => a.localeCompare(b)))
}

function serializeForBaseline(state: PersistedWorkspaceState): string {
  return JSON.stringify({
    windows: state.windows,
    activeWindowId: state.activeWindowId,
    activeTabMap: sortTabMapKeys(state.activeTabMap ?? {}),
    nextWindowId: state.nextWindowId,
    pinnedTaskbarItems: state.pinnedTaskbarItems ?? [],
  })
}

export interface WorkspaceSessionSlice {
  windowsById: Record<string, WorkspaceWindowDefinition>
  windowIds: string[]
  nextWindowId: number
  nextZIndex: number
  pinnedTaskbarItems: PinnedTaskbarItem[]
  playbackSource: WorkspaceSource | null
  layoutBaselinePresetId: string | null
  layoutBaselineSerialized: string | null
  layoutBaselineSnapshot: PersistedWorkspaceState | null
}

interface OpenWorkspaceWindowOptions {
  title?: string
  source?: WorkspaceSource
  initialState?: Partial<NavigationState>
  tabGroupId?: string | null
  layout?: WorkspaceWindowLayout
  insertIndex?: number
}

export function windowsArrayToNormalized(windows: WorkspaceWindowDefinition[]): {
  windowsById: Record<string, WorkspaceWindowDefinition>
  windowIds: string[]
} {
  const windowsById: Record<string, WorkspaceWindowDefinition> = {}
  const windowIds: string[] = []
  for (const w of windows) {
    windowsById[w.id] = w
    windowIds.push(w.id)
  }
  return { windowsById, windowIds }
}

export function normalizedWindowsToArray(
  session: Pick<WorkspaceSessionSlice, 'windowsById' | 'windowIds'>,
): WorkspaceWindowDefinition[] {
  return session.windowIds.map((id) => session.windowsById[id]).filter(Boolean)
}

export function buildWorkspaceSessionSlice(
  windows: WorkspaceWindowDefinition[],
  nextWindowId: number,
  nextZIndex: number,
  pinnedTaskbarItems: PinnedTaskbarItem[],
  playbackSource: WorkspaceSource | null,
  layoutBaselinePresetId: string | null,
  layoutBaselineSerialized: string | null,
  layoutBaselineSnapshot: PersistedWorkspaceState | null,
): WorkspaceSessionSlice {
  const { windowsById, windowIds } = windowsArrayToNormalized(windows)
  return {
    windowsById,
    windowIds,
    nextWindowId,
    nextZIndex,
    pinnedTaskbarItems,
    playbackSource,
    layoutBaselinePresetId,
    layoutBaselineSerialized,
    layoutBaselineSnapshot,
  }
}

export function selectOrderedGroupIds(
  sessions: Record<string, WorkspaceSessionSlice>,
  storageKey: string,
): string[] {
  const session = sessions[storageKey]
  if (!session) return []
  const seen = new Set<string>()
  const order: string[] = []
  for (const id of session.windowIds) {
    const w = session.windowsById[id]
    if (!w) continue
    const gid = w.tabGroupId ?? w.id
    if (!seen.has(gid)) {
      seen.add(gid)
      order.push(gid)
    }
  }
  return order
}

export function selectGroupTabs(
  sessions: Record<string, WorkspaceSessionSlice>,
  storageKey: string,
  groupId: string,
): WorkspaceWindowDefinition[] {
  const session = sessions[storageKey]
  if (!session) return []
  return session.windowIds
    .filter((id) => {
      const w = session.windowsById[id]
      return w && (w.tabGroupId ?? w.id) === groupId
    })
    .map((id) => session.windowsById[id])
}

interface WorkspaceSessionStore {
  sessions: Record<string, WorkspaceSessionSlice>
  replaceSession: (key: string, slice: WorkspaceSessionSlice) => void
  updateWindow: (
    key: string,
    windowId: string,
    updater: (window: WorkspaceWindowDefinition) => WorkspaceWindowDefinition,
  ) => void
  applyWindows: (
    key: string,
    fn: (
      windows: WorkspaceWindowDefinition[],
      session: WorkspaceSessionSlice,
    ) => WorkspaceWindowDefinition[] | null,
  ) => void
  setPinnedTaskbarItems: (key: string, items: PinnedTaskbarItem[]) => void
  setPlaybackSource: (key: string, source: WorkspaceSource | null) => void
  setLayoutBaselinePresetId: (key: string, id: string | null) => void
  setLayoutBaselineSerialized: (key: string, serialized: string | null) => void
  setLayoutBaselineSnapshot: (key: string, snapshot: PersistedWorkspaceState | null) => void
  syncLayoutBaselineToCurrent: (key: string) => void
  syncWindowBoundsFromViewport: (key: string) => void
  collectLayoutSnapshot: (key: string) => PersistedWorkspaceState | null
  applyLayoutSnapshot: (
    key: string,
    snapshot: PersistedWorkspaceState,
    options?: { baselinePresetId?: string | null },
  ) => void
  addPinnedItem: (key: string, item: Omit<PinnedTaskbarItem, 'id'>) => void
  removePinnedItem: (key: string, id: string) => void
  createWindow: (
    key: string,
    type: WorkspaceWindowDefinition['type'],
    options: OpenWorkspaceWindowOptions,
    defaultSource: WorkspaceSource,
  ) => string
  focusWindow: (key: string, windowId: string) => void
  openPlayerWindow: (
    key: string,
    options:
      | {
          path?: string
          source?: WorkspaceSource
          playingPath: string | null
          defaultSource: WorkspaceSource
        }
      | undefined,
  ) => string | null
  closeWindow: (key: string, windowId: string) => void
  requestPlay: (
    key: string,
    args: { source: WorkspaceSource; path: string; isVideo: boolean },
  ) => void
  snapWindow: (key: string, windowId: string, zone: SnapZone) => void
  unsnapWindow: (key: string, windowId: string, dropPosition?: { x: number; y: number }) => void
  resizeSnappedWindow: (
    key: string,
    windowId: string,
    newBounds: NonNullable<WorkspaceWindowLayout['bounds']>,
    direction: string,
  ) => void
  mergeWindowIntoGroup: (
    key: string,
    windowId: string,
    targetWindowId: string,
    insertIndex?: number,
  ) => void
  splitWindowFromGroup: (
    key: string,
    windowId: string,
    offsetBounds?: NonNullable<WorkspaceWindowLayout['bounds']>,
  ) => void
  addTabToGroup: (key: string, sourceWindowId: string) => string
  updateWindowNavigationState: (
    key: string,
    windowId: string,
    navState: Partial<NavigationState>,
  ) => void
  toggleWindowFullscreen: (key: string, windowId: string) => void
}

function bumpWindowsSlice(
  session: WorkspaceSessionSlice,
  nextWindows: WorkspaceWindowDefinition[],
  nextNextId?: number,
  nextZ?: number,
): WorkspaceSessionSlice {
  const { windowsById, windowIds } = windowsArrayToNormalized(nextWindows)
  return {
    ...session,
    windowsById,
    windowIds,
    ...(nextNextId != null ? { nextWindowId: nextNextId } : {}),
    ...(nextZ != null ? { nextZIndex: nextZ } : {}),
  }
}

export const useWorkspaceSessionStore = create<WorkspaceSessionStore>((set, get) => ({
  sessions: {},

  replaceSession(key, slice) {
    set((s) => ({ sessions: { ...s.sessions, [key]: slice } }))
  },

  updateWindow(key, windowId, updater) {
    set((state) => {
      const session = state.sessions[key]
      if (!session) return state
      const w = session.windowsById[windowId]
      if (!w) return state
      const updated = updater(w)
      if (updated === w) return state
      return {
        sessions: {
          ...state.sessions,
          [key]: {
            ...session,
            windowsById: { ...session.windowsById, [windowId]: updated },
          },
        },
      }
    })
  },

  applyWindows(key, fn) {
    set((state) => {
      const session = state.sessions[key]
      if (!session) return state
      const arr = normalizedWindowsToArray(session)
      const next = fn(arr, session)
      if (next == null || next === arr) return state
      const { windowsById, windowIds } = windowsArrayToNormalized(next)
      return {
        sessions: {
          ...state.sessions,
          [key]: { ...session, windowsById, windowIds },
        },
      }
    })
  },

  setPinnedTaskbarItems(key, items) {
    set((state) => {
      const session = state.sessions[key]
      if (!session) return state
      return {
        sessions: { ...state.sessions, [key]: { ...session, pinnedTaskbarItems: items } },
      }
    })
  },

  setPlaybackSource(key, source) {
    set((state) => {
      const session = state.sessions[key]
      if (!session) return state
      return {
        sessions: { ...state.sessions, [key]: { ...session, playbackSource: source } },
      }
    })
  },

  setLayoutBaselinePresetId(key, id) {
    set((state) => {
      const session = state.sessions[key]
      if (!session) return state
      return {
        sessions: { ...state.sessions, [key]: { ...session, layoutBaselinePresetId: id } },
      }
    })
  },

  setLayoutBaselineSerialized(key, serialized) {
    set((state) => {
      const session = state.sessions[key]
      if (!session) return state
      return {
        sessions: {
          ...state.sessions,
          [key]: { ...session, layoutBaselineSerialized: serialized },
        },
      }
    })
  },

  setLayoutBaselineSnapshot(key, snapshot) {
    set((state) => {
      const session = state.sessions[key]
      if (!session) return state
      return {
        sessions: { ...state.sessions, [key]: { ...session, layoutBaselineSnapshot: snapshot } },
      }
    })
  },

  syncLayoutBaselineToCurrent(key) {
    const snap = get().collectLayoutSnapshot(key)
    if (!snap) return
    const clone = JSON.parse(JSON.stringify(snap)) as PersistedWorkspaceState
    set((state) => {
      const session = state.sessions[key]
      if (!session) return state
      return {
        sessions: {
          ...state.sessions,
          [key]: {
            ...session,
            layoutBaselineSnapshot: clone,
            layoutBaselineSerialized: serializeForBaseline(clone),
          },
        },
      }
    })
  },

  syncWindowBoundsFromViewport(key) {
    const fsBounds = createFullscreenBounds()
    get().applyWindows(key, (current) => {
      let hasChanges = false
      const nextWindows = current.map((w) => {
        if (w.layout?.fullscreen) {
          const cur = w.layout.bounds
          if (
            cur &&
            cur.x === fsBounds.x &&
            cur.y === fsBounds.y &&
            cur.width === fsBounds.width &&
            cur.height === fsBounds.height
          ) {
            return w
          }
          hasChanges = true
          return { ...w, layout: { ...w.layout, bounds: fsBounds } }
        }
        if (w.layout?.snapZone) {
          const snapBounds = snapZoneToBounds(w.layout.snapZone)
          const cur = w.layout.bounds
          if (
            cur &&
            cur.x === snapBounds.x &&
            cur.y === snapBounds.y &&
            cur.width === snapBounds.width &&
            cur.height === snapBounds.height
          ) {
            return w
          }
          hasChanges = true
          return { ...w, layout: { ...w.layout, bounds: snapBounds } }
        }
        return w
      })
      return hasChanges ? nextWindows : null
    })
  },

  collectLayoutSnapshot(key) {
    const session = get().sessions[key]
    if (!session) return null
    const focus = useWorkspaceFocusStore.getState().getFocusState(key)
    const layoutOverlay = focus.layoutByWindowId ?? {}
    const windowsToSave = normalizedWindowsToArray(session).map((w) => ({
      ...w,
      layout: w.layout ? { ...w.layout, ...layoutOverlay[w.id] } : undefined,
    }))
    return {
      windows: windowsToSave.filter((w) => w.id !== PLAYER_WINDOW_ID),
      activeWindowId: focus.activeWindowId,
      activeTabMap: focus.activeTabMap,
      nextWindowId: session.nextWindowId,
      pinnedTaskbarItems: session.pinnedTaskbarItems,
    }
  },

  applyLayoutSnapshot(key, snapshot, options) {
    if (!snapshot.windows.length) return
    hydrateFocusFromPersisted(key, snapshot)
    const maxId = snapshot.windows.reduce((max, w) => {
      const match = w.id.match(/workspace-window-(\d+)/)
      return match ? Math.max(max, Number(match[1])) : max
    }, 1)
    const maxZ = snapshot.windows.reduce((max, w) => Math.max(max, w.layout?.zIndex ?? 0), 1)
    const nextWindowId = Math.max(snapshot.nextWindowId, maxId + 1)
    const nextZIndex = maxZ + 1
    const clone = JSON.parse(JSON.stringify(snapshot)) as PersistedWorkspaceState
    set((state) => {
      const prev = state.sessions[key]
      const { windowsById, windowIds } = windowsArrayToNormalized(snapshot.windows)
      return {
        sessions: {
          ...state.sessions,
          [key]: {
            windowsById,
            windowIds,
            nextWindowId,
            nextZIndex,
            pinnedTaskbarItems: snapshot.pinnedTaskbarItems ?? [],
            playbackSource: prev?.playbackSource ?? null,
            layoutBaselinePresetId:
              options && 'baselinePresetId' in options
                ? (options.baselinePresetId ?? null)
                : (prev?.layoutBaselinePresetId ?? null),
            layoutBaselineSerialized: serializeForBaseline(clone),
            layoutBaselineSnapshot: clone,
          },
        },
      }
    })
  },

  addPinnedItem(key, item) {
    set((state) => {
      const session = state.sessions[key]
      if (!session) return state
      const keyFn = (p: PinnedTaskbarItem) => `${p.path}:${p.source.kind}:${p.source.token ?? ''}`
      const newKey = `${item.path}:${item.source.kind}:${item.source.token ?? ''}`
      if (session.pinnedTaskbarItems.some((p) => keyFn(p) === newKey)) return state
      const id = `pinned-${Date.now()}-${Math.random().toString(36).slice(2)}`
      return {
        sessions: {
          ...state.sessions,
          [key]: {
            ...session,
            pinnedTaskbarItems: [...session.pinnedTaskbarItems, { ...item, id }],
          },
        },
      }
    })
  },

  removePinnedItem(key, id) {
    set((state) => {
      const session = state.sessions[key]
      if (!session) return state
      return {
        sessions: {
          ...state.sessions,
          [key]: {
            ...session,
            pinnedTaskbarItems: session.pinnedTaskbarItems.filter((p) => p.id !== id),
          },
        },
      }
    })
  },

  createWindow(key, type, options, defaultSource) {
    let newId = ''
    set((state) => {
      const session = state.sessions[key]
      if (!session) return state
      const {
        title,
        source = defaultSource,
        initialState = {},
        tabGroupId = null,
        layout = {},
        insertIndex,
      } = options
      const id = `workspace-window-${session.nextWindowId}`
      newId = id
      const zIndex = session.nextZIndex
      const arr = normalizedWindowsToArray(session)
      const windowCount = arr.filter((window) => window.type === type).length
      const initialIcon = getInitialWindowIcon(type, initialState)
      const nextWindow: WorkspaceWindowDefinition = {
        id,
        type,
        title:
          title ??
          `${type === 'viewer' ? 'Viewer' : type === 'player' ? 'Player' : getSourceLabel(source)} ${
            windowCount + 1
          }`,
        iconName: null,
        ...initialIcon,
        source,
        initialState,
        tabGroupId,
        layout: createWindowLayout(layout, createDefaultBounds(arr.length, type), zIndex),
      }
      let nextArr: WorkspaceWindowDefinition[]
      if (tabGroupId != null && insertIndex != null) {
        nextArr = insertWindowAtGroupIndex(arr, nextWindow, tabGroupId, insertIndex)
      } else {
        nextArr = [...arr, nextWindow]
      }
      const bumped = bumpWindowsSlice(
        session,
        nextArr,
        session.nextWindowId + 1,
        session.nextZIndex + 1,
      )
      return { sessions: { ...state.sessions, [key]: bumped } }
    })
    useWorkspaceFocusStore.getState().setActiveWindowId(key, newId)
    return newId
  },

  focusWindow(key, windowId) {
    set((state) => {
      const session = state.sessions[key]
      if (!session) return state
      const zIndex = session.nextZIndex
      const current = normalizedWindowsToArray(session)
      const focused = current.find((w) => w.id === windowId)
      const groupId = focused ? (focused.tabGroupId ?? focused.id) : null
      if (groupId != null) {
        const winIds = current.filter((w) => (w.tabGroupId ?? w.id) === groupId).map((w) => w.id)
        useWorkspaceFocusStore.getState().setGroupLayoutOverlay(key, winIds, {
          zIndex,
          minimized: false,
        })
      }
      return {
        sessions: {
          ...state.sessions,
          [key]: { ...session, nextZIndex: session.nextZIndex + 1 },
        },
      }
    })
    useWorkspaceFocusStore.getState().setActiveWindowId(key, windowId)
  },

  openPlayerWindow(key, options) {
    const playingPath = options?.path ?? options?.playingPath ?? null
    if (!playingPath || !isVideoPath(playingPath)) {
      return null
    }
    const source = options?.source ?? options?.defaultSource
    if (!source) return null
    let out: string | null = null
    set((state) => {
      const session = state.sessions[key]
      if (!session) return state
      const arr = normalizedWindowsToArray(session)
      const existing = arr.find((window) => window.id === PLAYER_WINDOW_ID)
      const zIndex = session.nextZIndex
      if (existing) {
        const next = arr.map((window) =>
          window.id === PLAYER_WINDOW_ID
            ? {
                ...window,
                title: getPlaybackTitle(playingPath),
                source,
                layout: {
                  ...window.layout,
                  minimized: false,
                  zIndex,
                },
              }
            : window,
        )
        out = PLAYER_WINDOW_ID
        return {
          sessions: {
            ...state.sessions,
            [key]: bumpWindowsSlice(session, next, undefined, session.nextZIndex + 1),
          },
        }
      }
      const nextWindow: WorkspaceWindowDefinition = {
        id: PLAYER_WINDOW_ID,
        type: 'player',
        title: getPlaybackTitle(playingPath),
        iconName: null,
        iconPath: playingPath,
        iconType: MediaType.VIDEO,
        iconIsVirtual: false,
        source,
        initialState: {},
        tabGroupId: null,
        layout: createWindowLayout(undefined, createDefaultBounds(arr.length, 'player'), zIndex),
      }
      const next = [...arr, nextWindow]
      out = PLAYER_WINDOW_ID
      return {
        sessions: {
          ...state.sessions,
          [key]: bumpWindowsSlice(session, next, undefined, session.nextZIndex + 1),
        },
      }
    })
    if (out) useWorkspaceFocusStore.getState().setActiveWindowId(key, PLAYER_WINDOW_ID)
    return out
  },

  closeWindow(key, windowId) {
    set((state) => {
      const session = state.sessions[key]
      if (!session) return state
      const current = normalizedWindowsToArray(session)
      const nextWindows = current.filter((window) => window.id !== windowId)
      const closedW = current.find((w) => w.id === windowId)
      const groupId = closedW?.tabGroupId

      if (groupId) {
        const remainingInGroup = nextWindows.filter((w) => (w.tabGroupId ?? w.id) === groupId)
        const nextTabId = remainingInGroup[0]?.id
        useWorkspaceFocusStore
          .getState()
          .setActiveTabMap(key, (prev) =>
            nextTabId && prev[groupId] === windowId ? { ...prev, [groupId]: nextTabId } : prev,
          )
      }

      const currentActive = useWorkspaceFocusStore.getState().getFocusState(key).activeWindowId
      if (currentActive === windowId) {
        let nextActive: string | null
        if (groupId) {
          const remainingInGroup = nextWindows.filter((w) => (w.tabGroupId ?? w.id) === groupId)
          nextActive = remainingInGroup[0]?.id ?? nextWindows.at(-1)?.id ?? null
        } else {
          nextActive = nextWindows.at(-1)?.id ?? null
        }
        useWorkspaceFocusStore.getState().setActiveWindowId(key, nextActive)
      }
      return {
        sessions: {
          ...state.sessions,
          [key]: bumpWindowsSlice(session, nextWindows),
        },
      }
    })
  },

  requestPlay(key, { source, path, isVideo }) {
    set((state) => {
      const session = state.sessions[key]
      if (!session) return state
      const base: WorkspaceSessionSlice = { ...session, playbackSource: source }

      if (isVideo) {
        const zIndex = session.nextZIndex
        const arr = normalizedWindowsToArray(session)
        const existing = arr.find((window) => window.id === PLAYER_WINDOW_ID)
        const next: WorkspaceWindowDefinition[] = !existing
          ? [
              ...arr,
              {
                id: PLAYER_WINDOW_ID,
                type: 'player',
                title: getPlaybackTitle(path),
                iconName: null,
                iconPath: path,
                iconType: MediaType.VIDEO,
                iconIsVirtual: false,
                source,
                initialState: {},
                tabGroupId: null,
                layout: createWindowLayout(
                  undefined,
                  createDefaultBounds(arr.length, 'player'),
                  zIndex,
                ),
              },
            ]
          : arr.map((window) =>
              window.id === PLAYER_WINDOW_ID
                ? {
                    ...window,
                    title: getPlaybackTitle(path),
                    iconPath: path,
                    iconType: MediaType.VIDEO,
                    iconIsVirtual: false,
                    source,
                    layout: {
                      ...window.layout,
                      minimized: false,
                      zIndex,
                    },
                  }
                : window,
            )
        const nextSession = bumpWindowsSlice(base, next, undefined, session.nextZIndex + 1)
        return { sessions: { ...state.sessions, [key]: nextSession } }
      }

      const next = normalizedWindowsToArray(session).filter(
        (window) => window.id !== PLAYER_WINDOW_ID,
      )
      const currentActive = useWorkspaceFocusStore.getState().getFocusState(key).activeWindowId
      if (currentActive === PLAYER_WINDOW_ID) {
        useWorkspaceFocusStore.getState().setActiveWindowId(key, null)
      }
      const nextSession = bumpWindowsSlice(base, next)
      return { sessions: { ...state.sessions, [key]: nextSession } }
    })
    if (isVideo) {
      useWorkspaceFocusStore.getState().setActiveWindowId(key, PLAYER_WINDOW_ID)
    }
  },

  snapWindow(key, windowId, zone) {
    set((state) => {
      const session = state.sessions[key]
      if (!session) return state
      const zIndex = session.nextZIndex
      const current = normalizedWindowsToArray(session)
      const occupied = current
        .filter((w) => w.id !== windowId && w.layout?.snapZone && w.layout?.bounds)
        .map((w) => ({ bounds: w.layout!.bounds!, snapZone: w.layout!.snapZone! }))
      const snapBounds = snapZoneToBoundsWithOccupied(zone, occupied)
      const next = current.map((w) =>
        w.id === windowId
          ? {
              ...w,
              layout: {
                ...w.layout,
                fullscreen: false,
                snapZone: zone,
                minimized: false,
                zIndex,
                bounds: snapBounds,
                restoreBounds: w.layout?.restoreBounds ?? w.layout?.bounds ?? null,
              },
            }
          : w,
      )
      return {
        sessions: {
          ...state.sessions,
          [key]: bumpWindowsSlice(session, next, undefined, session.nextZIndex + 1),
        },
      }
    })
    useWorkspaceFocusStore.getState().setActiveWindowId(key, windowId)
  },

  unsnapWindow(key, windowId, dropPosition) {
    get().updateWindow(key, windowId, (w) => {
      const restored = w.layout?.restoreBounds ?? w.layout?.bounds
      return {
        ...w,
        layout: {
          ...w.layout,
          snapZone: null,
          fullscreen: false,
          bounds:
            dropPosition && restored
              ? {
                  x: dropPosition.x,
                  y: dropPosition.y,
                  width: restored.width,
                  height: restored.height,
                }
              : (restored ?? null),
          restoreBounds: null,
        },
      }
    })
  },

  resizeSnappedWindow(key, windowId, newBounds, direction) {
    get().applyWindows(key, (current) => {
      const target = current.find((w) => w.id === windowId)
      if (!target?.layout?.bounds) {
        return current.map((w) =>
          w.id === windowId ? { ...w, layout: { ...w.layout, bounds: newBounds } } : w,
        )
      }

      const oldBounds = target.layout.bounds
      const siblings = (target.layout?.snapZone && SNAP_SIBLING_MAP[target.layout.snapZone]) ?? {}
      const affectedZones = new Set<SnapZone>()
      for (const zones of Object.values(siblings)) {
        for (const z of zones) affectedZones.add(z)
      }

      const siblingUpdates = new Map<string, NonNullable<WorkspaceWindowLayout['bounds']>>()
      const TOLERANCE = 5

      const isSpatialRightSibling = (w: (typeof current)[0]) => {
        const b = w.layout?.bounds
        if (!b) return false
        const targetRight = oldBounds.x + oldBounds.width
        return Math.abs(b.x - targetRight) <= TOLERANCE
      }
      const isSpatialLeftSibling = (w: (typeof current)[0]) => {
        const b = w.layout?.bounds
        if (!b) return false
        const siblingRight = b.x + b.width
        return Math.abs(siblingRight - oldBounds.x) <= TOLERANCE
      }
      const isSpatialBottomSibling = (w: (typeof current)[0]) => {
        const b = w.layout?.bounds
        if (!b) return false
        const targetBottom = oldBounds.y + oldBounds.height
        return Math.abs(b.y - targetBottom) <= TOLERANCE
      }
      const isSpatialTopSibling = (w: (typeof current)[0]) => {
        const b = w.layout?.bounds
        if (!b) return false
        const siblingBottom = b.y + b.height
        return Math.abs(siblingBottom - oldBounds.y) <= TOLERANCE
      }

      let next = current.map((w) => {
        if (w.id === windowId) {
          return { ...w, layout: { ...w.layout, bounds: newBounds } }
        }

        const hasZoneMatch = w.layout?.snapZone && affectedZones.has(w.layout.snapZone)
        const wb = { ...(w.layout?.bounds ?? { x: 0, y: 0, width: 0, height: 0 }) }
        if (!w.layout?.bounds) return w

        let updated = false

        if (
          direction.includes('right') &&
          newBounds.x + newBounds.width !== oldBounds.x + oldBounds.width
        ) {
          const delta = newBounds.x + newBounds.width - (oldBounds.x + oldBounds.width)
          const isSibling = hasZoneMatch && siblings.right?.includes(w.layout.snapZone!)
          const isSpatial = !hasZoneMatch && isSpatialRightSibling(w)
          if (isSibling || isSpatial) {
            wb.x += delta
            wb.width -= delta
            updated = true
          }
        }
        if (direction.includes('left') && newBounds.x !== oldBounds.x) {
          const delta = newBounds.x - oldBounds.x
          const isSibling = hasZoneMatch && siblings.left?.includes(w.layout.snapZone!)
          const isSpatial = !hasZoneMatch && isSpatialLeftSibling(w)
          if (isSibling || isSpatial) {
            wb.width += delta
            updated = true
          }
        }
        if (
          direction.includes('bottom') &&
          newBounds.y + newBounds.height !== oldBounds.y + oldBounds.height
        ) {
          const delta = newBounds.y + newBounds.height - (oldBounds.y + oldBounds.height)
          const isSibling = hasZoneMatch && siblings.bottom?.includes(w.layout.snapZone!)
          const isSpatial = !hasZoneMatch && isSpatialBottomSibling(w)
          if (isSibling || isSpatial) {
            wb.y += delta
            wb.height -= delta
            updated = true
          }
        }
        if (direction.includes('top') && newBounds.y !== oldBounds.y) {
          const delta = newBounds.y - oldBounds.y
          const isSibling = hasZoneMatch && siblings.top?.includes(w.layout.snapZone!)
          const isSpatial = !hasZoneMatch && isSpatialTopSibling(w)
          if (isSibling || isSpatial) {
            wb.height += delta
            updated = true
          }
        }

        if (
          !updated ||
          (wb.x === w.layout.bounds.x &&
            wb.y === w.layout.bounds.y &&
            wb.width === w.layout.bounds.width &&
            wb.height === w.layout.bounds.height)
        ) {
          return w
        }

        const gid = w.tabGroupId ?? w.id
        siblingUpdates.set(gid, wb)
        return { ...w, layout: { ...w.layout, bounds: wb } }
      })

      if (siblingUpdates.size > 0) {
        next = next.map((w) => {
          const gid = w.tabGroupId ?? w.id
          const syncBounds = siblingUpdates.get(gid)
          if (syncBounds && w.id !== windowId) {
            const b = w.layout?.bounds
            if (
              !b ||
              b.x !== syncBounds.x ||
              b.y !== syncBounds.y ||
              b.width !== syncBounds.width ||
              b.height !== syncBounds.height
            ) {
              return { ...w, layout: { ...w.layout, bounds: syncBounds } }
            }
          }
          return w
        })
      }

      return next
    })
  },

  mergeWindowIntoGroup(key, windowId, targetWindowId, insertIndex) {
    let mergedGroupId: string | null = null
    set((state) => {
      const session = state.sessions[key]
      if (!session) return state
      const current = normalizedWindowsToArray(session)
      const target = current.find((w) => w.id === targetWindowId)
      const moved = current.find((w) => w.id === windowId)
      if (!target || !moved) return state

      const groupId = target.tabGroupId || targetWindowId
      mergedGroupId = groupId
      const updatedMoved: WorkspaceWindowDefinition = {
        ...moved,
        tabGroupId: groupId,
        layout: {
          ...moved.layout,
          bounds: target.layout?.bounds ?? moved.layout?.bounds,
          zIndex: target.layout?.zIndex ?? moved.layout?.zIndex,
        },
      }
      let next: WorkspaceWindowDefinition[]
      if (insertIndex == null) {
        next = current.map((w) => {
          if (w.id === targetWindowId && !w.tabGroupId) return { ...w, tabGroupId: groupId }
          if (w.id === windowId) return updatedMoved
          return w
        })
      } else {
        const withTabGroup = current.map((w) => {
          if (w.id === targetWindowId && !w.tabGroupId) return { ...w, tabGroupId: groupId }
          return w
        })
        const withoutMoved = withTabGroup.filter((w) => w.id !== windowId)
        next = insertWindowAtGroupIndex(withoutMoved, updatedMoved, groupId, insertIndex)
      }
      return {
        sessions: {
          ...state.sessions,
          [key]: bumpWindowsSlice(session, next),
        },
      }
    })
    if (mergedGroupId != null) {
      useWorkspaceFocusStore.getState().setActiveTabMap(key, (prev) => ({
        ...prev,
        [mergedGroupId!]: windowId,
      }))
    }
  },

  splitWindowFromGroup(key, windowId, offsetBounds) {
    let tabMapGroupId: string | null = null
    let tabMapRemaining: WorkspaceWindowDefinition[] = []
    set((state) => {
      const session = state.sessions[key]
      if (!session) return state
      let nextZ = session.nextZIndex
      const current = normalizedWindowsToArray(session)
      const w = current.find((win) => win.id === windowId)
      if (!w?.tabGroupId) return state

      const groupId = w.tabGroupId
      tabMapGroupId = groupId
      tabMapRemaining = current.filter((win) => win.tabGroupId === groupId && win.id !== windowId)
      const groupWindows = current.filter((win) => win.tabGroupId === groupId)
      const groupLayout = w.layout
      const defaultBounds =
        offsetBounds ??
        (() => {
          const base = w.layout?.bounds ?? createDefaultBounds(0, w.type)
          return { x: base.x + 30, y: base.y + 30, width: base.width, height: base.height }
        })()

      let nextWindows = current.map((win) => {
        if (win.id === windowId) {
          const z = nextZ++
          return {
            ...win,
            tabGroupId: null,
            layout: {
              ...win.layout,
              bounds: defaultBounds,
              snapZone: null,
              fullscreen: false,
              restoreBounds: win.layout?.bounds ?? win.layout?.restoreBounds ?? null,
              zIndex: z,
            },
          }
        }
        return win
      })

      if (groupWindows.length === 2) {
        nextWindows = nextWindows.map((win) => {
          if (win.tabGroupId !== groupId) return win
          const fallbackBounds = createDefaultBounds(0, win.type)
          return {
            ...win,
            tabGroupId: null,
            layout: groupLayout
              ? {
                  ...groupLayout,
                  bounds: groupLayout.bounds ?? win.layout?.bounds ?? fallbackBounds,
                  snapZone: groupLayout.snapZone ?? null,
                  restoreBounds: groupLayout.restoreBounds ?? groupLayout.bounds ?? null,
                }
              : win.layout,
          }
        })
      }

      return {
        sessions: {
          ...state.sessions,
          [key]: bumpWindowsSlice({ ...session, nextZIndex: nextZ }, nextWindows),
        },
      }
    })

    if (tabMapGroupId != null) {
      useWorkspaceFocusStore.getState().setActiveTabMap(key, (prev) => {
        if (tabMapRemaining.length === 0) {
          const { [tabMapGroupId!]: _, ...rest } = prev
          return rest
        }
        if (prev[tabMapGroupId!] === windowId) {
          return { ...prev, [tabMapGroupId!]: tabMapRemaining[0].id }
        }
        return prev
      })
    }
    useWorkspaceFocusStore.getState().setActiveWindowId(key, windowId)
  },

  addTabToGroup(key, sourceWindowId) {
    let newId = sourceWindowId
    set((state) => {
      const session = state.sessions[key]
      if (!session) return state
      const arr = normalizedWindowsToArray(session)
      const sourceWindow = arr.find((w) => w.id === sourceWindowId)
      if (!sourceWindow) return state

      const groupId = sourceWindow.tabGroupId || sourceWindowId
      const id = `workspace-window-${session.nextWindowId}`
      newId = id
      const usedFallbackZ = sourceWindow.layout?.zIndex == null
      const zIndex = sourceWindow.layout?.zIndex ?? session.nextZIndex
      const nextZ = usedFallbackZ ? session.nextZIndex + 1 : session.nextZIndex
      const newWindow: WorkspaceWindowDefinition = {
        id,
        type: sourceWindow.type,
        title: '',
        iconName: null,
        iconPath: '',
        iconType: sourceWindow.type === 'browser' ? MediaType.FOLDER : MediaType.OTHER,
        iconIsVirtual: false,
        source: sourceWindow.source,
        initialState:
          sourceWindow.type === 'browser' ? { dir: sourceWindow.initialState.dir ?? null } : {},
        tabGroupId: groupId,
        layout: {
          bounds: sourceWindow.layout?.bounds,
          fullscreen: sourceWindow.layout?.fullscreen,
          snapZone: sourceWindow.layout?.snapZone,
          minimized: false,
          zIndex,
          restoreBounds: sourceWindow.layout?.restoreBounds,
        },
      }
      const updated = arr.map((w) => {
        if (w.id === sourceWindowId && !w.tabGroupId) {
          return { ...w, tabGroupId: groupId }
        }
        return w
      })
      const next = [...updated, newWindow]
      return {
        sessions: {
          ...state.sessions,
          [key]: bumpWindowsSlice(session, next, session.nextWindowId + 1, nextZ),
        },
      }
    })
    if (newId !== sourceWindowId) {
      const sess = get().sessions[key]
      const sw = sess
        ? normalizedWindowsToArray(sess).find((w) => w.id === sourceWindowId)
        : undefined
      const gid = sw?.tabGroupId || sourceWindowId
      useWorkspaceFocusStore.getState().setActiveTabMap(key, (prev) => ({ ...prev, [gid]: newId }))
      useWorkspaceFocusStore.getState().setActiveWindowId(key, newId)
    }
    return newId
  },

  updateWindowNavigationState(key, windowId, navState) {
    get().updateWindow(key, windowId, (w) => {
      const currentDir = w.initialState.dir ?? null
      const currentViewing = w.initialState.viewing ?? null
      const nextDir = navState.dir ?? null
      const nextViewing = navState.viewing ?? null
      if (currentDir === nextDir && currentViewing === nextViewing) return w
      return {
        ...w,
        initialState: { ...w.initialState, dir: nextDir, viewing: nextViewing },
      }
    })
  },

  toggleWindowFullscreen(key, windowId) {
    set((state) => {
      const session = state.sessions[key]
      if (!session) return state
      const zIndex = session.nextZIndex
      const arr = normalizedWindowsToArray(session)
      const next = arr.map((window) =>
        window.id === windowId
          ? (() => {
              const currentBounds = window.layout?.bounds ?? createDefaultBounds(0, window.type)
              const isFullscreen = window.layout?.fullscreen ?? false
              return {
                ...window,
                layout: {
                  ...window.layout,
                  fullscreen: !isFullscreen,
                  snapZone: null,
                  minimized: false,
                  zIndex,
                  bounds: isFullscreen
                    ? (window.layout?.restoreBounds ?? currentBounds)
                    : createFullscreenBounds(),
                  restoreBounds: isFullscreen ? null : currentBounds,
                },
              }
            })()
          : window,
      )
      return {
        sessions: {
          ...state.sessions,
          [key]: bumpWindowsSlice(session, next, undefined, session.nextZIndex + 1),
        },
      }
    })
    useWorkspaceFocusStore.getState().setActiveWindowId(key, windowId)
  },
}))
