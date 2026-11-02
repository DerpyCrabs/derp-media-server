import { modelOwner } from 'effectweb'
export type BreadcrumbFolderMenuTarget = {
  x: number
  y: number
  serverPath: string
  displayName: string
  isHome: boolean
}
function createBreadcrumbFloating() {
  const breadcrumbFloating = modelOwner({
    compactPathOpen: false,
    folderMenu: null as BreadcrumbFolderMenuTarget | null,
  })
  return {
    breadcrumbFloating,
    setBreadcrumbCompactPathOpen(this: void, open: boolean) {
      breadcrumbFloating.patch({ compactPathOpen: open, ...(!open ? { folderMenu: null } : {}) })
    },
    setBreadcrumbFolderMenu(this: void, folderMenu: BreadcrumbFolderMenuTarget | null) {
      breadcrumbFloating.patch({ folderMenu })
    },
    clearCompactPathOpenOnly(this: void) {
      if (breadcrumbFloating.read().compactPathOpen)
        breadcrumbFloating.patch({ compactPathOpen: false })
    },
    resetBreadcrumbFloating(this: void) {
      breadcrumbFloating.patch({ compactPathOpen: false, folderMenu: null })
    },
    dispose: breadcrumbFloating.dispose,
  }
}
const defaults = createBreadcrumbFloating()
export const {
  breadcrumbFloating,
  setBreadcrumbCompactPathOpen,
  setBreadcrumbFolderMenu,
  clearCompactPathOpenOnly,
  resetBreadcrumbFloating,
} = defaults
const windows = new WeakMap<Window, ReturnType<typeof createBreadcrumbFloating>>()
export function breadcrumbFloatingForWindow(target: Window) {
  if (target === globalThis.window) return defaults
  const controller = windows.get(target)
  if (!controller) throw new Error('Window breadcrumb lifetime is not mounted')
  return controller
}
export function acquireWindowBreadcrumbs(target: Window) {
  if (target === globalThis.window) return { dispose() {} }
  if (windows.has(target)) throw new Error('Window breadcrumbs already mounted')
  const controller = createBreadcrumbFloating()
  windows.set(target, controller)
  return {
    dispose() {
      windows.delete(target)
      controller.dispose()
    },
  }
}
