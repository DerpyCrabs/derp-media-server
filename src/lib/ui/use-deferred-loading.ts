import type { Accessor } from 'solid-js'
import { createEffect, createMemo, createSignal, onCleanup } from 'solid-js'

/** True only when `loading()` has been true continuously for `delayMs` (avoids spinner flicker). */
export function useDeferredLoading(loading: Accessor<boolean>, delayMs = 200): Accessor<boolean> {
  const [fired, setFired] = createSignal(false)
  createEffect(() => {
    const on = loading()
    if (!on) {
      setFired(false)
      return
    }
    const id = window.setTimeout(() => {
      if (loading()) setFired(true)
    }, delayMs)
    onCleanup(() => clearTimeout(id))
  })
  const show = createMemo(() => fired() && loading())
  return show
}
