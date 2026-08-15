import type {
  PersistedWindowState,
  WindowSource,
  WindowDefinition,
} from '@/lib/models/window-model'
import type { FileItem } from '@/lib/files/types'
import type { VirtualOpenTarget } from '@/lib/files/virtual-directory'
import type { Accessor } from 'solid-js'
import type { FileIconContext } from '@/features/explorer/use-file-icon'
import { HermesChatPane } from '@/features/hermes/HermesChatPane'
import { BrowserWindowHost } from '@/features/explorer/BrowserWindowHost'
import { ViewerPane } from '@/features/viewer'
import { PaneSwitch } from './PaneSwitch'

export type ApplicationWindowContentProps = Readonly<{
  windowId: Accessor<string>
  definition: Accessor<WindowDefinition | undefined>
  windowState: Accessor<PersistedWindowState | null>
  visible: Accessor<boolean>
  active?: Accessor<boolean>
  editableFolders: Accessor<string[]>
  knowledgeBases: Accessor<string[]>
  fileIconContext: () => FileIconContext
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
  autoPlayVideo: boolean
  onBeginFileOpenTargetPick?: (windowId: string) => void
  onOpenFileInNewFloatingWindow?: (windowId: string, file: FileItem) => void
  onUpdateViewing: (windowId: string, path: string) => void
  onVideoMetadataLoaded?: (windowId: string, width: number, height: number) => void
  onAudioActivate?: (windowId: string) => void
  onListenOnlyDismissViewer?: (windowId: string) => void
  onHermesSessionCreated?: (windowId: string, sessionId: string) => void
  onHermesBranchCreated?: (windowId: string, sessionId: string, title: string) => void
  onHermesTitleChanged?: (windowId: string, title: string) => void
}>

/** One surface switch shared by workspace and canvas window hosts. */
export function ApplicationWindowContent(props: ApplicationWindowContentProps) {
  const id = () => props.windowId()
  const active = () => props.active?.() ?? props.visible()
  const definition = () => props.definition()

  return (
    <PaneSwitch
      kind={() => definition()?.type}
      browser={() => (
        <BrowserWindowHost
          windowId={id()}
          windowState={props.windowState}
          fileIconContext={props.fileIconContext}
          editableFolders={props.editableFolders()}
          onNavigateDir={props.onNavigateDir}
          onOpenViewer={props.onOpenViewer}
          onOpenReader={props.onOpenReader}
          onOpenVirtualTarget={props.onOpenVirtualTarget}
          onAddToTaskbar={props.onAddToTaskbar}
          onOpenInNewTab={props.onOpenInNewTab}
          openInNewTabLabel={props.openInNewTabLabel}
          onOpenInSplitView={props.onOpenInSplitView}
          onRequestPlay={props.onRequestPlay}
          onBeginFileOpenTargetPick={
            props.onBeginFileOpenTargetPick
              ? () => props.onBeginFileOpenTargetPick?.(id())
              : undefined
          }
          onOpenFileInNewFloatingWindow={props.onOpenFileInNewFloatingWindow}
        />
      )}
      viewer={() => (
        <ViewerPane
          viewingPath={() => definition()?.initialState?.viewing ?? ''}
          directory={() => definition()?.initialState?.dir ?? ''}
          contentVisible={props.visible}
          active={active}
          readerKind={() => definition()?.initialState?.readerKind ?? null}
          editableFolders={props.editableFolders()}
          knowledgeBases={props.knowledgeBases()}
          autoPlayVideo={props.autoPlayVideo}
          onNavigateViewing={(path) => props.onUpdateViewing(id(), path)}
          onVideoMetadataLoaded={
            props.onVideoMetadataLoaded
              ? (width, height) => props.onVideoMetadataLoaded?.(id(), width, height)
              : undefined
          }
          onAudioActivate={props.onAudioActivate ? () => props.onAudioActivate?.(id()) : undefined}
          onListenOnlyDismissViewer={
            props.onListenOnlyDismissViewer
              ? () => props.onListenOnlyDismissViewer?.(id())
              : undefined
          }
          showListenOnly={!!props.onListenOnlyDismissViewer}
        />
      )}
      hermes={() => (
        <HermesChatPane
          window={definition}
          contentVisible={props.visible}
          active={active}
          onSessionCreated={(sessionId) => props.onHermesSessionCreated?.(id(), sessionId)}
          onBranchCreated={
            props.onHermesBranchCreated
              ? (sessionId, title) => props.onHermesBranchCreated?.(id(), sessionId, title)
              : undefined
          }
          onTitleChanged={(title) => props.onHermesTitleChanged?.(id(), title)}
        />
      )}
    />
  )
}
