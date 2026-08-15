import type { Accessor } from 'solid-js'
import { createEffect, createMemo, createSignal } from 'solid-js'

/** True only when `loading()` has been true continuously for `delayMs` (avoids spinner flicker). */
export function useDeferredLoading(loading: Accessor<boolean>, delayMs = 200): Accessor<boolean> {
  const [fired, setFired] = createSignal(false)
  createEffect(
    () => loading(),
    (isLoading) => {
      if (!isLoading) {
        setFired(false)
        return undefined
      }
      const id = window.setTimeout(() => {
        if (loading()) setFired(true)
      }, delayMs)
      // eslint-disable-next-line solid/reactivity
      return () => clearTimeout(id)
    },
  )
  const show = createMemo(() => fired() && loading())
  return show
}
