import type { PersistedWorkspaceState } from './use-workspace'
import {
  exitSplitViewState,
  ensureSplitActiveNotLeft,
  groupIdForWindow,
  isSplitLeftTab,
  mergeWindowIntoGroupState,
  openInNewTabInGroupState,
  openInSplitViewFromBrowserState,
  setSplitFractionState,
  setSplitLeftTabFromContextState,
  setTabPinnedAndReorderState,
  splitWindowFromGroupState,
  tabsInGroup,
} from '@/workspace/tabs/tab-group-ops'
import { directoryTitle } from '@/lib/files/directory-title'
import { isVirtualFolderPath } from '@/lib/files/constants'
import { MediaType } from '@/lib/files/types'
import { fileNameFromPath, parentPath } from '@/lib/files/path-utils'
import { getMediaTypeFromPath } from '@/lib/media/media-utils'
import { isVideoPath } from './workspace-geometry'
import { closeWorkspaceWindows } from './workspace-close'
import { workspaceValueEquals } from './workspace-equality'

function activateTab(
  state: PersistedWorkspaceState,
  groupId: string,
  tabId: string,
): PersistedWorkspaceState {
  const members = tabsInGroup(state.windows, groupId)
  const requested = members.find((window) => window.id === tabId)
  if (!requested) return state

  const splitLeftId = state.tabGroupSplits?.[groupId]?.leftTabId
  const current = state.activeTabMap[groupId]
  const activeId =
    tabId === splitLeftId
      ? (members.find((window) => window.id === current && window.id !== splitLeftId)?.id ??
        members.find((window) => window.id !== splitLeftId)?.id)
      : tabId
  if (!activeId) return state
  if (state.activeWindowId === activeId && current === activeId) return state

  return {
    ...state,
    activeWindowId: activeId,
    activeTabMap: { ...state.activeTabMap, [groupIdForWindow(requested)]: activeId },
  }
}

function navigateDir(
  state: PersistedWorkspaceState,
  windowId: string,
  dir: string,
): PersistedWorkspaceState {
  const target = state.windows.find((window) => window.id === windowId)
  if (!target) return state
  return {
    ...state,
    windows: state.windows.map((window) => {
      if (window.id !== windowId) return window
      const next = { ...window, initialState: { ...window.initialState, dir } }
      if (window.type !== 'browser') return next
      return {
        ...next,
        title: directoryTitle(dir),
        iconPath: dir,
        iconType: MediaType.FOLDER,
        iconIsVirtual: isVirtualFolderPath(dir),
      }
    }),
  }
}

function updateViewing(
  state: PersistedWorkspaceState,
  windowId: string,
  viewing: string,
): PersistedWorkspaceState {
  if (!state.windows.some((window) => window.id === windowId)) return state
  return {
    ...state,
    windows: state.windows.map((window) =>
      window.id === windowId
        ? {
            ...window,
            title: fileNameFromPath(viewing),
            iconPath: viewing,
            iconType: getMediaTypeFromPath(viewing),
            iconIsVirtual: false,
            initialState: {
              ...window.initialState,
              dir: parentPath(viewing),
              viewing,
            },
          }
        : window,
    ),
  }
}

function bindHermesSession(
  state: PersistedWorkspaceState,
  windowId: string,
  sessionId: string,
): PersistedWorkspaceState {
  const target = state.windows.find((window) => window.id === windowId)
  if (target?.type !== 'hermes') return state
  return {
    ...state,
    windows: state.windows.map((window) =>
      window.id === windowId
        ? {
            ...window,
            title: window.title === 'New Hermes session' ? 'Hermes session' : window.title,
            iconPath: `Hermes Sessions/session/${sessionId}`,
            hermes: { ...window.hermes, sessionId, draftId: undefined },
          }
        : window,
    ),
  }
}

function renameWindow(
  state: PersistedWorkspaceState,
  windowId: string,
  title: string,
): PersistedWorkspaceState {
  const target = state.windows.find((window) => window.id === windowId)
  if (!target || target.title === title) return state
  return {
    ...state,
    windows: state.windows.map((window) =>
      window.id === windowId ? { ...window, title } : window,
    ),
  }
}

function toggleTabPin(state: PersistedWorkspaceState, tabId: string): PersistedWorkspaceState {
  const target = state.windows.find((window) => window.id === tabId)
  if (!target) return state
  if (isSplitLeftTab(state, groupIdForWindow(target), tabId)) return state
  if (target.type === 'viewer' && target.initialState.viewing) {
    if (isVideoPath(target.initialState.viewing)) return state
  }
  return setTabPinnedAndReorderState(state, tabId, !target.tabPinned)
}

function closeTab(
  state: PersistedWorkspaceState,
  tabId: string,
  options?: { ignorePin?: boolean },
) {
  const target = state.windows.find((window) => window.id === tabId)
  if (!target || (target.tabPinned && !options?.ignorePin)) return { state, removed: [] }
  return closeWorkspaceWindows(state, new Set([tabId]))
}

