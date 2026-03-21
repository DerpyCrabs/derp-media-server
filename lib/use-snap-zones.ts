import type { SnapZone } from '@/lib/use-workspace'

const EDGE_THRESHOLD = 36

export type SnapDetectResult = SnapZone | 'top'

export function detectSnapZone(
  cursorX: number,
  cursorY: number,
  containerWidth: number,
  containerHeight: number,
): SnapDetectResult | null {
  const nearLeft = cursorX <= EDGE_THRESHOLD
  const nearRight = cursorX >= containerWidth - EDGE_THRESHOLD
  const nearTop = cursorY <= EDGE_THRESHOLD
  const nearBottom = cursorY >= containerHeight - EDGE_THRESHOLD

  if (nearLeft && nearTop) return 'top-left'
  if (nearRight && nearTop) return 'top-right'
  if (nearLeft && nearBottom) return 'bottom-left'
  if (nearRight && nearBottom) return 'bottom-right'
  if (nearLeft) return 'left'
  if (nearRight) return 'right'
  if (nearTop) {
    const inCenterThird = cursorX >= containerWidth * 0.35 && cursorX <= containerWidth * 0.65
    if (inCenterThird) return 'top'
    if (containerHeight > containerWidth) return 'top-half'
    return 'top'
  }
  if (nearBottom) {
    if (containerHeight > containerWidth) return 'bottom-half'
  }

  return null
}
