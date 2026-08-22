import type { FileItem } from '@/lib/files/types'
import type { Accessor } from 'solid-js'
import { Show } from 'solid-js'
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
  open: Accessor<boolean>
  submit: (name: string) => void
  cancel: () => void
  pending: Accessor<boolean>
  error: Accessor<Error | null | undefined>
  exists: (name: string) => boolean
  defaultExtension: Accessor<CreateFileDialogProps['defaultExtension']>
}

export type FileBrowserCreateFolderDialog = {
  open: Accessor<boolean>
  submit: (name: string) => void
  cancel: () => void
  pending: Accessor<boolean>
  error: Accessor<Error | null | undefined>
  exists: (name: string) => boolean
}

export type FileBrowserCopyDialog = {
  target: Accessor<FileItem | null>
  close: () => void
  confirm: (destination: string) => void
  pending: Accessor<boolean>
  error: Accessor<Error | null | undefined>
  editableFolders: Accessor<string[]>
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
  virtual?: Accessor<VirtualDirectoryModal | undefined>
}

export function FileBrowserModalLayer(props: FileBrowserModalLayerProps) {
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
        isOpen={props.dialogs.createFolder.open()}
        onCreate={props.dialogs.createFolder.submit}
        onCancel={props.dialogs.createFolder.cancel}
        isPending={props.dialogs.createFolder.pending()}
        error={props.dialogs.createFolder.error()}
        folderExists={props.dialogs.createFolder.exists}
      />
      <CreateFileDialog
        overlayScope={props.overlayScope}
        isOpen={props.dialogs.createFile.open()}
        onCreate={props.dialogs.createFile.submit}
        onCancel={props.dialogs.createFile.cancel}
        isPending={props.dialogs.createFile.pending()}
        error={props.dialogs.createFile.error()}
        fileExists={props.dialogs.createFile.exists}
        defaultExtension={props.dialogs.createFile.defaultExtension()}
      />
      <Show when={props.dialogs.copy?.target()} keyed>
        {(file) => (
          <MoveToDialog
            overlayScope={props.overlayScope}
            mode='copy'
            onClose={props.dialogs.copy!.close}
            fileName={file.name}
            filePath={file.path}
            onConfirm={props.dialogs.copy!.confirm}
            isPending={props.dialogs.copy!.pending()}
            error={props.dialogs.copy!.error()}
            editableFolders={props.dialogs.copy!.editableFolders()}
          />
        )}
      </Show>
      <Show when={props.dialogs.virtual?.()} keyed>
        {(virtual) => virtual.render(props.overlayScope)}
      </Show>
    </ExplorerCommonModalLayer>
  )
}
