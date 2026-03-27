import { computeSnappedResizeWindows } from '@/lib/workspace-session-store'
import {
  assistGridSpanToBounds,
  assistShapeMatchingSpan,
  detectEdgeAssistGridSpan,
  type AssistGridSpan,
} from '@/lib/workspace-assist-grid'
import { pickAssistSlotFromPoint, type AssistSlotPick } from '@/lib/workspace-snap-pick'
import { snapZonePreviewBoundsForDrag } from '@/lib/workspace-snap-live'
import { useWorkspacePreferredSnapStore } from '@/lib/workspace-preferred-snap-store'
import {
  createDefaultBounds,
  createFullscreenBounds,
  getViewportSize,
  scaleSnappedWindowsBoundsForCanvasResize,
  snapZoneToBoundsWithOccupied,
  type WorkspaceCanvasSize,
} from '@/lib/workspace-geometry'
import type { PersistedWorkspaceState, SnapZone } from '@/lib/use-workspace'
import {
  SNAP_EDGE_THRESHOLD_PX,
  TOP_SNAP_ASSIST_CENTER_HALF_WIDTH_PX,
  TOP_SNAP_ASSIST_KEEPALIVE_PX,
  type SnapDetectResult,
} from '@/lib/use-snap-zones'
import { findMergeTarget, type MergeTarget } from '@/src/workspace/merge-target'
import { groupIdForWindow, mergeWindowIntoGroupState } from '@/src/workspace/tab-group-ops'
import { applySnapPreviewLayout } from '@/src/workspace/snap-preview'
import { createEffect, createSignal, onCleanup, type Accessor, type Setter } from 'solid-js'
import type { WorkspaceBounds } from '@/src/workspace/WorkspaceWindowChrome'

