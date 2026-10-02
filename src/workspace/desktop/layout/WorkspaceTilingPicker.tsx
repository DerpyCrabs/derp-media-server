import { layoutViewportClientSize } from '@/lib/ui/layout-viewport'
import { assistShapeLabel, type AssistGridSpan } from '@/workspace/model/workspace-assist-grid'
import type { AssistSlotPick } from '@/workspace/model/workspace-snap-pick'
import {
  narrowPickToAssistShape,
  pickAssistSlotFromPoint,
} from '@/workspace/model/workspace-snap-pick'
import { component, view, domBinding } from 'effectweb'
import X from '@effectweb/lucide/icons/x'
import { WorkspaceSnapAssistMasterGrid } from './WorkspaceSnapAssistMasterGrid'
import { snapAssistSurfaceWidth } from '@/workspace/model/snap-zones'

const MIN_TILE_WIDTH = 360
const MIN_TILE_HEIGHT = 260

export type WorkspaceTilingPickerProps = {
  anchorRect: DOMRect
  /** Used for aspect ratio of mini grids; position uses viewport (`fixed`) so it stays aligned with the anchor. */
  container: HTMLElement
  onSelectSpan: (span: AssistGridSpan) => void
  onClose: () => void
  /** Fired when the hovered grid span changes; cleared on unmount / pointer leaving all spans. */
  onHoverSpanChange?: (span: AssistGridSpan | null) => void
}

type Geometry = {
  viewport: { w: number; h: number }
  box: { w: number; h: number } | null
  container: { width: number; height: number }
}
export const WorkspaceTilingPicker = component<
  WorkspaceTilingPickerProps,
  { pointerPick: AssistSlotPick | null; geometry: Geometry }
