import type { SnapZone } from '@/lib/use-workspace'

export const SNAP_EDGE_THRESHOLD_PX = 36

/** After the top snap band engages assist, keep the bar mounted while the pointer stays within this depth (workspace px) so the cursor can reach thumbnails without a dead zone. */
export const TOP_SNAP_ASSIST_KEEPALIVE_PX = 320

/** Total width of the top-center region that opens snap assist (centered on the workspace). */
export const TOP_SNAP_ASSIST_CENTER_BAND_PX = 300

export const TOP_SNAP_ASSIST_CENTER_HALF_WIDTH_PX = TOP_SNAP_ASSIST_CENTER_BAND_PX / 2

export type SnapDetectResult = SnapZone | 'snap-assist' | 'edge-grid'

export function segmentIndex(localX: number, span: number, segments: number): number {
  if (span <= 0 || segments <= 0) return 0
  const t = Math.min(Math.max(localX / span, 0), 1 - Number.EPSILON)
  return Math.min(segments - 1, Math.floor(t * segments))
}