export function createWorkspaceSnapDragModel(options: {
  workspace: Accessor<PersistedWorkspaceState | null>
  setWorkspace: Setter<PersistedWorkspaceState | null>
  preferredSnapTick: () => void
}) {
  const { workspace, setWorkspace, preferredSnapTick } = options

  let workspaceAreaEl: HTMLDivElement | undefined
  let snapPreviewEl: HTMLDivElement | undefined
  let snapAssistRootEl: HTMLDivElement | undefined
  const [workspaceAreaNode, setWorkspaceAreaNode] = createSignal<HTMLDivElement | null>(null)
  const [workspaceCanvasSize, setWorkspaceCanvasSize] = createSignal<WorkspaceCanvasSize | null>(
    null,
  )
  const [_dragSnapZone, setDragSnapZone] = createSignal<SnapDetectResult | null>(null)
  const [dragSnapWindowId, setDragSnapWindowId] = createSignal<string | null>(null)
  const [snapAssistShown, setSnapAssistShown] = createSignal(false)
  const [snapAssistEngaged, setSnapAssistEngaged] = createSignal(false)
  const [assistHoverPick, setAssistHoverPick] = createSignal<AssistSlotPick | null>(null)
  const [dragEdgeGridSpan, setDragEdgeGridSpan] = createSignal<AssistGridSpan | null>(null)
  const [mergeTargetPreview, setMergeTargetPreview] = createSignal<MergeTarget | null>(null)
  let draggedWindowIdForSnap: string | null = null

  function getWorkspaceCanvas(): WorkspaceCanvasSize {
    const s = workspaceCanvasSize()
    if (s && s.width > 0 && s.height > 0) return s
    const el = workspaceAreaEl
    if (el) {
      return {
        width: Math.max(1, Math.round(el.clientWidth)),
        height: Math.max(1, Math.round(el.clientHeight)),
      }
    }
    return getViewportSize()
  }

  function clientInDomRect(clientX: number, clientY: number, r: DOMRect) {
    return clientX >= r.left && clientY >= r.top && clientX <= r.right && clientY <= r.bottom
  }

  createEffect(() => {
    const el = workspaceAreaNode()
    if (!el) return
    let lastW = Math.round(el.clientWidth)
    let lastH = Math.round(el.clientHeight)
    if (lastW > 0 && lastH > 0) {
      setWorkspaceCanvasSize({ width: lastW, height: lastH })
    }
    const ro = new ResizeObserver(() => {
      const w = Math.round(el.clientWidth)
      const h = Math.round(el.clientHeight)
      if (w <= 0 || h <= 0) return
      if (w === lastW && h === lastH) return
      if (lastW <= 0 || lastH <= 0) {
        lastW = w
        lastH = h
        setWorkspaceCanvasSize({ width: w, height: h })
        return
      }
      setWorkspace((prev) => {
        if (!prev) return prev
        const scaled = scaleSnappedWindowsBoundsForCanvasResize(
          prev.windows,
          { width: lastW, height: lastH },
          { width: w, height: h },
        )
        return { ...prev, windows: scaled }
      })
      lastW = w
      lastH = h
      setWorkspaceCanvasSize({ width: w, height: h })
    })
    ro.observe(el)
    onCleanup(() => ro.disconnect())
  })

  function getZoneBoundsForDrag(zone: SnapZone): WorkspaceBounds {
    const edge = dragEdgeGridSpan()
    const canvas = getWorkspaceCanvas()
    if (edge) {
      return assistGridSpanToBounds(canvas, edge)
    }
    const w = workspace()
    if (!w) return snapZoneToBoundsWithOccupied(zone, [], canvas)
    const ex = draggedWindowIdForSnap
    const excludeW = ex ? w.windows.find((x) => x.id === ex) : null
    const excludeGid = excludeW ? groupIdForWindow(excludeW) : null
    const occupied = w.windows
      .filter(
        (x) =>
          x.layout?.snapZone &&
          x.layout.bounds &&
          (excludeGid == null || groupIdForWindow(x) !== excludeGid),
      )
      .map((x) => ({ bounds: x.layout!.bounds!, snapZone: x.layout!.snapZone! }))
    preferredSnapTick()
    const shape = useWorkspacePreferredSnapStore.getState().assistGridShape
    return snapZonePreviewBoundsForDrag(zone, canvas, w.windows, occupied, shape)
  }

  function handleDragPointerMove(windowId: string, clientX: number, clientY: number) {
    draggedWindowIdForSnap = windowId
    setDragSnapWindowId(windowId)
    const c = workspaceAreaEl
    const p = snapPreviewEl

    const ws = workspace()
    const hit = ws && c ? findMergeTarget(ws.windows, windowId, clientX, clientY) : null
    setMergeTargetPreview(hit)

    if (!c) return

    if (ws && hit) {
      setSnapAssistEngaged(false)
      setSnapAssistShown(false)
      setAssistHoverPick(null)
      setDragEdgeGridSpan(null)
      setDragSnapZone(null)
      applySnapPreviewLayout(p, null, c, getZoneBoundsForDrag)
      return
    }

    const rect = c.getBoundingClientRect()
    const lx = clientX - rect.left
    const ly = clientY - rect.top
    preferredSnapTick()
    const st = useWorkspacePreferredSnapStore.getState()
    const shape = st.assistGridShape
    const assistOn = st.snapAssistOnTopDrag
    const nearTop = ly <= SNAP_EDGE_THRESHOLD_PX
    const topInnerBand =
      assistOn && nearTop && Math.abs(lx - rect.width / 2) <= TOP_SNAP_ASSIST_CENTER_HALF_WIDTH_PX
    const assistRect = snapAssistRootEl?.getBoundingClientRect()
    const overAssistPanel =
      assistOn && assistRect ? clientInDomRect(clientX, clientY, assistRect) : false

    if (topInnerBand || overAssistPanel) {
      setSnapAssistEngaged(true)
    }

    const inAssistKeepaliveCorridor =
      assistOn && snapAssistEngaged() && ly <= TOP_SNAP_ASSIST_KEEPALIVE_PX

    const edgeSpan = detectEdgeAssistGridSpan(lx, ly, rect.width, rect.height, shape, {
      suppressTopEdgeSpans: false,
    })
    setDragEdgeGridSpan(edgeSpan)

    let z: SnapDetectResult | null = edgeSpan ? 'edge-grid' : null

    if (assistOn && snapAssistEngaged() && (overAssistPanel || inAssistKeepaliveCorridor)) {
      setSnapAssistShown(true)
    } else {
      setSnapAssistShown(false)
      if (
        assistOn &&
        snapAssistEngaged() &&
        !topInnerBand &&
        !overAssistPanel &&
        !inAssistKeepaliveCorridor
      ) {
        setSnapAssistEngaged(false)
      }
    }

    setDragSnapZone(z)
    if (p) applySnapPreviewLayout(p, z, c, getZoneBoundsForDrag)

    const assistBarVisible =
      assistOn && snapAssistEngaged() && (overAssistPanel || ly <= TOP_SNAP_ASSIST_KEEPALIVE_PX)
    if (assistBarVisible && snapAssistRootEl) {
      setAssistHoverPick(pickAssistSlotFromPoint(clientX, clientY, snapAssistRootEl))
    } else {
      setAssistHoverPick(null)
    }
  }

  function restoreDrag(
    windowId: string,
    clientX: number,
    _clientY: number,
  ): WorkspaceBounds | undefined {
    const w = workspace()
    const container = workspaceAreaEl?.getBoundingClientRect()
    if (!w || !container) return
    const win = w.windows.find((x) => x.id === windowId)
    if (!win) return
    const currentBounds = win.layout?.bounds
    const restoreBounds = win.layout?.restoreBounds
    const restoredW = restoreBounds?.width ?? currentBounds?.width ?? 500
    const restoredH = restoreBounds?.height ?? currentBounds?.height ?? 260
    const currentWidth = currentBounds?.width ?? restoredW
    const oX = container.left
    const grabRatio = currentBounds
      ? Math.min(Math.max((clientX - oX - currentBounds.x) / currentWidth, 0), 1)
      : 0.5
    const newX = clientX - oX - restoredW * grabRatio
    const newY = currentBounds?.y ?? 0
    unsnapWindow(windowId, { x: newX, y: newY })
    return { x: newX, y: newY, width: restoredW, height: restoredH }
  }

  function unsnapWindow(windowId: string, drop: { x: number; y: number } | null) {
    setWorkspace((prev) => {
      if (!prev) return prev
      const win = prev.windows.find((x) => x.id === windowId)
      const gid = win ? groupIdForWindow(win) : null
      return {
        ...prev,
        windows: prev.windows.map((w) => {
          if (gid && groupIdForWindow(w) !== gid) return w
          if (!gid && w.id !== windowId) return w
          const restored = w.layout?.restoreBounds ?? w.layout?.bounds
          return {
            ...w,
            layout: {
              ...w.layout,
              snapZone: null,
              fullscreen: false,
              bounds:
                drop && restored
                  ? { x: drop.x, y: drop.y, width: restored.width, height: restored.height }
                  : (restored ?? w.layout?.bounds ?? null),
              restoreBounds: null,
            },
          }
        }),
      }
    })
  }

  function snapWindowToAssistCustom(windowId: string, bounds: WorkspaceBounds) {
    // oxlint-disable-next-line solid/reactivity -- setState functional update from snap/drag, not a tracked derivation
    setWorkspace((prev) => {
      if (!prev) return prev
      const maxZ = Math.max(...prev.windows.map((x) => x.layout?.zIndex ?? 1), 1)
      const win = prev.windows.find((x) => x.id === windowId)
      const gid = win ? groupIdForWindow(win) : null
      const canvas = getWorkspaceCanvas()
      const b: WorkspaceBounds = {
        x: Math.max(0, Math.min(bounds.x, canvas.width - 100)),
        y: Math.max(0, Math.min(bounds.y, canvas.height - 100)),
        width: Math.min(Math.max(bounds.width, 100), canvas.width),
        height: Math.min(Math.max(bounds.height, 100), canvas.height),
      }
      return {
        ...prev,
        activeWindowId: windowId,
        windows: prev.windows.map((w) => {
          if (gid && groupIdForWindow(w) !== gid) return w
          if (!gid && w.id !== windowId) return w
          return {
            ...w,
            layout: {
              ...w.layout,
              fullscreen: false,
              snapZone: 'assist-custom',
              minimized: false,
              zIndex: maxZ + 1,
              bounds: b,
              restoreBounds: w.layout?.restoreBounds ?? w.layout?.bounds ?? null,
            },
          }
        }),
      }
    })
  }

  function toggleFullscreenWindow(windowId: string) {
    setWorkspace((prev) => {
      if (!prev) return prev
      const win = prev.windows.find((x) => x.id === windowId)
      const gid = win ? groupIdForWindow(win) : null
      const maxZ = Math.max(...prev.windows.map((x) => x.layout?.zIndex ?? 1), 1)
      return {
        ...prev,
        activeWindowId: windowId,
        windows: prev.windows.map((w) => {
          const inGroup = gid && groupIdForWindow(w) === gid
          const solo = !gid && w.id === windowId
          if (!inGroup && !solo) return w
          const currentBounds = w.layout?.bounds ?? createDefaultBounds(0, w.type)
          const isFs = w.layout?.fullscreen ?? false
          return {
            ...w,
            layout: {
              ...w.layout,
              fullscreen: !isFs,
              snapZone: null,
              minimized: false,
              zIndex: maxZ + 1,
              bounds: isFs
                ? (w.layout?.restoreBounds ?? currentBounds)
                : createFullscreenBounds(getWorkspaceCanvas()),
              restoreBounds: isFs ? null : currentBounds,
            },
          }
        }),
      }
    })
  }

  function setWindowMinimized(windowId: string, minimized: boolean) {
    setWorkspace((prev) => {
      if (!prev) return prev
      const win = prev.windows.find((x) => x.id === windowId)
      const gid = win ? groupIdForWindow(win) : null
      return {
        ...prev,
        windows: prev.windows.map((w) =>
          gid && groupIdForWindow(w) === gid
            ? { ...w, layout: { ...w.layout, minimized } }
            : !gid && w.id === windowId
              ? { ...w, layout: { ...w.layout, minimized } }
              : w,
        ),
      }
    })
  }

  function updateWindowBounds(windowId: string, bounds: WorkspaceBounds) {
    setWorkspace((prev) => {
      if (!prev) return prev
      const win = prev.windows.find((x) => x.id === windowId)
      const gid = win ? groupIdForWindow(win) : null
      return {
        ...prev,
        windows: prev.windows.map((w) =>
          gid && groupIdForWindow(w) === gid
            ? { ...w, layout: { ...w.layout, bounds } }
            : w.id === windowId
              ? { ...w, layout: { ...w.layout, bounds } }
              : w,
        ),
      }
    })
  }

  function resizeSnappedWindowBounds(windowId: string, bounds: WorkspaceBounds, direction: string) {
    setWorkspace((prev) =>
      prev
        ? {
            ...prev,
            windows: computeSnappedResizeWindows(prev.windows, windowId, bounds, direction),
          }
        : prev,
    )
  }

  function clearSnapAssistDragUi() {
    setSnapAssistShown(false)
    setSnapAssistEngaged(false)
    setAssistHoverPick(null)
    setDragEdgeGridSpan(null)
    setDragSnapWindowId(null)
    setMergeTargetPreview(null)
    draggedWindowIdForSnap = null
  }

  function onDragPointerEnd(
    windowId: string,
    bounds: WorkspaceBounds,
    clientX: number,
    clientY: number,
  ) {
    const edgeSpanEnd = dragEdgeGridSpan()
    const hadAssistUi = snapAssistShown()
    const assistRootAtEnd = snapAssistRootEl
    const c = workspaceAreaEl
    const p = snapPreviewEl
    if (c && p) applySnapPreviewLayout(p, null, c, getZoneBoundsForDrag)
    setDragSnapZone(null)
    setDragEdgeGridSpan(null)

    const wsMerge = workspace()
    if (wsMerge) {
      const hit = findMergeTarget(wsMerge.windows, windowId, clientX, clientY)
      if (hit) {
        const targetWindow = wsMerge.windows.find((w) => groupIdForWindow(w) === hit.groupId)
        if (targetWindow) {
          clearSnapAssistDragUi()
          setWorkspace((prev) =>
            prev
              ? mergeWindowIntoGroupState(prev, windowId, targetWindow.id, hit.insertIndex)
              : prev,
          )
          return
        }
      }
    }

    if (hadAssistUi && assistRootAtEnd?.isConnected) {
      const picked = pickAssistSlotFromPoint(clientX, clientY, assistRootAtEnd)
      const assistRect = assistRootAtEnd.getBoundingClientRect()
      const inAssist = clientInDomRect(clientX, clientY, assistRect)

      if (inAssist && !picked) {
        clearSnapAssistDragUi()
        updateWindowBounds(windowId, bounds)
        return
      }

      if (picked) {
        clearSnapAssistDragUi()
        const matched = assistShapeMatchingSpan(picked.span)
        if (matched) {
          useWorkspacePreferredSnapStore.getState().setAssistGridShape(matched)
        }
        const snapB = assistGridSpanToBounds(getWorkspaceCanvas(), picked.span)
        snapWindowToAssistCustom(windowId, snapB)
        return
      }
    }

    clearSnapAssistDragUi()

    if (edgeSpanEnd) {
      snapWindowToAssistCustom(windowId, assistGridSpanToBounds(getWorkspaceCanvas(), edgeSpanEnd))
      return
    }

    const w = workspace()?.windows.find((x) => x.id === windowId)
    if (w?.layout?.snapZone || w?.layout?.fullscreen) {
      unsnapWindow(windowId, { x: bounds.x, y: bounds.y })
      return
    }
    updateWindowBounds(windowId, bounds)
  }

  function bindWorkspaceAreaRoot(el: HTMLDivElement | null) {
    workspaceAreaEl = el ?? undefined
    setWorkspaceAreaNode(el)
  }

  function applyTilingPickerPick(windowId: string, span: AssistGridSpan) {
    const c = workspaceAreaEl
    if (!c) return
    const r = c.getBoundingClientRect()
    const canvas = { width: Math.max(1, r.width), height: Math.max(1, r.height) }
    const matched = assistShapeMatchingSpan(span)
    if (matched) {
      useWorkspacePreferredSnapStore.getState().setAssistGridShape(matched)
    }
    snapWindowToAssistCustom(windowId, assistGridSpanToBounds(canvas, span))
  }

  return {
    workspaceAreaNode,
    bindWorkspaceAreaRoot,
    bindSnapPreview(el: HTMLDivElement | null) {
      snapPreviewEl = el ?? undefined
    },
    bindSnapAssistRoot(el: HTMLDivElement | null) {
      snapAssistRootEl = el ?? undefined
    },
    getWorkspaceAreaElement: () => workspaceAreaEl,
    dragSnapWindowId,
    snapAssistShown,
    assistHoverPick,
    mergeTargetPreview,
    handleDragPointerMove,
    restoreDrag,
    snapWindowToAssistCustom,
    toggleFullscreenWindow,
    setWindowMinimized,
    updateWindowBounds,
    resizeSnappedWindowBounds,
    onDragPointerEnd,
    applyTilingPickerPick,
  }
}
