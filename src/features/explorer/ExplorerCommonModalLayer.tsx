import { view, type JSX } from 'effectweb'
import type { PasteData } from '@/lib/files/paste-data'
import type { FileItem } from '@/lib/files/types'
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
import type { ExplorerRowMenu } from './explorer-row-menu'
export type { ExplorerFileRowMenuApi, ExplorerRowMenu } from './explorer-row-menu'
export type ExplorerBreadcrumbMenuActions = {
  showOpenInNewTab: boolean
  showOpenInOtherSurface: boolean
  showSetIcon: boolean
}
export type ExplorerIconDialog = {
  target: FileItem | null
  setTarget: (value: FileItem | null) => void
  customIcons: Record<string, string>
  save: (iconName: string | null) => void
  pending: boolean
}
export type ExplorerUploadNotice = { state: UploadToastState; dismiss: () => void }
export type ExplorerBreadcrumbMenu = {
  target: BreadcrumbMenuTarget | null
  setTarget: (value: BreadcrumbMenuTarget | null) => void
  availableActions: ExplorerBreadcrumbMenuActions
  openInNewTab: () => void
  openInOtherSurface: () => void
  otherSurfaceLabel?: string
  setIcon: () => void
}
export type ExplorerRenameDialog = {
  open: boolean
  target: FileItem | null
  submit: (name: string) => void
  cancel: () => void
  pending: boolean
  error: Error | null | undefined
  targetExists: (name: string) => boolean
  targetIsDirectory: boolean
}
export type ExplorerMoveDialog = {
  target: FileItem | null
  close: () => void
  filePath: string
  confirm: (destination: string) => void
  pending: boolean
  error: Error | null | undefined
}
export type ExplorerDeleteDialog = {
  target: FileItem | null
  setTarget: (value: FileItem | null) => void
  pending: boolean
  confirm: () => void
  title?: string | undefined
  description?: string | undefined
  confirmLabel?: string | undefined
}
export type ExplorerPasteDialog = {
  open: boolean
  data: PasteData | null
  pending: boolean
  error: Error | null
  existingFiles: readonly FileItem[]
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
export const ExplorerCommonModalLayer = view<ExplorerCommonModalLayerProps>((props) => {
  return (
    <>
      <IconEditorDialog
        overlayScope={props.overlayScope}
        isOpen={!!props.icon.target}
        fileName={props.icon.target?.name ?? ''}
        currentIcon={
          props.icon.target
            ? (props.icon.customIcons[props.icon.target!.path] ??
              props.icon.customIcons[props.icon.target!.path.replace(/\\/g, '/')] ??
              null)
            : null
        }
        onClose={() => props.icon.setTarget(null)}
        onSave={props.icon.save}
        isPending={props.icon.pending}
      />
      <UploadToastStack
        toastAnchor={props.overlayScope}
        state={props.upload.state}
        onDismissError={props.upload.dismiss}
      />
      <BreadcrumbContextMenu
        target={props.breadcrumbs.target}
        onDismiss={() => props.breadcrumbs.setTarget(null)}
        showOpenInNewTab={props.breadcrumbs.availableActions.showOpenInNewTab}
        onOpenInNewTab={props.breadcrumbs.openInNewTab}
        showOpenInOtherSurface={props.breadcrumbs.availableActions.showOpenInOtherSurface}
        onOpenInOtherSurface={props.breadcrumbs.openInOtherSurface}
        openInOtherSurfaceLabel={props.breadcrumbs.otherSurfaceLabel}
        showSetIcon={props.breadcrumbs.availableActions.showSetIcon}
        onSetIcon={props.breadcrumbs.setIcon}
      />
      <FileRowContextMenu model={props.rowMenu} />
      <RenameDialog
        overlayScope={props.overlayScope}
        isOpen={props.rename.open}
        itemName={props.rename.target?.name ?? ''}
        onRename={props.rename.submit}
        onCancel={props.rename.cancel}
        isPending={props.rename.pending}
        error={props.rename.error}
        nameExists={props.rename.targetExists}
        isDirectory={props.rename.targetIsDirectory}
      />
      {props.move.target ? (
        <MoveToDialog
          overlayScope={props.overlayScope}
          onClose={props.move.close}
          fileName={props.move.target!.name}
          filePath={props.move.filePath}
          onConfirm={props.move.confirm}
          isPending={props.move.pending}
          error={props.move.error}
          editableFolders={props.rowMenu.editableFolders}
        />
      ) : null}
      <DeleteFileDialog
        overlayScope={props.overlayScope}
        item={props.remove.target}
        isPending={props.remove.pending}
        onDismiss={() => props.remove.setTarget(null)}
        onConfirm={props.remove.confirm}
        title={props.remove.title}
        description={props.remove.description}
        confirmLabel={props.remove.confirmLabel}
      />
      <PasteDialog
        overlayScope={props.overlayScope}
        isOpen={props.paste.open}
        pasteData={props.paste.data}
        isPending={props.paste.pending}
        error={props.paste.error}
        existingFiles={props.paste.existingFiles}
        onPaste={props.paste.submit}
        onClose={props.paste.close}
      />
      {props.children}
    </>
  )
})
