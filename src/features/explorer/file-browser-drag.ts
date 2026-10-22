import { runDesktopOperation } from '@/desktop/operations'
import {
  getFileDragData,
  hasFileDragData,
  isCompatibleSource,
  setFileDragData,
} from '@/lib/files/file-drag-data'
import type { FileItem } from '@/lib/files/types'
import type { VirtualOpenTarget } from '@/lib/files/virtual-directory'
import { isPathEditable, parentPath } from '@/lib/files/path-utils'
import {
  finePointerDragEnabled,
  subscribeFinePointerDragEnabled,
} from '@/lib/ui/enable-fine-pointer-drag'
import { modelOwner } from 'effectweb'
type Accessor<T> = () => T
export type FileBrowserDragControllerProps = Readonly<{
  files: Accessor<FileItem[]>
  currentPath: Accessor<string>
  editableFolders: Accessor<readonly string[]> | readonly string[]
  allowMoveFile: Accessor<((sourcePath: string, destinationDir: string) => void) | undefined>
  virtualOpenTarget?: (file: FileItem) => VirtualOpenTarget | undefined
}>
function foldersFor(folders: Accessor<readonly string[]> | readonly string[]): readonly string[] {
  return typeof folders === 'function' ? folders() : folders
}
export function createFileBrowserDragController(props: FileBrowserDragControllerProps) {
  const owner = modelOwner({
    draggedPath: null as string | null,
    dragOverPath: null as string | null,
    dragAllowsMove: false,
    enableDrag: finePointerDragEnabled(),
  })
  const draggedPath = () => owner.read().draggedPath
  const dragOverPath = () => owner.read().dragOverPath
  const dragAllowsMove = () => owner.read().dragAllowsMove
  const enableDrag = () => owner.read().enableDrag
  const setDraggedPath = (draggedPath: string | null) => owner.patch({ draggedPath })
  const setDragOverPath = (dragOverPath: string | null) => owner.patch({ dragOverPath })
  const setDragAllowsMove = (dragAllowsMove: boolean) => owner.patch({ dragAllowsMove })
  owner.own(subscribeFinePointerDragEnabled((enableDrag) => owner.patch({ enableDrag })))
  const parentDirForDrop = () => parentPath(props.currentPath())
  const canDropOnParent = () =>
    !!props.allowMoveFile() &&
    !!props.currentPath() &&
    isPathEditable(parentDirForDrop(), [...foldersFor(props.editableFolders)])
  function canDropOn(targetPath: string, sourcePath?: string | null) {
    const source = sourcePath ?? draggedPath()
    if (!source || source === targetPath) return false
    return !targetPath.startsWith(source + '/')
  }
  function nativeOver(event: globalThis.DragEvent, target: string) {
    if (!window.derpDesktop || !event.dataTransfer?.types.includes('Files')) return false
    event.stopPropagation()
    if (isPathEditable(target, [...foldersFor(props.editableFolders)])) {
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    } else event.dataTransfer.dropEffect = 'none'
    return true
  }
  function nativeDrop(event: globalThis.DragEvent, target: string) {
    const desktop = window.derpDesktop
    if (!desktop || !event.dataTransfer?.files.length) return false
    event.preventDefault()
    event.stopPropagation()
    const files = Array.from(event.dataTransfer.files)
    if (isPathEditable(target, [...foldersFor(props.editableFolders)]))
      runDesktopOperation(() => desktop.importDrop(files, target))
    return true
  }
  function parentRowDragOver(event: globalThis.DragEvent) {
    if (nativeOver(event, parentDirForDrop())) return
    const move = props.allowMoveFile()
    const dataTransfer = event.dataTransfer
    if (!move || !canDropOnParent() || !dataTransfer) return
    if (!draggedPath() && !hasFileDragData(dataTransfer)) return
    if (draggedPath() && !dragAllowsMove()) return
    event.preventDefault()
    dataTransfer.dropEffect = 'move'
    setDragOverPath('__parent__')
  }
  function parentRowDragLeave(event: globalThis.DragEvent) {
    const current = event.currentTarget as Node | null
    if (
      current &&
      !current.contains(event.relatedTarget as Node) &&
      dragOverPath() === '__parent__'
    ) {
      setDragOverPath(null)
    }
  }
  function parentRowDrop(event: globalThis.DragEvent) {
    if (nativeDrop(event, parentDirForDrop())) return
    event.preventDefault()
    setDragOverPath(null)
    const move = props.allowMoveFile()
    if (!move) return
    const destination = parentPath(props.currentPath())
    const internalPath = draggedPath()
    if (internalPath) {
      if (dragAllowsMove()) move(internalPath, destination)
      return
    }
    const dataTransfer = event.dataTransfer
    if (!dataTransfer) return
    const data = getFileDragData(dataTransfer)
    if (
      data &&
      isCompatibleSource({ sourceKind: 'local' }, data) &&
      canDropOn(destination, data.path)
    ) {
      move(data.path, destination)
    }
  }
  function onFileDragStart(file: FileItem, event: globalThis.DragEvent) {
    if (window.derpDesktop && !file.isVirtual) {
      event.preventDefault()
      runDesktopOperation(() => window.derpDesktop!.drag([file.path]))
      return
    }
    const dataTransfer = event.dataTransfer
    if (!dataTransfer || !enableDrag()) return
    const canMove =
      !!props.allowMoveFile() && isPathEditable(file.path, [...foldersFor(props.editableFolders)])
    setDragAllowsMove(canMove)
    const virtualOpenTarget = props.virtualOpenTarget?.(file)
    setFileDragData(dataTransfer, {
      path: file.path,
      isDirectory: file.isDirectory,
      sourceKind: 'local',
      ...(virtualOpenTarget ? { virtualOpenTarget } : {}),
    })
    dataTransfer.effectAllowed = canMove ? 'copyMove' : 'copy'
    setDraggedPath(file.path)
  }
  function onFileDragEnd() {
    setDraggedPath(null)
    setDragOverPath(null)
    setDragAllowsMove(false)
  }
  const resetDrag = onFileDragEnd
  function onFolderDragOver(file: FileItem, event: globalThis.DragEvent) {
    if (file.isDirectory && nativeOver(event, file.path)) return
    const dataTransfer = event.dataTransfer
    if (!file.isDirectory || !props.allowMoveFile() || !dataTransfer) return
    const crossWindow = !draggedPath() && hasFileDragData(dataTransfer)
    if (!draggedPath() && !crossWindow) return
    const source = draggedPath()
    if (source && !dragAllowsMove()) return
    if (source && !canDropOn(file.path)) return
    if (!isPathEditable(file.path, [...foldersFor(props.editableFolders)])) return
    event.preventDefault()
    dataTransfer.dropEffect = 'move'
    setDragOverPath(file.path)
  }
  function onFolderDragLeave(file: FileItem, event: globalThis.DragEvent) {
    const current = event.currentTarget as Node | null
    if (current && !current.contains(event.relatedTarget as Node) && dragOverPath() === file.path) {
      setDragOverPath(null)
    }
  }
  function handleFolderRowDragOver(path: string, event: globalThis.DragEvent) {
    const file = props.files().find((candidate) => candidate.path === path)
    if (file?.isDirectory) onFolderDragOver(file, event)
  }
  function handleFolderRowDragLeave(path: string, event: globalThis.DragEvent) {
    const file = props.files().find((candidate) => candidate.path === path)
    if (file?.isDirectory) onFolderDragLeave(file, event)
  }
  function handleFolderRowDrop(path: string, event: globalThis.DragEvent) {
    const file = props.files().find((candidate) => candidate.path === path)
    if (file?.isDirectory) onFolderDrop(file, event)
  }
  function onFolderDrop(file: FileItem, event: globalThis.DragEvent) {
    if (file.isDirectory && nativeDrop(event, file.path)) return
    event.preventDefault()
    setDragOverPath(null)
    const move = props.allowMoveFile()
    if (!move || !file.isDirectory) return
    const internalPath = draggedPath()
    if (internalPath && canDropOn(file.path)) {
      if (dragAllowsMove()) move(internalPath, file.path)
      return
    }
    if (internalPath) return
    const dataTransfer = event.dataTransfer
    if (!dataTransfer) return
    const data = getFileDragData(dataTransfer)
    if (
      data &&
      isCompatibleSource({ sourceKind: 'local' }, data) &&
      canDropOn(file.path, data.path)
    ) {
      move(data.path, file.path)
    }
  }
  const events = {
    draggedPath,
    dragOverPath,
    dragAllowsMove,
    enableDrag,
    canDropOnParent,
    parentRowDragOver,
    parentRowDragLeave,
    parentRowDrop,
    onFileDragStart,
    onFileDragEnd,
    resetDrag,
    onFolderDragOver,
    onFolderDragLeave,
    onFolderDrop,
    handleFolderRowDragOver,
    handleFolderRowDragLeave,
    handleFolderRowDrop,
  }
  return {
    source: owner.source,
    read: owner.read,
    dispose: owner.dispose,
    snapshot: (
      state: ReturnType<typeof owner.read>,
      input: { currentPath: string; editableFolders: readonly string[]; canMove: boolean },
    ) => ({
      ...events,
      draggedPath: state.draggedPath,
      dragOverPath: state.dragOverPath,
      dragAllowsMove: state.dragAllowsMove,
      enableDrag: state.enableDrag,
      canDropOnParent:
        input.canMove &&
        !!input.currentPath &&
        isPathEditable(parentPath(input.currentPath), [...input.editableFolders]),
    }),
  }
}
