import { available, modelOwner } from 'effectweb'
import type { FileItem } from '@/lib/files/types'
import type { FileColumnScope } from '@/lib/models/settings-types'
import type { VirtualEntry } from '@/lib/files/virtual-directory'
import { getKnowledgeBaseRoot } from '@/lib/files/path-utils'
import { resetBreadcrumbFloating } from './breadcrumb-floating-store'
import { createFileBrowserDragController } from './file-browser-drag'
import { createExplorerSettings } from './explorer-settings'
import { createFileOperations } from './file-browser-mutations'
import { fileDisplaySettings } from './file-display-settings-source'
import { createInlineCreate } from './inline-create'
import { createKnowledgeBaseSearch } from './knowledge-base-search'
import { createPasteSession } from './paste-session'
import { createUploadDrop } from './upload-drop'
type Accessor<T> = () => T
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
export function createFileBrowserController(options: FileBrowserControllerOptions) {
  const settings = createExplorerSettings()
  const operations = createFileOperations({ onFileCreated: options.onFileCreated })
  const folders = () =>
    typeof options.editableFolders === 'function'
      ? options.editableFolders()
      : options.editableFolders
  const context = () => ({
    currentPath: options.currentPath(),
    files: options.files(),
    editable: options.editable(),
    inKnowledgeBase:
      getKnowledgeBaseRoot(options.currentPath(), [
        ...(available(settings.read().result)?.knowledgeBases ?? []),
      ]) !== null,
  })
  const search = createKnowledgeBaseSearch(() => ({
    currentPath: options.currentPath(),
    knowledgeBases: available(settings.read().result)?.knowledgeBases ?? [],
    active: options.isActive?.() ?? true,
  }))
  const upload = createUploadDrop(context)
  const paste = createPasteSession(context, operations, options.onFileSaved)
  const inline = createInlineCreate(
    context,
    operations,
    options.onInlineFileCreated,
    options.onInlineFolderCreated,
  )
  const moveFile = (sourcePath: string, destinationDir: string) => {
    const name = sourcePath.split(/[/\\]/).pop()!
    void operations.rename.run({
      oldPath: sourcePath,
      newPath: destinationDir ? `${destinationDir}/${name}` : name,
    })
  }
  const drag = createFileBrowserDragController({
    files: options.files,
    currentPath: options.currentPath,
    editableFolders: options.editableFolders,
    allowMoveFile: () => (options.editable() ? moveFile : undefined),
    virtualOpenTarget: (file) => options.virtualEntry?.(file)?.openTarget,
  })
  const owner = modelOwner({
    settings: settings.read(),
    operations: operations.read(),
    search: search.read(),
    upload: upload.read(),
    paste: paste.read(),
    inline: inline.read(),
    drag: drag.read(),
  })
  for (const child of [settings, operations, search, upload, paste, inline, drag])
    owner.own(child.dispose)
  owner.own(settings.source.subscribe((settings) => owner.patch({ settings })))
  owner.own(operations.source.subscribe((operations) => owner.patch({ operations })))
  owner.own(search.source.subscribe((search) => owner.patch({ search })))
  owner.own(upload.source.subscribe((upload) => owner.patch({ upload })))
  owner.own(paste.source.subscribe((paste) => owner.patch({ paste })))
  owner.own(inline.source.subscribe((inline) => owner.patch({ inline })))
  owner.own(drag.source.subscribe((drag) => owner.patch({ drag })))
  owner.own(resetBreadcrumbFloating)
  const snapshot = (
    state: ReturnType<typeof owner.read>,
    input: {
      currentPath: string
      files: FileItem[]
      editable: boolean
      editableFolders: readonly string[]
      active: boolean
    },
  ) => {
    const data = settings.snapshot(state.settings)
    const mutations = operations.snapshot(state.operations)
    const inKnowledgeBase =
      getKnowledgeBaseRoot(input.currentPath, [...data.knowledgeBases]) !== null
    const searchModel = search.snapshot(state.search, {
      currentPath: input.currentPath,
      knowledgeBases: data.knowledgeBases,
      active: input.active,
    })
    return {
      currentPath: input.currentPath,
      files: input.files,
      editable: input.editable,
      settings: data.settings,
      knowledgeBases: [...data.knowledgeBases],
      customIcons: data.customIcons,
      inKb: inKnowledgeBase,
      hasEditableFolders: input.editableFolders.length > 0,
      displaySettings: fileDisplaySettings(
        input.currentPath,
        data.settings,
        options.layout,
        mutations,
      ),
      search: searchModel,
      upload: upload.snapshot(state.upload),
      paste: paste.snapshot(state.paste, input.files),
      inline: inline.snapshot(state.inline, { ...input, inKnowledgeBase }),
      allowMoveFile: input.editable ? moveFile : undefined,
      drag: drag.snapshot(state.drag, {
        currentPath: input.currentPath,
        editableFolders: input.editableFolders,
        canMove: input.editable,
      }),
      mutations,
    }
  }
  return {
    source: owner.source,
    read: owner.read,
    dispose: owner.dispose,
    snapshot,
    operations,
    clearSearch: search.clear,
    setError: upload.setError,
    current: () =>
      snapshot(owner.read(), {
        currentPath: options.currentPath(),
        files: options.files(),
        editable: options.editable(),
        editableFolders: folders(),
        active: options.isActive?.() ?? true,
      }),
  }
}
export type FileBrowserController = ReturnType<
  ReturnType<typeof createFileBrowserController>['snapshot']
>
