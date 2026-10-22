import { domBinding } from 'effectweb'
const attachLongPress = (element: HTMLElement, delay: () => number) => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const clear = () => {
    clearTimeout(timer)
    timer = undefined
  }
  const down = (event: PointerEvent) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    clear()
    const { clientX, clientY } = event
    timer = setTimeout(() => {
      timer = undefined
      element.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          view: window,
          clientX,
          clientY,
        }),
      )
    }, delay())
  }
  element.addEventListener('pointerdown', down)
  element.addEventListener('pointerup', clear)
  element.addEventListener('pointerleave', clear)
  element.addEventListener('pointercancel', clear)
  return () => {
    clear()
    element.removeEventListener('pointerdown', down)
    element.removeEventListener('pointerup', clear)
    element.removeEventListener('pointerleave', clear)
    element.removeEventListener('pointercancel', clear)
  }
}
export const longPressContextMenu = (delay = 500) => domBinding(delay, attachLongPress)
