import type { PasteData } from '@/lib/files/paste-data'
import type { FileItem } from '@/lib/files/types'
import type { Accessor } from 'solid-js'
import { Show } from 'solid-js'
import type { BreadcrumbMenuTarget } from './BreadcrumbContextMenu'
import { CreateFileDialog } from './CreateFileDialog'
import { CreateFolderDialog } from './CreateFolderDialog'
import { MoveToDialog } from './MoveToDialog'
import {
  ExplorerCommonModalLayer,
  type ExplorerBreadcrumbMenuActions,
  type ExplorerFileRowMenuApi,
} from './ExplorerCommonModalLayer'
import type { UploadToastState } from './types'

type BreadcrumbMenuActions = ExplorerBreadcrumbMenuActions
type FileRowMenuApi = ExplorerFileRowMenuApi

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
  onBreadcrumbOpenInOtherSurface: () => void
  otherSurfaceLabel?: string
  onBreadcrumbSetIcon: () => void
  fileRowMenu: FileRowMenuApi
  editableFolders: Accessor<string[]>
  isEditable: Accessor<boolean>
  hasEditableFolders: Accessor<boolean>
  onContextDownload: (file: FileItem) => void
  onContextOpenInNewTab: (file: FileItem) => void
  onContextOpenInOtherSurface: (file: FileItem) => void
  onContextOpenWithBrowser: (file: FileItem) => void
  onContextOpenWithReader: (file: FileItem) => void
  onContextToggleFavorite: (file: FileItem) => void
  isRowFavorite: (file: FileItem) => boolean
  onContextRename: (file: FileItem) => void
  onContextMove: (file: FileItem) => void
  onContextCopyTo: (file: FileItem) => void
  onContextSetIcon: (file: FileItem) => void
  onContextToggleKnowledgeBase: (file: FileItem) => void
  isRowKnowledgeBase: (file: FileItem) => boolean
  deleteTarget: Accessor<FileItem | null>
  setDeleteTarget: (v: FileItem | null) => void
  deletePending: boolean
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
  pasteExistingFiles: Accessor<FileItem[]>
  onPasteFileSubmit: (
    fileName: string,
    mode: 'create' | 'replace',
    expectedVersion?: number,
  ) => void
  closePasteDialog: () => void
}

export function FileBrowserModalLayer(props: FileBrowserModalLayerProps) {
  return (
    <ExplorerCommonModalLayer
      iconEditTarget={props.iconEditTarget}
      setIconEditTarget={props.setIconEditTarget}
      customIcons={props.customIcons}
      onSaveCustomIcon={props.onSaveCustomIcon}
      setCustomIconPending={props.setCustomIconPending}
      removeCustomIconPending={props.removeCustomIconPending}
      uploadToast={props.uploadToast}
      setUploadToastHidden={props.setUploadToastHidden}
      breadcrumbMenu={props.breadcrumbMenu}
      setBreadcrumbMenu={props.setBreadcrumbMenu}
      breadcrumbMenuActions={props.breadcrumbMenuActions}
      onBreadcrumbOpenInNewTab={props.onBreadcrumbOpenInNewTab}
      onBreadcrumbOpenInOtherSurface={props.onBreadcrumbOpenInOtherSurface}
      otherSurfaceLabel={props.otherSurfaceLabel}
      onBreadcrumbSetIcon={props.onBreadcrumbSetIcon}
      fileRowMenu={props.fileRowMenu}
      editableFolders={props.editableFolders}
      isCurrentDirEditable={props.isEditable}
      hasEditableFolders={props.hasEditableFolders}
      onContextDownload={props.onContextDownload}
      onOpenInNewTab={props.onContextOpenInNewTab}
      onOpenInOtherSurface={props.onContextOpenInOtherSurface}
      openInOtherSurfaceLabel={props.otherSurfaceLabel}
      onOpenWithBrowser={props.onContextOpenWithBrowser}
      onOpenWithReader={props.onContextOpenWithReader}
      onToggleFavorite={props.onContextToggleFavorite}
      isFavorite={props.isRowFavorite}
      onRename={props.onContextRename}
      onMove={props.onContextMove}
      onCopy={props.onContextCopyTo}
      onSetIcon={props.onContextSetIcon}
      onToggleKnowledgeBase={props.onContextToggleKnowledgeBase}
      isKnowledgeBase={props.isRowKnowledgeBase}
      showRename={props.showRename}
      renameTarget={props.renameItem}
      renameNewName={props.newNameForRename}
      setRenameNewName={props.setNewNameForRename}
      submitRename={props.submitRename}
      cancelRename={props.cancelRename}
      renamePending={props.renamePending}
      renameError={props.renameError}
      renameTargetExists={props.renameTargetExists}
      renameTargetIsDirectory={props.renameTargetIsDirectory}
      moveTarget={props.moveDialogTarget}
      closeMoveDialog={props.closeMoveDialog}
      moveDialogFilePath={() => props.moveDialogTarget()?.path ?? ''}
      confirmMoveTo={props.onDialogMove}
      movePending={props.movePending}
      moveError={props.moveError}
      deleteTarget={props.deleteTarget}
      setDeleteTarget={props.setDeleteTarget}
      deletePending={props.deletePending}
      onConfirmDelete={props.onConfirmDelete}
      showPasteDialog={props.showPasteDialog}
      pasteData={props.pasteData}
      pastePending={props.pastePending}
      pasteError={props.pasteError}
      pasteExistingFiles={props.pasteExistingFiles}
      onPasteFileSubmit={props.onPasteFileSubmit}
      closePasteDialog={props.closePasteDialog}
    >
      <CreateFolderDialog
        isOpen={props.showCreateFolder()}
        folderName={props.newItemName()}
        onFolderNameChange={props.setNewItemName}
        onCreate={props.submitCreateFolder}
        onCancel={props.cancelCreateFolder}
        isPending={props.createFolderPending}
        error={props.createFolderError}
        folderExists={props.folderExists()}
      />
      <CreateFileDialog
        isOpen={props.showCreateFile()}
        fileName={props.newItemName()}
        onFileNameChange={props.setNewItemName}
        onCreate={props.submitCreateFile}
        onCancel={props.cancelCreateFile}
        isPending={props.createFilePending}
        error={props.createFileError}
        fileExists={props.fileExists()}
        defaultExtension={props.inKb() ? 'md' : 'txt'}
      />
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
    </ExplorerCommonModalLayer>
  )
}
