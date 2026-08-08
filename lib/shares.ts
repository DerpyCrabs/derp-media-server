import type { WorkspaceLayoutPreset } from './workspace-layout-presets-types'
import type { WorkspaceTaskbarPin } from './workspace-taskbar-pins'

export interface ShareRestrictions {
  allowDelete?: boolean
  allowUpload?: boolean
  allowEdit?: boolean
  maxUploadBytes?: number
}

export interface ShareLink {
  token: string
  path: string
  isDirectory: boolean
  editable: boolean
  passcode?: string
  createdAt: number
  rootId?: string
  rootRelativePath?: string
  unavailable?: boolean
  restrictions?: ShareRestrictions
  usedBytes?: number
  workspaceTaskbarPins?: WorkspaceTaskbarPin[]
  workspaceLayoutPresets?: WorkspaceLayoutPreset[]
}
