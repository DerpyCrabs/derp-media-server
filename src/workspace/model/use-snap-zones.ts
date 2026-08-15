import type { SnapZone } from '@/lib/models/window-model'

export const SNAP_EDGE_THRESHOLD_PX = 36

export const TOP_SNAP_ASSIST_HANDLE_HEIGHT_PX = 8

export function snapAssistSurfaceWidth(viewportWidth: number, viewportHeight: number): number {
  const thumbnailWidth = viewportWidth >= 640 ? 96 : 84
  const columns = viewportWidth >= viewportHeight ? 4 : 2
  const contentWidth = columns * thumbnailWidth + (columns - 1) * 6 + 14
  return Math.min(contentWidth, Math.max(0, viewportWidth - 16))
}

export type SnapDetectResult = SnapZone | 'snap-assist' | 'edge-grid'

export function segmentIndex(localX: number, span: number, segments: number): number {
  if (span <= 0 || segments <= 0) return 0
  const t = Math.min(Math.max(localX / span, 0), 1 - Number.EPSILON)
  return Math.min(segments - 1, Math.floor(t * segments))
}
