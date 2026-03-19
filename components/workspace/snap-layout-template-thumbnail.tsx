import type { SnapZone } from '@/lib/use-workspace'
import { cn } from '@/lib/utils'
import type { SnapLayoutTemplate } from '@/lib/workspace-snap-layouts'

export interface SnapLayoutTemplateThumbnailProps {
  template: SnapLayoutTemplate
  /** Tailwind width class; height follows aspectRatio. Default matches picker (`w-16`). */
  className?: string
  /** Content box aspect ratio (width / height). Picker uses workspace bounds; settings use defaults. */
  aspectRatio?: number
  /** When true, each zone is a button (snap picker). Otherwise inert cells. */
  interactive?: boolean
  onSlotClick?: (zone: SnapZone | 'full') => void
}

export function SnapLayoutTemplateThumbnail({
  template,
  className = 'w-16',
  aspectRatio = 16 / 12,
  interactive = false,
  onSlotClick,
}: SnapLayoutTemplateThumbnailProps) {
  const rows = template.gridRows ?? 4
  const cellClass = 'rounded-[2px] bg-muted'
  return (
    <div
      data-snap-layout-template
      className={cn('shrink-0 rounded border border-border bg-muted/50 p-0.5', className)}
      style={{ aspectRatio }}
    >
      <div
        className={cn('grid h-full w-full grid-cols-6 gap-0.5')}
        style={{ gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
      >
        {template.grid.map((slot) =>
          interactive ? (
            <button
              key={slot.zone}
              type='button'
              className={cn(cellClass, 'transition-colors hover:bg-primary/40')}
              style={{ gridColumn: slot.col, gridRow: slot.row }}
              onClick={() => onSlotClick?.(slot.zone)}
            />
          ) : (
            <div
              key={slot.zone}
              className={cellClass}
              style={{ gridColumn: slot.col, gridRow: slot.row }}
            />
          ),
        )}
      </div>
    </div>
  )
}
