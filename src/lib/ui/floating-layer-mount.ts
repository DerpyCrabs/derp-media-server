/** One subtree under `document.body` for all floating menus (stacking + predictable hit order). */
let layerRoot: HTMLDivElement | null = null

export function getFloatingLayerMount(): HTMLElement {
  if (typeof document === 'undefined') {
    throw new Error('getFloatingLayerMount requires document')
  }
  if (!layerRoot) {
    layerRoot = document.createElement('div')
    layerRoot.setAttribute('data-floating-layer-root', '')
    layerRoot.style.setProperty('isolation', 'isolate')
    document.body.appendChild(layerRoot)
  }
  return layerRoot
}
