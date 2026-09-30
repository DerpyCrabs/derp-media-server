/** Group floating surfaces without creating a stacking context. */
let layerRoot: HTMLDivElement | null = null

export function getFloatingLayerMount(): HTMLElement {
  if (typeof document === 'undefined') {
    throw new Error('getFloatingLayerMount requires document')
  }
  if (!layerRoot) {
    layerRoot = document.createElement('div')
    layerRoot.setAttribute('data-floating-layer-root', '')
    layerRoot.style.display = 'contents'
    document.body.appendChild(layerRoot)
  }
  return layerRoot
}
