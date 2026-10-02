import { modelOwner } from 'effectweb'
import { operationError } from './file-browser-mutations'
import { normalizeNewFilePath } from '@/lib/files/new-file-name'
import type { FileItem } from '@/lib/files/types'
import type {
  ExplorerDeleteDialog,
  ExplorerMoveDialog,
  ExplorerPasteDialog,
  ExplorerRenameDialog,
} from './ExplorerCommonModalLayer'
import type {
  FileBrowserCopyDialog,
  FileBrowserCreateFileDialog,
  FileBrowserCreateFolderDialog,
} from './FileBrowserModalLayer'
import type { FileBrowserController } from './file-browser-controller'
import { fileRowContextMenu, type FileRowMenuState } from './file-row-context-menu'
import {
  type VirtualDirectoryFeature,
  type VirtualDirectoryFeatureOptions,
} from './virtual-directory-feature'
import type { FileBrowserActionOverrides } from './file-browser-action-overrides'
export type { FileBrowserActionOverrides } from './file-browser-action-overrides'
export type FileBrowserActionsOptions = Readonly<{
  controller: FileBrowserController
  currentPath: string
  files: readonly FileItem[]
  inKnowledgeBase: boolean
  editableFolders: readonly string[]
  copyEnabled?: boolean
  overrides?: FileBrowserActionOverrides
  virtual?: VirtualDirectoryFeatureOptions
}>
type FileBrowserActionDialog =
  | { kind: 'create-file' }
  | { kind: 'create-folder' }
  | { kind: 'rename'; target: FileItem }
  | { kind: 'move'; target: FileItem }
  | { kind: 'copy'; target: FileItem }
  | { kind: 'remove'; target: FileItem }
  | null
