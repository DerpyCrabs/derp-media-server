import { createMemo, onCleanup, type Accessor } from 'solid-js'
import type { FileItem } from '@/lib/files/types'
import type { FileColumnScope } from '@/lib/models/settings-types'
import type { VirtualEntry } from '@/lib/files/virtual-directory'
import { resetBreadcrumbFloating } from './breadcrumb-floating-store'
import { createFileBrowserDragController } from './file-browser-drag'
import { useExplorerSettings } from './use-explorer-settings'
import { useFileBrowserMutations } from './use-file-browser-mutations'
import { useFileDisplaySettings } from './use-file-display-settings'
import { useInlineCreate } from './use-inline-create'
import { useKnowledgeBaseSearch } from './use-knowledge-base-search'
import { usePasteSession } from './use-paste-session'
import { useUploadDrop } from './use-upload-drop'

export type FileBrowserControllerOptions = Readonly<{
  currentPath: Accessor<string>
  layout: FileColumnScope
  files: Accessor<FileItem[]>
  editable: Accessor<boolean>
  editableFolders: Accessor<readonly string[]> | readonly string[]
  isActive?: Accessor<boolean>
  virtualEntry?: (file: FileItem) => VirtualEntry | undefined
  onFileCreated?: (path: string) => void
  onFileSaved?: (path: string) => void
  onInlineFileCreated?: (path: string) => void
  onInlineFolderCreated?: (path: string) => void
}>

export function useFileBrowserController(options: FileBrowserControllerOptions) {
  const { settingsQuery, knowledgeBases, customIcons } = useExplorerSettings()
  const currentPath = options.currentPath
  const hasEditableFolders = createMemo(() => {
    const folders =
      typeof options.editableFolders === 'function'
        ? options.editableFolders()
        : options.editableFolders
    return folders.length > 0
  })

  const mutations = useFileBrowserMutations({
    onFileCreated: options.onFileCreated,
  })
  const { moveMutation, createFileMutation, createFolderMutation, pasteMutation } = mutations
  const search = useKnowledgeBaseSearch({ currentPath, knowledgeBases, active: options.isActive })
  const upload = useUploadDrop({ currentPath, editable: options.editable })
  const paste = usePasteSession({
    currentPath,
    files: options.files,
    editable: options.editable,
    inKnowledgeBase: search.active,
    mutation: pasteMutation,
    onSaved: options.onFileSaved,
  })
  const inline = useInlineCreate({
    currentPath,
    files: options.files,
    editable: options.editable,
    inKnowledgeBase: search.active,
    createFileMutation,
    createFolderMutation,
    onFileCreated: options.onInlineFileCreated,
    onFolderCreated: options.onInlineFolderCreated,
  })

  function moveFile(sourcePath: string, destinationDir: string) {
    const fileName = sourcePath.split(/[/\\]/).pop()!
    const newPath = destinationDir ? `${destinationDir}/${fileName}` : fileName
    moveMutation.mutate({ oldPath: sourcePath, newPath })
  }

  const allowMoveFile = createMemo(() => (options.editable() ? moveFile : undefined))
  const drag = createFileBrowserDragController({
    files: options.files,
    currentPath,
    editableFolders: options.editableFolders,
    allowMoveFile,
    virtualOpenTarget: (file) => options.virtualEntry?.(file)?.openTarget,
  })
  onCleanup(resetBreadcrumbFloating)

  const displaySettings = useFileDisplaySettings(currentPath, settingsQuery, options.layout)

  return {
    currentPath,
    files: options.files,
    editable: options.editable,
    settingsQuery,
    knowledgeBases,
    customIcons,
    inKb: search.active,
    hasEditableFolders,
    displaySettings,
    search,
    upload,
    paste,
    inline,
    allowMoveFile,
    drag,
    mutations,
  }
}

export type FileBrowserController = ReturnType<typeof useFileBrowserController>
