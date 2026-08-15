import { createStore } from 'solid-js'

/** Compact path popover and folder context-menu state for explorer surfaces. */
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
  setBreadcrumbFloating((state) => {
    state.compactPathOpen = open
    if (!open) state.folderMenu = null
  })
}

export function setBreadcrumbFolderMenu(target: BreadcrumbFolderMenuTarget | null) {
  setBreadcrumbFloating((state) => {
    state.folderMenu = target
  })
}

export function clearCompactPathOpenOnly() {
  setBreadcrumbFloating((state) => {
    state.compactPathOpen = false
  })
}

export function resetBreadcrumbFloating() {
  setBreadcrumbFloating((state) => {
    state.compactPathOpen = false
    state.folderMenu = null
  })
}
