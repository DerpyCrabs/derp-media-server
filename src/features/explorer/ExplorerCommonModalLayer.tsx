import type { PasteData } from '@/lib/files/paste-data'
import type { FileItem } from '@/lib/files/types'
import type { FileOpenTarget } from '@/lib/models/open-target'
import type { Accessor } from 'solid-js'
import type { JSX } from '@solidjs/web'
import { Show } from 'solid-js'
import type { VirtualCapability, VirtualEntry } from '@/lib/files/virtual-directory'
import type { BreadcrumbMenuTarget } from './BreadcrumbContextMenu'
import { BreadcrumbContextMenu } from './BreadcrumbContextMenu'
import { DeleteFileDialog } from './DeleteFileDialog'
import { FileRowContextMenu } from './FileRowContextMenu'
import { IconEditorDialog } from './IconEditorDialog'
import { MoveToDialog } from './MoveToDialog'
import { PasteDialog } from './PasteDialog'
import { RenameDialog } from './RenameDialog'
import type { ModalOverlayScope } from './modal-overlay-scope'
import type { UploadToastState } from './types'
import { UploadToastStack } from './UploadToastStack'

export type ExplorerBreadcrumbMenuActions = {
  showOpenInNewTab: boolean
  showOpenInOtherSurface: boolean
  showSetIcon: boolean
}

export type ExplorerFileRowMenuApi = {
  menu: Accessor<{ x: number; y: number; file: FileItem } | null>
  dismiss: () => void
  confirmDelete: (file: FileItem) => void
}

export type ExplorerIconDialog = {
  target: Accessor<FileItem | null>
  setTarget: (value: FileItem | null) => void
  customIcons: Accessor<Record<string, string>>
  save: (iconName: string | null) => void
  pending: Accessor<boolean>
}

export type ExplorerUploadNotice = {
  state: Accessor<UploadToastState>
  dismiss: () => void
}

export type ExplorerBreadcrumbMenu = {
  target: Accessor<BreadcrumbMenuTarget | null>
  setTarget: (value: BreadcrumbMenuTarget | null) => void
  availableActions: Accessor<ExplorerBreadcrumbMenuActions>
  openInNewTab: () => void
  openInOtherSurface: () => void
  otherSurfaceLabel?: string
  setIcon: () => void
}

export type ExplorerRowMenu = {
  api: ExplorerFileRowMenuApi
  editableFolders: Accessor<string[]>
  currentDirectoryEditable: Accessor<boolean>
  hasEditableFolders: Accessor<boolean>
  download: (file: FileItem) => void
  openInNewTab?: (file: FileItem) => void
  openInNewTabLabel?: string
  showOpenInNewTabForFiles?: boolean
  openInSplitView?: (file: FileItem) => void
  openInOtherSurface?: (file: FileItem) => void
  openInOtherSurfaceLabel?: string
  openWithBrowser?: (file: FileItem) => void
  openWithReader?: (file: FileItem) => void
  addToTaskbar?: (file: FileItem) => void
  toggleFavorite?: (file: FileItem) => void
  isFavorite?: (file: FileItem) => boolean
  rename?: (file: FileItem) => void
  move?: (file: FileItem) => void
  copy?: (file: FileItem) => void
  setIcon?: (file: FileItem) => void
  toggleKnowledgeBase?: (file: FileItem) => void
  isKnowledgeBase?: (file: FileItem) => boolean
  pickNewTabTarget?: () => void
  defaultFileOpen?: Accessor<FileOpenTarget>
  openFileInNewWindow?: (file: FileItem) => void
  getVirtualEntry?: (file: FileItem) => VirtualEntry | undefined
  runVirtualAction?: (action: VirtualCapability, file: FileItem) => void
}

export type ExplorerRenameDialog = {
  open: Accessor<boolean>
  target: Accessor<FileItem | null>
  submit: (name: string) => void
  cancel: () => void
  pending: Accessor<boolean>
  error: Accessor<Error | null | undefined>
  targetExists: (name: string) => boolean
  targetIsDirectory: Accessor<boolean>
}

export type ExplorerMoveDialog = {
  target: Accessor<FileItem | null>
  close: () => void
  filePath: Accessor<string>
  confirm: (destination: string) => void
  pending: Accessor<boolean>
  error: Accessor<Error | null | undefined>
}

export type ExplorerDeleteDialog = {
  target: Accessor<FileItem | null>
  setTarget: (value: FileItem | null) => void
  pending: Accessor<boolean>
  confirm: () => void
  title?: Accessor<string | undefined>
  description?: Accessor<string | undefined>
  confirmLabel?: Accessor<string | undefined>
}

export type ExplorerPasteDialog = {
  open: Accessor<boolean>
  data: Accessor<PasteData | null>
  pending: Accessor<boolean>
  error: Accessor<Error | null>
  existingFiles: Accessor<FileItem[]>
  submit: (fileName: string, mode: 'create' | 'replace', expectedVersion?: number) => void
  close: () => void
}

export type ExplorerCommonModalLayerProps = {
  overlayScope?: ModalOverlayScope
  icon: ExplorerIconDialog
  upload: ExplorerUploadNotice
  breadcrumbs: ExplorerBreadcrumbMenu
  rowMenu: ExplorerRowMenu
  rename: ExplorerRenameDialog
  move: ExplorerMoveDialog
  remove: ExplorerDeleteDialog
  paste: ExplorerPasteDialog
  children?: JSX.Element
}

