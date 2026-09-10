import { createMemo, createSignal } from 'solid-js'
import type { Accessor } from 'solid-js'
import type { JSX } from '@solidjs/web'

export function createPlaybackScrubber(options: {
  key: Accessor<string>
  position: Accessor<number>
  duration: Accessor<number>
  onSeek: (position: number) => void
  onActivity?: () => void
}) {
  const [drag, setDrag] = createSignal<{ key: string; position: number } | null>(null)
  const active = createMemo(() => drag() !== null && drag()?.key === options.key())
  const position = createMemo(() => (active() ? drag()!.position : options.position()))
  const onPointerDown: JSX.EventHandler<HTMLInputElement, PointerEvent> = (event) => {
    if (event.button !== 0) return
    setDrag({ key: options.key(), position: options.position() })
    event.currentTarget.setPointerCapture(event.pointerId)
    options.onActivity?.()
  }
  const onInput: JSX.EventHandler<HTMLInputElement, InputEvent> = (event) => {
    const target = Math.max(0, Math.min(options.duration(), Number(event.currentTarget.value)))
    if (!Number.isFinite(target)) return
    const current = drag()
    if (!current) options.onSeek(target)
    else if (current.key === options.key()) setDrag({ ...current, position: target })
  }
  const onPointerUp = () => {
    if (active()) options.onSeek(drag()!.position)
    setDrag(null)
  }
  const cancel = () => setDrag(null)
  return {
    active,
    position,
    handlers: {
      onPointerDown,
      onInput,
      onPointerUp,
      onPointerCancel: cancel,
      onLostPointerCapture: cancel,
    },
  }
}
