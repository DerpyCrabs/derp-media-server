import { modelOwner } from 'effectweb'
export type BreadcrumbFolderMenuTarget = {
  x: number
  y: number
  serverPath: string
  displayName: string
  isHome: boolean
}
export const breadcrumbFloating = modelOwner({
  compactPathOpen: false,
  folderMenu: null as BreadcrumbFolderMenuTarget | null,
})
export function setBreadcrumbCompactPathOpen(open: boolean) {
  breadcrumbFloating.patch({ compactPathOpen: open, ...(!open ? { folderMenu: null } : {}) })
}
export function setBreadcrumbFolderMenu(folderMenu: BreadcrumbFolderMenuTarget | null) {
  breadcrumbFloating.patch({ folderMenu })
}
export function clearCompactPathOpenOnly() {
  if (breadcrumbFloating.read().compactPathOpen)
    breadcrumbFloating.patch({ compactPathOpen: false })
}
export function resetBreadcrumbFloating() {
  breadcrumbFloating.patch({ compactPathOpen: false, folderMenu: null })
}
