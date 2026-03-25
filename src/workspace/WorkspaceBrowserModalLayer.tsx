import type { PasteData } from '@/lib/paste-data'
import type { FileItem } from '@/lib/types'
import type { Accessor } from 'solid-js'
import { Show } from 'solid-js'
import type { BreadcrumbMenuTarget } from '../file-browser/BreadcrumbContextMenu'
import { BreadcrumbContextMenu } from '../file-browser/BreadcrumbContextMenu'
import { DeleteFileDialog } from '../file-browser/DeleteFileDialog'
import { FileRowContextMenu } from '../file-browser/FileRowContextMenu'
import { IconEditorDialog } from '../file-browser/IconEditorDialog'
import { MoveToDialog } from '../file-browser/MoveToDialog'
import { PasteDialog } from '../file-browser/PasteDialog'
import { RenameDialog } from '../file-browser/RenameDialog'
import type { UploadToastState } from '../file-browser/types'
import { UploadToastStack } from '../file-browser/UploadToastStack'

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

export type WorkspaceBrowserModalLayerProps = {
  iconEditTarget: Accessor<FileItem | null>
  setIconEditTarget: (v: FileItem | null) => void
  workspaceCustomIcons: Accessor<Record<string, string>>
  onSaveWorkspaceCustomIcon: (iconName: string | null) => void
  setCustomIconPending: boolean
  removeCustomIconPending: boolean
  breadcrumbMenu: Accessor<BreadcrumbMenuTarget | null>
  setBreadcrumbMenu: (v: BreadcrumbMenuTarget | null) => void
  workspaceBreadcrumbMenuActions: Accessor<BreadcrumbMenuActions>
  onWorkspaceBreadcrumbOpenInNewTab: () => void
  onWorkspaceBreadcrumbOpenInWorkspace: () => void
  onWorkspaceBreadcrumbSetIcon: () => void
  fileRowMenu: FileRowMenuApi
  editableFoldersList: string[]
  isContextDirEditable: Accessor<boolean>
  shareDeleteGated: Accessor<boolean>
  shareCanDelete: boolean
  onAddToTaskbar: (file: FileItem) => void
  onFileRowRename?: (file: FileItem) => void
  onFileRowMove?: (file: FileItem) => void
  onSetRowIcon?: (file: FileItem) => void
  onOpenInNewTabFromRow?: (file: FileItem) => void
  showOpenInNewTabForFiles: boolean
  onContextDownload: (file: FileItem) => void
  /** Admin workspace only; toggles folder as knowledge base (same as main file browser). */
  onContextToggleKnowledgeBase?: (file: FileItem) => void
  isRowKnowledgeBase?: (file: FileItem) => boolean
  showRename: Accessor<boolean>
  renamingItem: Accessor<FileItem | null>
  renameNewName: Accessor<string>
  setRenameNewName: (v: string) => void
  submitRename: () => void
  cancelRename: () => void
  renamePending: boolean
  renameError: Error | undefined
  renameTargetExists: Accessor<boolean>
  moveTarget: Accessor<FileItem | null>
  closeMoveDialog: () => void
  moveDialogFilePath: Accessor<string>
  confirmMoveTo: (dest: string) => void
  movePending: boolean
  moveError: Error | undefined
  shareToken: Accessor<string | undefined>
  shareRootPath: Accessor<string | undefined>
  deleteTarget: Accessor<FileItem | null>
  setDeleteTarget: (v: FileItem | null) => void
  deletePending: boolean
  onConfirmDelete: () => void
  showCreateFolder: Accessor<boolean>
  setShowCreateFolder: (v: boolean) => void
  newFolderName: Accessor<string>
  setNewFolderName: (v: string) => void
  submitCreateFolder: () => void
  createFolderPending: boolean
  createFolderIsError: boolean
  createFolderError: Error | undefined
  folderExists: Accessor<boolean>
  showCreateFile: Accessor<boolean>
  setShowCreateFile: (v: boolean) => void
  newFileName: Accessor<string>
  setNewFileName: (v: string) => void
  submitCreateFile: () => void
  createFilePending: boolean
  createFileIsError: boolean
  createFileError: Error | undefined
  fileExists: Accessor<boolean>
  inKb: Accessor<boolean>
  showPasteDialog: Accessor<boolean>
  pasteData: Accessor<PasteData | null>
  pastePending: boolean
  pasteError: Error | null
  pasteExistingLowerNames: Accessor<string[]>
  onPasteFileSubmit: (fileName: string) => void
  closePasteDialog: () => void
  uploadToast: Accessor<UploadToastState>
  setUploadToastHidden: () => void
}

