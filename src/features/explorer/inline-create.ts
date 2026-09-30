import { modelOwner } from 'effectweb'
import { normalizeNewFilePath } from '@/lib/files/new-file-name'
import type { FileItem } from '@/lib/files/types'
import type { FileOperations } from './file-browser-mutations'
type Context = {
  currentPath: string
  files: readonly FileItem[]
  editable: boolean
  inKnowledgeBase: boolean
}
export function createInlineCreate(
  context: () => Context,
  operations: FileOperations,
  onFileCreated?: (path: string) => void,
  onFolderCreated?: (path: string) => void,
) {
  const owner = modelOwner({ mode: null as 'file' | 'folder' | null, name: '' })
  const reset = () => {
    owner.patch({ mode: null, name: '' })
    operations.createFile.reset()
    operations.createFolder.reset()
  }
  const snapshot = (state: ReturnType<typeof owner.read>, input: Context) => {
    const visible = input.editable && input.inKnowledgeBase
    const name = state.name.trim()
    const finalName = normalizeNewFilePath(name, input.inKnowledgeBase).toLowerCase()
    const fileExists =
      state.mode === 'file' &&
      !!name &&
      input.files.some((file) => !file.isDirectory && file.name.toLowerCase() === finalName)
    const folderExists =
      state.mode === 'folder' &&
      !!name &&
      input.files.some((file) => file.isDirectory && file.name.toLowerCase() === name.toLowerCase())
    return {
      mode: state.mode,
      name: state.name,
      visible: visible,
      fileExists: fileExists,
      folderExists: folderExists,
      setMode: (mode: 'file' | 'folder' | null) => owner.patch({ mode }),
      setName: (name: string | ((previous: string) => string)) =>
        owner.edit('name', (previous) => (typeof name === 'function' ? name(previous) : name)),
      reset,
      submitFile,
      submitFolder,
    }
  }
  function submitFile() {
    const input = context(),
      state = owner.read(),
      projected = snapshot(state, input),
      name = state.name.trim()
    if (!name || projected.fileExists || !projected.visible) return
    const path = normalizeNewFilePath(
      input.currentPath ? `${input.currentPath}/${name}` : name,
      input.inKnowledgeBase,
    )
    operations.createFile.run({ path, content: '' }, () => {
      reset()
      onFileCreated?.(path)
    })
  }
  function submitFolder() {
    const input = context(),
      state = owner.read(),
      projected = snapshot(state, input),
      name = state.name.trim()
    if (!name || projected.folderExists || !projected.visible) return
    const path = input.currentPath ? `${input.currentPath}/${name}` : name
    operations.createFolder.run({ path }, () => {
      reset()
      onFolderCreated?.(path)
    })
  }
  return { source: owner.source, read: owner.read, dispose: owner.dispose, snapshot, reset }
}
