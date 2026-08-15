/** Layout viewport for `getBoundingClientRect()` / `position: fixed` (not `visualViewport`, which can be smaller and clamps too early). */
export function layoutViewportClientSize(): { w: number; h: number } {
  const de = document.documentElement
  const w = de && de.clientWidth > 0 ? de.clientWidth : Math.max(1, window.innerWidth)
  const h = de && de.clientHeight > 0 ? de.clientHeight : Math.max(1, window.innerHeight)
  return { w: Math.max(1, w), h: Math.max(1, h) }
}
