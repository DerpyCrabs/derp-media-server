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

export type ExplorerCommonModalLayerProps = {
  overlayScope?: ModalOverlayScope
  iconEditTarget: Accessor<FileItem | null>
  setIconEditTarget: (value: FileItem | null) => void
  customIcons: Accessor<Record<string, string>>
  onSaveCustomIcon: (iconName: string | null) => void
  setCustomIconPending: boolean
  removeCustomIconPending: boolean
  uploadToast: Accessor<UploadToastState>
  setUploadToastHidden: () => void
  breadcrumbMenu: Accessor<BreadcrumbMenuTarget | null>
  setBreadcrumbMenu: (value: BreadcrumbMenuTarget | null) => void
  breadcrumbMenuActions: Accessor<ExplorerBreadcrumbMenuActions>
  onBreadcrumbOpenInNewTab: () => void
  onBreadcrumbOpenInOtherSurface: () => void
  otherSurfaceLabel?: string
  onBreadcrumbSetIcon: () => void
  fileRowMenu: ExplorerFileRowMenuApi
  editableFolders: Accessor<string[]>
  isCurrentDirEditable: Accessor<boolean>
  hasEditableFolders: Accessor<boolean>
  onContextDownload: (file: FileItem) => void
  onOpenInNewTab?: (file: FileItem) => void
  openInNewTabLabel?: string
  showOpenInNewTabForFiles?: boolean
  onOpenInSplitView?: (file: FileItem) => void
  onOpenInOtherSurface?: (file: FileItem) => void
  onOpenWithBrowser?: (file: FileItem) => void
  onOpenWithReader?: (file: FileItem) => void
  onAddToTaskbar?: (file: FileItem) => void
  onToggleFavorite?: (file: FileItem) => void
  isFavorite?: (file: FileItem) => boolean
  onRename?: (file: FileItem) => void
  onMove?: (file: FileItem) => void
  onCopy?: (file: FileItem) => void
  onSetIcon?: (file: FileItem) => void
  onToggleKnowledgeBase?: (file: FileItem) => void
  isKnowledgeBase?: (file: FileItem) => boolean
  openInOtherSurfaceLabel?: string
  onPickNewTabTarget?: () => void
  defaultFileOpen?: Accessor<FileOpenTarget>
  onOpenFileInNewWindow?: (file: FileItem) => void
  getVirtualEntry?: (file: FileItem) => VirtualEntry | undefined
  onVirtualAction?: (action: VirtualCapability, file: FileItem) => void
  showRename: Accessor<boolean>
  renameTarget: Accessor<FileItem | null>
  renameNewName: Accessor<string>
  setRenameNewName: (value: string) => void
  submitRename: () => void
  cancelRename: () => void
  renamePending: boolean
  renameError: Error | null | undefined
  renameTargetExists: Accessor<boolean>
  renameTargetIsDirectory: Accessor<boolean>
  moveTarget: Accessor<FileItem | null>
  closeMoveDialog: () => void
  moveDialogFilePath: Accessor<string>
  confirmMoveTo: (destination: string) => void
  movePending: boolean
  moveError: Error | null | undefined
  deleteTarget: Accessor<FileItem | null>
  setDeleteTarget: (value: FileItem | null) => void
  deletePending: boolean
  onConfirmDelete: () => void
  deleteTitle?: string
  deleteDescription?: string
  deleteConfirmLabel?: string
  showPasteDialog: Accessor<boolean>
  pasteData: Accessor<PasteData | null>
  pastePending: boolean
  pasteError: Error | null
  pasteExistingFiles: Accessor<FileItem[]>
  onPasteFileSubmit: (
    fileName: string,
    mode: 'create' | 'replace',
    expectedVersion?: number,
  ) => void
  closePasteDialog: () => void
  children?: JSX.Element
}

