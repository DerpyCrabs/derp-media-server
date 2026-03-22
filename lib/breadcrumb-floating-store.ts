import { createStore } from 'solid-js/store'

/** Compact path popover + folder context menu state (media + workspace file browsers). */
export type BreadcrumbFolderMenuTarget = {
  x: number
  y: number
  serverPath: string
  displayName: string
  isHome: boolean
}

export const [breadcrumbFloating, setBreadcrumbFloating] = createStore({
  compactPathOpen: false,
  folderMenu: null as BreadcrumbFolderMenuTarget | null,
})

export function setBreadcrumbCompactPathOpen(open: boolean) {
  setBreadcrumbFloating('compactPathOpen', open)
  if (!open) setBreadcrumbFloating('folderMenu', null)
}

export function setBreadcrumbFolderMenu(target: BreadcrumbFolderMenuTarget | null) {
  setBreadcrumbFloating('folderMenu', target)
}

export function clearCompactPathOpenOnly() {
  setBreadcrumbFloating('compactPathOpen', false)
}

export function resetBreadcrumbFloating() {
  setBreadcrumbFloating({ compactPathOpen: false, folderMenu: null })
}
