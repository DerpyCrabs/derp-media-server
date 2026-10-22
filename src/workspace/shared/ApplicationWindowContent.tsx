import { view } from 'effectweb'
import { memoView } from 'effectweb/advanced'
import { HermesChatPane } from '@/features/hermes/LazyHermesChatPane'
import { WorkspaceFileBrowser } from '@/workspace/shared/WorkspaceFileBrowser'
import { ViewerPane } from '@/features/viewer'
import { PaneSwitch } from './PaneSwitch'
import { windowContentEquals, type ApplicationWindowContentProps } from './window-content-model'
export type { ApplicationWindowContentProps } from './window-content-model'
/** Window content shared by desktop and canvas workspaces. */
export const ApplicationWindowContent = memoView(
  view<ApplicationWindowContentProps>((props) => {
    const id = () => props.windowId
    const active = () => props.active
    const definition = () => props.definition
    return (
      <PaneSwitch
        kind={definition()?.type}
        browser={() => (
          <WorkspaceFileBrowser
            windowId={id()}
            definition={props.definition}
            active={props.active}
            fileIconContext={props.fileIconContext}
            editableFolders={props.editableFolders}
            actions={props.actions.browser}
          />
        )}
        viewer={() => (
          <ViewerPane
            viewingPath={definition()?.initialState?.viewing ?? ''}
            imageSeed={definition()?.initialState?.imageSeed}
            onImageSeedChange={(seed, path) => props.actions.viewer.updateViewing(id(), path, seed)}
            directory={definition()?.initialState?.dir ?? ''}
            contentVisible={props.visible}
            active={active()}
            readerKind={definition()?.initialState?.readerKind ?? null}
            editableFolders={props.editableFolders}
            knowledgeBases={props.knowledgeBases}
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
            target={definition()?.hermes}
            ownerId={definition()?.id}
            title={definition()?.title}
            contentVisible={props.visible}
            active={active()}
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
  }),
  windowContentEquals,
)
