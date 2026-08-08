import type { CanvasCamera } from '@/lib/infinite-canvas'

type CanvasPanControllerOptions = {
  camera: () => CanvasCamera
  viewport: () => HTMLDivElement | undefined
  world: () => HTMLDivElement | undefined
  commit: (camera: CanvasCamera) => void
}

export function createCanvasPanController(options: CanvasPanControllerOptions) {
  let disposeActive: (() => void) | undefined

  function begin(event: PointerEvent) {
    if (event.button !== 1) return
    event.preventDefault()
    disposeActive?.()

    const start = options.camera()
    const startX = event.clientX
    const startY = event.clientY
    const viewport = options.viewport()
    const backgroundImage = viewport?.style.backgroundImage ?? ''
    let latest = start
    let frame: number | undefined
    let active = true
    if (viewport) viewport.style.backgroundImage = 'none'

    const render = () => {
      frame = undefined
      const world = options.world()
      if (!world) return
      world.style.transform = `translate3d(${latest.x}px, ${latest.y}px, 0) scale(${latest.zoom})`
    }
    const move = (next: PointerEvent) => {
      next.preventDefault()
      latest = {
        ...start,
        x: start.x + next.clientX - startX,
        y: start.y + next.clientY - startY,
      }
      if (frame === undefined) frame = window.requestAnimationFrame(render)
    }
    const finish = (shouldCommit: boolean) => {
      if (!active) return
      active = false
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      window.removeEventListener('blur', end)
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      render()
      if (viewport) viewport.style.backgroundImage = backgroundImage
      disposeActive = undefined
      if (shouldCommit && (latest.x !== start.x || latest.y !== start.y)) options.commit(latest)
    }
    const end = () => finish(true)
    disposeActive = () => finish(false)

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end, { once: true })
    window.addEventListener('pointercancel', end, { once: true })
    window.addEventListener('blur', end, { once: true })
  }

  return {
    begin,
    dispose: () => disposeActive?.(),
  }
}
