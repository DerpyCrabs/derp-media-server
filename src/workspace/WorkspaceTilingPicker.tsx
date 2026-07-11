import { layoutViewportClientSize } from '@/lib/layout-viewport'
import type { AssistGridShape, AssistGridSpan } from '@/lib/workspace-assist-grid'
import type { AssistSlotPick } from '@/lib/workspace-snap-pick'
import { narrowPickToAssistShape, pickAssistSlotFromPoint } from '@/lib/workspace-snap-pick'
import { createEffect, onCleanup, onMount, createMemo, createSignal } from 'solid-js'
import X from 'lucide-solid/icons/x'
import { WorkspaceSnapAssistMasterGrid } from './WorkspaceSnapAssistMasterGrid'

const PICKER_APPROX_WIDTH = 420
const PICKER_APPROX_HEIGHT = 360
const MIN_TILE_WIDTH = 360
const MIN_TILE_HEIGHT = 260

function shapeLabel(id: AssistGridShape): string {
  switch (id) {
    case '3x2':
      return '3×2'
    case '3x3':
      return '3×3'
    case '2x2':
      return '2×2'
    case '2x3':
      return '2×3'
  }
}

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

  createEffect(() => {
    const cont = props.container
    if (!cont) return
    const bump = () => setLayoutVersion((v) => v + 1)
    const ro = new ResizeObserver(bump)
    ro.observe(cont)
    const onWinResize = () => bump()
    window.addEventListener('resize', onWinResize)
    onCleanup(() => {
      ro.disconnect()
      window.removeEventListener('resize', onWinResize)
    })
  })

  createEffect(() => {
    const el = pickerRoot()
    if (!el) {
      setMeasuredBox(null)
      return
    }
    let raf = 0
    const measure = () => {
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect()
        if (r.width > 0 && r.height > 0) setMeasuredBox({ w: r.width, h: r.height })
      })
    }
    measure()
    onCleanup(() => cancelAnimationFrame(raf))
  })

  const layout = createMemo(() => {
    void layoutVersion()
    void measuredBox()
    const a = props.anchorRect
    const m = measuredBox()
    const pw = Math.max(1, m?.w ?? PICKER_APPROX_WIDTH)
    const ph = Math.max(1, m?.h ?? PICKER_APPROX_HEIGHT)
    const { w: vw, h: vh } = layoutViewportClientSize()
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
    const rect = props.container.getBoundingClientRect()
    return rect.height > 0 ? rect.width / rect.height : 16 / 12
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
      setPointerPick(null)
      return
    }
    setPointerPick(pickAssistSlotFromPoint(e.clientX, e.clientY, el))
  }

  createEffect(() => {
    if (!pickerRoot()) return
    const onWindow = (e: PointerEvent) => updateHoverFromEvent(e)
    window.addEventListener('pointermove', onWindow, {
      capture: true,
      passive: true,
    })
    onCleanup(() => window.removeEventListener('pointermove', onWindow, { capture: true }))
  })

  createEffect(() => {
    const cb = props.onHoverSpanChange
    if (!cb) return
    cb(pointerPick()?.span ?? null)
  })

  onCleanup(() => {
    props.onHoverSpanChange?.(null)
  })

  onMount(() => {
    const outside = (target: EventTarget | null) => {
      const r = pickerRoot()
      const n = target as Node | null
      if (!r || !n || r.contains(n)) return
      props.onClose()
    }
    const onPointerDownCapture = (e: PointerEvent) => outside(e.target)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose()
    }
    document.addEventListener('pointerdown', onPointerDownCapture, true)
    document.addEventListener('keydown', onKey)
    onCleanup(() => {
      document.removeEventListener('pointerdown', onPointerDownCapture, true)
      document.removeEventListener('keydown', onKey)
    })
  })

  return (
    <div
      ref={(el) => setPickerRoot(el ?? null)}
      data-tiling-picker
      class='fixed z-[9999] w-[420px] max-w-[calc(100vw-16px)] overflow-hidden rounded-xl border border-border/80 bg-popover/95 shadow-2xl ring-1 ring-black/10 backdrop-blur-xl'
      style={{
        left: `${layout().left}px`,
        top: `${layout().top}px`,
      }}
      on:pointerleave={() => setPointerPick(null)}
      role='dialog'
      aria-label='Choose window layout'
    >
      <div class='flex items-start justify-between border-b border-border/70 px-4 py-3'>
        <div>
          <div class='text-sm font-semibold text-foreground'>Choose window layout</div>
        </div>
        <button
          type='button'
          class='-mr-1 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary'
          aria-label='Close layout picker'
          onClick={() => props.onClose()}
        >
          <X class='h-3.5 w-3.5' stroke-width={2} />
        </button>
      </div>
      <div class='grid max-h-[min(72vh,430px)] grid-cols-2 gap-2 overflow-y-auto p-3'>
        <WorkspaceSnapAssistMasterGrid
          shape='2x2'
          getHoverPick={() => narrowPickToAssistShape(pointerPick(), '2x2')}
          aspectRatio={aspect()}
          layoutLabel={shapeLabel('2x2')}
          pickMode
          onPickSpan={(span) => props.onSelectSpan(span)}
          isSpanDisabled={spanUnavailable}
        />
        <WorkspaceSnapAssistMasterGrid
          shape='3x2'
          getHoverPick={() => narrowPickToAssistShape(pointerPick(), '3x2')}
          aspectRatio={aspect()}
          layoutLabel={shapeLabel('3x2')}
          pickMode
          onPickSpan={(span) => props.onSelectSpan(span)}
          isSpanDisabled={spanUnavailable}
        />
        <WorkspaceSnapAssistMasterGrid
          shape='2x3'
          getHoverPick={() => narrowPickToAssistShape(pointerPick(), '2x3')}
          aspectRatio={aspect()}
          layoutLabel={shapeLabel('2x3')}
          pickMode
          onPickSpan={(span) => props.onSelectSpan(span)}
          isSpanDisabled={spanUnavailable}
        />
        <WorkspaceSnapAssistMasterGrid
          shape='3x3'
          getHoverPick={() => narrowPickToAssistShape(pointerPick(), '3x3')}
          aspectRatio={aspect()}
          layoutLabel={shapeLabel('3x3')}
          pickMode
          onPickSpan={(span) => props.onSelectSpan(span)}
          isSpanDisabled={spanUnavailable}
        />
      </div>
    </div>
  )
}
