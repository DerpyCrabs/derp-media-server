export type PointerGestureOptions = {
  pointerId: number
  captureTarget?: HTMLElement
  move: (event: PointerEvent) => void
  commit: (event: PointerEvent) => void
  cancel: () => void
}

export function startPointerGesture(options: PointerGestureOptions): () => void {
  let active = true
  const ownerDocument = options.captureTarget?.ownerDocument ?? document
  const ownerWindow = ownerDocument.defaultView

  try {
    options.captureTarget?.setPointerCapture(options.pointerId)
  } catch {}

  const finish = (callback: () => void) => {
    if (!active) return
    active = false
    ownerDocument.removeEventListener('pointermove', onPointerMove)
    ownerDocument.removeEventListener('pointerup', onPointerUp)
    ownerDocument.removeEventListener('pointercancel', onPointerCancel)
    ownerDocument.removeEventListener('keydown', onKeyDown, true)
    ownerWindow?.removeEventListener('blur', onBlur)
    try {
      if (options.captureTarget?.hasPointerCapture(options.pointerId)) {
        options.captureTarget.releasePointerCapture(options.pointerId)
      }
    } catch {}
    callback()
  }
  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerId === options.pointerId) options.move(event)
  }
  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== options.pointerId) return
    finish(() => options.commit(event))
  }
  const onPointerCancel = (event: PointerEvent) => {
    if (event.pointerId !== options.pointerId) return
    finish(options.cancel)
  }
  const onBlur = () => {
    finish(options.cancel)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    finish(options.cancel)
  }

  ownerDocument.addEventListener('pointermove', onPointerMove)
  ownerDocument.addEventListener('pointerup', onPointerUp)
  ownerDocument.addEventListener('pointercancel', onPointerCancel)
  ownerDocument.addEventListener('keydown', onKeyDown, true)
  ownerWindow?.addEventListener('blur', onBlur)

  return () => finish(options.cancel)
}
