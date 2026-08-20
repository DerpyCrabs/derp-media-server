import type { WindowLayout } from '@/lib/models/window-model'

export type WorkspaceViewport = { width: number; height: number }
export type WorkspacePlacementBounds = NonNullable<WindowLayout['bounds']>

/** Pick a repeatable desktop placement for a newly inserted group. */
export function cascadeWorkspaceBounds(
  index: number,
  viewport: WorkspaceViewport,
): WorkspacePlacementBounds {
  const width = Math.max(1, Math.min(720, viewport.width - 48))
  const height = Math.max(1, Math.min(520, viewport.height - 48))
  const availableWidth = Math.max(0, viewport.width - width)
  const availableHeight = Math.max(0, viewport.height - height)
  const slots = Math.max(1, Math.floor(Math.min(availableWidth, availableHeight) / 24) + 1)
  const offset = (Math.max(0, index) % slots) * 24
  return { x: offset, y: offset, width, height }
}

/** Keep bounds fully inside viewport, including viewports smaller than normal window minimums. */
export function clampWorkspaceBoundsToViewport(
  bounds: WorkspacePlacementBounds,
  viewport: WorkspaceViewport,
): WorkspacePlacementBounds {
  const width = Math.min(Math.max(1, bounds.width), Math.max(1, viewport.width))
  const height = Math.min(Math.max(1, bounds.height), Math.max(1, viewport.height))
  return {
    x: Math.min(Math.max(0, bounds.x), Math.max(0, viewport.width - width)),
    y: Math.min(Math.max(0, bounds.y), Math.max(0, viewport.height - height)),
    width,
    height,
  }
}
