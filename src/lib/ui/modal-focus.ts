import { createEffect, type Accessor } from 'solid-js'

const FOCUSABLE =
  'input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex="0"]'

export function useModalFocus(options: {
  active: Accessor<boolean>
  element: Accessor<HTMLElement | undefined>
  onEscape: () => void
  ignoreEscape?: (event: KeyboardEvent) => boolean
  fallbackFocus?: () => HTMLElement | null
}) {
  createEffect(
    () => options.active(),
    (active) => {
      if (!active) return undefined
      const previousFocus =
        document.activeElement instanceof HTMLElement ? document.activeElement : null
      queueMicrotask(() => {
        const element = options.element()
        const autofocus = element?.querySelector<HTMLElement>('[autofocus]')
        const first = element?.querySelector<HTMLElement>(FOCUSABLE)
        ;(autofocus ?? first)?.focus()
      })
      return () => {
        queueMicrotask(() => {
          if (previousFocus?.isConnected) previousFocus.focus()
          else options.fallbackFocus?.()?.focus()
        })
      }
    },
  )

  return (event: KeyboardEvent) => {
    if (event.defaultPrevented) return
    if (event.key === 'Escape') {
      if (options.ignoreEscape?.(event)) return
      event.stopPropagation()
      event.preventDefault()
      options.onEscape()
      return
    }
    event.stopPropagation()
    if (event.key !== 'Tab') return
    const element = options.element()
    if (!element) return
    const focusable = [...element.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
      (candidate) => candidate.offsetParent !== null,
    )
    if (!focusable.length) return
    const first = focusable[0]!
    const last = focusable.at(-1)!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
}
