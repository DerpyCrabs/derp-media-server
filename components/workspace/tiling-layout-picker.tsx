import { type RefObject, useCallback, useEffect, useMemo, useRef } from 'react'
import type { SnapZone } from '@/lib/use-workspace'
import { SnapLayoutTemplateThumbnail } from '@/components/workspace/snap-layout-template-thumbnail'
import {
  filterSnapTemplates,
  SNAP_LAYOUT_ROW_1,
  SNAP_LAYOUT_ROW_2,
  SNAP_LAYOUT_ROW_VERTICAL,
} from '@/lib/workspace-snap-layouts'

/** Approx picker width: 4×64px templates + gaps + padding */
const PICKER_APPROX_WIDTH = 320
const PICKER_APPROX_HEIGHT = 180

interface TilingLayoutPickerProps {
  anchorRect: DOMRect
  containerRef: RefObject<HTMLDivElement | null>
  visibleSnapLayoutIds: Set<string>
  onSelectZone: (zone: SnapZone) => void
  onSelectFullscreen: () => void
  onClose: () => void
}

export function TilingLayoutPicker({
  anchorRect,
  containerRef,
  visibleSnapLayoutIds,
  onSelectZone,
  onSelectFullscreen,
  onClose,
}: TilingLayoutPickerProps) {
  const pickerRef = useRef<HTMLDivElement>(null)

  const containerRect = containerRef.current?.getBoundingClientRect()
  const isVertical = containerRect != null && containerRect.height > containerRect.width

  const { rowVertical, row1, row2, emergencyRow } = useMemo(() => {
    const v = filterSnapTemplates(SNAP_LAYOUT_ROW_VERTICAL, visibleSnapLayoutIds)
    const r1 = filterSnapTemplates(SNAP_LAYOUT_ROW_1, visibleSnapLayoutIds)
    const r2 = filterSnapTemplates(SNAP_LAYOUT_ROW_2, visibleSnapLayoutIds)
    const hasAnyToShow = r1.length > 0 || r2.length > 0 || (isVertical && v.length > 0)
    return {
      rowVertical: v,
      row1: r1,
      row2: r2,
      emergencyRow: hasAnyToShow ? null : [SNAP_LAYOUT_ROW_1[0]!],
    }
  }, [visibleSnapLayoutIds, isVertical])

  let left = containerRect ? anchorRect.left - containerRect.left : 0
  let top = containerRect ? anchorRect.bottom - containerRect.top + 4 : 0

  if (containerRect) {
    if (left + PICKER_APPROX_WIDTH > containerRect.width) {
      left = containerRect.width - PICKER_APPROX_WIDTH
    }
    if (left < 0) left = 0
    if (top + PICKER_APPROX_HEIGHT > containerRect.height) {
      top = containerRect.height - PICKER_APPROX_HEIGHT
    }
    if (top < 0) top = 0
  }

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  const handleSlotClick = useCallback(
    (zone: SnapZone | 'full') => {
      if (zone === 'full') {
        onSelectFullscreen()
      } else {
        onSelectZone(zone)
      }
    },
    [onSelectZone, onSelectFullscreen],
  )

  const thumbAspectRatio =
    containerRect && containerRect.height > 0 ? containerRect.width / containerRect.height : 16 / 12

  return (
    <div
      ref={pickerRef}
      className='absolute z-9999 rounded-lg border border-border bg-popover/95 p-3 shadow-2xl backdrop-blur'
      style={{ left, top }}
    >
      <div className='mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground'>
        Snap layout
      </div>
      <div className='flex flex-col gap-2'>
        {emergencyRow ? (
          <div className='flex gap-2'>
            {emergencyRow.map((template) => (
              <SnapLayoutTemplateThumbnail
                key={template.id}
                template={template}
                aspectRatio={thumbAspectRatio}
                interactive
                onSlotClick={handleSlotClick}
              />
            ))}
          </div>
        ) : (
          <>
            {isVertical && rowVertical.length > 0 ? (
              <div className='flex gap-2'>
                {rowVertical.map((template) => (
                  <SnapLayoutTemplateThumbnail
                    key={template.id}
                    template={template}
                    aspectRatio={thumbAspectRatio}
                    interactive
                    onSlotClick={handleSlotClick}
                  />
                ))}
              </div>
            ) : null}
            {row1.length > 0 ? (
              <div className='flex gap-2'>
                {row1.map((template) => (
                  <SnapLayoutTemplateThumbnail
                    key={template.id}
                    template={template}
                    aspectRatio={thumbAspectRatio}
                    interactive
                    onSlotClick={handleSlotClick}
                  />
                ))}
              </div>
            ) : null}
            {row2.length > 0 ? (
              <div className='flex gap-2'>
                {row2.map((template) => (
                  <SnapLayoutTemplateThumbnail
                    key={template.id}
                    template={template}
                    aspectRatio={thumbAspectRatio}
                    interactive
                    onSlotClick={handleSlotClick}
                  />
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  )
}
