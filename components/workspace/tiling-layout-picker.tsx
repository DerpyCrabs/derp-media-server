import { type RefObject, useCallback, useEffect, useRef } from 'react'
import type { SnapZone } from '@/lib/use-workspace'
import { cn } from '@/lib/utils'

/** Approx picker width: 4×64px templates + gaps + padding */
const PICKER_APPROX_WIDTH = 320
const PICKER_APPROX_HEIGHT = 180

interface LayoutTemplate {
  id: string
  zones: (SnapZone | 'full')[]
  grid: { col: string; row: string; zone: SnapZone | 'full' }[]
  /** Number of grid rows (default 4). Use 3 for vertical-thirds so three equal rows fill the preview. */
  gridRows?: number
}

const ROW_1: LayoutTemplate[] = [
  {
    id: 'full',
    zones: ['full'],
    grid: [{ col: '1 / -1', row: '1 / -1', zone: 'full' }],
  },
  {
    id: 'left-right',
    zones: ['left', 'right'],
    grid: [
      { col: '1 / 4', row: '1 / -1', zone: 'left' },
      { col: '4 / 7', row: '1 / -1', zone: 'right' },
    ],
  },
  {
    id: 'left-right-stack',
    zones: ['left', 'top-right', 'bottom-right'],
    grid: [
      { col: '1 / 4', row: '1 / -1', zone: 'left' },
      { col: '4 / 7', row: '1 / 3', zone: 'top-right' },
      { col: '4 / 7', row: '3 / 5', zone: 'bottom-right' },
    ],
  },
  {
    id: 'stack-left-right',
    zones: ['top-left', 'bottom-left', 'right'],
    grid: [
      { col: '1 / 4', row: '1 / 3', zone: 'top-left' },
      { col: '1 / 4', row: '3 / 5', zone: 'bottom-left' },
      { col: '4 / 7', row: '1 / -1', zone: 'right' },
    ],
  },
]

const ROW_2: LayoutTemplate[] = [
  {
    id: 'quarters',
    zones: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
    grid: [
      { col: '1 / 4', row: '1 / 3', zone: 'top-left' },
      { col: '4 / 7', row: '1 / 3', zone: 'top-right' },
      { col: '1 / 4', row: '3 / 5', zone: 'bottom-left' },
      { col: '4 / 7', row: '3 / 5', zone: 'bottom-right' },
    ],
  },
  {
    id: 'thirds-3x2',
    zones: [
      'top-left-third',
      'top-center-third',
      'top-right-third',
      'bottom-left-third',
      'bottom-center-third',
      'bottom-right-third',
    ],
    grid: [
      { col: '1 / 3', row: '1 / 3', zone: 'top-left-third' },
      { col: '3 / 5', row: '1 / 3', zone: 'top-center-third' },
      { col: '5 / 7', row: '1 / 3', zone: 'top-right-third' },
      { col: '1 / 3', row: '3 / 5', zone: 'bottom-left-third' },
      { col: '3 / 5', row: '3 / 5', zone: 'bottom-center-third' },
      { col: '5 / 7', row: '3 / 5', zone: 'bottom-right-third' },
    ],
  },
  {
    id: 'third-two-thirds',
    zones: ['left-third', 'right-two-thirds'],
    grid: [
      { col: '1 / 3', row: '1 / -1', zone: 'left-third' },
      { col: '3 / 7', row: '1 / -1', zone: 'right-two-thirds' },
    ],
  },
  {
    id: 'two-thirds-third',
    zones: ['left-two-thirds', 'right-third'],
    grid: [
      { col: '1 / 5', row: '1 / -1', zone: 'left-two-thirds' },
      { col: '5 / 7', row: '1 / -1', zone: 'right-third' },
    ],
  },
]

const ROW_VERTICAL: LayoutTemplate[] = [
  {
    id: 'full-vertical',
    zones: ['full'],
    grid: [{ col: '1 / -1', row: '1 / -1', zone: 'full' }],
  },
  {
    id: 'vertical-thirds',
    zones: ['top-third', 'middle-third', 'bottom-third'],
    gridRows: 3,
    grid: [
      { col: '1 / -1', row: '1 / 2', zone: 'top-third' },
      { col: '1 / -1', row: '2 / 3', zone: 'middle-third' },
      { col: '1 / -1', row: '3 / 4', zone: 'bottom-third' },
    ],
  },
  {
    id: 'half-top-two-quarters-bottom',
    zones: ['top-half', 'bottom-left', 'bottom-right'],
    grid: [
      { col: '1 / -1', row: '1 / 3', zone: 'top-half' },
      { col: '1 / 4', row: '3 / 5', zone: 'bottom-left' },
      { col: '4 / 7', row: '3 / 5', zone: 'bottom-right' },
    ],
  },
  {
    id: 'top-bottom-stack',
    zones: ['top-half', 'bottom-half'],
    grid: [
      { col: '1 / -1', row: '1 / 3', zone: 'top-half' },
      { col: '1 / -1', row: '3 / 5', zone: 'bottom-half' },
    ],
  },
]

interface TilingLayoutPickerProps {
  anchorRect: DOMRect
  containerRef: RefObject<HTMLDivElement | null>
  onSelectZone: (zone: SnapZone) => void
  onSelectFullscreen: () => void
  onClose: () => void
}

export function TilingLayoutPicker({
  anchorRect,
  containerRef,
  onSelectZone,
  onSelectFullscreen,
  onClose,
}: TilingLayoutPickerProps) {
  const pickerRef = useRef<HTMLDivElement>(null)

  const containerRect = containerRef.current?.getBoundingClientRect()
  const isVertical = containerRect != null && containerRect.height > containerRect.width
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
        {isVertical && (
          <div className='flex gap-2'>
            {ROW_VERTICAL.map((template) => (
              <LayoutTemplatePreview
                key={template.id}
                template={template}
                onSlotClick={handleSlotClick}
                containerRect={containerRect ?? undefined}
              />
            ))}
          </div>
        )}
        <div className='flex gap-2'>
          {ROW_1.map((template) => (
            <LayoutTemplatePreview
              key={template.id}
              template={template}
              onSlotClick={handleSlotClick}
              containerRect={containerRect ?? undefined}
            />
          ))}
        </div>
        <div className='flex gap-2'>
          {ROW_2.map((template) => (
            <LayoutTemplatePreview
              key={template.id}
              template={template}
              onSlotClick={handleSlotClick}
              containerRect={containerRect ?? undefined}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function LayoutTemplatePreview({
  template,
  onSlotClick,
  containerRect,
}: {
  template: LayoutTemplate
  onSlotClick: (zone: SnapZone | 'full') => void
  containerRect?: DOMRect
}) {
  const aspectRatio =
    containerRect && containerRect.height > 0 ? containerRect.width / containerRect.height : 16 / 12
  const rows = template.gridRows ?? 4
  return (
    <div
      data-snap-layout-template
      className='w-16 shrink-0 rounded border border-border bg-muted/50 p-0.5'
      style={{ aspectRatio }}
    >
      <div
        className={cn('grid h-full w-full grid-cols-6 gap-0.5')}
        style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
      >
        {template.grid.map((slot) => (
          <button
            key={slot.zone}
            type='button'
            className={cn('rounded-[2px] bg-muted transition-colors hover:bg-primary/40')}
            style={{ gridColumn: slot.col, gridRow: slot.row }}
            onClick={() => onSlotClick(slot.zone)}
          />
        ))}
      </div>
    </div>
  )
}
