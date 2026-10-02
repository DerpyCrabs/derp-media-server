import { component, view } from 'effectweb'
import type { ReaderSelection } from './ReaderSelectionMenu'
import { menuPositionForRect } from './reader-geometry'
type Box = { left: number; top: number; width: number; height: number }
type Drag = { pointerId: number; startX: number; startY: number; x: number; y: number }
type RegionProps = { onRegion: (selection: Omit<ReaderSelection, 'id'>) => void }
const box = (drag: Drag): Box => ({
  left: Math.min(drag.startX, drag.x),
  top: Math.min(drag.startY, drag.y),
  width: Math.abs(drag.x - drag.startX),
  height: Math.abs(drag.y - drag.startY),
})
const point = (event: PointerEvent) => {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  return {
    x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
    y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
  }
}
export const RegionLayer = component<RegionProps, { drag: Drag | null; committed: Box | null }>(
  { init: () => ({ drag: null, committed: null }) },
  view((model, patch) => {
    const visible = model.drag ? box(model.drag) : model.committed
    return (
      <div
        data-testid='region-layer'
        class='absolute inset-0 cursor-crosshair'
        style={{ 'pointer-events': 'auto', 'z-index': 5 }}
        onPointerDown={(event) => {
          const next = point(event)
          event.currentTarget.setPointerCapture(event.pointerId)
          patch({
            committed: null,
            drag: { pointerId: event.pointerId, startX: next.x, startY: next.y, ...next },
          })
        }}
        onPointerMove={(event) => {
          if (model.drag) patch({ drag: { ...model.drag, ...point(event) } })
        }}
        onPointerUp={(event) => {
          if (!model.drag || model.drag.pointerId !== event.pointerId) return
          event.currentTarget.releasePointerCapture(event.pointerId)
          const area = box(model.drag)
          patch({ drag: null })
          if (area.width < 12 || area.height < 12) return
          const host = event.currentTarget.parentElement!
          const source = host.querySelector('canvas, img') as
            | HTMLCanvasElement
            | HTMLImageElement
            | null
          if (!source) return
          const bounds = host.getBoundingClientRect()
          const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width
          const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height
          if (!width || !height) return
          const region = {
            x: (area.left / bounds.width) * width,
            y: (area.top / bounds.height) * height,
            width: (area.width / bounds.width) * width,
            height: (area.height / bounds.height) * height,
          }
          patch({
            committed: {
              left: (area.left / bounds.width) * 100,
              top: (area.top / bounds.height) * 100,
              width: (area.width / bounds.width) * 100,
              height: (area.height / bounds.height) * 100,
            },
          })
          const crop = document.createElement('canvas')
          crop.width = Math.max(1, Math.round(region.width))
          crop.height = Math.max(1, Math.round(region.height))
          const context = crop.getContext('2d')
          if (!context) return
          context.drawImage(
            source,
            region.x,
            region.y,
            region.width,
            region.height,
            0,
            0,
            crop.width,
            crop.height,
          )
          model.props.onRegion({
            kind: 'image',
            text: '',
            imageData: crop.toDataURL('image/png'),
            anchor: host,
            region,
            ...menuPositionForRect(
              new DOMRect(bounds.left + area.left, bounds.top + area.top, area.width, area.height),
              host.closest<HTMLElement>('[data-testid="reader-viewport"]') ?? undefined,
            ),
          })
        }}
      >
        {visible ? (
          <div
            class='reader-region-box absolute border-2 border-[rgb(80_120_255/78%)] bg-[rgb(0_0_255/25%)]'
            style={{
              left: `${visible.left}${model.drag ? 'px' : '%'}`,
              top: `${visible.top}${model.drag ? 'px' : '%'}`,
              width: `${visible.width}${model.drag ? 'px' : '%'}`,
              height: `${visible.height}${model.drag ? 'px' : '%'}`,
            }}
          />
        ) : null}
      </div>
    )
  }),
)
