import type { FileItem } from '@/lib/types'
import type { VirtualOpenTarget } from '@/lib/virtual-directory'
import type { PersistedWorkspaceState, WorkspaceSource } from '@/lib/use-workspace'
import type { Accessor } from 'solid-js'
import type { FileIconContext } from '../lib/use-file-icon'

export type WorkspaceBrowserPaneProps = {
  windowId: string
  workspace: Accessor<PersistedWorkspaceState | null>
  fileIconContext: () => FileIconContext
  editableFolders: string[]
  onNavigateDir: (windowId: string, dir: string) => void
  onOpenViewer: (windowId: string, file: FileItem) => void
  onOpenReader: (windowId: string, file: FileItem) => void
  onOpenVirtualTarget?: (windowId: string, file: FileItem, target: VirtualOpenTarget) => void
  onAddToTaskbar?: (file: FileItem) => void
  onOpenInNewTab?: (
    windowId: string,
    file: { path: string; isDirectory: boolean; isVirtual?: boolean },
    currentPath: string,
  ) => void
  openInNewTabLabel?: string
  onOpenInSplitView?: (windowId: string, file: FileItem) => void
  onRequestPlay?: (source: WorkspaceSource, path: string, dir?: string) => void
  onBeginFileOpenTargetPick?: () => void
  onOpenFileInNewFloatingWindow?: (windowId: string, file: FileItem) => void
}
