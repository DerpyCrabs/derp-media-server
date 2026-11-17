import { viewWindow } from '../../lib/browser/view-window'
import type { DelimitedData } from './delimited-text'
type ViewportState = {
  update: (top: number, left: number, height: number, width: number) => void
  save: () => void
  history: (redo: boolean) => void
  focus: (row: number, column: number) => void
  reset: number
  order: readonly number[]
  data: DelimitedData | null
}
export const tableViewport = (element: HTMLDivElement, current: () => ViewportState) => {
  const window = viewWindow({ document: element.ownerDocument })
  let reset = current().reset
  let frame = 0
  const update = () =>
    current().update(
      element.scrollTop,
      element.scrollLeft,
      element.clientHeight,
      element.clientWidth,
    )
  const button = (target: EventTarget | null) =>
    target instanceof window.HTMLElement
      ? target.closest<HTMLButtonElement>('button[data-table-row]')
      : null
  const focus = (event: FocusEvent) => {
    const cell = button(event.target)
    if (cell) current().focus(Number(cell.dataset.tableRow), Number(cell.dataset.tableColumn))
  }
  const copy = (event: ClipboardEvent) => {
    const cell = button(event.target)
    if (!cell || !event.clipboardData) return
    const value =
      current().data?.rows[Number(cell.dataset.tableRow)]?.cells[Number(cell.dataset.tableColumn)]
        ?.value ?? ''
    event.clipboardData.setData('text/plain', value)
    event.preventDefault()
  }
  const key = (event: KeyboardEvent) => {
    if (
      event.target instanceof window.HTMLTextAreaElement ||
      event.target instanceof window.HTMLInputElement
    )
      return
    const command = event.ctrlKey || event.metaKey
    if (command && event.key.toLowerCase() === 's') {
      event.preventDefault()
      current().save()
      return
    }
    if (command && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      current().history(event.shiftKey)
      return
    }
    const cell = button(event.target)
    if (!cell) return
    if (event.key === 'F2' || event.key === 'Enter') {
      event.preventDefault()
      cell.click()
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() =>
        element.parentElement?.querySelector<HTMLTextAreaElement>('textarea')?.focus(),
      )
      return
    }
    const keys = [
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'Home',
      'End',
      'PageUp',
      'PageDown',
    ]
    if (!keys.includes(event.key)) return
    event.preventDefault()
    const state = current(),
      columns = state.data?.columns ?? 0
    if (!columns || !state.order.length) return
    let row = state.order.indexOf(Number(cell.dataset.tableRow)),
      column = Number(cell.dataset.tableColumn)
    if (event.key === 'ArrowUp') row--
    if (event.key === 'ArrowDown') row++
    if (event.key === 'ArrowLeft') column--
    if (event.key === 'ArrowRight') column++
    if (event.key === 'Home') {
      column = 0
      if (command) row = 0
    }
    if (event.key === 'End') {
      column = columns - 1
      if (command) row = state.order.length - 1
    }
    if (event.key === 'PageUp') row -= Math.max(1, Math.floor(element.clientHeight / 32) - 1)
    if (event.key === 'PageDown') row += Math.max(1, Math.floor(element.clientHeight / 32) - 1)
    row = Math.max(0, Math.min(state.order.length - 1, row))
    column = Math.max(0, Math.min(columns - 1, column))
    const top = (row + 1) * 32,
      left = 48 + column * 180
    if (top < element.scrollTop + 32) element.scrollTop = top - 32
    else if (top + 32 > element.scrollTop + element.clientHeight)
      element.scrollTop = top + 32 - element.clientHeight
    if (left < element.scrollLeft + 48) element.scrollLeft = left - 48
    else if (left + 180 > element.scrollLeft + element.clientWidth)
      element.scrollLeft = left + 180 - element.clientWidth
    update()
    const sourceRow = state.order[row]!
    current().focus(sourceRow, column)
    window.cancelAnimationFrame(frame)
    frame = window.requestAnimationFrame(() =>
      element
        .querySelector<HTMLButtonElement>(
          `button[data-table-row="${sourceRow}"][data-table-column="${column}"]`,
        )
        ?.focus({ preventScroll: true }),
    )
  }
  const resize = new window.ResizeObserver(update)
  resize.observe(element)
  element.addEventListener('scroll', update, { passive: true })
  element.addEventListener('keydown', key)
  element.addEventListener('focusin', focus)
  element.addEventListener('copy', copy)
  update()
  return {
    update: () => {
      if (reset !== current().reset) {
        reset = current().reset
        element.scrollTop = 0
      }
    },
    dispose: () => {
      window.cancelAnimationFrame(frame)
      resize.disconnect()
      element.removeEventListener('scroll', update)
      element.removeEventListener('keydown', key)
      element.removeEventListener('focusin', focus)
      element.removeEventListener('copy', copy)
    },
  }
}
