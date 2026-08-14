import type { ContentInstance } from '@/lib/domain/content'
import type { ResourceSummary } from '@/lib/domain/resource'
import type { FileItem } from '@/lib/types'
import type { WorkspaceSource } from '@/lib/use-workspace'
import type { ExplorerLocation } from '@/src/features/explorer/types'
import type { OpenContext } from '@/src/features/open/open-resource'
import type { Accessor } from 'solid-js'
import type { FileIconContext } from '../lib/use-file-icon'

export type WorkspaceBrowserPaneProps = {
  windowId: string
  location: Accessor<ExplorerLocation>
  active: Accessor<boolean>
  source: Accessor<WorkspaceSource>
  resourceOpenContext: Accessor<OpenContext>
  fileIconContext: () => FileIconContext
  editableFolders: string[]
  onNavigate: (windowId: string, location: ExplorerLocation) => void
  onOpenViewer: (windowId: string, file: FileItem) => void
  onOpenReader: (windowId: string, file: FileItem) => void
  onOpenContent?: (windowId: string, content: ContentInstance, resource: ResourceSummary) => void
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
