import { createMemo, createSignal } from 'solid-js'
import { isVirtualFolderPath } from '@/lib/files/constants'
import { MediaType, type FileItem } from '@/lib/files/types'
import { breadcrumbFloating, setBreadcrumbFolderMenu } from './breadcrumb-floating-store'
import type { BreadcrumbMenuTarget } from './BreadcrumbContextMenu'
import type {
  ExplorerBreadcrumbMenu,
  ExplorerIconDialog,
  ExplorerRowMenu,
  ExplorerUploadNotice,
} from './ExplorerCommonModalLayer'
import type { FileBrowserController } from './use-file-browser-controller'

export type FileBrowserChromeOptions = Readonly<{
  controller: FileBrowserController
  otherSurfaceLabel: string
  openBreadcrumbInNewTab?: (folder: FileItem | null) => void
  openBreadcrumbInOtherSurface?: (folder: FileItem | null) => void
  createRowMenu: (setIcon: (file: FileItem) => void) => ExplorerRowMenu
}>

function breadcrumbFolder(target: BreadcrumbMenuTarget): FileItem {
  return {
    name: target.displayName,
    path: target.serverPath,
    type: MediaType.FOLDER,
    size: 0,
    extension: '',
    isDirectory: true,
    isVirtual: isVirtualFolderPath(target.serverPath),
  }
}

export function useFileBrowserChrome(options: FileBrowserChromeOptions) {
  const [iconTarget, setIconTarget] = createSignal<FileItem | null>(null)
  const breadcrumbTarget = () => breadcrumbFloating.folderMenu
  const controller = options.controller

  const breadcrumbActions = createMemo(() => {
    const target = breadcrumbTarget()
    if (!target) {
      return { showOpenInNewTab: false, showOpenInOtherSurface: false, showSetIcon: false }
    }
    if (target.isHome) {
      return {
        showOpenInNewTab: !!options.openBreadcrumbInNewTab,
        showOpenInOtherSurface: !!options.openBreadcrumbInOtherSurface,
        showSetIcon: false,
      }
    }
    const virtual = isVirtualFolderPath(target.serverPath)
    return {
      showOpenInNewTab: !virtual && !!options.openBreadcrumbInNewTab,
      showOpenInOtherSurface: !virtual && !!options.openBreadcrumbInOtherSurface,
      showSetIcon: !virtual,
    }
  })

  function openBreadcrumbMenu(
    event: MouseEvent,
    info: { navigatePath: string; displayName: string; isHome: boolean },
  ) {
    setBreadcrumbFolderMenu({
      x: event.clientX,
      y: event.clientY,
      serverPath: info.navigatePath.replace(/\\/g, '/'),
      displayName: info.displayName,
      isHome: info.isHome,
    })
  }

  function selectedBreadcrumbFolder() {
    const target = breadcrumbTarget()
    return !target || target.isHome ? null : breadcrumbFolder(target)
  }

  function editBreadcrumbIcon() {
    const folder = selectedBreadcrumbFolder()
    if (folder && !folder.isVirtual) setIconTarget(folder)
  }

  function saveIcon(iconName: string | null) {
    const target = iconTarget()
    if (!target) return
    const path = target.path.replace(/\\/g, '/')
    if (iconName) void controller.mutations.setCustomIconMutation.mutateAsync({ path, iconName })
    else void controller.mutations.removeCustomIconMutation.mutateAsync(path)
  }

  const icon: ExplorerIconDialog = {
    target: iconTarget,
    setTarget: setIconTarget,
    customIcons: controller.customIcons,
    save: saveIcon,
    pending: () =>
      controller.mutations.setCustomIconMutation.isPending ||
      controller.mutations.removeCustomIconMutation.isPending,
  }
  const upload: ExplorerUploadNotice = {
    state: controller.upload.toast,
    dismiss: controller.upload.hideToast,
  }
  const breadcrumbs: ExplorerBreadcrumbMenu = {
    target: breadcrumbTarget,
    setTarget: setBreadcrumbFolderMenu,
    availableActions: breadcrumbActions,
    openInNewTab: () => options.openBreadcrumbInNewTab?.(selectedBreadcrumbFolder()),
    openInOtherSurface: () => options.openBreadcrumbInOtherSurface?.(selectedBreadcrumbFolder()),
    otherSurfaceLabel: options.otherSurfaceLabel,
    setIcon: editBreadcrumbIcon,
  }
  const rowMenu = options.createRowMenu(setIconTarget)
  return {
    openBreadcrumbMenu,
    modal: { icon, upload, breadcrumbs, rowMenu },
  }
}
