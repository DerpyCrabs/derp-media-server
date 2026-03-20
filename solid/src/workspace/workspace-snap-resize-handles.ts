import type { SnapZone } from '@/lib/use-workspace'

export type ResizeHandleKey =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'topLeft'
  | 'topRight'
  | 'bottomLeft'
  | 'bottomRight'

export function getWorkspaceSnapResizeHandleMap(
  isSnapped: boolean,
  zone: SnapZone | null | undefined,
): Record<ResizeHandleKey, boolean> | 'all' {
  if (!isSnapped || !zone) return 'all'
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
