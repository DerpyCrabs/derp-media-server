import type { ControllerHost } from 'effectweb'

export type BrowserWindow = NonNullable<Document['defaultView']>
export function viewWindow(host: ControllerHost): BrowserWindow {
  const window = host.document.defaultView
  if (!window) throw new Error('UI controller requires an owning Window')
  return window
}
