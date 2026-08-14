import { computeSnappedResizeWindows } from '@/lib/workspace-session-store'
import {
  applyAssistCustomSnapToWindows,
  assistGridSpanToBounds,
  assistShapeMatchingSpan,
  detectEdgeAssistGridSpan,
  expandEdgeAssistSpanToAvailableTracks,
  findSharedAssistGridLines,
  type AssistGridSpan,
} from '@/lib/workspace-assist-grid'
import { pickAssistSlotFromPoint, type AssistSlotPick } from '@/lib/workspace-snap-pick'
import { snapZonePreviewBoundsForDrag } from '@/lib/workspace-snap-live'
import { useWorkspacePreferredSnapStore } from '@/lib/workspace-preferred-snap-store'
import {
  createDefaultBounds,
  createFullscreenBounds,
  getViewportSize,
  maxWorkspaceWindowZ,
  scaleSnappedWindowsBoundsForCanvasResize,
  snapZoneToBoundsWithOccupied,
  type WorkspaceCanvasSize,
} from '@/lib/workspace-geometry'
import type { PersistedWorkspaceState, SnapZone } from '@/lib/use-workspace'
import { contentWindowKind } from '@/lib/content-window'
import {
  TOP_SNAP_ASSIST_HANDLE_HEIGHT_PX,
  snapAssistSurfaceWidth,
  type SnapDetectResult,
} from '@/lib/use-snap-zones'
import { layoutViewportClientSize } from '@/lib/layout-viewport'
import {
  findMergeTarget,
  mergeTargetGroupSignature,
  mergeTargetHitTest,
  workspaceWindowsByGroupId,
  type MergeTarget,
} from '@/src/workspace/merge-target'
import {
  groupIdForWindow,
  mergeWindowIntoGroupState,
  resolveGroupVisibleTabId,
} from '@/src/workspace/tab-group-ops'
import { applySnapPreviewBounds, applySnapPreviewLayout } from '@/src/workspace/snap-preview'
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
  let snapAssistSticky = false
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
  const [tilingPickerHoverSpan, setTilingPickerHoverSpan] = createSignal<AssistGridSpan | null>(
    null,
  )
  let draggedWindowIdForSnap: string | null = null
  const layoutUndoStack: PersistedWorkspaceState[] = []
  let lastHistoryKind = ''
  let lastHistoryAt = 0

  function rememberLayout(state: PersistedWorkspaceState, kind: string) {
    const now = Date.now()
    if (kind === lastHistoryKind && now - lastHistoryAt < 500) return
    layoutUndoStack.push(structuredClone(state))
    if (layoutUndoStack.length > 20) layoutUndoStack.shift()
    lastHistoryKind = kind
    lastHistoryAt = now
  }

  const onLayoutUndoKey = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null
    if (
      !(event.ctrlKey || event.metaKey) ||
      event.key.toLowerCase() !== 'z' ||
      target?.closest('input, textarea, [contenteditable]')
    ) {
      return
    }
    const previous = layoutUndoStack.pop()
    if (!previous) return
    event.preventDefault()
    setWorkspace(previous)
  }
  document.addEventListener('keydown', onLayoutUndoKey)
  onCleanup(() => document.removeEventListener('keydown', onLayoutUndoKey))

  let mergeByGroupCache: {
    sig: string
    byGroup: ReturnType<typeof workspaceWindowsByGroupId>
  } | null = null

  function invalidateMergeGroupCache() {
    mergeByGroupCache = null
  }

  function mergePreviewForPointer(
    windows: PersistedWorkspaceState['windows'],
    windowId: string,
    clientX: number,
    clientY: number,
  ): MergeTarget | null {
    const sig = mergeTargetGroupSignature(windows)
    if (!mergeByGroupCache || mergeByGroupCache.sig !== sig) {
      mergeByGroupCache = { sig, byGroup: workspaceWindowsByGroupId(windows) }
    }
    const draggedW = windows.find((w) => w.id === windowId)
    const draggedGroupId = draggedW ? groupIdForWindow(draggedW) : windowId
    const c = workspaceAreaEl
    const rect = c?.getBoundingClientRect()
    return mergeTargetHitTest(
      mergeByGroupCache.byGroup,
      draggedGroupId,
      clientX,
      clientY,
      rect ? { canvasRect: rect } : undefined,
    )
  }

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

  function tiledWindowGap() {
    preferredSnapTick()
    return useWorkspacePreferredSnapStore.getState().tiledWindowGap
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

  createEffect(() => {
    const span = tilingPickerHoverSpan() ?? (snapAssistShown() ? assistHoverPick()?.span : null)
    void workspaceCanvasSize()
    const c = workspaceAreaEl
    const p = snapPreviewEl
    if (!c || !p) return
    if (!span) {
      applySnapPreviewLayout(
        p,
        dragSnapWindowId() ? _dragSnapZone() : null,
        c,
        getZoneBoundsForDrag,
        tiledWindowGap(),
      )
      return
    }
    const r = c.getBoundingClientRect()
    const canvas = {
      width: Math.max(1, r.width),
      height: Math.max(1, r.height),
    }
    const existing = findSharedAssistGridLines(workspace()?.windows ?? [], span)
    const b = assistGridSpanToBounds(canvas, span, existing)
    applySnapPreviewBounds(p, b, c, tiledWindowGap())
  })

  function getZoneBoundsForDrag(zone: SnapZone): WorkspaceBounds {
    const edge = dragEdgeGridSpan()
    const canvas = getWorkspaceCanvas()
    if (edge) {
      const existing = findSharedAssistGridLines(workspace()?.windows ?? [], edge)
      return assistGridSpanToBounds(canvas, edge, existing)
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
      .map((x) => ({
        bounds: x.layout!.bounds!,
        snapZone: x.layout!.snapZone!,
      }))
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
    const hit =
      !snapAssistEngaged() && !snapAssistSticky && ws && c
        ? mergePreviewForPointer(ws.windows, windowId, clientX, clientY)
        : null
    setMergeTargetPreview(hit)

    if (!c) return

    if (ws && hit) {
      setSnapAssistEngaged(false)
      setSnapAssistShown(false)
      setAssistHoverPick(null)
      setDragEdgeGridSpan(null)
      setDragSnapZone(null)
      applySnapPreviewLayout(p, null, c, getZoneBoundsForDrag, tiledWindowGap())
      return
    }

    const rect = c.getBoundingClientRect()
    const lx = clientX - rect.left
    const ly = clientY - rect.top
    preferredSnapTick()
    const st = useWorkspacePreferredSnapStore.getState()
    const shape = st.assistGridShape
    const assistOn = st.snapAssistOnTopDrag
    const viewport = layoutViewportClientSize()
    const nearTop = clientY >= 0 && clientY <= TOP_SNAP_ASSIST_HANDLE_HEIGHT_PX
    const assistTargetWidth = snapAssistSurfaceWidth(viewport.w, viewport.h)
    const topInnerBand =
      assistOn && nearTop && Math.abs(clientX - viewport.w / 2) <= assistTargetWidth / 2
    const assistRect = snapAssistRootEl?.getBoundingClientRect()
    const overAssistPanel =
      assistOn && assistRect ? clientInDomRect(clientX, clientY, assistRect) : false

    if (snapAssistSticky && !overAssistPanel) {
      snapAssistSticky = false
      setSnapAssistEngaged(false)
      setSnapAssistShown(false)
      setAssistHoverPick(null)
    }

    if (topInnerBand || overAssistPanel) {
      setSnapAssistEngaged(true)
    }
    if (overAssistPanel) snapAssistSticky = true

    const detectedEdgeSpan = detectEdgeAssistGridSpan(lx, ly, rect.width, rect.height, shape, {
      suppressTopEdgeSpans: false,
    })
    const dragged = ws?.windows.find((window) => window.id === windowId)
    const draggedGroupId = dragged ? groupIdForWindow(dragged) : null
    const edgeSpan = detectedEdgeSpan
      ? expandEdgeAssistSpanToAvailableTracks(
          ws?.windows.filter(
            (window) => draggedGroupId === null || groupIdForWindow(window) !== draggedGroupId,
          ) ?? [],
          detectedEdgeSpan,
        )
      : null
    setDragEdgeGridSpan(edgeSpan)

    let z: SnapDetectResult | null = edgeSpan ? 'edge-grid' : null

    if (assistOn && (snapAssistEngaged() || snapAssistSticky)) {
      setSnapAssistShown(true)
    } else {
      setSnapAssistShown(false)
    }

    setDragSnapZone(z)
    if (p) applySnapPreviewLayout(p, z, c, getZoneBoundsForDrag, tiledWindowGap())

    const assistBarVisible = assistOn && (snapAssistEngaged() || snapAssistSticky)
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
      rememberLayout(prev, 'unsnap')
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
              tiling: null,
              fullscreen: false,
              bounds:
                drop && restored
                  ? {
                      x: drop.x,
                      y: drop.y,
                      width: restored.width,
                      height: restored.height,
                    }
                  : (restored ?? w.layout?.bounds ?? null),
              restoreBounds: null,
            },
          }
        }),
      }
    })
  }

  function snapWindowToAssistCustom(windowId: string, span: AssistGridSpan) {
    // oxlint-disable-next-line solid/reactivity -- setState functional update from snap/drag, not a tracked derivation
    setWorkspace((prev) => {
      if (!prev) return prev
      rememberLayout(prev, 'snap')
      return {
        ...prev,
        activeWindowId: windowId,
        windows: applyAssistCustomSnapToWindows(
          prev.windows,
          windowId,
          span,
          getWorkspaceCanvas(),
          { zIndex: maxWorkspaceWindowZ(prev.windows) + 1 },
        ),
      }
    })
  }

  function toggleFullscreenWindow(windowId: string) {
    setWorkspace((prev) => {
      if (!prev) return prev
      rememberLayout(prev, 'fullscreen')
      const win = prev.windows.find((x) => x.id === windowId)
      const gid = win ? groupIdForWindow(win) : null
      const maxZ = maxWorkspaceWindowZ(prev.windows)
      return {
        ...prev,
        activeWindowId: windowId,
        windows: prev.windows.map((w) => {
          const inGroup = gid && groupIdForWindow(w) === gid
          const solo = !gid && w.id === windowId
          if (!inGroup && !solo) return w
          const currentBounds = w.layout?.bounds ?? createDefaultBounds(0, contentWindowKind(w))
          const isFs = w.layout?.fullscreen ?? false
          return {
            ...w,
            layout: {
              ...w.layout,
              fullscreen: !isFs,
              snapZone: null,
              tiling: null,
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
      const windows = prev.windows.map((w) =>
        gid && groupIdForWindow(w) === gid
          ? { ...w, layout: { ...w.layout, minimized } }
          : !gid && w.id === windowId
            ? { ...w, layout: { ...w.layout, minimized } }
            : w,
      )

      if (!minimized) return { ...prev, windows }

      const activeId = prev.activeWindowId
      if (activeId == null) return { ...prev, windows }
      const activeWin = windows.find((x) => x.id === activeId)
      if (!activeWin) return { ...prev, windows }
      const activeGid = groupIdForWindow(activeWin)
      const minimizingActive =
        (gid != null && activeGid === gid) || (gid == null && activeId === windowId)
      if (!minimizingActive) return { ...prev, windows }

      let bestGid: string | null = null
      let bestZ = -Infinity
      const seen = new Set<string>()
      for (const w of windows) {
        if (w.layout?.minimized) continue
        const wg = groupIdForWindow(w)
        if (gid != null && wg === gid) continue
        if (seen.has(wg)) continue
        seen.add(wg)
        const z = w.layout?.zIndex ?? 0
        if (z >= bestZ) {
          bestZ = z
          bestGid = wg
        }
      }
      if (!bestGid) return { ...prev, windows }

      const focusId =
        resolveGroupVisibleTabId(
          {
            windows,
            activeTabMap: prev.activeTabMap,
            tabGroupSplits: prev.tabGroupSplits,
          },
          bestGid,
        ) || bestGid
      const newZ = maxWorkspaceWindowZ(windows) + 1
      return {
        ...prev,
        activeWindowId: focusId,
        activeTabMap: { ...prev.activeTabMap, [bestGid]: focusId },
        windows: windows.map((w) =>
          groupIdForWindow(w) === bestGid ? { ...w, layout: { ...w.layout, zIndex: newZ } } : w,
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
    const canvas = getWorkspaceCanvas()
    setWorkspace((prev) =>
      prev
        ? (rememberLayout(prev, `resize:${windowId}:${direction}`),
          {
            ...prev,
            windows: computeSnappedResizeWindows(prev.windows, windowId, bounds, direction, canvas),
          })
        : prev,
    )
  }

  function clearSnapAssistDragUi() {
    invalidateMergeGroupCache()
    snapAssistSticky = false
    setSnapAssistShown(false)
    setSnapAssistEngaged(false)
    setAssistHoverPick(null)
    setDragEdgeGridSpan(null)
    setDragSnapWindowId(null)
    setMergeTargetPreview(null)
    draggedWindowIdForSnap = null
  }

  function engageSnapAssistFromHandle() {
    preferredSnapTick()
    if (!draggedWindowIdForSnap || !useWorkspacePreferredSnapStore.getState().snapAssistOnTopDrag) {
      return
    }
    snapAssistSticky = true
    setMergeTargetPreview(null)
    setSnapAssistEngaged(true)
    setSnapAssistShown(true)
  }

  function disengageSnapAssistFromPanel() {
    snapAssistSticky = false
    setSnapAssistEngaged(false)
    setSnapAssistShown(false)
    setAssistHoverPick(null)
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
    if (c && p) applySnapPreviewLayout(p, null, c, getZoneBoundsForDrag, tiledWindowGap())
    setDragSnapZone(null)
    setDragEdgeGridSpan(null)

    const wsMerge = workspace()
    if (wsMerge && !snapAssistEngaged() && !snapAssistSticky) {
      const rect = workspaceAreaEl?.getBoundingClientRect()
      const hit = findMergeTarget(
        wsMerge.windows,
        windowId,
        clientX,
        clientY,
        rect ? { canvasRect: rect } : undefined,
      )
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
        snapWindowToAssistCustom(windowId, picked.span)
        return
      }
    }

    clearSnapAssistDragUi()

    if (edgeSpanEnd) {
      snapWindowToAssistCustom(windowId, edgeSpanEnd)
      return
    }

    const w = workspace()?.windows.find((x) => x.id === windowId)
    if (w?.layout?.tiling || w?.layout?.snapZone || w?.layout?.fullscreen) {
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
    setTilingPickerHoverSpan(null)
    if (!workspaceAreaEl) return
    const matched = assistShapeMatchingSpan(span)
    if (matched) {
      useWorkspacePreferredSnapStore.getState().setAssistGridShape(matched)
    }
    snapWindowToAssistCustom(windowId, span)
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
    engageSnapAssistFromHandle,
    disengageSnapAssistFromPanel,
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
    setTilingPickerHoverPreview: setTilingPickerHoverSpan,
  }
}
