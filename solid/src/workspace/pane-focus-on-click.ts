import { type Accessor, createEffect, onCleanup } from 'solid-js'

/** Focus after the clicked control's handlers run (bubble `click`), so table row opens stay reliable. */
export function bindPaneFocusOnClick(
  el: Accessor<HTMLElement | null | undefined>,
  windowId: Accessor<string>,
  onFocusWindow: Accessor<((id: string) => void) | undefined>,
) {
  createEffect(() => {
    const focus = onFocusWindow()
    const node = el()
    if (!focus || !node) return
    const handler = () => focus(windowId())
    node.addEventListener('click', handler)
    onCleanup(() => node.removeEventListener('click', handler))
  })
}
