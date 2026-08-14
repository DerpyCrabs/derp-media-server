import type { ContentInstance } from './domain/content'
import type { NavigationState } from './navigation-session'
import type { MediaType } from './types'

export interface ContentWindowSource {
  kind: 'local'
  rootPath?: string | null
}

export interface ContentWindowDefinition {
  id: string
  type: 'browser' | 'viewer' | 'integration'
  title: string
  iconName?: string | null
  iconPath?: string | null
  iconType?: MediaType | null
  iconIsVirtual?: boolean
  source: ContentWindowSource
  initialState: Partial<NavigationState>
  content?: unknown
  runtimeContent?: ContentInstance
  contentRecoveryReason?: string
}
