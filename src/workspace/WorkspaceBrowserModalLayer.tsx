import type { PasteData } from '@/lib/paste-data'
import type { ShareLink } from '@/lib/shares'
import type { FileItem } from '@/lib/types'
import type { Accessor } from 'solid-js'
import type { WorkspaceFileOpenTarget } from '@/lib/workspace-file-open-target'
import type { VirtualCapability, VirtualEntry } from '@/lib/virtual-directory'
import { For, Show } from 'solid-js'
import type { BreadcrumbMenuTarget } from '../file-browser/BreadcrumbContextMenu'
import { BreadcrumbContextMenu } from '../file-browser/BreadcrumbContextMenu'
import { DeleteFileDialog } from '../file-browser/DeleteFileDialog'
import { modalDialogBackdropClass } from '../file-browser/modal-overlay-scope'
import { FileRowContextMenu } from '../file-browser/FileRowContextMenu'
import { IconEditorDialog } from '../file-browser/IconEditorDialog'
import { MoveToDialog } from '../file-browser/MoveToDialog'
import { PasteDialog } from '../file-browser/PasteDialog'
import { RenameDialog } from '../file-browser/RenameDialog'
import { ShareDialog } from '../file-browser/ShareDialog'
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
  onAddToTaskbar?: (file: FileItem) => void
  onFileRowRename?: (file: FileItem) => void
  onFileRowMove?: (file: FileItem) => void
  onSetRowIcon?: (file: FileItem) => void
  onOpenInNewTabFromRow?: (file: FileItem) => void
  openInNewTabLabel?: string
  showOpenInNewTabForFiles: boolean
  onOpenInSplitViewFromRow?: (file: FileItem) => void
  onOpenInMediaServer?: (file: FileItem) => void
  onOpenWithBrowser?: (file: FileItem) => void
  onOpenWithReader?: (file: FileItem) => void
  onContextDownload: (file: FileItem) => void
  /** Admin workspace: create / manage share links (same as main file browser). */
  shareDialogTarget?: Accessor<FileItem | null>
  setShareDialogTarget?: (v: FileItem | null) => void
  onContextShare?: (file: FileItem) => void
  getPathHasShare?: (file: FileItem) => boolean
  shareDialogIsEditable?: Accessor<boolean>
  shareDialogExistingShares?: Accessor<ShareLink[]>
  shareLinkBaseForDialog?: Accessor<string>
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
  revokeSharePending?: boolean
  onConfirmDelete: () => void
  deleteTitle?: string
  deleteDescription?: string
  deleteConfirmLabel?: string
  showCreateFolder: Accessor<boolean>
  setShowCreateFolder: (v: boolean) => void
  newFolderName: Accessor<string>
  setNewFolderName: (v: string) => void
  submitCreateFolder: () => void
  createFolderPending: boolean
  createFolderIsError: boolean
  createFolderError: Error | undefined
  folderExists: Accessor<boolean>
  virtualProjectForm?: Accessor<boolean>
  projectPrimaryPath?: Accessor<string>
  setProjectPrimaryPath?: (v: string) => void
  projectAdditionalPaths?: Accessor<string>
  setProjectAdditionalPaths?: (v: string) => void
  gatewayPickerPath?: Accessor<string>
  setGatewayPickerPath?: (v: string) => void
  gatewayDirectoryEntries?: Accessor<{ name: string; path: string; isDirectory: boolean }[]>
  gatewayDirectoryError?: Accessor<string | undefined>
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
  pasteExistingFiles: Accessor<FileItem[]>
  onPasteFileSubmit: (
    fileName: string,
    mode: 'create' | 'replace',
    expectedVersion?: number,
  ) => void
  closePasteDialog: () => void
  uploadToast: Accessor<UploadToastState>
  setUploadToastHidden: () => void
  onCopyShareLink?: (file: FileItem) => void
  onPickNewTabTarget?: () => void
  workspaceDefaultFileOpen?: Accessor<WorkspaceFileOpenTarget>
  onOpenFileInNewWindow?: (file: FileItem) => void
  getVirtualEntry?: (file: FileItem) => VirtualEntry | undefined
  onVirtualAction?: (action: VirtualCapability, file: FileItem) => void
}

