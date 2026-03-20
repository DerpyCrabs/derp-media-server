import type { SnapZone } from '@/lib/use-workspace'
import {
  ALL_SNAP_LAYOUT_IDS,
  filterSnapTemplates,
  SNAP_LAYOUT_ROW_1,
  SNAP_LAYOUT_ROW_2,
  SNAP_LAYOUT_ROW_VERTICAL,
  type SnapLayoutTemplate,
} from '@/lib/workspace-snap-layouts'
import { For, Show, createMemo, onCleanup, onMount } from 'solid-js'

const PICKER_APPROX_WIDTH = 320
const PICKER_APPROX_HEIGHT = 180

function SnapTemplateThumb(props: {
  template: SnapLayoutTemplate
  aspectRatio: number
  onSlot: (zone: SnapZone | 'full') => void
}) {
  const rows = () => props.template.gridRows ?? 4
  return (
    <div
      data-snap-layout-template
      class='w-16 shrink-0 rounded border border-border bg-muted/50 p-0.5'
      style={{ 'aspect-ratio': String(props.aspectRatio) }}
    >
      <div
        class='grid h-full w-full grid-cols-6 gap-0.5'
        style={{ 'grid-template-rows': `repeat(${rows()}, minmax(0, 1fr))` }}
      >
        <For each={props.template.grid}>
          {(slot) => (
            <button
              type='button'
              class='rounded-[2px] bg-muted transition-colors hover:bg-primary/40'
              style={{ 'grid-column': slot.col, 'grid-row': slot.row }}
              onClick={() => props.onSlot(slot.zone)}
            />
          )}
        </For>
      </div>
    </div>
  )
}

export type WorkspaceTilingPickerProps = {
  anchorRect: DOMRect
  container: HTMLElement
  onSelectZone: (zone: SnapZone) => void
  onSelectFullscreen: () => void
  onClose: () => void
}

export function WorkspaceTilingPicker(props: WorkspaceTilingPickerProps) {
  let root!: HTMLDivElement

  const visibleIds = createMemo(() => new Set(ALL_SNAP_LAYOUT_IDS))

  const layout = createMemo(() => {
    const rect = props.container.getBoundingClientRect()
    const isVertical = rect.height > rect.width
    const rowVertical = filterSnapTemplates(SNAP_LAYOUT_ROW_VERTICAL, visibleIds())
    const row1 = filterSnapTemplates(SNAP_LAYOUT_ROW_1, visibleIds())
    const row2 = filterSnapTemplates(SNAP_LAYOUT_ROW_2, visibleIds())
    const aspect = rect.height > 0 ? rect.width / rect.height : 16 / 12
    let left = props.anchorRect.left - rect.left
    let top = props.anchorRect.bottom - rect.top + 4
    if (left + PICKER_APPROX_WIDTH > rect.width) left = rect.width - PICKER_APPROX_WIDTH
    if (left < 0) left = 0
    if (top + PICKER_APPROX_HEIGHT > rect.height) top = rect.height - PICKER_APPROX_HEIGHT
    if (top < 0) top = 0
    return { isVertical, rowVertical, row1, row2, aspect, left, top }
  })

  const onSlot = (zone: SnapZone | 'full') => {
    if (zone === 'full') props.onSelectFullscreen()
    else props.onSelectZone(zone)
  }

  onMount(() => {
    const clickOutside = (e: MouseEvent) => {
      if (root && !root.contains(e.target as Node)) props.onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }
    document.addEventListener('mousedown', clickOutside)
    document.addEventListener('keydown', onKey)
    onCleanup(() => {
      document.removeEventListener('mousedown', clickOutside)
      document.removeEventListener('keydown', onKey)
    })
  })

  return (
    <div
      ref={root}
      class='absolute z-[9999] rounded-lg border border-border bg-popover/95 p-3 shadow-2xl backdrop-blur'
      style={{
        left: `${layout().left}px`,
        top: `${layout().top}px`,
      }}
    >
      <div class='mb-1.5 text-[10px] font-medium tracking-wider text-muted-foreground uppercase'>
        Snap layout
      </div>
      <div class='flex flex-col gap-2'>
        <Show when={layout().isVertical && layout().rowVertical.length > 0}>
          <div class='flex gap-2'>
            <For each={layout().rowVertical}>
              {(t) => (
                <SnapTemplateThumb template={t} aspectRatio={layout().aspect} onSlot={onSlot} />
              )}
            </For>
          </div>
        </Show>
        <Show when={layout().row1.length > 0}>
          <div class='flex gap-2'>
            <For each={layout().row1}>
              {(t) => (
                <SnapTemplateThumb template={t} aspectRatio={layout().aspect} onSlot={onSlot} />
              )}
            </For>
          </div>
        </Show>
        <Show when={layout().row2.length > 0}>
          <div class='flex gap-2'>
            <For each={layout().row2}>
              {(t) => (
                <SnapTemplateThumb template={t} aspectRatio={layout().aspect} onSlot={onSlot} />
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  )
}
