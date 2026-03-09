import { type RefObject, useCallback, useEffect, useRef } from 'react'
import type { SnapZone } from '@/lib/use-workspace'
import { cn } from '@/lib/utils'

interface LayoutTemplate {
  id: string
  zones: (SnapZone | 'full')[]
  grid: { col: string; row: string; zone: SnapZone | 'full' }[]
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

  const containerRect = containerRef.current?.getBoundingClientRect()
  const left = anchorRect.left - (containerRect?.left ?? 0)
  const top = anchorRect.bottom - (containerRect?.top ?? 0) + 4

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
      className='absolute z-9999 rounded-lg border border-white/10 bg-neutral-900/95 p-3 shadow-2xl backdrop-blur'
      style={{ left, top }}
    >
      <div className='mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground'>
        Snap layout
      </div>
      <div className='flex flex-col gap-2'>
        <div className='flex gap-2'>
          {ROW_1.map((template) => (
            <LayoutTemplatePreview
              key={template.id}
              template={template}
              onSlotClick={handleSlotClick}
            />
          ))}
        </div>
        <div className='flex gap-2'>
          {ROW_2.map((template) => (
            <LayoutTemplatePreview
              key={template.id}
              template={template}
              onSlotClick={handleSlotClick}
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
}: {
  template: LayoutTemplate
  onSlotClick: (zone: SnapZone | 'full') => void
}) {
  return (
    <div className='grid h-12 w-16 grid-cols-6 grid-rows-4 gap-0.5 rounded border border-white/6 bg-black/40 p-0.5'>
      {template.grid.map((slot) => (
        <button
          key={slot.zone}
          type='button'
          className={cn('rounded-[2px] bg-white/8 transition-colors hover:bg-blue-500/40')}
          style={{ gridColumn: slot.col, gridRow: slot.row }}
          onClick={() => onSlotClick(slot.zone)}
        />
      ))}
    </div>
  )
}
