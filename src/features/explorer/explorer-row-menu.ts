import type { Accessor } from 'solid-js'
import { isPathEditable } from '@/lib/files/path-utils'
import { MediaType, type FileItem } from '@/lib/files/types'
import type { FileOpenTarget } from '@/lib/models/open-target'
import {
  hasVirtualCapability,
  type VirtualCapability,
  type VirtualEntry,
} from '@/lib/files/virtual-directory'

export type ExplorerFileRowMenuApi = {
  menu: Accessor<{ x: number; y: number; file: FileItem } | null>
  dismiss: () => void
  confirmDelete: (file: FileItem) => void
}

export type ExplorerRowAction =
  | 'set-icon'
  | 'pick-new-tab-target'
  | 'primary-open'
  | 'split-view'
  | 'open-with'
  | 'open-with-browser'
  | 'open-with-reader'
  | 'other-surface'
  | 'add-to-taskbar'
  | 'favorite'
  | 'knowledge-base'
  | 'download'
  | 'copy'
  | 'move'
  | 'rename'
  | 'delete'

type ExplorerRowLabelAction =
  | 'primary-open'
  | 'other-surface'
  | 'favorite'
  | 'knowledge-base'
  | 'download'

export type ExplorerRowMenuConfig = {
  api: ExplorerFileRowMenuApi
  permissions: {
    editableFolders: Accessor<string[]>
    currentDirectoryEditable: Accessor<boolean>
    hasEditableFolders: Accessor<boolean>
  }
  edit: {
    download: (file: FileItem) => void
    addToTaskbar?: (file: FileItem) => void
    rename?: (file: FileItem) => void
    move?: (file: FileItem) => void
    copy?: (file: FileItem) => void
    setIcon?: (file: FileItem) => void
  }
  open: {
    newTab?: (file: FileItem) => void
    newTabLabel?: string
    showNewTabForFiles?: boolean
    splitView?: (file: FileItem) => void
    otherSurface?: (file: FileItem) => void
    otherSurfaceLabel?: string
    withBrowser?: (file: FileItem) => void
    withReader?: (file: FileItem) => void
    pickNewTabTarget?: () => void
    defaultFileOpen?: Accessor<FileOpenTarget>
    fileInNewWindow?: (file: FileItem) => void
  }
  metadata: {
    toggleFavorite?: (file: FileItem) => void
    isFavorite?: (file: FileItem) => boolean
    toggleKnowledgeBase?: (file: FileItem) => void
    isKnowledgeBase?: (file: FileItem) => boolean
  }
  virtual?: {
    entry: (file: FileItem) => VirtualEntry | undefined
    run: (action: VirtualCapability, file: FileItem) => void
  }
}

export type ExplorerRowMenu = {
  menu: ExplorerFileRowMenuApi['menu']
  dismiss: () => void
  editableFolders: Accessor<string[]>
  canVirtual: (capability: VirtualCapability, file: FileItem) => boolean
  runVirtual: (capability: VirtualCapability, file: FileItem) => void
  available: (action: ExplorerRowAction, file: FileItem) => boolean
  run: (action: ExplorerRowAction, file: FileItem) => void
  label: (action: ExplorerRowLabelAction, file: FileItem) => string
  active: (action: ExplorerRowAction, file: FileItem) => boolean
  primaryOpenUsesNewWindow: (file: FileItem) => boolean
}

