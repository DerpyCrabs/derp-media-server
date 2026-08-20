import type { PersistedWorkspaceState } from '../../model/use-workspace'
import {
  CANVAS_MAX_ZOOM,
  CANVAS_MIN_ZOOM,
  createEmptyCanvasState,
  type InfiniteCanvasState,
} from '@/workspace/canvas/model/infinite-canvas'
import { createDefaultBounds } from '../../model/workspace-geometry'

export function canvasViewFromWorkspace(state: PersistedWorkspaceState): InfiniteCanvasState {
  const fallback = createEmptyCanvasState()
  const canvas = state.canvas
  const windows = state.windows.map((definition, index) => ({
    id: definition.id,
    bounds:
      definition.layout?.bounds ??
      createDefaultBounds(index, definition.type === 'browser' ? 'browser' : 'viewer'),
    zIndex: definition.layout?.zIndex ?? index + 1,
  }))
  return {
    windows,
    maximizedWindowId:
      canvas?.maximizedWindowId && windows.some((window) => window.id === canvas.maximizedWindowId)
        ? canvas.maximizedWindowId
        : null,
    camera: canvas
      ? {
          x: Number.isFinite(canvas.camera.x) ? canvas.camera.x : 0,
          y: Number.isFinite(canvas.camera.y) ? canvas.camera.y : 0,
          zoom: Math.min(CANVAS_MAX_ZOOM, Math.max(CANVAS_MIN_ZOOM, canvas.camera.zoom)),
        }
      : fallback.camera,
    windowSizeByType: canvas?.windowSizeByType ?? {},
    nextItemId: state.nextWindowId,
    nextZIndex: Math.max(canvas?.nextZIndex ?? 1, ...windows.map((window) => window.zIndex + 1)),
  }
}

export function applyCanvasGeometryToWorkspace(
  canvasState: InfiniteCanvasState,
  base: PersistedWorkspaceState,
): PersistedWorkspaceState {
  const geometryById = new Map(canvasState.windows.map((window) => [window.id, window]))
  return {
    ...base,
    workspaceType: 'canvas',
    windows: base.windows.map((definition) => {
      const geometry = geometryById.get(definition.id)
      if (!geometry) return definition
      return {
        ...definition,
        layout: {
          ...definition.layout,
          bounds: { ...geometry.bounds },
          zIndex: geometry.zIndex,
          fullscreen: false,
          minimized: false,
          snapZone: null,
          tiling: null,
        },
      }
    }),
    nextWindowId: Math.max(base.nextWindowId, canvasState.nextItemId),
    canvas: {
      camera: { ...canvasState.camera },
      maximizedWindowId:
        canvasState.maximizedWindowId &&
        base.windows.some((window) => window.id === canvasState.maximizedWindowId)
          ? canvasState.maximizedWindowId
          : null,
      windowSizeByType: Object.fromEntries(
        Object.entries(canvasState.windowSizeByType).map(([key, size]) => [key, { ...size }]),
      ),
      nextZIndex: Math.max(base.canvas?.nextZIndex ?? 1, canvasState.nextZIndex),
    },
  }
}
