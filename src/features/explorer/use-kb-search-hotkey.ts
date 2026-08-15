import type { Accessor } from 'solid-js'
import { createEffect } from 'solid-js'

export function registerKbSearchHotkeys(opts: {
  active: Accessor<boolean>
  isOpen: Accessor<boolean>
  setOpen: (open: boolean) => void
  focusInput: () => void
}) {
  createEffect(
    () => opts.active(),
    (active) => {
      if (!active) return undefined
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape' && opts.isOpen()) {
          e.preventDefault()
          opts.setOpen(false)
          return
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
          e.preventDefault()
          opts.setOpen(true)
          queueMicrotask(() => opts.focusInput())
          return
        }
        const t = e.target as HTMLElement | null
        if (t?.closest?.('input, textarea, select, [contenteditable="true"]')) return
        if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault()
          opts.setOpen(true)
          queueMicrotask(() => opts.focusInput())
        }
      }
      document.addEventListener('keydown', onKey)
      // eslint-disable-next-line solid/reactivity
      return () => document.removeEventListener('keydown', onKey)
    },
  )
}
