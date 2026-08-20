import type { CanvasCamera } from '@/workspace/canvas/model/infinite-canvas'
import { startPointerGesture } from '@/lib/ui/start-pointer-gesture'

type CanvasPanControllerOptions = {
  camera: () => CanvasCamera
  viewport: () => HTMLDivElement | undefined
  world: () => HTMLDivElement | undefined
  commit: (camera: CanvasCamera) => void
}

export function createCanvasPanController(options: CanvasPanControllerOptions) {
  let disposeActive: (() => void) | undefined

  function begin(event: PointerEvent, allowPrimary = false) {
    if (event.button !== 1 && !(allowPrimary && event.button === 0)) return
    event.preventDefault()
    disposeActive?.()

    const start = options.camera()
    const startX = event.clientX
    const startY = event.clientY
    const viewport = options.viewport()
    const backgroundImage = viewport?.style.backgroundImage ?? ''
    let latest = start
    let frame: number | undefined
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
      if (frame !== undefined) window.cancelAnimationFrame(frame)
      render()
      if (viewport) viewport.style.backgroundImage = backgroundImage
      disposeActive = undefined
      if (shouldCommit && (latest.x !== start.x || latest.y !== start.y)) options.commit(latest)
    }
    disposeActive = startPointerGesture({
      pointerId: event.pointerId,
      captureTarget: event.currentTarget as HTMLElement,
      move,
      commit: () => finish(true),
      cancel: () => finish(false),
    })
  }

  return {
    begin,
    dispose: () => disposeActive?.(),
  }
}
