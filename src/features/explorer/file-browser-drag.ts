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
import { createMemo, createSignal, onMount, type Accessor } from 'solid-js'

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
  const [draggedPath, setDraggedPath] = createSignal<string | null>(null)
  const [dragOverPath, setDragOverPath] = createSignal<string | null>(null)
  const [dragAllowsMove, setDragAllowsMove] = createSignal(false)
  const [enableDrag, setEnableDrag] = createSignal(finePointerDragEnabled())
  const parentDirForDrop = createMemo(() => parentPath(props.currentPath()))
  const canDropOnParent = createMemo(
    () =>
      !!props.allowMoveFile() &&
      !!props.currentPath() &&
      isPathEditable(parentDirForDrop(), [...foldersFor(props.editableFolders)]),
  )

  onMount(() => {
    setEnableDrag(finePointerDragEnabled())
    return subscribeFinePointerDragEnabled(setEnableDrag)
  })

  function canDropOn(targetPath: string, sourcePath?: string | null) {
    const source = sourcePath ?? draggedPath()
    if (!source || source === targetPath) return false
    return !targetPath.startsWith(source + '/')
  }

  function parentRowDragOver(event: globalThis.DragEvent) {
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

  return {
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
}
