import type { WindowDefinition as WorkspaceWindowDefinition } from '@/lib/models/window-model'
import type { PersistedWorkspaceState } from './use-workspace'
import { cascadeWorkspaceBounds } from './workspace-placement'

export type WorkspaceTransferPhase = 'idle' | 'dragging' | 'armed'

export type WorkspaceTransferMachineState = {
  phase: WorkspaceTransferPhase
  sourceId: string | null
  windowIds: string[]
  hoverTargetId: string | null
  armedTargetId: string | null
  generation: number
}

export type WorkspaceTransferCommit = {
  sourceId: string
  destinationId: string
  windowIds: string[]
  generation: number
}

export type WorkspaceTransferEndResult = {
  state: WorkspaceTransferMachineState
  commit?: WorkspaceTransferCommit
}

export type WorkspaceTransferMachine = {
  getState(): WorkspaceTransferMachineState
  begin(sourceId: string, windowIds: readonly string[]): WorkspaceTransferMachineState
  hover(targetId: string | null): WorkspaceTransferMachineState
  arm(targetId: string, generation?: number): WorkspaceTransferMachineState
  end(targetId?: string | null): WorkspaceTransferEndResult
  cancel(): WorkspaceTransferMachineState
}

function idleTransferState(generation: number): WorkspaceTransferMachineState {
  return {
    phase: 'idle',
    sourceId: null,
    windowIds: [],
    hoverTargetId: null,
    armedTargetId: null,
    generation,
  }
}

/** Shared drag/hover/arm lifecycle. Drop commits only on the current hover target. */
export function createWorkspaceTransferMachine(): WorkspaceTransferMachine {
  let current = idleTransferState(0)

  const getState = () => ({ ...current, windowIds: [...current.windowIds] })

  return {
    getState,
    begin(sourceId, windowIds) {
      const generation = current.generation + 1
      const ids = [...new Set(windowIds.filter((id) => id.length > 0))]
      current =
        sourceId.length > 0 && ids.length > 0
          ? {
              phase: 'dragging',
              sourceId,
              windowIds: ids,
              hoverTargetId: null,
              armedTargetId: null,
              generation,
            }
          : idleTransferState(generation)
      return getState()
    },
    hover(targetId) {
      if (current.phase === 'idle' || !targetId || targetId === current.sourceId) {
        if (current.phase !== 'idle') {
          current = { ...current, phase: 'dragging', hoverTargetId: null, armedTargetId: null }
        }
        return getState()
      }
      current = {
        ...current,
        phase: current.armedTargetId === targetId ? 'armed' : 'dragging',
        hoverTargetId: targetId,
        armedTargetId: current.armedTargetId === targetId ? targetId : null,
      }
      return getState()
    },
    arm(targetId, generation = current.generation) {
      if (
        current.phase === 'idle' ||
        generation !== current.generation ||
        !targetId ||
        targetId === current.sourceId ||
        current.hoverTargetId !== targetId
      ) {
        return getState()
      }
      current = { ...current, phase: 'armed', armedTargetId: targetId }
      return getState()
    },
    end(targetId) {
      const canCommit =
        current.phase !== 'idle' &&
        !!targetId &&
        targetId === current.hoverTargetId &&
        targetId !== current.sourceId
      const commit = canCommit
        ? {
            sourceId: current.sourceId!,
            destinationId: targetId!,
            windowIds: [...current.windowIds],
            generation: current.generation,
          }
        : undefined
      current = idleTransferState(current.generation + 1)
      return commit ? { state: getState(), commit } : { state: getState() }
    },
    cancel() {
      current = idleTransferState(current.generation + 1)
      return getState()
    },
  }
}

const groupId = (window: WorkspaceWindowDefinition) => window.tabGroupId ?? window.id

