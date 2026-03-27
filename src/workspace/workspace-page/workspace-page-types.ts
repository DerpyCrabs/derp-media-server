import type { PinnedTaskbarItem } from '@/lib/use-workspace'
import type { WorkspaceLayoutPreset } from '@/lib/workspace-layout-presets'

export type WorkspacePageProps = {
  shareConfig?: { token: string; sharePath: string } | null
  shareWorkspaceTaskbarPins?: PinnedTaskbarItem[]
  shareWorkspaceLayoutPresets?: WorkspaceLayoutPreset[]
  shareAllowUpload?: boolean
  shareCanEdit?: boolean
  shareCanDelete?: boolean
  shareIsKnowledgeBase?: boolean
}
