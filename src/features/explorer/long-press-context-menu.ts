export function createLongPressContextMenuHandlers(delay = 500) {
  let timeout: ReturnType<typeof setTimeout> | null = null

  function clear() {
    if (timeout) {
      clearTimeout(timeout)
      timeout = null
    }
  }

  return {
    onPointerDown(e: PointerEvent) {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      clear()
      timeout = setTimeout(() => {
        timeout = null
        e.preventDefault()
        const target = e.target as HTMLElement
        const te = e as unknown as TouchEvent
        const clientX = 'touches' in te && te.touches[0] ? te.touches[0].clientX : e.clientX
        const clientY = 'touches' in te && te.touches[0] ? te.touches[0].clientY : e.clientY
        target.dispatchEvent(
          new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX,
            clientY,
          }),
        )
      }, delay)
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
  }
}
