import { createEffect, createMemo, createSignal, onSettled, Show } from 'solid-js'
import type { ReaderSelection } from './ReaderSelectionMenu'
import { menuPositionForRect } from './reader-geometry'

export function RegionLayer(props: {
  active: boolean
  host: () => HTMLElement
  source: () => HTMLCanvasElement | HTMLImageElement
  onRegion: (selection: Omit<ReaderSelection, 'id'>) => void
}) {
  const [drag, setDrag] = createSignal<{
    pointerId: number
    startX: number
    startY: number
    x: number
    y: number
  } | null>(null)
  const [committedRegion, setCommittedRegion] = createSignal<{
    x: number
    y: number
    width: number
    height: number
  } | null>(null)
  const [sourceSizeVersion, setSourceSizeVersion] = createSignal(0)
  const rect = createMemo(() => {
    const value = drag()
    if (!value) return null
    return {
      left: Math.min(value.startX, value.x),
      top: Math.min(value.startY, value.y),
      width: Math.abs(value.x - value.startX),
      height: Math.abs(value.y - value.startY),
    }
  })
  const point = (event: PointerEvent) => {
    const bounds = props.host().getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
      y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)),
    }
  }
  const committedRect = createMemo(() => {
    sourceSizeVersion()
    const region = committedRegion()
    if (!region) return null
    const source = props.source()
    const bounds = props.host().getBoundingClientRect()
    const naturalWidth = source instanceof HTMLImageElement ? source.naturalWidth : source.width
    const naturalHeight = source instanceof HTMLImageElement ? source.naturalHeight : source.height
    if (!naturalWidth || !naturalHeight || !bounds.width || !bounds.height) return null
    return {
      left: (region.x / naturalWidth) * bounds.width,
      top: (region.y / naturalHeight) * bounds.height,
      width: (region.width / naturalWidth) * bounds.width,
      height: (region.height / naturalHeight) * bounds.height,
    }
  })

  createEffect(
    () => props.active,
    (active) => {
      if (active) return
      setDrag(null)
      setCommittedRegion(null)
    },
  )

  onSettled(() => {
    const observer = new ResizeObserver(() => setSourceSizeVersion((version) => version + 1))
    observer.observe(props.host())
    observer.observe(props.source())
    return () => observer.disconnect()
  })

  const finish = () => {
    const visible = rect()
    const hostRect = props.host().getBoundingClientRect()
    setDrag(null)
    if (!visible || visible.width < 12 || visible.height < 12) return
    const source = props.source()
    const naturalWidth = source instanceof HTMLImageElement ? source.naturalWidth : source.width
    const naturalHeight = source instanceof HTMLImageElement ? source.naturalHeight : source.height
    if (!naturalWidth || !naturalHeight) return
    const sx = (visible.left / hostRect.width) * naturalWidth
    const sy = (visible.top / hostRect.height) * naturalHeight
    const sw = (visible.width / hostRect.width) * naturalWidth
    const sh = (visible.height / hostRect.height) * naturalHeight
    const region = { x: sx, y: sy, width: sw, height: sh }
    setCommittedRegion(region)
    const crop = window.document.createElement('canvas')
    crop.width = Math.max(1, Math.round(sw))
    crop.height = Math.max(1, Math.round(sh))
    const context = crop.getContext('2d')
    if (!context) return
    context.drawImage(source, sx, sy, sw, sh, 0, 0, crop.width, crop.height)
    props.onRegion({
      kind: 'image',
      text: '',
      imageData: crop.toDataURL('image/png'),
      anchor: props.host(),
      region,
      ...menuPositionForRect(
        new DOMRect(
          hostRect.left + visible.left,
          hostRect.top + visible.top,
          visible.width,
          visible.height,
        ),
        props.host().closest<HTMLElement>('[data-testid="reader-viewport"]') ?? undefined,
      ),
    })
  }
  return (
    <div
      data-testid='region-layer'
      class={['absolute inset-0', { 'cursor-crosshair': props.active }]}
      style={{
        'pointer-events': props.active ? 'auto' : 'none',
        'z-index': props.active ? 5 : 2,
      }}
      onPointerDown={(event) => {
        if (!props.active) return
        const next = point(event)
        event.currentTarget.setPointerCapture(event.pointerId)
        setCommittedRegion(null)
        setDrag({
          pointerId: event.pointerId,
          startX: next.x,
          startY: next.y,
          ...next,
        })
      }}
      onPointerMove={(event) => {
        if (!drag()) return
        const next = point(event)
        setDrag((value) => (value ? { ...value, ...next } : null))
      }}
      onPointerUp={(event) => {
        if (drag()?.pointerId !== event.pointerId) return
        event.currentTarget.releasePointerCapture(event.pointerId)
        finish()
      }}
    >
      <Show when={rect() ?? committedRect()}>
        {(box) => (
          <div
            class='reader-region-box absolute border-2 border-[rgb(80_120_255/78%)] bg-[rgb(0_0_255/25%)]'
            style={{
              left: `${box().left}px`,
              top: `${box().top}px`,
              width: `${box().width}px`,
              height: `${box().height}px`,
            }}
          />
        )}
      </Show>
    </div>
  )
}
