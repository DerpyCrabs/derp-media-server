import type { OverlayHandle } from '@effectweb/base-ui'

export function restoreOverlayFocus(handle: OverlayHandle): false {
  const trigger = handle.trigger()
  const document = trigger?.ownerDocument
  if (!document) return false
  const active = document.activeElement
  const popup = document.getElementById(`${handle.id}-popup`)
  if (!active || active === document.body || active === trigger || popup?.contains(active))
    trigger?.focus({ preventScroll: true })
  return false
}