/** Restores only dragged-group geometry against latest membership and definitions. */
export function rollbackWorkspaceTransferGeometry(
  latest: PersistedWorkspaceState,
  beforeGesture: PersistedWorkspaceState,
  windowIds: readonly string[],
): PersistedWorkspaceState {
  const selectedGroups = new Set(
    beforeGesture.windows.filter((window) => windowIds.includes(window.id)).map(groupId),
  )
  const beforeById = new Map(beforeGesture.windows.map((window) => [window.id, window]))
  let changed = false
  const windows = latest.windows.map((window) => {
    const before = beforeById.get(window.id)
    if (!before || !selectedGroups.has(groupId(before))) return window
    changed = true
    return { ...window, layout: before.layout ? structuredClone(before.layout) : undefined }
  })
  const restoreCanvas = latest.workspaceType === 'canvas' && beforeGesture.canvas
  if (!changed && !restoreCanvas) return latest
  return {
    ...latest,
    windows,
    ...(restoreCanvas
      ? {
          canvas: {
            ...latest.canvas!,
            camera: { ...beforeGesture.canvas!.camera },
            maximizedWindowId:
              beforeGesture.canvas!.maximizedWindowId &&
              latest.windows.some((window) => window.id === beforeGesture.canvas!.maximizedWindowId)
                ? beforeGesture.canvas!.maximizedWindowId
                : null,
            windowSizeByType: structuredClone(beforeGesture.canvas!.windowSizeByType),
          },
        }
      : {}),
  }
}

