/** Group floating surfaces without creating a stacking context. */
const roots = new WeakMap<Document, HTMLDivElement>()

export function getFloatingLayerMount(document: Document = globalThis.document): HTMLElement {
  if (typeof document === 'undefined') {
    throw new Error('getFloatingLayerMount requires document')
  }
  const dialog = Array.from(document.querySelectorAll<HTMLDialogElement>('dialog[open]')).at(-1)
  if (dialog) return dialog
  let layerRoot = roots.get(document)
  if (!layerRoot) {
    layerRoot = document.createElement('div')
    layerRoot.setAttribute('data-floating-layer-root', '')
    layerRoot.style.display = 'contents'
    document.body.appendChild(layerRoot)
    roots.set(document, layerRoot)
  }
  return layerRoot
}