export function WorkspaceBrowserModalLayer(props: WorkspaceBrowserModalLayerProps) {
  return (
    <>
      <IconEditorDialog
        overlayScope='window'
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
        openInWorkspaceLabel='Open in Media Server'
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
        openInNewTabLabel={props.openInNewTabLabel}
        showOpenInNewTabForFiles={props.showOpenInNewTabForFiles}
        onOpenInSplitView={props.onOpenInSplitViewFromRow}
        onOpenInWorkspace={props.onOpenInMediaServer}
        onOpenWithBrowser={props.onOpenWithBrowser}
        onOpenWithReader={props.onOpenWithReader}
        openInWorkspaceLabel='Open in Media Server'
        onToggleKnowledgeBase={props.onContextToggleKnowledgeBase}
        isKnowledgeBase={props.isRowKnowledgeBase}
        onShare={props.onContextShare}
        onCopyShareLink={props.onCopyShareLink}
        getPathHasShare={props.getPathHasShare}
        onPickNewTabTarget={props.onPickNewTabTarget}
        workspaceDefaultFileOpen={props.workspaceDefaultFileOpen}
        onOpenFileInNewWindow={props.onOpenFileInNewWindow}
        getVirtualEntry={props.getVirtualEntry}
        onVirtualAction={props.onVirtualAction}
      />
      <Show when={props.onContextShare}>
        <ShareDialog
          overlayScope='window'
          isOpen={!!props.shareDialogTarget?.()}
          onClose={() => props.setShareDialogTarget?.(null)}
          filePath={props.shareDialogTarget?.()?.path ?? ''}
          fileName={props.shareDialogTarget?.()?.name ?? ''}
          isDirectory={props.shareDialogTarget?.()?.isDirectory ?? false}
          isEditable={props.shareDialogIsEditable?.() ?? false}
          existingShares={props.shareDialogExistingShares?.() ?? []}
          shareLinkBase={props.shareLinkBaseForDialog?.() ?? ''}
        />
      </Show>
      <RenameDialog
        overlayScope='window'
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
          overlayScope='window'
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
        overlayScope='window'
        item={props.deleteTarget}
        isPending={props.deletePending || !!props.revokeSharePending}
        onDismiss={() => props.setDeleteTarget(null)}
        onConfirm={props.onConfirmDelete}
        title={props.deleteTitle}
        description={props.deleteDescription}
        confirmLabel={props.deleteConfirmLabel}
      />

      <Show when={props.showCreateFolder()}>
        <div
          data-no-window-drag
          class={modalDialogBackdropClass('window')}
          role='presentation'
          onClick={() => props.setShowCreateFolder(false)}
        >
          <div
            role='dialog'
            aria-modal='true'
            aria-labelledby='workspace-create-folder-title'
            class='bg-card max-h-[calc(100%-1rem)] w-full max-w-sm overflow-y-auto rounded-lg border border-border p-4 shadow-lg'
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id='workspace-create-folder-title' class='text-base font-semibold'>
              {props.virtualProjectForm?.() ? 'Create Hermes project' : 'Create folder'}
            </h2>
            <form
              class='mt-3 space-y-2.5'
              onSubmit={(e) => {
                e.preventDefault()
                props.submitCreateFolder()
              }}
            >
              <input
                type='text'
                class='mt-0 h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm'
                placeholder={props.virtualProjectForm?.() ? 'Project name' : 'Folder name'}
                value={props.newFolderName()}
                onInput={(e) => props.setNewFolderName((e.currentTarget as HTMLInputElement).value)}
              />
              <Show when={props.virtualProjectForm?.()}>
                <label class='block space-y-1 text-xs text-muted-foreground'>
                  <span>Primary directory</span>
                  <input
                    type='text'
                    class='h-8 w-full rounded-md border border-input bg-background px-2.5 text-sm text-foreground'
                    placeholder='/existing/gateway/path'
                    value={props.projectPrimaryPath?.() ?? ''}
                    onInput={(e) => props.setProjectPrimaryPath?.(e.currentTarget.value)}
                  />
                </label>
                <details class='rounded-md border border-border px-2.5 py-1.5 text-xs'>
                  <summary class='cursor-pointer text-muted-foreground'>
                    Additional directories
                  </summary>
                  <textarea
                    class='mt-2 min-h-14 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground'
                    placeholder='One gateway path per line'
                    value={props.projectAdditionalPaths?.() ?? ''}
                    onInput={(e) => props.setProjectAdditionalPaths?.(e.currentTarget.value)}
                  />
                </details>
                <details class='rounded-md border border-border px-2.5 py-1.5 text-xs'>
                  <summary class='cursor-pointer text-muted-foreground'>
                    Browse gateway directories
                  </summary>
                  <div class='mt-2 space-y-2'>
                    <div class='flex items-center justify-between gap-2'>
                      <span class='truncate text-xs text-muted-foreground'>
                        Gateway: {props.gatewayPickerPath?.() || '(gateway cwd)'}
                      </span>
                      <Show when={props.gatewayPickerPath?.()}>
                        <button
                          type='button'
                          class='h-7 rounded border border-input px-2 text-xs'
                          onClick={() =>
                            props.setProjectPrimaryPath?.(props.gatewayPickerPath?.() ?? '')
                          }
                        >
                          Use current
                        </button>
                      </Show>
                    </div>
                    <Show when={props.gatewayDirectoryError?.()}>
                      <p class='text-destructive text-xs'>{props.gatewayDirectoryError?.()}</p>
                    </Show>
                    <div class='max-h-28 overflow-auto'>
                      <For each={props.gatewayDirectoryEntries?.() ?? []}>
                        {(entry) => (
                          <Show when={entry.isDirectory}>
                            <button
                              type='button'
                              class='block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-muted'
                              onDblClick={() => props.setGatewayPickerPath?.(entry.path)}
                              onClick={() => props.setProjectPrimaryPath?.(entry.path)}
                            >
                              {entry.name}
                            </button>
                          </Show>
                        )}
                      </For>
                    </div>
                  </div>
                </details>
              </Show>
              <Show when={props.folderExists()}>
                <p class='text-sm text-amber-600'>A folder with this name already exists.</p>
              </Show>
              <Show when={props.createFolderIsError}>
                <p class='text-destructive text-sm'>
                  {props.createFolderError?.message ?? 'Create failed'}
                </p>
              </Show>
              <div class='sticky bottom-0 -mx-1 flex justify-end gap-2 bg-card px-1 pt-1'>
                <button
                  type='button'
                  class='h-8 rounded-md border border-input px-3 text-sm'
                  onClick={() => props.setShowCreateFolder(false)}
                >
                  Cancel
                </button>
                <button
                  type='submit'
                  class='bg-primary text-primary-foreground hover:bg-primary/90 h-8 rounded-md px-3 text-sm disabled:opacity-50'
                  disabled={
                    props.createFolderPending ||
                    !props.newFolderName().trim() ||
                    (!!props.virtualProjectForm?.() && !props.projectPrimaryPath?.().trim()) ||
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
          class={modalDialogBackdropClass('window')}
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
                ? 'Enter a note name. A .md extension will be added unless it already ends in .md.'
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
        overlayScope='window'
        isOpen={props.showPasteDialog()}
        pasteData={props.pasteData()}
        isPending={props.pastePending}
        error={props.pasteError}
        existingFiles={props.pasteExistingFiles()}
        onPaste={props.onPasteFileSubmit}
        onClose={props.closePasteDialog}
      />

      <UploadToastStack
        toastAnchor='window'
        state={props.uploadToast}
        onDismissError={props.setUploadToastHidden}
      />
    </>
  )
}
