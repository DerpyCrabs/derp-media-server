import type { PasteData } from '@/lib/paste-data'
import type { ShareLink } from '@/lib/shares'
import type { FileItem } from '@/lib/types'
import type { Accessor } from 'solid-js'
import { Show } from 'solid-js'
import type { BreadcrumbMenuTarget } from './BreadcrumbContextMenu'
import { BreadcrumbContextMenu } from './BreadcrumbContextMenu'
import { CreateFileDialog } from './CreateFileDialog'
import { CreateFolderDialog } from './CreateFolderDialog'
import { DeleteFileDialog } from './DeleteFileDialog'
import { FileRowContextMenu } from './FileRowContextMenu'
import { IconEditorDialog } from './IconEditorDialog'
import { MoveToDialog } from './MoveToDialog'
import { PasteDialog } from './PasteDialog'
import { RenameDialog } from './RenameDialog'
import { ShareDialog } from './ShareDialog'
import type { UploadToastState } from './types'
import { UploadToastStack } from './UploadToastStack'

type BreadcrumbMenuActions = {
  showOpenInNewTab: boolean
  showOpenInWorkspace: boolean
  showSetIcon: boolean
}

type FileRowMenuApi = {
  menu: Accessor<{ x: number; y: number; file: FileItem } | null>
  dismiss: () => void
  confirmDelete: (file: FileItem) => void
}

export type FileBrowserModalLayerProps = {
  iconEditTarget: Accessor<FileItem | null>
  setIconEditTarget: (v: FileItem | null) => void
  customIcons: Accessor<Record<string, string>>
  onSaveCustomIcon: (iconName: string | null) => void
  setCustomIconPending: boolean
  removeCustomIconPending: boolean
  uploadToast: Accessor<UploadToastState>
  setUploadToastHidden: () => void
  breadcrumbMenu: Accessor<BreadcrumbMenuTarget | null>
  setBreadcrumbMenu: (v: BreadcrumbMenuTarget | null) => void
  breadcrumbMenuActions: Accessor<BreadcrumbMenuActions>
  onBreadcrumbOpenInNewTab: () => void
  onBreadcrumbOpenInWorkspace: () => void
  onBreadcrumbSetIcon: () => void
  fileRowMenu: FileRowMenuApi
  editableFolders: Accessor<string[]>
  isEditable: Accessor<boolean>
  hasEditableFolders: Accessor<boolean>
  onContextDownload: (file: FileItem) => void
  onContextShare: (file: FileItem) => void
  onCopyShareLink: (file: FileItem) => void
  getPathHasShare: (file: FileItem) => boolean
  onContextOpenInNewTab: (file: FileItem) => void
  onContextOpenInWorkspace: (file: FileItem) => void
  onContextToggleFavorite: (file: FileItem) => void
  isRowFavorite: (file: FileItem) => boolean
  onContextRename: (file: FileItem) => void
  onContextMove: (file: FileItem) => void
  onContextCopyTo: (file: FileItem) => void
  onContextSetIcon: (file: FileItem) => void
  onContextToggleKnowledgeBase: (file: FileItem) => void
  isRowKnowledgeBase: (file: FileItem) => boolean
  shareTarget: Accessor<FileItem | null>
  setShareTarget: (v: FileItem | null) => void
  shareDialogIsEditable: Accessor<boolean>
  shareDialogExistingShares: Accessor<ShareLink[]>
  shareLinkBase: Accessor<string>
  deleteTarget: Accessor<FileItem | null>
  setDeleteTarget: (v: FileItem | null) => void
  deletePending: boolean
  revokeSharePending: boolean
  onConfirmDelete: () => void
  showCreateFolder: Accessor<boolean>
  newItemName: Accessor<string>
  setNewItemName: (v: string) => void
  submitCreateFolder: () => void
  cancelCreateFolder: () => void
  createFolderPending: boolean
  createFolderError: Error | null
  folderExists: Accessor<boolean>
  showCreateFile: Accessor<boolean>
  submitCreateFile: () => void
  cancelCreateFile: () => void
  createFilePending: boolean
  createFileError: Error | null
  fileExists: Accessor<boolean>
  inKb: Accessor<boolean>
  showRename: Accessor<boolean>
  renameItem: Accessor<FileItem | null>
  newNameForRename: Accessor<string>
  setNewNameForRename: (v: string) => void
  submitRename: () => void
  cancelRename: () => void
  renamePending: boolean
  renameError: Error | null
  renameTargetExists: Accessor<boolean>
  renameTargetIsDirectory: Accessor<boolean>
  moveDialogTarget: Accessor<FileItem | null>
  copyDialogTarget: Accessor<FileItem | null>
  closeMoveDialog: () => void
  closeCopyDialog: () => void
  onDialogMove: (dest: string) => void
  onCopyToDestination: (dest: string) => void
  movePending: boolean
  moveError: Error | null
  copyPending: boolean
  copyError: Error | null
  editableFoldersList: Accessor<string[]>
  showPasteDialog: Accessor<boolean>
  pasteData: Accessor<PasteData | null>
  pastePending: boolean
  pasteError: Error | null
  pasteExistingLowerNames: Accessor<string[]>
  onPasteFileSubmit: (fileName: string) => void
  closePasteDialog: () => void
}

