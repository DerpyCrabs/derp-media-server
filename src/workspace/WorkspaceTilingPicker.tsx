import type { SnapZone } from '@/lib/use-workspace'
import { useWorkspaceSnapLayoutVisibilityStore } from '@/lib/workspace-snap-layout-visibility-store'
import {
  filterSnapTemplates,
  SNAP_LAYOUT_ROW_1,
  SNAP_LAYOUT_ROW_2,
  SNAP_LAYOUT_ROW_VERTICAL,
} from '@/lib/workspace-snap-layouts'
import { For, Show, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { SnapLayoutTemplateThumbnail } from './SnapLayoutTemplateThumbnail'

const PICKER_APPROX_WIDTH = 320
const PICKER_APPROX_HEIGHT = 180

function SnapTemplateThumb(props: {
  template: (typeof SNAP_LAYOUT_ROW_1)[number]
  aspectRatio: number
  onSlot: (zone: SnapZone | 'full') => void
}) {
  return (
    <SnapLayoutTemplateThumbnail
      template={props.template}
      aspectRatio={props.aspectRatio}
      interactive
      onSlotClick={props.onSlot}
    />
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
  let root: HTMLDivElement | undefined

  const [snapVisTick, setSnapVisTick] = createSignal(0)
  onMount(() => {
    const unsub = useWorkspaceSnapLayoutVisibilityStore.subscribe(() =>
      setSnapVisTick((n) => n + 1),
    )
    onCleanup(unsub)
  })

  const visibleIds = createMemo(() => {
    void snapVisTick()
    return new Set(useWorkspaceSnapLayoutVisibilityStore.getState().visibleIdList)
  })

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
      ref={(el) => {
        root = el
      }}
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