export function createFileBrowserActions() {
  const owner = modelOwner({
    actionDialog: null as FileBrowserActionDialog,
    menu: null as FileRowMenuState | null,
  })
  return {
    source: owner.source,
    read: owner.read,
    dispose: owner.dispose,
    snapshot: (
      state: ReturnType<typeof owner.read>,
      options: FileBrowserActionsOptions,
      virtual?: VirtualDirectoryFeature,
    ) => {
      const actionDialog = () => state.actionDialog
      const setActionDialog = (actionDialog: FileBrowserActionDialog) =>
        owner.patch({ actionDialog })
      const createFolderOpen = () => actionDialog()?.kind === 'create-folder'
      const dialogTarget = (kind: 'rename' | 'move' | 'copy' | 'remove') => {
        const dialog = actionDialog()
        return dialog?.kind === kind ? dialog.target : null
      }
      const renameTarget = () => dialogTarget('rename')
      const moveTarget = () => dialogTarget('move')
      const copyTarget = () => dialogTarget('copy')
      const deleteTarget = () => dialogTarget('remove')
      const overrides: FileBrowserActionOverrides | undefined =
        options.overrides || virtual
          ? { ...virtual?.actionOverrides, ...options.overrides }
          : undefined
      function updateDeleteTarget(target: FileItem | null) {
        if (target) setActionDialog({ kind: 'remove', target })
        else if (actionDialog()?.kind === 'remove') setActionDialog(null)
        overrides?.removeTargetChanged?.(target)
      }
      const rowMenu = fileRowContextMenu(
        state.menu,
        (menu) => owner.patch({ menu }),
        updateDeleteTarget,
      )
      const controller = options.controller
      function folderExists(value: string) {
        const name = value.trim().toLowerCase()
        return (
          !!name &&
          options.files.some((file) => file.isDirectory && file.name.toLowerCase() === name)
        )
      }
      function fileExists(value: string) {
        const name = value.trim()
        if (!name) return false
        const normalized = normalizeNewFilePath(name, options.inKnowledgeBase).toLowerCase()
        const raw = name.toLowerCase()
        return options.files.some(
          (file) =>
            !file.isDirectory &&
            (file.name.toLowerCase() === normalized || file.name.toLowerCase() === raw),
        )
      }
      function renameTargetExists(value: string) {
        const target = renameTarget()
        const trimmed = value.trim()
        const name = trimmed.toLowerCase()
        if (!target || !name) return false
        const overridden = overrides?.renameExists?.(target, trimmed)
        if (overridden !== undefined) return overridden
        return options.files.some(
          (file) => file.path !== target.path && file.name.toLowerCase() === name,
        )
      }
      function closeDialog(kind: NonNullable<FileBrowserActionDialog>['kind']) {
        if (actionDialog()?.kind === kind) setActionDialog(null)
      }
      function closeCreateFile() {
        closeDialog('create-file')
        controller.mutations.createFileMutation.reset()
      }
      function closeCreateFolder() {
        closeDialog('create-folder')
        controller.mutations.createFolderMutation.reset()
      }
      function closeRename() {
        closeDialog('rename')
        controller.mutations.renameMutation.reset()
      }
      function closeMove() {
        closeDialog('move')
        controller.mutations.moveMutation.reset()
      }
      function closeCopy() {
        closeDialog('copy')
        controller.mutations.copyMutation.reset()
      }
      function openCreateFile() {
        if (overrides?.openCreateFile?.() === true) return
        controller.mutations.createFileMutation.reset()
        setActionDialog({ kind: 'create-file' })
      }
      function openCreateFolder() {
        if (virtual?.openCreateFolder()) return
        controller.mutations.createFolderMutation.reset()
        setActionDialog({ kind: 'create-folder' })
      }
      function requestRename(file: FileItem) {
        controller.mutations.renameMutation.reset()
        setActionDialog({ kind: 'rename', target: file })
      }
      function requestMove(file: FileItem) {
        controller.mutations.moveMutation.reset()
        setActionDialog({ kind: 'move', target: file })
      }
      function requestCopy(file: FileItem) {
        if (!options.copyEnabled) return
        controller.mutations.copyMutation.reset()
        setActionDialog({ kind: 'copy', target: file })
      }
      function submitCreateFile(value: string) {
        const name = value.trim()
        if (!name || fileExists(name)) return
        const base = options.currentPath ? `${options.currentPath}/${name}` : name
        const path = normalizeNewFilePath(base, options.inKnowledgeBase)
        void controller.mutations.createFileMutation.run({ path, content: '' }, closeCreateFile)
      }
      function submitCreateFolder(value: string) {
        const name = value.trim()
        if (!name || folderExists(name)) return
        const path = options.currentPath ? `${options.currentPath}/${name}` : name
        void controller.mutations.createFolderMutation.run({ path }, closeCreateFolder)
      }
      function submitRename(value: string) {
        const target = renameTarget()
        const name = value.trim()
        if (!target || !name || name === target.name || renameTargetExists(name)) return
        if (overrides?.rename?.(target, name, closeRename) === true) return
        const normalizedPath = target.path.replace(/\\/g, '/')
        const parent = normalizedPath.split('/').slice(0, -1).join('/')
        const newPath = parent ? `${parent}/${name}` : name
        void controller.mutations.renameMutation.run(
          { oldPath: normalizedPath, newPath },
          closeRename,
        )
      }
      function confirmMove(destination: string) {
        const target = moveTarget()
        if (!target) return
        const name = target.path.split(/[/\\]/).pop()!
        const normalizedDestination = destination.replace(/\\/g, '/').replace(/\/+$/, '')
        const newPath = normalizedDestination ? `${normalizedDestination}/${name}` : name
        void controller.mutations.moveMutation.run(
          { oldPath: target.path.replace(/\\/g, '/'), newPath },
          closeMove,
        )
      }
      function confirmCopy(destination: string) {
        const target = copyTarget()
        if (!target) return
        void controller.mutations.copyMutation.run(
          { sourcePath: target.path, destinationDir: destination },
          closeCopy,
        )
      }
      function confirmDelete() {
        const target = deleteTarget()
        if (!target) return
        const close = () => updateDeleteTarget(null)
        if (overrides?.remove?.(target, close) === true) return
        void controller.mutations.deleteMutation.run(target.path, close)
      }
      const rename: ExplorerRenameDialog = {
        open: renameTarget() !== null,
        target: renameTarget(),
        submit: submitRename,
        cancel: closeRename,
        pending:
          controller.mutations.renameMutation.result.waiting || (overrides?.renamePending ?? false),
        error: overrides?.renameError ?? operationError(controller.mutations.renameMutation.result),
        targetExists: renameTargetExists,
        targetIsDirectory: renameTarget()?.isDirectory ?? false,
      }
      const move: ExplorerMoveDialog = {
        target: moveTarget(),
        close: closeMove,
        filePath: moveTarget()?.path ?? '',
        confirm: confirmMove,
        pending: controller.mutations.moveMutation.result.waiting,
        error: operationError(controller.mutations.moveMutation.result),
      }
      const remove: ExplorerDeleteDialog = {
        target: deleteTarget(),
        setTarget: updateDeleteTarget,
        pending:
          controller.mutations.deleteMutation.result.waiting || (overrides?.removePending ?? false),
        confirm: confirmDelete,
        title: overrides?.removeTitle,
        description: overrides?.removeDescription,
        confirmLabel: overrides?.removeConfirmLabel,
      }
      const paste: ExplorerPasteDialog = {
        open: controller.paste.open,
        data: controller.paste.data,
        pending: controller.mutations.pasteMutation.result.waiting,
        error:
          (operationError(controller.mutations.pasteMutation.result) as Error | undefined) ?? null,
        existingFiles: controller.paste.existingFiles,
        submit: controller.paste.submit,
        close: controller.paste.close,
      }
      const createFile: FileBrowserCreateFileDialog = {
        open: actionDialog()?.kind === 'create-file',
        submit: submitCreateFile,
        cancel: closeCreateFile,
        pending: controller.mutations.createFileMutation.result.waiting,
        error: operationError(controller.mutations.createFileMutation.result),
        exists: fileExists,
        defaultExtension: options.inKnowledgeBase ? 'md' : 'txt',
      }
      const createFolder: FileBrowserCreateFolderDialog = {
        open: createFolderOpen(),
        submit: submitCreateFolder,
        cancel: closeCreateFolder,
        pending: controller.mutations.createFolderMutation.result.waiting,
        error: operationError(controller.mutations.createFolderMutation.result),
        exists: folderExists,
      }
      const copy: FileBrowserCopyDialog | undefined = options.copyEnabled
        ? {
            target: copyTarget(),
            close: closeCopy,
            confirm: confirmCopy,
            pending: controller.mutations.copyMutation.result.waiting,
            error: operationError(controller.mutations.copyMutation.result),
            editableFolders: options.editableFolders,
          }
        : undefined
      return {
        rowMenu,
        openCreateFile,
        openCreateFolder,
        requestRename,
        requestMove,
        requestCopy,
        virtual,
        dialogs: {
          rename,
          move,
          remove,
          paste,
          createFile,
          createFolder,
          copy,
          virtual: virtual?.modal,
        },
      }
    },
  }
}
