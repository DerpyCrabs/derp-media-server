import type { GlobalSettings } from '@/lib/models/settings-types'
import type { TaskbarPin } from '@/lib/models/taskbar-pins'

export interface WorkspaceSettings extends GlobalSettings {
  workspaceTaskbarPins: TaskbarPin[]
}
