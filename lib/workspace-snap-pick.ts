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

export function pickAssistSlotFromPoint(
  clientX: number,
  clientY: number,
  root: HTMLElement | undefined,
): AssistSlotPick | null {
  if (!root || typeof document === 'undefined' || !root.isConnected) return null

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

  const rr = root.getBoundingClientRect()
  if (clientX < rr.left || clientX > rr.right || clientY < rr.top || clientY > rr.bottom) {
    return null
  }

  const spanCells = root.querySelectorAll<HTMLElement>('[data-assist-grid-span]')
  let best: HTMLElement | null = null
  let bestArea = Infinity
  for (const el of spanCells) {
    const r = el.getBoundingClientRect()
    if (
      clientX >= r.left &&
      clientX <= r.right &&
      clientY >= r.top &&
      clientY <= r.bottom &&
      r.width > 0 &&
      r.height > 0
    ) {
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
