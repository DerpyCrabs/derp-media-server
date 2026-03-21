import type { SnapZone } from '@/lib/use-workspace'
import { cn } from '@/lib/utils'
import type { SnapLayoutTemplate } from '@/lib/workspace-snap-layouts'
import { For, Show } from 'solid-js'

export type SnapLayoutTemplateThumbnailProps = {
  template: SnapLayoutTemplate
  class?: string
  aspectRatio?: number
  interactive?: boolean
  onSlotClick?: (zone: SnapZone | 'full') => void
}

export function SnapLayoutTemplateThumbnail(props: SnapLayoutTemplateThumbnailProps) {
  const rows = () => props.template.gridRows ?? 4
  const cellClass = 'rounded-[2px] bg-muted'
  return (
    <div
      data-snap-layout-template
      class={cn('w-16 shrink-0 rounded border border-border bg-muted/50 p-0.5', props.class)}
      style={{ 'aspect-ratio': String(props.aspectRatio ?? 16 / 12) }}
    >
      <div
        class='grid h-full w-full grid-cols-6 gap-0.5'
        style={{ 'grid-template-rows': `repeat(${rows()}, minmax(0, 1fr))` }}
      >
        <For each={props.template.grid}>
          {(slot) => (
            <Show
              when={props.interactive}
              fallback={
                <div class={cellClass} style={{ 'grid-column': slot.col, 'grid-row': slot.row }} />
              }
            >
              <button
                type='button'
                class={cn(cellClass, 'transition-colors hover:bg-primary/40')}
                style={{ 'grid-column': slot.col, 'grid-row': slot.row }}
                onClick={() => props.onSlotClick?.(slot.zone)}
              />
            </Show>
          )}
        </For>
      </div>
    </div>
  )
}