export function WorkspaceBrowserModalLayer(props: WorkspaceBrowserModalLayerProps) {
  return (
    <>
      <IconEditorDialog
        isOpen={!!props.iconEditTarget()}
        fileName={props.iconEditTarget()?.name ?? ''}
        currentIcon={
          props.iconEditTarget()
            ? (props.workspaceCustomIcons()[props.iconEditTarget()!.path] ??
              props.workspaceCustomIcons()[props.iconEditTarget()!.path.replace(/\\/g, '/')] ??
              null)
            : null
        }
        onClose={() => props.setIconEditTarget(null)}
        onSave={props.onSaveWorkspaceCustomIcon}
        isPending={props.setCustomIconPending || props.removeCustomIconPending}
      />
      <BreadcrumbContextMenu
        target={props.breadcrumbMenu}
        onDismiss={() => props.setBreadcrumbMenu(null)}
        showOpenInNewTab={props.workspaceBreadcrumbMenuActions().showOpenInNewTab}
        onOpenInNewTab={props.onWorkspaceBreadcrumbOpenInNewTab}
        showOpenInWorkspace={props.workspaceBreadcrumbMenuActions().showOpenInWorkspace}
        onOpenInWorkspace={props.onWorkspaceBreadcrumbOpenInWorkspace}
        showSetIcon={props.workspaceBreadcrumbMenuActions().showSetIcon}
        onSetIcon={props.onWorkspaceBreadcrumbSetIcon}
      />
      <FileRowContextMenu
        menu={props.fileRowMenu.menu}
        editableFolders={() => props.editableFoldersList}
        isCurrentDirEditable={props.isContextDirEditable}
        hasEditableFolders={() => props.editableFoldersList.length > 0}
        shareDeleteGated={props.shareDeleteGated}
        shareCanDelete={() => !!props.shareCanDelete}
        onDismiss={props.fileRowMenu.dismiss}
        onDownload={props.onContextDownload}
        onDelete={props.fileRowMenu.confirmDelete}
        onAddToTaskbar={props.onAddToTaskbar}
        onRename={props.onFileRowRename}
        onMove={props.onFileRowMove}
        onSetIcon={props.onSetRowIcon}
        onOpenInNewTab={props.onOpenInNewTabFromRow}
        showOpenInNewTabForFiles={props.showOpenInNewTabForFiles}
        onToggleKnowledgeBase={props.onContextToggleKnowledgeBase}
        isKnowledgeBase={props.isRowKnowledgeBase}
      />
      <RenameDialog
        isOpen={props.showRename()}
        itemName={props.renamingItem()?.name ?? ''}
        newName={props.renameNewName()}
        onNewNameChange={props.setRenameNewName}
        onRename={props.submitRename}
        onCancel={props.cancelRename}
        isPending={props.renamePending}
        error={props.renameError}
        nameExists={props.renameTargetExists()}
        isDirectory={props.renamingItem()?.isDirectory ?? false}
      />
      <Show when={props.moveTarget()}>
        <MoveToDialog
          onClose={props.closeMoveDialog}
          fileName={props.moveTarget()!.name}
          filePath={props.moveDialogFilePath()}
          onConfirm={props.confirmMoveTo}
          isPending={props.movePending}
          error={props.moveError}
          editableFolders={props.editableFoldersList}
          shareToken={props.shareToken()}
          shareRootPath={props.shareRootPath()}
        />
      </Show>
      <DeleteFileDialog
        item={props.deleteTarget}
        isPending={props.deletePending}
        onDismiss={() => props.setDeleteTarget(null)}
        onConfirm={props.onConfirmDelete}
      />

      <Show when={props.showCreateFolder()}>
        <div
          data-no-window-drag
          class='fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4'
          role='presentation'
          onClick={() => props.setShowCreateFolder(false)}
        >
          <div
            role='dialog'
            aria-modal='true'
            aria-labelledby='workspace-create-folder-title'
            class='bg-card w-full max-w-md rounded-lg border border-border p-6 shadow-lg'
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id='workspace-create-folder-title' class='text-lg font-semibold'>
              Create folder
            </h2>
            <form
              class='mt-4 space-y-4'
              onSubmit={(e) => {
                e.preventDefault()
                props.submitCreateFolder()
              }}
            >
              <input
                type='text'
                class='mt-0 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
                placeholder='Folder name'
                value={props.newFolderName()}
                onInput={(e) => props.setNewFolderName((e.currentTarget as HTMLInputElement).value)}
              />
              <Show when={props.folderExists()}>
                <p class='text-sm text-amber-600'>A folder with this name already exists.</p>
              </Show>
              <Show when={props.createFolderIsError}>
                <p class='text-destructive text-sm'>
                  {props.createFolderError?.message ?? 'Create failed'}
                </p>
              </Show>
              <div class='flex justify-end gap-2'>
                <button
                  type='button'
                  class='h-9 rounded-md border border-input px-4 text-sm'
                  onClick={() => props.setShowCreateFolder(false)}
                >
                  Cancel
                </button>
                <button
                  type='submit'
                  class='bg-primary text-primary-foreground hover:bg-primary/90 h-9 rounded-md px-4 text-sm disabled:opacity-50'
                  disabled={
                    props.createFolderPending ||
                    !props.newFolderName().trim() ||
                    props.folderExists()
                  }
                >
                  {props.createFolderPending ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </Show>

      <Show when={props.showCreateFile()}>
        <div
          data-no-window-drag
          class='fixed inset-0 z-60 flex items-center justify-center bg-black/50 p-4'
          role='presentation'
          onClick={() => props.setShowCreateFile(false)}
        >
          <div
            role='dialog'
            aria-modal='true'
            aria-labelledby='workspace-create-file-title'
            class='bg-card w-full max-w-md rounded-lg border border-border p-6 shadow-lg'
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id='workspace-create-file-title' class='text-lg font-semibold'>
              Create New File
            </h2>
            <p class='text-muted-foreground mt-1 text-sm'>
              {props.inKb()
                ? 'Enter a name. A .md extension will be added if none is provided.'
                : 'Enter a name. A .txt extension will be added if none is provided.'}
            </p>
            <input
              type='text'
              class='mt-4 w-full rounded-md border border-input bg-background px-3 py-2 text-sm'
              placeholder={
                props.inKb() ? 'File name (e.g., notes.md)' : 'File name (e.g., notes.txt)'
              }
              value={props.newFileName()}
              onInput={(e) => props.setNewFileName((e.currentTarget as HTMLInputElement).value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && props.newFileName().trim() && !props.fileExists())
                  props.submitCreateFile()
              }}
            />
            <Show when={props.fileExists()}>
              <p class='mt-2 text-sm text-amber-600'>A file with this name already exists.</p>
            </Show>
            <Show when={props.createFileIsError}>
              <p class='text-destructive mt-2 text-sm'>
                {props.createFileError?.message ?? 'Create failed'}
              </p>
            </Show>
            <div class='mt-6 flex justify-end gap-2'>
              <button
                type='button'
                class='h-9 rounded-md border border-input px-4 text-sm'
                onClick={() => props.setShowCreateFile(false)}
              >
                Cancel
              </button>
              <button
                type='button'
                class='bg-primary text-primary-foreground hover:bg-primary/90 h-9 rounded-md px-4 text-sm disabled:opacity-50'
                disabled={
                  props.createFilePending || !props.newFileName().trim() || props.fileExists()
                }
                onClick={() => props.submitCreateFile()}
              >
                {props.createFilePending ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
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

      <UploadToastStack state={props.uploadToast} onDismissError={props.setUploadToastHidden} />
    </>
  )
}
