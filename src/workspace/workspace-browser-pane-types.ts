import type { FileItem } from '@/lib/types'
import type { ResourceSummary, ViewerId } from '@/lib/resource'
import type { VirtualOpenTarget } from '@/lib/virtual-directory'
import type { PersistedWorkspaceState, WorkspaceSource } from '@/lib/use-workspace'
import type { Accessor } from 'solid-js'
import type { OpenSurface } from '../lib/open-resource'
import type { FileIconContext } from '../lib/use-file-icon'

export type WorkspaceShareConfig = { token: string; sharePath: string }

export type WorkspaceBrowserPaneProps = {
  windowId: string
  surface?: OpenSurface
  workspace: Accessor<PersistedWorkspaceState | null>
  sharePanel: Accessor<WorkspaceShareConfig | null>
  fileIconContext: () => FileIconContext
  shareAllowUpload?: boolean
  shareCanEdit?: boolean
  shareCanDelete?: boolean
  shareIsKnowledgeBase?: boolean
  editableFolders: string[]
  onNavigateDir: (windowId: string, dir: string, resource?: ResourceSummary) => void
  onOpenViewer: (windowId: string, file: FileItem, viewerId?: ViewerId) => void
  onOpenReader: (windowId: string, file: FileItem, viewerId?: ViewerId) => void
  onOpenVirtualTarget?: (windowId: string, file: FileItem, target: VirtualOpenTarget) => void
  onAddToTaskbar?: (file: FileItem) => void
  onOpenInNewTab?: (
    windowId: string,
    file: FileItem,
    currentPath: string,
    viewerId?: ViewerId,
  ) => void
  openInNewTabLabel?: string
  onOpenInSplitView?: (
    windowId: string,
    file: FileItem,
    plannedMedia?: 'audio' | 'video',
    viewerId?: ViewerId,
  ) => void
  onRequestPlay?: (
    source: WorkspaceSource,
    file: FileItem,
    dir?: string,
    plannedMedia?: 'audio' | 'video',
    viewerId?: ViewerId,
  ) => void
  onBeginFileOpenTargetPick?: () => void
  onOpenFileInNewFloatingWindow?: (windowId: string, file: FileItem, viewerId?: ViewerId) => void
}