export function FileBrowserModalLayer(props: FileBrowserModalLayerProps) {
  return (
    <>
      <IconEditorDialog
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
      <UploadToastStack state={props.uploadToast} onDismissError={props.setUploadToastHidden} />
      <BreadcrumbContextMenu
        target={props.breadcrumbMenu}
        onDismiss={() => props.setBreadcrumbMenu(null)}
        showOpenInNewTab={props.breadcrumbMenuActions().showOpenInNewTab}
        onOpenInNewTab={props.onBreadcrumbOpenInNewTab}
        showOpenInWorkspace={props.breadcrumbMenuActions().showOpenInWorkspace}
        onOpenInWorkspace={props.onBreadcrumbOpenInWorkspace}
        showSetIcon={props.breadcrumbMenuActions().showSetIcon}
        onSetIcon={props.onBreadcrumbSetIcon}
      />
      <FileRowContextMenu
        menu={props.fileRowMenu.menu}
        editableFolders={props.editableFolders}
        isCurrentDirEditable={props.isEditable}
        hasEditableFolders={props.hasEditableFolders}
        onDismiss={props.fileRowMenu.dismiss}
        onDownload={props.onContextDownload}
        onDelete={props.fileRowMenu.confirmDelete}
        onShare={props.onContextShare}
        onCopyShareLink={props.onCopyShareLink}
        getPathHasShare={props.getPathHasShare}
        onOpenInNewTab={props.onContextOpenInNewTab}
        onOpenInWorkspace={props.onContextOpenInWorkspace}
        onToggleFavorite={props.onContextToggleFavorite}
        isFavorite={props.isRowFavorite}
        onRename={props.onContextRename}
        onMove={props.onContextMove}
        onCopy={props.onContextCopyTo}
        onSetIcon={props.onContextSetIcon}
        onToggleKnowledgeBase={props.onContextToggleKnowledgeBase}
        isKnowledgeBase={props.isRowKnowledgeBase}
      />
      <ShareDialog
        isOpen={!!props.shareTarget()}
        onClose={() => props.setShareTarget(null)}
        filePath={props.shareTarget()?.path ?? ''}
        fileName={props.shareTarget()?.name ?? ''}
        isDirectory={props.shareTarget()?.isDirectory ?? false}
        isEditable={props.shareDialogIsEditable()}
        existingShares={props.shareDialogExistingShares()}
        shareLinkBase={props.shareLinkBase()}
      />
      <DeleteFileDialog
        item={props.deleteTarget}
        isPending={props.deletePending || props.revokeSharePending}
        onDismiss={() => props.setDeleteTarget(null)}
        onConfirm={props.onConfirmDelete}
      />
      <CreateFolderDialog
        isOpen={props.showCreateFolder()}
        folderName={props.newItemName()}
        onFolderNameChange={props.setNewItemName}
        onCreate={() => props.submitCreateFolder()}
        onCancel={props.cancelCreateFolder}
        isPending={props.createFolderPending}
        error={props.createFolderError}
        folderExists={props.folderExists()}
      />
      <CreateFileDialog
        isOpen={props.showCreateFile()}
        fileName={props.newItemName()}
        onFileNameChange={props.setNewItemName}
        onCreate={() => props.submitCreateFile()}
        onCancel={props.cancelCreateFile}
        isPending={props.createFilePending}
        error={props.createFileError}
        fileExists={props.fileExists()}
        defaultExtension={props.inKb() ? 'md' : 'txt'}
      />
      <RenameDialog
        isOpen={props.showRename()}
        itemName={props.renameItem()?.name ?? ''}
        newName={props.newNameForRename()}
        onNewNameChange={props.setNewNameForRename}
        onRename={() => props.submitRename()}
        onCancel={props.cancelRename}
        isPending={props.renamePending}
        error={props.renameError}
        nameExists={props.renameTargetExists()}
        isDirectory={props.renameTargetIsDirectory()}
      />
      <Show when={props.moveDialogTarget()} keyed>
        {(file) => (
          <MoveToDialog
            onClose={props.closeMoveDialog}
            fileName={file.name}
            filePath={file.path}
            onConfirm={(dest) => props.onDialogMove(dest)}
            isPending={props.movePending}
            error={props.moveError}
            editableFolders={props.editableFoldersList()}
          />
        )}
      </Show>
      <Show when={props.copyDialogTarget()} keyed>
        {(file) => (
          <MoveToDialog
            mode='copy'
            onClose={props.closeCopyDialog}
            fileName={file.name}
            filePath={file.path}
            onConfirm={(dest) => props.onCopyToDestination(dest)}
            isPending={props.copyPending}
            error={props.copyError}
            editableFolders={props.editableFoldersList()}
          />
        )}
      </Show>
      <PasteDialog
        isOpen={props.showPasteDialog()}
        pasteData={props.pasteData()}
        isPending={props.pastePending}
        error={props.pasteError}
        existingFiles={props.pasteExistingLowerNames()}
        onPaste={props.onPasteFileSubmit}
        onClose={props.closePasteDialog}
      />
    </>
  )
}