export function ExplorerCommonModalLayer(props: ExplorerCommonModalLayerProps) {
  return (
    <>
      <IconEditorDialog
        overlayScope={props.overlayScope}
        isOpen={!!props.iconEditTarget()}
        fileName={props.iconEditTarget()?.name ?? ''}
        currentIcon={
          props.iconEditTarget()
            ? (props.customIcons()[props.iconEditTarget()!.path] ??
              props.customIcons()[props.iconEditTarget()!.path.replace(/\\/g, '/')] ??
              null)
            : null
        }
        onClose={() => props.setIconEditTarget(null)}
        onSave={props.onSaveCustomIcon}
        isPending={props.setCustomIconPending || props.removeCustomIconPending}
      />
      <UploadToastStack
        toastAnchor={props.overlayScope}
        state={props.uploadToast}
        onDismissError={props.setUploadToastHidden}
      />
      <BreadcrumbContextMenu
        target={props.breadcrumbMenu}
        onDismiss={() => props.setBreadcrumbMenu(null)}
        showOpenInNewTab={props.breadcrumbMenuActions().showOpenInNewTab}
        onOpenInNewTab={props.onBreadcrumbOpenInNewTab}
        showOpenInOtherSurface={props.breadcrumbMenuActions().showOpenInOtherSurface}
        onOpenInOtherSurface={props.onBreadcrumbOpenInOtherSurface}
        openInOtherSurfaceLabel={props.otherSurfaceLabel}
        showSetIcon={props.breadcrumbMenuActions().showSetIcon}
        onSetIcon={props.onBreadcrumbSetIcon}
      />
      <FileRowContextMenu
        menu={props.fileRowMenu.menu}
        editableFolders={props.editableFolders}
        isCurrentDirEditable={props.isCurrentDirEditable}
        hasEditableFolders={props.hasEditableFolders}
        onDismiss={props.fileRowMenu.dismiss}
        onDownload={props.onContextDownload}
        onDelete={props.fileRowMenu.confirmDelete}
        onAddToTaskbar={props.onAddToTaskbar}
        onRename={props.onRename}
        onMove={props.onMove}
        onSetIcon={props.onSetIcon}
        onOpenInNewTab={props.onOpenInNewTab}
        openInNewTabLabel={props.openInNewTabLabel}
        showOpenInNewTabForFiles={props.showOpenInNewTabForFiles}
        onOpenInSplitView={props.onOpenInSplitView}
        onOpenInOtherSurface={props.onOpenInOtherSurface}
        openInOtherSurfaceLabel={props.openInOtherSurfaceLabel}
        onOpenWithBrowser={props.onOpenWithBrowser}
        onOpenWithReader={props.onOpenWithReader}
        onToggleFavorite={props.onToggleFavorite}
        isFavorite={props.isFavorite}
        onCopy={props.onCopy}
        onToggleKnowledgeBase={props.onToggleKnowledgeBase}
        isKnowledgeBase={props.isKnowledgeBase}
        onPickNewTabTarget={props.onPickNewTabTarget}
        defaultFileOpen={props.defaultFileOpen}
        onOpenFileInNewWindow={props.onOpenFileInNewWindow}
        getVirtualEntry={props.getVirtualEntry}
        onVirtualAction={props.onVirtualAction}
      />
      <RenameDialog
        overlayScope={props.overlayScope}
        isOpen={props.showRename()}
        itemName={props.renameTarget()?.name ?? ''}
        newName={props.renameNewName()}
        onNewNameChange={props.setRenameNewName}
        onRename={props.submitRename}
        onCancel={props.cancelRename}
        isPending={props.renamePending}
        error={props.renameError}
        nameExists={props.renameTargetExists()}
        isDirectory={props.renameTargetIsDirectory()}
      />
      <Show when={props.moveTarget()}>
        <MoveToDialog
          overlayScope={props.overlayScope}
          onClose={props.closeMoveDialog}
          fileName={props.moveTarget()!.name}
          filePath={props.moveDialogFilePath()}
          onConfirm={props.confirmMoveTo}
          isPending={props.movePending}
          error={props.moveError}
          editableFolders={props.editableFolders()}
        />
      </Show>
      <DeleteFileDialog
        overlayScope={props.overlayScope}
        item={props.deleteTarget}
        isPending={props.deletePending}
        onDismiss={() => props.setDeleteTarget(null)}
        onConfirm={props.onConfirmDelete}
        title={props.deleteTitle}
        description={props.deleteDescription}
        confirmLabel={props.deleteConfirmLabel}
      />
      <PasteDialog
        overlayScope={props.overlayScope}
        isOpen={props.showPasteDialog()}
        pasteData={props.pasteData()}
        isPending={props.pastePending}
        error={props.pasteError}
        existingFiles={props.pasteExistingFiles()}
        onPaste={props.onPasteFileSubmit}
        onClose={props.closePasteDialog}
      />
      {props.children}
    </>
  )
}
