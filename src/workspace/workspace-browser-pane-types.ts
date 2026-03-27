import type { FileItem } from '@/lib/types'
import type { PersistedWorkspaceState, WorkspaceSource } from '@/lib/use-workspace'
import type { Accessor } from 'solid-js'
import type { FileIconContext } from '../lib/use-file-icon'

export type WorkspaceShareConfig = { token: string; sharePath: string }

export type WorkspaceBrowserPaneProps = {
  windowId: string
  workspace: Accessor<PersistedWorkspaceState | null>
  sharePanel: Accessor<WorkspaceShareConfig | null>
  fileIconContext: () => FileIconContext
  shareAllowUpload?: boolean
  shareCanEdit?: boolean
  shareCanDelete?: boolean
  shareIsKnowledgeBase?: boolean
  editableFolders: string[]
  onNavigateDir: (windowId: string, dir: string) => void
  onOpenViewer: (windowId: string, file: FileItem) => void
  onAddToTaskbar: (file: FileItem) => void
  onOpenInNewTab?: (
    windowId: string,
    file: { path: string; isDirectory: boolean; isVirtual?: boolean },
    currentPath: string,
  ) => void
  onOpenInSplitView?: (windowId: string, file: FileItem) => void
  onRequestPlay?: (source: WorkspaceSource, path: string, dir?: string) => void
}
