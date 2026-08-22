import { createSignal, type Accessor } from 'solid-js'
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
import type { FileBrowserController } from './use-file-browser-controller'
import { useFileRowContextMenu } from './use-file-row-context-menu'
import {
  useVirtualDirectoryFeature,
  type FileBrowserActionOverrides,
  type VirtualDirectoryFeatureOptions,
} from './virtual-directory-feature'

export type { FileBrowserActionOverrides } from './virtual-directory-feature'

export type FileBrowserActionsOptions = Readonly<{
  controller: FileBrowserController
  currentPath: Accessor<string>
  files: Accessor<FileItem[]>
  inKnowledgeBase: Accessor<boolean>
  editableFolders: Accessor<string[]>
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

export function useFileBrowserActions(options: FileBrowserActionsOptions) {
  const [actionDialog, setActionDialog] = createSignal<FileBrowserActionDialog>(null)
  const createFolderOpen = () => actionDialog()?.kind === 'create-folder'
  const dialogTarget = (kind: 'rename' | 'move' | 'copy' | 'remove') => {
    const dialog = actionDialog()
    return dialog?.kind === kind ? dialog.target : null
  }
  const renameTarget = () => dialogTarget('rename')
  const moveTarget = () => dialogTarget('move')
  const copyTarget = () => dialogTarget('copy')
  const deleteTarget = () => dialogTarget('remove')
  const virtual = options.virtual ? useVirtualDirectoryFeature(options.virtual) : undefined
  const overrides: FileBrowserActionOverrides | undefined =
    options.overrides || virtual ? { ...virtual?.actionOverrides, ...options.overrides } : undefined

  function updateDeleteTarget(target: FileItem | null) {
    if (target) setActionDialog({ kind: 'remove', target })
    else if (actionDialog()?.kind === 'remove') setActionDialog(null)
    overrides?.removeTargetChanged?.(target)
  }

  const rowMenu = useFileRowContextMenu({ onDeleteRequest: updateDeleteTarget })
  const controller = options.controller

  function folderExists(value: string) {
    const name = value.trim().toLowerCase()
    return (
      !!name && options.files().some((file) => file.isDirectory && file.name.toLowerCase() === name)
    )
  }
  function fileExists(value: string) {
    const name = value.trim()
    if (!name) return false
    const normalized = normalizeNewFilePath(name, options.inKnowledgeBase()).toLowerCase()
    const raw = name.toLowerCase()
    return options
      .files()
      .some(
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
    return options
      .files()
      .some((file) => file.path !== target.path && file.name.toLowerCase() === name)
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
    const base = options.currentPath() ? `${options.currentPath()}/${name}` : name
    const path = normalizeNewFilePath(base, options.inKnowledgeBase())
    controller.mutations.createFileMutation.mutate(
      { path, content: '' },
      { onSuccess: closeCreateFile },
    )
  }

  function submitCreateFolder(value: string) {
    const name = value.trim()
    if (!name || folderExists(name)) return
    const path = options.currentPath() ? `${options.currentPath()}/${name}` : name
    controller.mutations.createFolderMutation.mutate({ path }, { onSuccess: closeCreateFolder })
  }

  function submitRename(value: string) {
    const target = renameTarget()
    const name = value.trim()
    if (!target || !name || name === target.name || renameTargetExists(name)) return
    if (overrides?.rename?.(target, name, closeRename) === true) return
    const normalizedPath = target.path.replace(/\\/g, '/')
    const parent = normalizedPath.split('/').slice(0, -1).join('/')
    const newPath = parent ? `${parent}/${name}` : name
    controller.mutations.renameMutation.mutate(
      { oldPath: normalizedPath, newPath },
      { onSuccess: closeRename },
    )
  }

  function confirmMove(destination: string) {
    const target = moveTarget()
    if (!target) return
    const name = target.path.split(/[/\\]/).pop()!
    const normalizedDestination = destination.replace(/\\/g, '/').replace(/\/+$/, '')
    const newPath = normalizedDestination ? `${normalizedDestination}/${name}` : name
    controller.mutations.moveMutation.mutate(
      { oldPath: target.path.replace(/\\/g, '/'), newPath },
      { onSuccess: closeMove },
    )
  }

  function confirmCopy(destination: string) {
    const target = copyTarget()
    if (!target) return
    controller.mutations.copyMutation.mutate(
      { sourcePath: target.path, destinationDir: destination },
      { onSuccess: closeCopy },
    )
  }

  function confirmDelete() {
    const target = deleteTarget()
    if (!target) return
    const close = () => updateDeleteTarget(null)
    if (overrides?.remove?.(target, close) === true) return
    void controller.mutations.deleteMutation.mutateAsync(target.path).then(close)
  }

  const rename: ExplorerRenameDialog = {
    open: () => renameTarget() !== null,
    target: renameTarget,
    submit: submitRename,
    cancel: closeRename,
    pending: () =>
      controller.mutations.renameMutation.isPending || (overrides?.renamePending?.() ?? false),
    error: () => overrides?.renameError?.() ?? controller.mutations.renameMutation.error,
    targetExists: renameTargetExists,
    targetIsDirectory: () => renameTarget()?.isDirectory ?? false,
  }
  const move: ExplorerMoveDialog = {
    target: moveTarget,
    close: closeMove,
    filePath: () => moveTarget()?.path ?? '',
    confirm: confirmMove,
    pending: () => controller.mutations.moveMutation.isPending,
    error: () => controller.mutations.moveMutation.error,
  }
  const remove: ExplorerDeleteDialog = {
    target: deleteTarget,
    setTarget: updateDeleteTarget,
    pending: () =>
      controller.mutations.deleteMutation.isPending || (overrides?.removePending?.() ?? false),
    confirm: confirmDelete,
    title: overrides?.removeTitle,
    description: overrides?.removeDescription,
    confirmLabel: overrides?.removeConfirmLabel,
  }
  const paste: ExplorerPasteDialog = {
    open: controller.paste.open,
    data: controller.paste.data,
    pending: () => controller.mutations.pasteMutation.isPending,
    error: () => (controller.mutations.pasteMutation.error as Error | undefined) ?? null,
    existingFiles: controller.paste.existingFiles,
    submit: controller.paste.submit,
    close: controller.paste.close,
  }
  const createFile: FileBrowserCreateFileDialog = {
    open: () => actionDialog()?.kind === 'create-file',
    submit: submitCreateFile,
    cancel: closeCreateFile,
    pending: () => controller.mutations.createFileMutation.isPending,
    error: () => controller.mutations.createFileMutation.error,
    exists: fileExists,
    defaultExtension: () => (options.inKnowledgeBase() ? 'md' : 'txt'),
  }
  const createFolder: FileBrowserCreateFolderDialog = {
    open: createFolderOpen,
    submit: submitCreateFolder,
    cancel: closeCreateFolder,
    pending: () => controller.mutations.createFolderMutation.isPending,
    error: () => controller.mutations.createFolderMutation.error,
    exists: folderExists,
  }
  const copy: FileBrowserCopyDialog | undefined = options.copyEnabled
    ? {
        target: copyTarget,
        close: closeCopy,
        confirm: confirmCopy,
        pending: () => controller.mutations.copyMutation.isPending,
        error: () => controller.mutations.copyMutation.error,
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
}
