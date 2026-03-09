import { useCallback, useRef } from 'react'
import { snapZoneToBounds, type SnapZone } from '@/lib/use-workspace'

const EDGE_THRESHOLD = 36

export type SnapDetectResult = SnapZone | 'top'

export interface UseSnapZonesOptions {
  /** When provided, used for preview bounds instead of default zone bounds (e.g. to show remaining space when other windows are snapped) */
  getZoneBounds?: (zone: SnapZone) => { x: number; y: number; width: number; height: number }
}

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
  if (nearTop) return 'top'

  return null
}

export function useSnapZones(options?: UseSnapZonesOptions) {
  const zoneRef = useRef<SnapDetectResult | null>(null)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const getZoneBoundsRef = useRef(options?.getZoneBounds)
  getZoneBoundsRef.current = options?.getZoneBounds

  const updatePreview = useCallback((zone: SnapDetectResult | null, container: HTMLElement) => {
    if (!previewRef.current) {
      const el = container.querySelector('[data-snap-preview]') as HTMLDivElement | null
      previewRef.current = el
    }
    const el = previewRef.current
    if (!el) return

    if (!zone) {
      el.style.display = 'none'
      return
    }

    if (zone === 'top') {
      el.style.display = 'block'
      el.style.left = '0px'
      el.style.top = '0px'
      el.style.width = `${container.clientWidth}px`
      el.style.height = `${container.clientHeight}px`
      return
    }

    const bounds = getZoneBoundsRef.current?.(zone) ?? snapZoneToBounds(zone)
    el.style.display = 'block'
    el.style.left = `${bounds.x}px`
    el.style.top = `${bounds.y}px`
    el.style.width = `${bounds.width}px`
    el.style.height = `${bounds.height}px`
  }, [])

  const onDragMove = useCallback(
    (
      clientX: number,
      clientY: number,
      containerEl: HTMLElement,
      suppressPreview?: boolean,
    ): SnapDetectResult | null => {
      const rect = containerEl.getBoundingClientRect()
      const zone = detectSnapZone(clientX - rect.left, clientY - rect.top, rect.width, rect.height)
      const visibleZone = suppressPreview ? null : zone
      zoneRef.current = zone
      updatePreview(visibleZone, containerEl)
      return zone
    },
    [updatePreview],
  )

  const onDragEnd = useCallback(
    (containerEl: HTMLElement | null): SnapDetectResult | null => {
      const zone = zoneRef.current
      zoneRef.current = null
      if (containerEl) updatePreview(null, containerEl)
      return zone
    },
    [updatePreview],
  )

  return { onDragMove, onDragEnd }
}
