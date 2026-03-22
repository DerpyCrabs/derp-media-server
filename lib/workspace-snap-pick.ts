import {
  assistShapeToDims,
  type AssistGridShape,
  type AssistGridSpan,
} from '@/lib/workspace-assist-grid'

export type AssistSlotPick = { kind: 'grid-span'; span: AssistGridSpan }

export function narrowPickToAssistShape(
  pick: AssistSlotPick | null,
  shape: AssistGridShape,
): AssistSlotPick | null {
  if (!pick) return null
  const d = assistShapeToDims(shape)
  if (pick.span.gridCols !== d.cols || pick.span.gridRows !== d.rows) return null
  return pick
}

function rectArea(r: DOMRectReadOnly): number {
  return Math.max(0, r.width) * Math.max(0, r.height)
}

/** Pixels to extend gutter/junction hit testing into adjacent tiles (visual gutters stay 6px). */
const ASSIST_GUTTER_SLOP_PX = 3

function spanGutterKind(span: AssistGridSpan): 'v' | 'h' | 'j' | null {
  const cw = span.gc1 - span.gc0
  const rh = span.gr1 - span.gr0
  if (cw === 0 && rh === 0) return null
  if (cw > 0 && rh === 0) return 'v'
  if (cw === 0 && rh > 0) return 'h'
  if (cw > 0 && rh > 0) return 'j'
  return null
}

function pointInRect(clientX: number, clientY: number, r: DOMRectReadOnly): boolean {
  return (
    clientX >= r.left &&
    clientX <= r.right &&
    clientY >= r.top &&
    clientY <= r.bottom &&
    r.width > 0 &&
    r.height > 0
  )
}

function slopInflatedRect(r: DOMRectReadOnly, kind: 'v' | 'h' | 'j'): DOMRect {
  const s = ASSIST_GUTTER_SLOP_PX
  switch (kind) {
    case 'v':
      return new DOMRect(r.left - s, r.top, r.width + 2 * s, r.height)
    case 'h':
      return new DOMRect(r.left, r.top - s, r.width, r.height + 2 * s)
    case 'j':
      return new DOMRect(r.left - s, r.top - s, r.width + 2 * s, r.height + 2 * s)
  }
}

function pickFromGutterSlop(
  clientX: number,
  clientY: number,
  root: HTMLElement,
): AssistSlotPick | null {
  const matches: { el: HTMLElement; span: AssistGridSpan; area: number }[] = []
  for (const el of root.querySelectorAll<HTMLElement>('[data-assist-grid-span]')) {
    const span = parseGridSpan(el)
    if (!span) continue
    const kind = spanGutterKind(span)
    if (!kind) continue
    const r = el.getBoundingClientRect()
    if (pointInRect(clientX, clientY, slopInflatedRect(r, kind))) {
      matches.push({ el, span, area: rectArea(r) })
    }
  }
  if (matches.length === 0) return null
  let best = matches[0]!
  for (let i = 1; i < matches.length; i++) {
    const m = matches[i]!
    if (m.area < best.area) best = m
  }
  return { kind: 'grid-span', span: best.span }
}

export function pickAssistSlotFromPoint(
  clientX: number,
  clientY: number,
  root: HTMLElement | undefined,
): AssistSlotPick | null {
  if (!root || typeof document === 'undefined' || !root.isConnected) return null

  const rr = root.getBoundingClientRect()
  if (clientX < rr.left || clientX > rr.right || clientY < rr.top || clientY > rr.bottom) {
    return null
  }

  const slop = pickFromGutterSlop(clientX, clientY, root)
  if (slop) return slop

  const stack = document.elementsFromPoint(clientX, clientY)
  const candidates: HTMLElement[] = []
  const seen = new Set<HTMLElement>()
  for (const n of stack) {
    if (!(n instanceof Element)) continue
    if (!root.contains(n)) continue

    const gridEl = n.closest('[data-assist-grid-span]')
    if (gridEl && root.contains(gridEl) && gridEl instanceof HTMLElement) {
      if (!seen.has(gridEl)) {
        seen.add(gridEl)
        candidates.push(gridEl)
      }
    }
  }
  if (candidates.length > 0) {
    let best = candidates[0]!
    let bestArea = rectArea(best.getBoundingClientRect())
    for (let i = 1; i < candidates.length; i++) {
      const el = candidates[i]!
      const a = rectArea(el.getBoundingClientRect())
      if (a < bestArea) {
        bestArea = a
        best = el
      }
    }
    const span = parseGridSpan(best)
    if (span) return { kind: 'grid-span', span }
  }

  const spanCells = root.querySelectorAll<HTMLElement>('[data-assist-grid-span]')
  let best: HTMLElement | null = null
  let bestArea = Infinity
  for (const el of spanCells) {
    const r = el.getBoundingClientRect()
    if (pointInRect(clientX, clientY, r)) {
      const area = r.width * r.height
      if (area < bestArea) {
        bestArea = area
        best = el
      }
    }
  }
  if (best) {
    const span = parseGridSpan(best)
    if (span) return { kind: 'grid-span', span }
  }
  return null
}

function parseGridSpan(el: Element): AssistGridSpan | null {
  const gc0 = Number.parseInt(el.getAttribute('data-gc0') ?? '', 10)
  const gc1 = Number.parseInt(el.getAttribute('data-gc1') ?? '', 10)
  const gr0 = Number.parseInt(el.getAttribute('data-gr0') ?? '', 10)
  const gr1 = Number.parseInt(el.getAttribute('data-gr1') ?? '', 10)
  const gridCols = Number.parseInt(el.getAttribute('data-grid-cols') ?? '', 10)
  const gridRows = Number.parseInt(el.getAttribute('data-grid-rows') ?? '', 10)
  if (
    [gc0, gc1, gr0, gr1, gridCols, gridRows].some((n) => Number.isNaN(n)) ||
    gridCols < 1 ||
    gridRows < 1 ||
    gc0 < 0 ||
    gr0 < 0 ||
    gc1 < gc0 ||
    gr1 < gr0 ||
    gc1 >= gridCols ||
    gr1 >= gridRows
  ) {
    return null
  }
  return { gridCols, gridRows, gc0, gc1, gr0, gr1 }
}

export function assistPickMatchesGridSpan(
  pick: AssistSlotPick | null,
  span: AssistGridSpan,
): boolean {
  return pick != null && gridSpansEqual(pick.span, span)
}

function gridSpansEqual(a: AssistGridSpan, b: AssistGridSpan): boolean {
  return (
    a.gridCols === b.gridCols &&
    a.gridRows === b.gridRows &&
    a.gc0 === b.gc0 &&
    a.gc1 === b.gc1 &&
    a.gr0 === b.gr0 &&
    a.gr1 === b.gr1
  )
}