export type WorkspaceTransferOptions = {
  windowIds: string[]
  viewport?: { width: number; height: number }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

export function transferWorkspaceGroups(
  source: PersistedWorkspaceState,
  destination: PersistedWorkspaceState,
  options: WorkspaceTransferOptions,
): { source: PersistedWorkspaceState; destination: PersistedWorkspaceState } {
  const selectedGroups = new Set(
    source.windows.filter((window) => options.windowIds.includes(window.id)).map(groupId),
  )
  const payload = source.windows.filter((window) => selectedGroups.has(groupId(window)))
  if (!payload.length) return { source, destination }

  const payloadIds = new Set(payload.map((window) => window.id))
  const sourceWindows = source.windows
    .filter((window) => !payloadIds.has(window.id))
    .map((window) =>
      window.fileOpenTargetWindowId && payloadIds.has(window.fileOpenTargetWindowId)
        ? { ...window, fileOpenTargetWindowId: null }
        : window,
    )
  const sourceActiveTabMap = { ...source.activeTabMap }
  const sourceSplits = { ...source.tabGroupSplits }
  for (const id of selectedGroups) {
    delete sourceActiveTabMap[id]
    delete sourceSplits[id]
  }

  const destinationIds = new Set(destination.windows.map((window) => window.id))
  const remap = new Map<string, string>()
  for (const window of payload) {
    if (destinationIds.has(window.id)) remap.set(window.id, `${window.id}-${crypto.randomUUID()}`)
  }
  const mapped = (id: string) => remap.get(id) ?? id
  const orderedGroups = [...selectedGroups]
  const viewport = options.viewport ?? {
    width: globalThis.innerWidth || 1280,
    height: (globalThis.innerHeight || 800) - 32,
  }
  const canvas = destination.canvas
  const zoom = canvas?.camera.zoom ?? 1
  const canvasPadding = 16 / zoom
  const visibleCanvas = canvas
    ? {
        x: -canvas.camera.x / zoom + canvasPadding,
        y: -canvas.camera.y / zoom + canvasPadding,
        width: Math.max(1, viewport.width / zoom - canvasPadding * 2),
        height: Math.max(1, viewport.height / zoom - canvasPadding * 2),
      }
    : null
  const targetCenter = canvas
    ? {
        x: (viewport.width / 2 - canvas.camera.x) / zoom,
        y: (viewport.height / 2 - canvas.camera.y) / zoom,
      }
    : { x: viewport.width / 2, y: viewport.height / 2 }
  const sourceGroupBounds = orderedGroups.map((id) => {
    const bounds = payload.find((window) => groupId(window) === id)?.layout?.bounds
    return bounds ?? { x: 0, y: 0, width: 640, height: 480 }
  })
  const selectionCenter = {
    x:
      (Math.min(...sourceGroupBounds.map((bounds) => bounds.x)) +
        Math.max(...sourceGroupBounds.map((bounds) => bounds.x + bounds.width))) /
      2,
    y:
      (Math.min(...sourceGroupBounds.map((bounds) => bounds.y)) +
        Math.max(...sourceGroupBounds.map((bounds) => bounds.y + bounds.height))) /
      2,
  }

  const destinationTopZ = Math.max(
    0,
    ...destination.windows.map((window) => window.layout?.zIndex ?? 0),
    destination.canvas?.nextZIndex ? destination.canvas.nextZIndex - 1 : 0,
  )
  const moved = payload.map((window) => {
    const oldGroup = groupId(window)
    const groupIndex = orderedGroups.indexOf(oldGroup)
    const original = sourceGroupBounds[groupIndex]!
    const proposedCanvasBounds = {
      ...original,
      x: original.x - selectionCenter.x + targetCenter.x,
      y: original.y - selectionCenter.y + targetCenter.y,
    }
    const bounds = visibleCanvas
      ? {
          x: clamp(
            proposedCanvasBounds.x,
            visibleCanvas.x,
            visibleCanvas.x + visibleCanvas.width - Math.min(original.width, visibleCanvas.width),
          ),
          y: clamp(
            proposedCanvasBounds.y,
            visibleCanvas.y,
            visibleCanvas.y +
              visibleCanvas.height -
              Math.min(original.height, visibleCanvas.height),
          ),
          width: Math.min(original.width, visibleCanvas.width),
          height: Math.min(original.height, visibleCanvas.height),
        }
      : cascadeWorkspaceBounds(destination.windows.length + groupIndex, viewport)
    return {
      ...structuredClone(window),
      id: mapped(window.id),
      tabGroupId: window.tabGroupId ? mapped(window.tabGroupId) : window.tabGroupId,
      fileOpenTargetWindowId:
        window.fileOpenTargetWindowId && payloadIds.has(window.fileOpenTargetWindowId)
          ? mapped(window.fileOpenTargetWindowId)
          : null,
      layout: {
        ...window.layout,
        bounds,
        restoreBounds: null,
        fullscreen: false,
        minimized: false,
        snapZone: null,
        tiling: null,
        zIndex: destinationTopZ + 1 + groupIndex,
      },
    }
  })

  const destinationActiveTabMap = { ...destination.activeTabMap }
  const destinationSplits = { ...destination.tabGroupSplits }
  for (const oldGroup of selectedGroups) {
    const nextGroup = mapped(oldGroup)
    const active = source.activeTabMap[oldGroup]
    if (active) destinationActiveTabMap[nextGroup] = mapped(active)
    const split = source.tabGroupSplits?.[oldGroup]
    if (split) destinationSplits[nextGroup] = { ...split, leftTabId: mapped(split.leftTabId) }
  }
  const activeWindowId = mapped(
    source.activeWindowId && payloadIds.has(source.activeWindowId)
      ? source.activeWindowId
      : payload.at(-1)!.id,
  )

  return {
    source: {
      ...source,
      windows: sourceWindows,
      activeWindowId: sourceWindows.some((window) => window.id === source.activeWindowId)
        ? source.activeWindowId
        : (sourceWindows.at(-1)?.id ?? null),
      activeTabMap: sourceActiveTabMap,
      tabGroupSplits: Object.keys(sourceSplits).length ? sourceSplits : undefined,
    },
    destination: {
      ...destination,
      windows: [...destination.windows, ...moved],
      activeWindowId,
      activeTabMap: destinationActiveTabMap,
      tabGroupSplits: Object.keys(destinationSplits).length ? destinationSplits : undefined,
      nextWindowId: Math.max(destination.nextWindowId, source.nextWindowId),
      ...(destination.canvas
        ? {
            canvas: {
              ...destination.canvas,
              maximizedWindowId: null,
              nextZIndex: destinationTopZ + 1 + orderedGroups.length,
            },
          }
        : {}),
    },
  }
}