export function ExplorerCommonModalLayer(props: ExplorerCommonModalLayerProps) {
  return (
    <>
      <IconEditorDialog
        overlayScope={props.overlayScope}
        isOpen={!!props.icon.target()}
        fileName={props.icon.target()?.name ?? ''}
        currentIcon={
          props.icon.target()
            ? (props.icon.customIcons()[props.icon.target()!.path] ??
              props.icon.customIcons()[props.icon.target()!.path.replace(/\\/g, '/')] ??
              null)
            : null
        }
        onClose={() => props.icon.setTarget(null)}
        onSave={props.icon.save}
        isPending={props.icon.pending()}
      />
      <UploadToastStack
        toastAnchor={props.overlayScope}
        state={props.upload.state}
        onDismissError={props.upload.dismiss}
      />
      <BreadcrumbContextMenu
        target={props.breadcrumbs.target}
        onDismiss={() => props.breadcrumbs.setTarget(null)}
        showOpenInNewTab={props.breadcrumbs.availableActions().showOpenInNewTab}
        onOpenInNewTab={props.breadcrumbs.openInNewTab}
        showOpenInOtherSurface={props.breadcrumbs.availableActions().showOpenInOtherSurface}
        onOpenInOtherSurface={props.breadcrumbs.openInOtherSurface}
        openInOtherSurfaceLabel={props.breadcrumbs.otherSurfaceLabel}
        showSetIcon={props.breadcrumbs.availableActions().showSetIcon}
        onSetIcon={props.breadcrumbs.setIcon}
      />
      <FileRowContextMenu
        menu={props.rowMenu.api.menu}
        editableFolders={props.rowMenu.editableFolders}
        isCurrentDirEditable={props.rowMenu.currentDirectoryEditable}
        hasEditableFolders={props.rowMenu.hasEditableFolders}
        onDismiss={props.rowMenu.api.dismiss}
        onDownload={props.rowMenu.download}
        onDelete={props.rowMenu.api.confirmDelete}
        onAddToTaskbar={props.rowMenu.addToTaskbar}
        onRename={props.rowMenu.rename}
        onMove={props.rowMenu.move}
        onSetIcon={props.rowMenu.setIcon}
        onOpenInNewTab={props.rowMenu.openInNewTab}
        openInNewTabLabel={props.rowMenu.openInNewTabLabel}
        showOpenInNewTabForFiles={props.rowMenu.showOpenInNewTabForFiles}
        onOpenInSplitView={props.rowMenu.openInSplitView}
        onOpenInOtherSurface={props.rowMenu.openInOtherSurface}
        openInOtherSurfaceLabel={props.rowMenu.openInOtherSurfaceLabel}
        onOpenWithBrowser={props.rowMenu.openWithBrowser}
        onOpenWithReader={props.rowMenu.openWithReader}
        onToggleFavorite={props.rowMenu.toggleFavorite}
        isFavorite={props.rowMenu.isFavorite}
        onCopy={props.rowMenu.copy}
        onToggleKnowledgeBase={props.rowMenu.toggleKnowledgeBase}
        isKnowledgeBase={props.rowMenu.isKnowledgeBase}
        onPickNewTabTarget={props.rowMenu.pickNewTabTarget}
        defaultFileOpen={props.rowMenu.defaultFileOpen}
        onOpenFileInNewWindow={props.rowMenu.openFileInNewWindow}
        getVirtualEntry={props.rowMenu.getVirtualEntry}
        onVirtualAction={props.rowMenu.runVirtualAction}
      />
      <RenameDialog
        overlayScope={props.overlayScope}
        isOpen={props.rename.open()}
        itemName={props.rename.target()?.name ?? ''}
        onRename={props.rename.submit}
        onCancel={props.rename.cancel}
        isPending={props.rename.pending()}
        error={props.rename.error()}
        nameExists={props.rename.targetExists}
        isDirectory={props.rename.targetIsDirectory()}
      />
      <Show when={props.move.target()}>
        <MoveToDialog
          overlayScope={props.overlayScope}
          onClose={props.move.close}
          fileName={props.move.target()!.name}
          filePath={props.move.filePath()}
          onConfirm={props.move.confirm}
          isPending={props.move.pending()}
          error={props.move.error()}
          editableFolders={props.rowMenu.editableFolders()}
        />
      </Show>
      <DeleteFileDialog
        overlayScope={props.overlayScope}
        item={props.remove.target}
        isPending={props.remove.pending()}
        onDismiss={() => props.remove.setTarget(null)}
        onConfirm={props.remove.confirm}
        title={props.remove.title?.()}
        description={props.remove.description?.()}
        confirmLabel={props.remove.confirmLabel?.()}
      />
      <PasteDialog
        overlayScope={props.overlayScope}
        isOpen={props.paste.open()}
        pasteData={props.paste.data()}
        isPending={props.paste.pending()}
        error={props.paste.error()}
        existingFiles={props.paste.existingFiles()}
        onPaste={props.paste.submit}
        onClose={props.paste.close}
      />
      {props.children}
    </>
  )
}
