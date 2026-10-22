import { domBinding } from 'effectweb'

const FOCUSABLE =
  'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex="0"]'
export type ModalFocusOptions = {
  onEscape: () => void
  ignoreEscape?: (event: KeyboardEvent) => boolean
  fallbackFocus?: () => HTMLElement | null
}
function acquireModalFocus(element: HTMLElement, options: () => ModalFocusOptions) {
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
  let disposed = false
  queueMicrotask(() => {
    if (disposed) return
    ;(
      element.querySelector<HTMLElement>('[autofocus]') ??
      element.querySelector<HTMLElement>(FOCUSABLE)
    )?.focus()
  })
  const keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) return
    if (event.key === 'Escape') {
      if (options().ignoreEscape?.(event)) return
      event.stopPropagation()
      event.preventDefault()
      options().onEscape()
      return
    }
    event.stopPropagation()
    if (event.key !== 'Tab') return
    const focusable = [...element.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (candidate) => candidate.offsetParent !== null,
    )
    const first = focusable[0]
    const last = focusable.at(-1)
    if (!first || !last) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
  element.addEventListener('keydown', keydown)
  return () => {
    disposed = true
    element.removeEventListener('keydown', keydown)
    queueMicrotask(() => {
      if (previous?.isConnected) previous.focus()
      else options().fallbackFocus?.()?.focus()
    })
  }
}
export const modalFocus = (options: ModalFocusOptions) => domBinding(options, acquireModalFocus)
