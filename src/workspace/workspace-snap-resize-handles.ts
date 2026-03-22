import type { SnapZone } from '@/lib/use-workspace'
import type { WorkspaceBounds, WorkspaceCanvasSize } from '@/lib/workspace-geometry'

export type ResizeHandleKey =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'topLeft'
  | 'topRight'
  | 'bottomLeft'
  | 'bottomRight'

const EDGE_TOL = 6

function snapResizeHandlesFromBounds(
  b: WorkspaceBounds,
  canvas: WorkspaceCanvasSize,
): Record<ResizeHandleKey, boolean> {
  const handles: Record<ResizeHandleKey, boolean> = {
    top: false,
    bottom: false,
    left: false,
    right: false,
    topLeft: false,
    topRight: false,
    bottomLeft: false,
    bottomRight: false,
  }
  if (b.x > EDGE_TOL) handles.left = true
  if (b.x + b.width < canvas.width - EDGE_TOL) handles.right = true
  if (b.y > EDGE_TOL) handles.top = true
  if (b.y + b.height < canvas.height - EDGE_TOL) handles.bottom = true
  handles.topLeft = handles.top && handles.left
  handles.topRight = handles.top && handles.right
  handles.bottomLeft = handles.bottom && handles.left
  handles.bottomRight = handles.bottom && handles.right
  return handles
}

export function getWorkspaceSnapResizeHandleMap(
  isSnapped: boolean,
  zone: SnapZone | null | undefined,
  bounds?: WorkspaceBounds | null,
  canvas?: WorkspaceCanvasSize | null,
): Record<ResizeHandleKey, boolean> | 'all' {
  if (!isSnapped || !zone) return 'all'
  if (zone === 'assist-custom' && bounds && canvas) {
    return snapResizeHandlesFromBounds(bounds, canvas)
  }
  const handles: Record<ResizeHandleKey, boolean> = {
    top: false,
    bottom: false,
    left: false,
    right: false,
    topLeft: false,
    topRight: false,
    bottomLeft: false,
    bottomRight: false,
  }
  const hasRightEdge = [
    'left',
    'top-left',
    'bottom-left',
    'left-third',
    'center-third',
    'left-two-thirds',
    'top-left-third',
    'top-center-third',
    'bottom-left-third',
    'bottom-center-third',
  ].includes(zone)
  const hasLeftEdge = [
    'right',
    'top-right',
    'bottom-right',
    'right-third',
    'center-third',
    'right-two-thirds',
    'top-right-third',
    'top-center-third',
    'bottom-right-third',
    'bottom-center-third',
  ].includes(zone)
  const hasBottomEdge = [
    'top-left',
    'top-right',
    'top-left-third',
    'top-center-third',
    'top-right-third',
  ].includes(zone)
  const hasTopEdge = [
    'bottom-left',
    'bottom-right',
    'bottom-left-third',
    'bottom-center-third',
    'bottom-right-third',
  ].includes(zone)
  if (hasRightEdge) handles.right = true
  if (hasLeftEdge) handles.left = true
  if (hasBottomEdge) handles.bottom = true
  if (hasTopEdge) handles.top = true
  return handles
}
