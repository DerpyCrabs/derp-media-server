import type { PersistedWindowState, WindowDefinition } from '@/lib/models/window-model'
import type { Accessor } from 'solid-js'
import type { FileIconContext } from '@/features/explorer/use-file-icon'
import { HermesChatPane } from '@/features/hermes/HermesChatPane'
import { WorkspaceFileBrowser } from '@/workspace/shared/WorkspaceFileBrowser'
import { ViewerPane } from '@/features/viewer'
import { PaneSwitch } from './PaneSwitch'
import type { WorkspaceWindowActions } from './workspace-window-actions'

export type ApplicationWindowContentProps = Readonly<{
  windowId: Accessor<string>
  definition: Accessor<WindowDefinition | undefined>
  windowState: Accessor<PersistedWindowState | null>
  visible: Accessor<boolean>
  active?: Accessor<boolean>
  editableFolders: Accessor<string[]>
  knowledgeBases: Accessor<string[]>
  fileIconContext: () => FileIconContext
  actions: WorkspaceWindowActions
  autoPlayVideo: boolean
}>

/** Window content shared by desktop and canvas workspaces. */
export function ApplicationWindowContent(props: ApplicationWindowContentProps) {
  const id = () => props.windowId()
  const active = () => props.active?.() ?? props.visible()
  const definition = () => props.definition()

  return (
    <PaneSwitch
      kind={() => definition()?.type}
      browser={() => (
        <WorkspaceFileBrowser
          windowId={id()}
          windowState={props.windowState}
          fileIconContext={props.fileIconContext}
          editableFolders={props.editableFolders()}
          actions={props.actions.browser}
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
          onNavigateViewing={(path) => props.actions.viewer.updateViewing(id(), path)}
          onVideoMetadataLoaded={
            props.actions.viewer.videoMetadata
              ? (width, height) => props.actions.viewer.videoMetadata?.(id(), width, height)
              : undefined
          }
          onAudioActivate={
            props.actions.viewer.audioActivate
              ? () => props.actions.viewer.audioActivate?.(id())
              : undefined
          }
          onListenOnlyDismissViewer={
            props.actions.viewer.dismissListenOnly
              ? () => props.actions.viewer.dismissListenOnly?.(id())
              : undefined
          }
          showListenOnly={!!props.actions.viewer.dismissListenOnly}
        />
      )}
      hermes={() => (
        <HermesChatPane
          target={() => definition()?.hermes}
          ownerId={() => definition()?.id}
          title={() => definition()?.title}
          contentVisible={props.visible}
          active={active}
          onSessionCreated={(sessionId) => props.actions.hermes.sessionCreated(id(), sessionId)}
          onBranchCreated={
            props.actions.hermes.branchCreated
              ? (sessionId, title) => props.actions.hermes.branchCreated?.(id(), sessionId, title)
              : undefined
          }
          onTitleChanged={(title) => props.actions.hermes.titleChanged(id(), title)}
        />
      )}
    />
  )
}
