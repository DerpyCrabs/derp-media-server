import type { ContentInstance } from '@/lib/domain/content'
import type { ResourceKey, ResourceSummary } from '@/lib/domain/resource'
import type { ExplorerLocation } from '@/src/features/explorer/types'
import type { OpenContext } from '@/src/features/open/open-resource'
import type { Accessor } from 'solid-js'
import type { FileIconContext } from '../lib/use-file-icon'

export type WorkspaceBrowserPaneProps = {
  windowId: string
  location: Accessor<ExplorerLocation>
  active: Accessor<boolean>
  resourceOpenContext: Accessor<OpenContext>
  fileIconContext: () => FileIconContext
  editableFolders: string[]
  onNavigate: (windowId: string, location: ExplorerLocation) => void
  onOpenViewer: (windowId: string, resource: ResourceSummary) => void
  onOpenReader: (windowId: string, resource: ResourceSummary) => void
  onOpenContent?: (windowId: string, content: ContentInstance, resource: ResourceSummary) => void
  onAddToTaskbar?: (resource: ResourceSummary) => void
  onOpenInNewTab?: (windowId: string, resource: ResourceSummary) => void
  openInNewTabLabel?: string
  onOpenInSplitView?: (windowId: string, resource: ResourceSummary) => void
  onRequestPlay?: (resource: ResourceSummary, context?: ResourceKey) => void
  onBeginFileOpenTargetPick?: () => void
  onOpenFileInNewFloatingWindow?: (windowId: string, resource: ResourceSummary) => void
}
