import { createDefaultBounds, insertWindowAtGroupIndex } from '@/lib/workspace-geometry'
import { MediaType } from '@/lib/types'
import type { PersistedWorkspaceState, WorkspaceWindowDefinition } from '@/lib/use-workspace'

export function groupIdForWindow(w: WorkspaceWindowDefinition): string {
  return w.tabGroupId ?? w.id
}

export function orderedVisibleGroupIds(windows: WorkspaceWindowDefinition[]): string[] {
  const seen = new Set<string>()
  const order: string[] = []
  for (const win of windows) {
    if (win.layout?.minimized) continue
    const gid = groupIdForWindow(win)
    if (seen.has(gid)) continue
    seen.add(gid)
    order.push(gid)
  }
  return order
}

export function tabsInGroup(
  windows: WorkspaceWindowDefinition[],
  groupId: string,
): WorkspaceWindowDefinition[] {
  return windows.filter((w) => groupIdForWindow(w) === groupId)
}

export function mergeWindowIntoGroupState(
  state: PersistedWorkspaceState,
  windowId: string,
  targetWindowId: string,
  insertIndex?: number,
): PersistedWorkspaceState {
  const current = state.windows
  const target = current.find((w) => w.id === targetWindowId)
  const moved = current.find((w) => w.id === windowId)
  if (!target || !moved) return state

  const groupId = target.tabGroupId || targetWindowId
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
    ...state,
    windows: next,
    activeWindowId: windowId,
    activeTabMap: { ...state.activeTabMap, [groupId]: windowId },
  }
}

export function addTabToGroupState(
  state: PersistedWorkspaceState,
  sourceWindowId: string,
): PersistedWorkspaceState {
  const arr = state.windows
  const sourceWindow = arr.find((w) => w.id === sourceWindowId)
  if (!sourceWindow) return state

  const groupId = sourceWindow.tabGroupId || sourceWindowId
  const id = `workspace-window-${state.nextWindowId}`
  const zIndex = sourceWindow.layout?.zIndex ?? 1

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
  return {
    ...state,
    windows: [...updated, newWindow],
    nextWindowId: state.nextWindowId + 1,
    activeWindowId: id,
    activeTabMap: { ...state.activeTabMap, [groupId]: id },
  }
}

export function splitWindowFromGroupState(
  state: PersistedWorkspaceState,
  windowId: string,
  offsetBounds?: { x: number; y: number; width: number; height: number },
): PersistedWorkspaceState {
  const current = state.windows
  const w = current.find((win) => win.id === windowId)
  if (!w?.tabGroupId) return state

  const groupId = w.tabGroupId
  const groupWindows = current.filter((win) => win.tabGroupId === groupId)
  const groupLayout = w.layout
  const maxZ = Math.max(...current.map((x) => x.layout?.zIndex ?? 1), 1)
  let nextZ = maxZ + 1

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

  const hasGroupAfter = nextWindows.some((win) => win.tabGroupId === groupId)
  const nextActiveMap = { ...state.activeTabMap }
  if (!hasGroupAfter) {
    delete nextActiveMap[groupId]
  } else if (state.activeTabMap[groupId] === windowId) {
    const still = nextWindows.filter((x) => x.tabGroupId === groupId)
    if (still[0]) nextActiveMap[groupId] = still[0].id
  }

  return {
    ...state,
    windows: nextWindows,
    activeWindowId: windowId,
    activeTabMap: nextActiveMap,
  }
}