function closeGroups(state: PersistedWorkspaceState, groupIds: ReadonlySet<string>) {
  const ids = new Set(
    state.windows
      .filter((window) => groupIds.has(groupIdForWindow(window)))
      .map((window) => window.id),
  )
  return closeWorkspaceWindows(state, ids)
}

function mergeGroups(
  state: PersistedWorkspaceState,
  sourceWindowId: string,
  targetWindowId: string,
  insertIndex?: number,
) {
  return mergeWindowIntoGroupState(state, sourceWindowId, targetWindowId, insertIndex)
}

function splitWindowFromGroup(
  state: PersistedWorkspaceState,
  windowId: string,
  bounds?: { x: number; y: number; width: number; height: number },
) {
  return splitWindowFromGroupState(state, windowId, bounds)
}

function sameMapEntry(
  current: Record<string, unknown> | undefined,
  projected: Record<string, unknown> | undefined,
  key: string,
) {
  const currentHas = Object.hasOwn(current ?? {}, key)
  const projectedHas = Object.hasOwn(projected ?? {}, key)
  return (
    currentHas === projectedHas &&
    (!currentHas || workspaceValueEquals(current?.[key], projected?.[key]))
  )
}

function restoreMapEntry<T>(
  current: Record<string, T> | undefined,
  before: Record<string, T> | undefined,
  key: string,
) {
  const next = { ...current }
  if (Object.hasOwn(before ?? {}, key)) next[key] = before![key]!
  else delete next[key]
  return Object.keys(next).length ? next : undefined
}

/**
 * Reverts only fields changed by a tab-pull projection. Current window definitions and remote
 * deletion or regrouping win over stale gesture state.
 */
function rollbackTabPull(
  latest: PersistedWorkspaceState,
  before: PersistedWorkspaceState,
  projected: PersistedWorkspaceState,
  groupId: string,
): PersistedWorkspaceState {
  const beforeById = new Map(before.windows.map((window) => [window.id, window]))
  const projectedById = new Map(projected.windows.map((window) => [window.id, window]))
  const beforeGroupIds = new Set(
    before.windows
      .filter((window) => groupIdForWindow(window) === groupId)
      .map((window) => window.id),
  )
  const liveIds = new Set(latest.windows.map((window) => window.id))
  const windows = latest.windows.map((window) => {
    if (!beforeGroupIds.has(window.id)) return window
    const previous = beforeById.get(window.id)
    const local = projectedById.get(window.id)
    if (!previous || !local) return window
    const membershipWasLocallyChanged =
      previous.tabGroupId !== local.tabGroupId && window.tabGroupId === local.tabGroupId
    if (!membershipWasLocallyChanged) return window
    return {
      ...window,
      tabGroupId: previous.tabGroupId,
      layout: previous.layout,
    }
  })

  const activeTabMap = sameMapEntry(latest.activeTabMap, projected.activeTabMap, groupId)
    ? (restoreMapEntry(latest.activeTabMap, before.activeTabMap, groupId) ?? {})
    : latest.activeTabMap
  const tabGroupSplits = sameMapEntry(latest.tabGroupSplits, projected.tabGroupSplits, groupId)
    ? restoreMapEntry(latest.tabGroupSplits, before.tabGroupSplits, groupId)
    : latest.tabGroupSplits
  const activeWindowId =
    latest.activeWindowId === projected.activeWindowId &&
    before.activeWindowId &&
    liveIds.has(before.activeWindowId)
      ? before.activeWindowId
      : latest.activeWindowId
  const canvas =
    latest.canvas &&
    before.canvas &&
    projected.canvas &&
    latest.canvas.nextZIndex === projected.canvas.nextZIndex
      ? { ...latest.canvas, nextZIndex: before.canvas.nextZIndex }
      : latest.canvas

  return { ...latest, windows, activeWindowId, activeTabMap, tabGroupSplits, canvas }
}

/** Restores one locally changed split record without overwriting a newer remote value. */
function rollbackSplitFraction(
  latest: PersistedWorkspaceState,
  before: PersistedWorkspaceState,
  projected: PersistedWorkspaceState,
  groupId: string,
): PersistedWorkspaceState {
  if (!sameMapEntry(latest.tabGroupSplits, projected.tabGroupSplits, groupId)) return latest
  return {
    ...latest,
    tabGroupSplits: restoreMapEntry(latest.tabGroupSplits, before.tabGroupSplits, groupId),
  }
}

export const WorkspaceDocumentCommands = {
  activateTab,
  bindHermesSession,
  closeGroups,
  closeTab,
  exitSplit: exitSplitViewState,
  mergeGroups,
  navigateDir,
  openInSplit: openInSplitViewFromBrowserState,
  openTabInGroup: openInNewTabInGroupState,
  renameWindow,
  repairSplitFocus: ensureSplitActiveNotLeft,
  rollbackSplitFraction,
  rollbackTabPull,
  setSplitFraction: setSplitFractionState,
  setSplitLeft: setSplitLeftTabFromContextState,
  splitWindowFromGroup,
  toggleTabPin,
  updateViewing,
}
