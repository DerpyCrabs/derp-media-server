import type { PersistedWorkspaceState } from './use-workspace'
import { clampWorkspaceBoundsToViewport, type WorkspaceViewport } from './workspace-placement'

export type WorkspaceType = PersistedWorkspaceState['workspaceType']

function clearRendererLayout(
  state: PersistedWorkspaceState,
  viewport?: WorkspaceViewport,
): PersistedWorkspaceState['windows'] {
  const groupBounds = new Map<
    string,
    NonNullable<(typeof state.windows)[number]['layout']>['bounds']
  >()
  return state.windows.map((window) => {
    const groupId = window.tabGroupId ?? window.id
    const existing = window.layout?.bounds
    let bounds = groupBounds.get(groupId)
    if (!bounds && existing) {
      bounds = viewport ? clampWorkspaceBoundsToViewport(existing, viewport) : { ...existing }
      groupBounds.set(groupId, bounds)
    }
    return {
      ...window,
      layout: {
        ...window.layout,
        ...(bounds ? { bounds: { ...bounds } } : {}),
        fullscreen: false,
        minimized: false,
        snapZone: null,
        tiling: null,
      },
    }
  })
}

export function convertWorkspaceSnapshot(
  state: PersistedWorkspaceState,
  target: WorkspaceType,
  viewport?: WorkspaceViewport,
): PersistedWorkspaceState {
  if (state.workspaceType === target) return state
  const windows = clearRendererLayout(state, target === 'desktop' ? viewport : undefined)
  if (target === 'desktop') {
    const { canvas: _canvas, ...desktop } = state
    return { ...desktop, workspaceType: 'desktop', windows }
  }
  return {
    ...state,
    workspaceType: 'canvas',
    windows,
    canvas: {
      camera: { x: 0, y: 0, zoom: 1 },
      maximizedWindowId: null,
      windowSizeByType: {},
      nextZIndex: Math.max(1, ...windows.map((window) => (window.layout?.zIndex ?? 0) + 1)),
    },
  }
}