export function createExplorerRowMenu(config: ExplorerRowMenuConfig): ExplorerRowMenu {
  const virtualEntry = (file: FileItem) => config.virtual?.entry(file)
  const canVirtual = (capability: VirtualCapability, file: FileItem) =>
    hasVirtualCapability(virtualEntry(file), capability)

  const primaryOpenUsesNewWindow = (file: FileItem) =>
    !file.isDirectory &&
    config.open.showNewTabForFiles === true &&
    config.open.defaultFileOpen?.() === 'new-tab' &&
    !!config.open.fileInNewWindow

  function available(action: ExplorerRowAction, file: FileItem): boolean {
    switch (action) {
      case 'set-icon':
        return !file.isVirtual && !!config.edit.setIcon
      case 'pick-new-tab-target':
        return !!config.open.pickNewTabTarget
      case 'primary-open':
        if (file.isVirtual) return false
        if (file.isDirectory) return !!config.open.newTab
        if (config.open.showNewTabForFiles !== true) return false
        return primaryOpenUsesNewWindow(file) || !!config.open.newTab
      case 'split-view':
        return !file.isVirtual && file.type !== MediaType.AUDIO && !!config.open.splitView
      case 'open-with':
        return (
          !file.isVirtual &&
          file.isDirectory &&
          !!config.open.withBrowser &&
          !!config.open.withReader
        )
      case 'open-with-browser':
        return !!config.open.withBrowser
      case 'open-with-reader':
        return !!config.open.withReader
      case 'other-surface':
        return !file.isVirtual && file.isDirectory && !!config.open.otherSurface
      case 'add-to-taskbar':
        return !!config.edit.addToTaskbar && (!file.isVirtual || canVirtual('pin', file))
      case 'favorite':
        return !file.isVirtual && !!config.metadata.toggleFavorite
      case 'knowledge-base':
        return file.isDirectory && !!config.metadata.toggleKnowledgeBase
      case 'download':
        return !file.isVirtual || canVirtual('download', file)
      case 'copy':
        return config.permissions.hasEditableFolders() && !file.isVirtual && !!config.edit.copy
      case 'move':
        return (
          config.permissions.currentDirectoryEditable() && !file.isVirtual && !!config.edit.move
        )
      case 'rename':
        return (
          config.permissions.currentDirectoryEditable() && !file.isVirtual && !!config.edit.rename
        )
      case 'delete':
        return !file.isVirtual && isPathEditable(file.path, config.permissions.editableFolders())
    }
    return false
  }

  function run(action: ExplorerRowAction, file: FileItem) {
    switch (action) {
      case 'set-icon':
        config.edit.setIcon?.(file)
        break
      case 'pick-new-tab-target':
        config.open.pickNewTabTarget?.()
        break
      case 'primary-open':
        if (primaryOpenUsesNewWindow(file)) config.open.fileInNewWindow?.(file)
        else config.open.newTab?.(file)
        break
      case 'split-view':
        config.open.splitView?.(file)
        break
      case 'open-with-browser':
        config.open.withBrowser?.(file)
        break
      case 'open-with-reader':
        config.open.withReader?.(file)
        break
      case 'other-surface':
        config.open.otherSurface?.(file)
        break
      case 'add-to-taskbar':
        config.edit.addToTaskbar?.(file)
        break
      case 'favorite':
        config.metadata.toggleFavorite?.(file)
        break
      case 'knowledge-base':
        config.metadata.toggleKnowledgeBase?.(file)
        break
      case 'download':
        config.edit.download(file)
        break
      case 'copy':
        config.edit.copy?.(file)
        break
      case 'move':
        config.edit.move?.(file)
        break
      case 'rename':
        config.edit.rename?.(file)
        break
      case 'delete':
        config.api.confirmDelete(file)
        return
      case 'open-with':
        return
    }
    config.api.dismiss()
  }

  function label(action: ExplorerRowLabelAction, file: FileItem): string {
    switch (action) {
      case 'primary-open':
        return primaryOpenUsesNewWindow(file)
          ? 'Open in new window'
          : (config.open.newTabLabel ?? 'Open in new tab')
      case 'other-surface':
        return config.open.otherSurfaceLabel ?? 'Open in other view'
      case 'favorite':
        return config.metadata.isFavorite?.(file) ? 'Unfavorite' : 'Favorite'
      case 'knowledge-base':
        return config.metadata.isKnowledgeBase?.(file)
          ? 'Remove Knowledge Base'
          : 'Set as Knowledge Base'
      case 'download':
        return file.isDirectory ? 'Download as ZIP' : 'Download'
    }
    return ''
  }

  function active(action: ExplorerRowAction, file: FileItem): boolean {
    if (action === 'favorite') return config.metadata.isFavorite?.(file) ?? false
    if (action === 'knowledge-base') return config.metadata.isKnowledgeBase?.(file) ?? false
    return false
  }

  return {
    menu: config.api.menu,
    dismiss: config.api.dismiss,
    editableFolders: config.permissions.editableFolders,
    canVirtual,
    runVirtual(capability, file) {
      config.virtual?.run(capability, file)
      config.api.dismiss()
    },
    available,
    run,
    label,
    active,
    primaryOpenUsesNewWindow,
  }
}
