export function finePointerDragEnabled(window: Window = globalThis.window): boolean {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(hover: hover)').matches || window.matchMedia('(pointer: fine)').matches
}

export function subscribeFinePointerDragEnabled(
  cb: (enabled: boolean) => void,
  window: Window = globalThis.window,
): () => void {
  if (typeof window === 'undefined') return () => {}
  const mqHover = window.matchMedia('(hover: hover)')
  const mqFine = window.matchMedia('(pointer: fine)')
  const sync = () => cb(mqHover.matches || mqFine.matches)
  mqHover.addEventListener('change', sync)
  mqFine.addEventListener('change', sync)
  return () => {
    mqHover.removeEventListener('change', sync)
    mqFine.removeEventListener('change', sync)
  }
}
