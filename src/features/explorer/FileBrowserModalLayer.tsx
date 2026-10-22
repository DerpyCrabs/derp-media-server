import { view } from 'effectweb'
import type { FileItem } from '@/lib/files/types'
import { CreateFileDialog, type CreateFileDialogProps } from './CreateFileDialog'
import { CreateFolderDialog } from './CreateFolderDialog'
import {
  ExplorerCommonModalLayer,
  type ExplorerBreadcrumbMenu,
  type ExplorerDeleteDialog,
  type ExplorerIconDialog,
  type ExplorerMoveDialog,
  type ExplorerPasteDialog,
  type ExplorerRenameDialog,
  type ExplorerRowMenu,
  type ExplorerUploadNotice,
} from './ExplorerCommonModalLayer'
import { MoveToDialog } from './MoveToDialog'
import type { ModalOverlayScope } from './modal-overlay-scope'
import type { VirtualDirectoryModal } from './virtual-directory-feature'
export type FileBrowserCreateFileDialog = {
  open: boolean
  submit: (name: string) => void
  cancel: () => void
  pending: boolean
  error: Error | null | undefined
  exists: (name: string) => boolean
  defaultExtension: CreateFileDialogProps['defaultExtension']
}
export type FileBrowserCreateFolderDialog = {
  open: boolean
  submit: (name: string) => void
  cancel: () => void
  pending: boolean
  error: Error | null | undefined
  exists: (name: string) => boolean
}
export type FileBrowserCopyDialog = {
  target: FileItem | null
  close: () => void
  confirm: (destination: string) => void
  pending: boolean
  error: Error | null | undefined
  editableFolders: readonly string[]
}
export type FileBrowserModalLayerProps = {
  overlayScope?: ModalOverlayScope
  chrome: FileBrowserModalChrome
  dialogs: FileBrowserDialogs
}
export type FileBrowserModalChrome = {
  icon: ExplorerIconDialog
  upload: ExplorerUploadNotice
  breadcrumbs: ExplorerBreadcrumbMenu
  rowMenu: ExplorerRowMenu
}
export type FileBrowserDialogs = {
  rename: ExplorerRenameDialog
  move: ExplorerMoveDialog
  remove: ExplorerDeleteDialog
  paste: ExplorerPasteDialog
  createFile: FileBrowserCreateFileDialog
  createFolder: FileBrowserCreateFolderDialog
  copy?: FileBrowserCopyDialog
  virtual?: VirtualDirectoryModal | undefined
}
export const FileBrowserModalLayer = view<FileBrowserModalLayerProps>((props) => {
  return (
    <ExplorerCommonModalLayer
      overlayScope={props.overlayScope}
      icon={props.chrome.icon}
      upload={props.chrome.upload}
      breadcrumbs={props.chrome.breadcrumbs}
      rowMenu={props.chrome.rowMenu}
      rename={props.dialogs.rename}
      move={props.dialogs.move}
      remove={props.dialogs.remove}
      paste={props.dialogs.paste}
    >
      <CreateFolderDialog
        overlayScope={props.overlayScope}
        isOpen={props.dialogs.createFolder.open}
        onCreate={props.dialogs.createFolder.submit}
        onCancel={props.dialogs.createFolder.cancel}
        isPending={props.dialogs.createFolder.pending}
        error={props.dialogs.createFolder.error}
        folderExists={props.dialogs.createFolder.exists}
      />
      <CreateFileDialog
        overlayScope={props.overlayScope}
        isOpen={props.dialogs.createFile.open}
        onCreate={props.dialogs.createFile.submit}
        onCancel={props.dialogs.createFile.cancel}
        isPending={props.dialogs.createFile.pending}
        error={props.dialogs.createFile.error}
        fileExists={props.dialogs.createFile.exists}
        defaultExtension={props.dialogs.createFile.defaultExtension}
      />
      {props.dialogs.copy?.target ? (
        <MoveToDialog
          overlayScope={props.overlayScope}
          mode='copy'
          onClose={props.dialogs.copy!.close}
          fileName={props.dialogs.copy?.target.name}
          filePath={props.dialogs.copy?.target.path}
          onConfirm={props.dialogs.copy!.confirm}
          isPending={props.dialogs.copy!.pending}
          error={props.dialogs.copy!.error}
          editableFolders={props.dialogs.copy!.editableFolders}
        />
      ) : null}
      {props.dialogs.virtual?.render(props.overlayScope) ?? null}
    </ExplorerCommonModalLayer>
  )
})
