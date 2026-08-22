import type { FileItem } from '@/lib/files/types'
import type { VirtualOpenTarget } from '@/lib/files/virtual-directory'

export type WorkspaceBrowserActions = Readonly<{
  navigate: (windowId: string, dir: string) => void
  openViewer: (windowId: string, file: FileItem) => void
  openReader: (windowId: string, file: FileItem) => void
  openVirtual: (windowId: string, file: FileItem, target: VirtualOpenTarget) => void
  play: (windowId: string, path: string, dir?: string) => void
  addToTaskbar?: (windowId: string, file: FileItem) => void
  openInNewTab?: (
    windowId: string,
    file: { path: string; isDirectory: boolean; isVirtual?: boolean },
    currentPath: string,
  ) => void
  openInSplitView?: (windowId: string, file: FileItem) => void
  beginOpenTargetPick?: (windowId: string) => void
  openInNewWindow?: (windowId: string, file: FileItem) => void
  newTabLabel?: string
}>

export type WorkspaceViewerActions = Readonly<{
  updateViewing: (windowId: string, path: string) => void
  videoMetadata?: (windowId: string, width: number, height: number) => void
  audioActivate?: (windowId: string) => void
  dismissListenOnly?: (windowId: string) => void
}>

export type WorkspaceHermesActions = Readonly<{
  sessionCreated: (windowId: string, sessionId: string) => void
  branchCreated?: (windowId: string, sessionId: string, title: string) => void
  titleChanged: (windowId: string, title: string) => void
}>

export type WorkspaceWindowActions = Readonly<{
  browser: WorkspaceBrowserActions
  viewer: WorkspaceViewerActions
  hermes: WorkspaceHermesActions
}>
