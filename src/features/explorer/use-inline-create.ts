import { createMemo, createSignal, type Accessor } from 'solid-js'
import { normalizeNewFilePath } from '@/lib/files/new-file-name'
import type { FileItem } from '@/lib/files/types'
import type { useFileBrowserMutations } from './use-file-browser-mutations'

type Mutations = ReturnType<typeof useFileBrowserMutations>

export function useInlineCreate(options: {
  currentPath: Accessor<string>
  files: Accessor<FileItem[]>
  editable: Accessor<boolean>
  inKnowledgeBase: Accessor<boolean>
  createFileMutation: Mutations['createFileMutation']
  createFolderMutation: Mutations['createFolderMutation']
  onFileCreated?: (path: string) => void
  onFolderCreated?: (path: string) => void
}) {
  const [mode, setMode] = createSignal<'file' | 'folder' | null>(null)
  const [name, setName] = createSignal('')
  const visible = createMemo(() => options.editable() && options.inKnowledgeBase())
  const fileExists = createMemo(() => {
    if (mode() !== 'file') return false
    const stem = name().trim()
    if (!stem) return false
    const finalName = normalizeNewFilePath(stem, options.inKnowledgeBase())
    return options
      .files()
      .some((file) => !file.isDirectory && file.name.toLowerCase() === finalName.toLowerCase())
  })
  const folderExists = createMemo(() => {
    if (mode() !== 'folder') return false
    const normalized = name().trim().toLowerCase()
    return (
      !!normalized &&
      options.files().some((file) => file.isDirectory && file.name.toLowerCase() === normalized)
    )
  })

  function reset() {
    setMode(null)
    setName('')
    options.createFileMutation.reset()
    options.createFolderMutation.reset()
  }

  function submitFile() {
    const stem = name().trim()
    if (!stem || fileExists() || !visible()) return
    const base = options.currentPath() ? `${options.currentPath()}/${stem}` : stem
    const path = normalizeNewFilePath(base, options.inKnowledgeBase())
    options.createFileMutation.mutate(
      { path, content: '' },
      {
        onSuccess: () => {
          reset()
          options.onFileCreated?.(path)
        },
      },
    )
  }

  function submitFolder() {
    const folderName = name().trim()
    if (!folderName || folderExists() || !visible()) return
    const path = options.currentPath() ? `${options.currentPath()}/${folderName}` : folderName
    options.createFolderMutation.mutate(
      { path },
      {
        onSuccess: () => {
          reset()
          options.onFolderCreated?.(path)
        },
      },
    )
  }

  return {
    mode,
    setMode,
    name,
    setName,
    fileExists,
    folderExists,
    visible,
    submitFile,
    submitFolder,
    reset,
  }
}
