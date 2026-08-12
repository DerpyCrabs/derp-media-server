import type { PinnedTaskbarItem } from '@/lib/use-workspace'
import type { WorkspaceLayoutPreset } from '@/lib/workspace-layout-presets'
import type { Space } from '@/lib/space'
import type { OptimisticSpaceClient } from '@/lib/space-client'

export type WorkspacePageProps = {
  initialSpace?: Space
  spaceClient?: OptimisticSpaceClient
  activePaneId?: string | null
  onActivePaneChange?: (paneId: string | null) => void
  registerPresentationFlush?: (flush: () => void) => () => void
  embedded?: boolean
  shareConfig?: { token: string; sharePath: string } | null
  shareWorkspaceTaskbarPins?: PinnedTaskbarItem[]
  shareWorkspaceLayoutPresets?: WorkspaceLayoutPreset[]
  shareAllowUpload?: boolean
  shareCanEdit?: boolean
  shareCanDelete?: boolean
  shareIsKnowledgeBase?: boolean
}
