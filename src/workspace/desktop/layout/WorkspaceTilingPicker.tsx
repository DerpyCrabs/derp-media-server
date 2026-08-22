import { layoutViewportClientSize } from '@/lib/ui/layout-viewport'
import { assistShapeLabel, type AssistGridSpan } from '@/workspace/model/workspace-assist-grid'
import type { AssistSlotPick } from '@/workspace/model/workspace-snap-pick'
import {
  narrowPickToAssistShape,
  pickAssistSlotFromPoint,
} from '@/workspace/model/workspace-snap-pick'
import { createEffect, onSettled, createMemo, createSignal } from 'solid-js'
import X from 'lucide-solid/icons/x'
import { WorkspaceSnapAssistMasterGrid } from './WorkspaceSnapAssistMasterGrid'
import { snapAssistSurfaceWidth } from '@/workspace/model/use-snap-zones'

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

export function WorkspaceTilingPicker(props: WorkspaceTilingPickerProps) {
  const [pickerRoot, setPickerRoot] = createSignal<HTMLDivElement | null>(null)
  const [pointerPick, setPointerPick] = createSignal<AssistSlotPick | null>(null)
  const [layoutVersion, setLayoutVersion] = createSignal(0)
  const [measuredBox, setMeasuredBox] = createSignal<{
    w: number
    h: number
  } | null>(null)

  onSettled(() => {
    const cont = props.container
    if (!cont) return undefined
    const bump = () => setLayoutVersion((v) => v + 1)
    const ro = new ResizeObserver(bump)
    ro.observe(cont)
    const onWinResize = () => bump()
    window.addEventListener('resize', onWinResize)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', onWinResize)
    }
  })

  createEffect(
    () => pickerRoot(),
    (el) => {
      if (!el) {
        setMeasuredBox(null)
        return undefined
      }
      const raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) setMeasuredBox({ w: r.width, h: r.height })
      })
      // eslint-disable-next-line solid/reactivity
      return () => cancelAnimationFrame(raf)
    },
  )

  const layout = createMemo(() => {
    void layoutVersion()
    void measuredBox()
    const a = props.anchorRect
    const m = measuredBox()
    const { w: vw, h: vh } = layoutViewportClientSize()
    const pw = Math.max(1, m?.w ?? snapAssistSurfaceWidth(vw, vh))
    const ph = Math.max(1, m?.h ?? (vw >= vh ? 112 : 360))
    const vx0 = 0
    const vy0 = 0
    const vx1 = vw
    const vy1 = vh

    // Align with anchor's left edge; only nudge left the minimum amount to stay in the viewport.
    let left = a.left
    const maxLeft = vx1 - pw
    if (left > maxLeft) left = maxLeft
    if (left < vx0) left = vx0

    let top = a.bottom + 4
    if (top + ph > vy1) {
      top = a.top - ph - 4
    }
    if (top + ph > vy1) {
      top = vy1 - ph
    }
    if (top < vy0) top = vy0

    return { left, top }
  })

  const aspect = createMemo(() => {
    void layoutVersion()
    const { w, h } = layoutViewportClientSize()
    return h > 0 ? w / h : 16 / 9
  })

  const surfaceWidth = createMemo(() => {
    void layoutVersion()
    const { w, h } = layoutViewportClientSize()
    return snapAssistSurfaceWidth(w, h)
  })

  const spanUnavailable = (span: AssistGridSpan) => {
    const rect = props.container.getBoundingClientRect()
    const width = (rect.width * (span.gc1 - span.gc0 + 1)) / span.gridCols
    const height = (rect.height * (span.gr1 - span.gr0 + 1)) / span.gridRows
    return width < MIN_TILE_WIDTH || height < MIN_TILE_HEIGHT
  }

  function updateHoverFromEvent(e: { clientX: number; clientY: number }) {
    const el = pickerRoot()
    if (!el) return
    const r = el.getBoundingClientRect()
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) {
      updatePointerPick(null)
      return
    }
    updatePointerPick(pickAssistSlotFromPoint(e.clientX, e.clientY, el))
  }

  function updatePointerPick(pick: AssistSlotPick | null) {
    setPointerPick(pick)
    props.onHoverSpanChange?.(pick?.span ?? null)
  }

  createEffect(
    () => pickerRoot(),
    (root) => {
      if (!root) return undefined
      const onWindow = (e: PointerEvent) => updateHoverFromEvent(e)
      window.addEventListener('pointermove', onWindow, {
        capture: true,
        passive: true,
      })
      // eslint-disable-next-line solid/reactivity
      return () => window.removeEventListener('pointermove', onWindow, { capture: true })
    },
  )

  onSettled(() => {
    const outside = (target: EventTarget | null) => {
      const r = pickerRoot()
      const n = target as Node | null
      if (
        !r ||
        !n ||
        r.contains(n) ||
        (target instanceof Element && target.closest('[data-layout-picker-trigger]'))
      )
        return
      props.onClose()
    }
    const onPointerDownCapture = (e: PointerEvent) => outside(e.target)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }
    document.addEventListener('pointerdown', onPointerDownCapture, true)
    document.addEventListener('keydown', onKey)
    // eslint-disable-next-line solid/reactivity
    return () => {
      document.removeEventListener('pointerdown', onPointerDownCapture, true)
      document.removeEventListener('keydown', onKey)
      props.onHoverSpanChange?.(null)
    }
  })

  return (
    <div
      ref={(el) => setPickerRoot(el ?? null)}
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
}
