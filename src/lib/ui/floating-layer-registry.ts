/**
 * Global floating UI: one capture-phase `pointerdown` on `document`.
 *
 * Layers register while mounted. On each pointerdown we repeatedly take the top layer by
 * `(zIndex desc, id desc)`, stop if that layer considers the event "inside", otherwise call
 * `dismiss()` and repeat. That way dismissing a nested menu (e.g. breadcrumb folder) updates
 * app state before we decide whether the parent path menu should see the same event as outside.
 */

export type FloatingDismissLayer = {
  zIndex: number
  /** True = do not dismiss this layer for this event. */
  isInside: (e: PointerEvent) => boolean
  dismiss: () => void
}

type Entry = FloatingDismissLayer & { id: number }

const entries = new Map<number, Entry>()
let seq = 1
let attached = false

function nodeInConnectedRoot(e: PointerEvent, root: HTMLElement | null | undefined): boolean {
  if (!root?.isConnected) return false
  for (const n of e.composedPath()) {
    if (n instanceof Node && root.contains(n)) return true
  }
  return false
}

function connectedMatchInComposedPath(e: PointerEvent, selector: string): boolean {
  for (const n of e.composedPath()) {
    if (!(n instanceof Element)) continue
    try {
      const hit = n.closest(selector)
      if (hit?.isConnected) return true
    } catch {
      /* bad selector */
    }
  }
  return false
}

/**
 * Hit-test for a portaled menu: surface element, optional extra roots (e.g. anchor trigger),
 * optional CSS ignore when `ignoreActive` is not false (gate nested menu by app state).
 */
export function floatingPointerInsideSurface(
  e: PointerEvent,
  surface: HTMLElement,
  extraRoots: Array<HTMLElement | null | undefined>,
  ignoreSelector: string | undefined,
  ignoreActive: (() => boolean) | undefined,
): boolean {
  if (!surface.isConnected) return false
  if (nodeInConnectedRoot(e, surface)) return true
  for (const r of extraRoots) {
    if (nodeInConnectedRoot(e, r ?? undefined)) return true
  }
  const useIgnore = ignoreActive === undefined || ignoreActive() !== false
  if (useIgnore && ignoreSelector && connectedMatchInComposedPath(e, ignoreSelector)) return true
  return false
}

function sortTopFirst(a: Entry, b: Entry): number {
  const z = b.zIndex - a.zIndex
  return z !== 0 ? z : b.id - a.id
}

function onDocumentPointerDownCapture(e: PointerEvent) {
  for (let i = 0; i < 64; i++) {
    const list = [...entries.values()].sort(sortTopFirst)
    const top = list[0]
    if (!top || !entries.has(top.id)) return
    if (top.isInside(e)) return
    const id = top.id
    try {
      top.dismiss()
    } catch {
      /* ignore */
    }
    // Drop immediately so the next iteration sees the next layer. Solid may defer
    // unmount/cleanup; without this the same entry stays "top" until the loop cap.
    entries.delete(id)
    syncDocumentListener()
  }
}

function syncDocumentListener() {
  if (entries.size > 0 && !attached) {
    document.addEventListener('pointerdown', onDocumentPointerDownCapture, true)
    attached = true
  } else if (entries.size === 0 && attached) {
    document.removeEventListener('pointerdown', onDocumentPointerDownCapture, true)
    attached = false
  }
}

export function registerFloatingDismissLayer(layer: FloatingDismissLayer): () => void {
  const id = seq++
  const row: Entry = { id, ...layer }
  entries.set(id, row)
  syncDocumentListener()
  return () => {
    entries.delete(id)
    syncDocumentListener()
  }
}
