/** Layout viewport for `getBoundingClientRect()` / `position: fixed` (not `visualViewport`, which can be smaller and clamps too early). */
export function layoutViewportClientSize(document: Document = globalThis.document): {
  w: number
  h: number
} {
  const window = document.defaultView
  const de = document.documentElement
  const w = de && de.clientWidth > 0 ? de.clientWidth : Math.max(1, window?.innerWidth ?? 1)
  const h = de && de.clientHeight > 0 ? de.clientHeight : Math.max(1, window?.innerHeight ?? 1)
  return { w: Math.max(1, w), h: Math.max(1, h) }
}
