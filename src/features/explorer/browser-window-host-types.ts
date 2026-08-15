import type { FileItem } from '@/lib/files/types'
import type { VirtualOpenTarget } from '@/lib/files/virtual-directory'
import type { PersistedWindowState, WindowSource } from '@/lib/models/window-model'
import type { Accessor } from 'solid-js'
import type { FileIconContext } from '@/features/explorer/use-file-icon'

export type BrowserWindowHostProps = {
  windowId: string
  windowState: Accessor<PersistedWindowState | null>
  fileIconContext: () => FileIconContext
  editableFolders: string[]
  onNavigateDir: (windowId: string, dir: string) => void
  onOpenViewer: (windowId: string, file: FileItem) => void
  onOpenReader: (windowId: string, file: FileItem) => void
  onOpenVirtualTarget?: (windowId: string, file: FileItem, target: VirtualOpenTarget) => void
  onAddToTaskbar?: (file: FileItem) => void
  onOpenInNewTab?: (
    windowId: string,
    file: { path: string; isDirectory: boolean; isVirtual?: boolean },
    currentPath: string,
  ) => void
  openInNewTabLabel?: string
  onOpenInSplitView?: (windowId: string, file: FileItem) => void
  onRequestPlay?: (source: WindowSource, path: string, dir?: string) => void
  onBeginFileOpenTargetPick?: () => void
  onOpenFileInNewFloatingWindow?: (windowId: string, file: FileItem) => void
}