>(
  {
    init: () => ({
      pointerPick: null,
      geometry: {
        viewport: layoutViewportClientSize(),
        box: null,
        container: { width: 0, height: 0 },
      },
    }),
  },
  view((local, patch) => {
    const props = local.props
    const pointerPick = () => local.pointerPick
    const { viewport, box, container } = local.geometry
    const aspect = () => (viewport.h > 0 ? viewport.w / viewport.h : 16 / 9)
    const surfaceWidth = () => snapAssistSurfaceWidth(viewport.w, viewport.h)
    const layout = () => {
      const width = box?.w ?? surfaceWidth(),
        height = box?.h ?? (viewport.w >= viewport.h ? 112 : 360),
        anchor = props.anchorRect
      return {
        left: Math.max(0, Math.min(anchor.left, viewport.w - width)),
        top: Math.max(
          0,
          Math.min(
            anchor.bottom + 4 + height > viewport.h ? anchor.top - height - 4 : anchor.bottom + 4,
            viewport.h - height,
          ),
        ),
      }
    }
    const spanUnavailable = (span: AssistGridSpan) =>
      (container.width * (span.gc1 - span.gc0 + 1)) / span.gridCols < MIN_TILE_WIDTH ||
      (container.height * (span.gr1 - span.gr0 + 1)) / span.gridRows < MIN_TILE_HEIGHT
    const updatePointerPick = (pointerPick: AssistSlotPick | null) => {
      patch({ pointerPick })
      props.onHoverSpanChange?.(pointerPick?.span ?? null)
    }
    return (
      <div
        use={domBinding(
          {
            container: props.container,
            measure: (geometry: Geometry) => patch({ geometry }),
            pick: updatePointerPick,
            close: props.onClose,
            clear: () => props.onHoverSpanChange?.(null),
          },
          tilingPickerEvents,
        )}
        data-tiling-picker
        class='fixed z-[9999] max-w-[calc(100vw-16px)] overflow-hidden rounded-xl border border-border/80 bg-popover/95 shadow-2xl ring-1 ring-black/10 backdrop-blur-xl'
        style={{
          left: `${layout().left}px`,
          top: `${layout().top}px`,
          width: `${surfaceWidth()}px`,
        }}
        onPointerLeave={() => updatePointerPick(null)}
        role='dialog'
        aria-label='Choose window layout'
      >
        <div class='flex h-8 items-center justify-between border-b border-border/70 px-2'>
          <div class='text-xs font-semibold text-foreground'>Choose window layout</div>
          <button
            type='button'
            class='inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
            aria-label='Close layout picker'
            onClick={() => props.onClose()}
          >
            <X class='h-3.5 w-3.5' stroke-width={2} />
          </button>
        </div>
        <div
          class={`grid max-h-[calc(100vh-40px)] justify-items-center gap-1.5 overflow-y-auto p-1.5 ${aspect() >= 1 ? 'grid-cols-4' : 'grid-cols-2'}`}
        >
          <WorkspaceSnapAssistMasterGrid
            shape='2x2'
            getHoverPick={() => narrowPickToAssistShape(pointerPick(), '2x2')}
            aspectRatio={aspect()}
            layoutLabel={assistShapeLabel('2x2')}
            pickMode
            compact
            onPickSpan={(span) => props.onSelectSpan(span)}
            isSpanDisabled={spanUnavailable}
          />
          <WorkspaceSnapAssistMasterGrid
            shape='3x2'
            getHoverPick={() => narrowPickToAssistShape(pointerPick(), '3x2')}
            aspectRatio={aspect()}
            layoutLabel={assistShapeLabel('3x2')}
            pickMode
            compact
            onPickSpan={(span) => props.onSelectSpan(span)}
            isSpanDisabled={spanUnavailable}
          />
          <WorkspaceSnapAssistMasterGrid
            shape='2x3'
            getHoverPick={() => narrowPickToAssistShape(pointerPick(), '2x3')}
            aspectRatio={aspect()}
            layoutLabel={assistShapeLabel('2x3')}
            pickMode
            compact
            onPickSpan={(span) => props.onSelectSpan(span)}
            isSpanDisabled={spanUnavailable}
          />
          <WorkspaceSnapAssistMasterGrid
            shape='3x3'
            getHoverPick={() => narrowPickToAssistShape(pointerPick(), '3x3')}
            aspectRatio={aspect()}
            layoutLabel={assistShapeLabel('3x3')}
            pickMode
            compact
            onPickSpan={(span) => props.onSelectSpan(span)}
            isSpanDisabled={spanUnavailable}
          />
        </div>
      </div>
    )
  }),
)
const tilingPickerEvents = (
  element: HTMLDivElement,
  current: () => {
    container: HTMLElement
    measure: (geometry: Geometry) => void
    pick: (pick: AssistSlotPick | null) => void
    close: () => void
    clear: () => void
  },
) => {
  const measure = () => {
    const box = element.getBoundingClientRect(),
      container = current().container.getBoundingClientRect()
    current().measure({
      viewport: layoutViewportClientSize(),
      box: { w: box.width, h: box.height },
      container: { width: container.width, height: container.height },
    })
  }
  const move = (event: PointerEvent) => {
    const box = element.getBoundingClientRect()
    current().pick(
      event.clientX < box.left ||
        event.clientX > box.right ||
        event.clientY < box.top ||
        event.clientY > box.bottom
        ? null
        : pickAssistSlotFromPoint(event.clientX, event.clientY, element),
    )
  }
  const outside = (event: PointerEvent) => {
    const target = event.target
    if (
      target instanceof Node &&
      !element.contains(target) &&
      !(target instanceof Element && target.closest('[data-layout-picker-trigger]'))
    )
      current().close()
  }
  const key = (event: KeyboardEvent) => {
    if (event.key === 'Escape') current().close()
  }
  const observer = new ResizeObserver(measure)
  observer.observe(element)
  observer.observe(current().container)
  window.addEventListener('resize', measure)
  window.addEventListener('pointermove', move, { capture: true, passive: true })
  document.addEventListener('pointerdown', outside, true)
  document.addEventListener('keydown', key)
  measure()
  return () => {
    observer.disconnect()
    window.removeEventListener('resize', measure)
    window.removeEventListener('pointermove', move, true)
    document.removeEventListener('pointerdown', outside, true)
    document.removeEventListener('keydown', key)
    current().clear()
  }
}
