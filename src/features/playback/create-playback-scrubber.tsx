import { component, view, type JSX } from 'effectweb'
type Props = {
  itemKey: string
  position: number
  duration: number
  onSeek: (position: number) => void
  onActivity?: () => void
  class?: string
  ariaValueText?: (position: number) => string
  onDraggingChange?: (dragging: boolean) => void
  ariaLabel?: string
  disabled?: boolean
  style?: JSX.CSSProperties
}
export const PlaybackScrubber = component<Props, { drag: number | null }>(
  { init: () => ({ drag: null }), identity: (props) => props.itemKey },
  view((model, patch) => (
    <input
      type='range'
      min={0}
      max={model.props.duration || 0}
      step='0.1'
      value={model.drag ?? model.props.position}
      class={model.props.class}
      style={model.props.style}
      disabled={model.props.disabled}
      aria-label={model.props.ariaLabel ?? 'Seek'}
      aria-valuetext={model.props.ariaValueText?.(model.drag ?? model.props.position)}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        patch({ drag: model.props.position })
        model.props.onDraggingChange?.(true)
        event.currentTarget.setPointerCapture(event.pointerId)
        model.props.onActivity?.()
      }}
      onInput={(event) => {
        const target = Math.max(
          0,
          Math.min(model.props.duration, Number(event.currentTarget.value)),
        )
        if (!Number.isFinite(target)) return
        if (model.drag === null) model.props.onSeek(target)
        else patch({ drag: target })
      }}
      onPointerUp={() => {
        if (model.drag !== null) model.props.onSeek(model.drag)
        patch({ drag: null })
        model.props.onDraggingChange?.(false)
      }}
      onPointerCancel={() => {
        patch({ drag: null })
        model.props.onDraggingChange?.(false)
      }}
      onLostPointerCapture={() => {
        patch({ drag: null })
        model.props.onDraggingChange?.(false)
      }}
    />
  )),
)
