import type { NavigationState } from '@/lib/browser/navigation-session'
import type { FileOpenTarget } from './open-target'
import { MediaType } from '@/lib/files/types'
import type { TaskbarPin } from './taskbar-pins'

export interface WindowSource {
  kind: 'local'
  rootPath?: string | null
}

export const DEFAULT_WINDOW_SOURCE: WindowSource = { kind: 'local', rootPath: null }

export type SnapZone =
  | 'assist-custom'
  | 'left'
  | 'right'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'top-half'
  | 'bottom-half'
  | 'top-third'
  | 'middle-third'
  | 'bottom-third'
  | 'left-third'
  | 'center-third'
  | 'right-third'
  | 'left-two-thirds'
  | 'right-two-thirds'
  | 'top-left-third'
  | 'top-center-third'
  | 'top-right-third'
  | 'bottom-left-third'
  | 'bottom-center-third'
  | 'bottom-right-third'

export interface WindowLayout {
  bounds?: {
    x: number
    y: number
    width: number
    height: number
  } | null
  fullscreen?: boolean
  snapZone?: SnapZone | null
  minimized?: boolean
  zIndex?: number
  restoreBounds?: {
    x: number
    y: number
    width: number
    height: number
  } | null
  tiling?: TilingPlacement | null
}

export interface TilingPlacement {
  cols: number
  rows: number
  colStart: number
  colEnd: number
  rowStart: number
  rowEnd: number
  colLines: number[]
  rowLines: number[]
}

export interface WindowDefinition {
  id: string
  type: 'browser' | 'viewer' | 'hermes'
  title: string
  iconName?: string | null
  iconPath?: string | null
  iconType?: MediaType | null
  iconIsVirtual?: boolean
  source: WindowSource
  initialState: Partial<NavigationState>
  tabGroupId?: string | null
  openedFromWindowId?: string | null
  tabPinned?: boolean
  layout?: WindowLayout
  fileOpenTargetWindowId?: string | null
  hermes?: {
    sessionId?: string
    draftId?: string
    cwd?: string | null
    readOnly?: boolean
  }
}

export type PinnedTaskbarItem = TaskbarPin

export interface TabGroupSplitState {
  leftTabId: string
  leftPaneFraction: number
}

export interface PersistedWindowState {
  windows: WindowDefinition[]
  activeWindowId: string | null
  activeTabMap: Record<string, string>
  nextWindowId: number
  pinnedTaskbarItems: PinnedTaskbarItem[]
  browserTabTitle?: string
  browserTabIcon?: string
  browserTabIconColor?: string
  tabGroupSplits?: Record<string, TabGroupSplitState>
  fileOpenTarget?: FileOpenTarget
}
