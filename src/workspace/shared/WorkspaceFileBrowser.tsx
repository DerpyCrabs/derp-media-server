import { createMemo } from 'solid-js'
import {
  FileBrowser,
  type FileBrowserHost,
  type FileBrowserHostActions,
  type FileBrowserPresentation,
} from '@/features/explorer/FileBrowser'
import { preloadVideoIntrinsics } from '@/lib/media/video-intrinsics'
import { MediaType, type FileItem } from '@/lib/files/types'
import type { PersistedWindowState } from '@/lib/models/window-model'
import type { Accessor } from 'solid-js'
import type { FileIconContext } from '@/features/explorer/use-file-icon'
import { useStoreSync } from '@/lib/state/solid-store-sync'
import { fileOpenTargetStore } from './file-open-target'
import type { WorkspaceBrowserActions } from './workspace-window-actions'

type WorkspaceFileBrowserProps = {
  windowId: string
  windowState: Accessor<PersistedWindowState | null>
  fileIconContext: () => FileIconContext
  editableFolders: string[]
  actions: WorkspaceBrowserActions
}

export function WorkspaceFileBrowser(props: WorkspaceFileBrowserProps) {
  const windowDefinition = createMemo(() =>
    props.windowState()?.windows.find((window) => window.id === props.windowId),
  )
  const currentPath = createMemo(() => windowDefinition()?.initialState?.dir ?? '')
  const fileOpenTargetTick = useStoreSync(fileOpenTargetStore)
  const fileOpenMode = () => {
    void fileOpenTargetTick()
    return fileOpenTargetStore.getState().target
  }

  function navigate(path: string) {
    props.actions.navigate(props.windowId, path)
  }

  function openInNewTab(file: FileItem | null, sourceDir = currentPath()) {
    if (!file) {
      window.open('/', '_blank')
      return
    }
    props.actions.openInNewTab?.(
      props.windowId,
      { path: file.path, isDirectory: file.isDirectory, isVirtual: file.isVirtual },
      sourceDir,
    )
  }

  function openDefaultFile(file: FileItem, sourceDir: string) {
    if (fileOpenMode() === 'new-tab' && props.actions.openInNewTab) {
      props.actions.openInNewTab(
        props.windowId,
        { path: file.path, isDirectory: false, isVirtual: file.isVirtual },
        sourceDir,
      )
      return
    }
    props.actions.openViewer(props.windowId, file)
  }

  function openFile(file: FileItem, sourceDir: string) {
    if (file.type === MediaType.AUDIO || file.type === MediaType.VIDEO) {
      props.actions.play(props.windowId, file.path, sourceDir || undefined)
      return
    }
    openDefaultFile(file, sourceDir)
  }

  function present(request: FileBrowserPresentation) {
    if (request.kind === 'reader') {
      props.actions.openReader(props.windowId, request.file)
      return
    }
    if (request.kind === 'virtual') {
      props.actions.openVirtual(props.windowId, request.file, request.target)
      return
    }
    openFile(request.file, request.sourceDir)
  }

  function openInMediaCenter(file: FileItem | null) {
    if (file?.isVirtual) return
    const params = new URLSearchParams()
    if (file?.path) params.set('dir', file.path)
    const query = params.toString()
    window.open(query ? `/?${query}` : '/', '_blank')
  }

  const addToTaskbar = (file: FileItem) => props.actions.addToTaskbar?.(props.windowId, file)
  const openInSplitView = (file: FileItem) => props.actions.openInSplitView?.(props.windowId, file)
  const beginOpenTargetPick = () => props.actions.beginOpenTargetPick?.(props.windowId)
  const openInNewWindow = (file: FileItem) => props.actions.openInNewWindow?.(props.windowId, file)

  const browserActions: FileBrowserHostActions = {
    get openNewTab() {
      return props.actions.openInNewTab ? openInNewTab : undefined
    },
    openOtherSurface: openInMediaCenter,
    get addToTaskbar() {
      return props.actions.addToTaskbar ? addToTaskbar : undefined
    },
    get openInSplitView() {
      return props.actions.openInSplitView ? openInSplitView : undefined
    },
    get beginOpenTargetPick() {
      return fileOpenMode() === 'new-tab' && props.actions.beginOpenTargetPick
        ? beginOpenTargetPick
        : undefined
    },
    get openInNewWindow() {
      return props.actions.openInNewWindow ? openInNewWindow : undefined
    },
    fileHover: (file: FileItem) => {
      if (file.type !== MediaType.VIDEO) return
      const source = windowDefinition()?.source
      if (source) preloadVideoIntrinsics(source, file.path)
    },
    get newTabLabel() {
      return props.actions.newTabLabel
    },
    defaultFileOpen: fileOpenMode,
    otherSurfaceLabel: 'Open in Media Server',
  }

  const host: FileBrowserHost = {
    layout: 'workspace',
    currentPath,
    editableFolders: () => props.editableFolders,
    active: () => props.windowState()?.activeWindowId === props.windowId,
    iconContext: () => props.fileIconContext(),
    navigate,
    present,
    actions: browserActions,
  }

  return <FileBrowser host={host} />
}
