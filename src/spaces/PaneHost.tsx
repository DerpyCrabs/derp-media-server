import {
  unavailablePersistedResourceTarget,
  type ResourceSummary,
  type ViewerId,
} from '@/lib/resource'
import type { FileItem } from '@/lib/types'
import type {
  PersistedWorkspaceState,
  WorkspaceSource,
  WorkspaceWindowDefinition,
} from '@/lib/use-workspace'
import type { VirtualOpenTarget } from '@/lib/virtual-directory'
import type { Accessor } from 'solid-js'
import { Match, Show, Switch, lazy } from 'solid-js'
import type { OpenSurface } from '../lib/open-resource'
import type { FileIconContext } from '../lib/use-file-icon'
import { viewerPaneDescriptorForWindow, type ViewerPaneDescriptor } from '../lib/viewer-registry'
import type { WorkspaceShareConfig } from '../workspace/workspace-browser-pane-types'
import type { WorkspaceVideoListenOnlyDetail } from '../workspace/WorkspaceViewerPane'
import {
  ResourceResolvingPane,
  ResourceUnavailablePane,
} from '../workspace/ResourceUnavailablePane'
import { usePaneRuntime } from './pane-runtime'

const WorkspaceBrowserPane = lazy(() =>
  import('../workspace/WorkspaceBrowserPane').then((module) => ({
    default: module.WorkspaceBrowserPane,
  })),
)
const HermesChatPane = lazy(() =>
  import('../workspace/HermesChatPane').then((module) => ({ default: module.HermesChatPane })),
)

export type PaneHostProps = {
  runtimeKey: string
  preserveBrowserHistory?: boolean
  paneId: string
  window: Accessor<WorkspaceWindowDefinition | undefined>
  workspace: Accessor<PersistedWorkspaceState | null>
  contentVisible: Accessor<boolean>
  pending: Accessor<boolean>
  surface?: OpenSurface
  storageKey: string
  sharePanel: Accessor<WorkspaceShareConfig | null>
  editableFolders: Accessor<string[]>
  knowledgeBases: Accessor<string[]>
  fileIconContext: Accessor<FileIconContext>
  shareAllowUpload?: boolean
  shareCanEdit?: boolean
  shareCanDelete?: boolean
  shareIsKnowledgeBase?: boolean
  onNavigateDir: (paneId: string, dir: string, resource?: ResourceSummary) => void
  onOpenViewer: (paneId: string, file: FileItem, viewerId?: ViewerId) => void
  onOpenReader: (paneId: string, file: FileItem, viewerId?: ViewerId) => void
  onOpenVirtualTarget?: (paneId: string, file: FileItem, target: VirtualOpenTarget) => void
  onAddToTaskbar?: (file: FileItem) => void
  onOpenInNewTab?: (
    paneId: string,
    file: FileItem,
    currentPath: string,
    viewerId?: ViewerId,
  ) => void
  openInNewTabLabel?: string
  onOpenInSplitView?: (
    paneId: string,
    file: FileItem,
    plannedMedia?: 'audio' | 'video',
    viewerId?: ViewerId,
  ) => void
  onRequestPlay?: (
    source: WorkspaceSource,
    file: FileItem,
    dir?: string,
    plannedMedia?: 'audio' | 'video',
    viewerId?: ViewerId,
  ) => void
  onBeginFileOpenTargetPick?: () => void
  onOpenFileInNewFloatingWindow?: (paneId: string, file: FileItem, viewerId?: ViewerId) => void
  onUpdateViewing: (
    paneId: string,
    path: string,
    resource?: ResourceSummary,
    viewerId?: ViewerId,
  ) => void
  onVideoMetadataLoaded?: (width: number, height: number) => void
  autoPlayVideo?: boolean
  onListenOnlyHandoff?: (detail: WorkspaceVideoListenOnlyDetail) => void
  onListenOnlyDismissViewer?: () => void
  showListenOnly?: boolean
  onAudioActivate?: () => void
  onSessionCreated?: (sessionId: string) => void
  onBranchCreated?: (sessionId: string, title: string) => void
  onTitleChanged?: (title: string) => void
}

function RegistryViewerPane(props: { descriptor: ViewerPaneDescriptor; host: PaneHostProps }) {
  const WorkspaceViewerPane = lazy(() =>
    props.descriptor.pane().then((module) => ({ default: module.default })),
  )
  const host = props.host
  const runtime = usePaneRuntime()
  return (
    <WorkspaceViewerPane
      windowId={host.paneId}
      viewerId={props.descriptor.id}
      storageKey={host.runtimeKey}
      runtimeState={runtime?.viewer(host.paneId)}
      contentVisible={host.contentVisible}
      workspace={host.workspace}
      sharePanel={host.sharePanel}
      editableFolders={host.editableFolders()}
      knowledgeBases={host.knowledgeBases()}
      shareCanEdit={host.shareCanEdit ?? false}
      shareCanUpload={host.shareAllowUpload ?? false}
      onUpdateViewing={host.onUpdateViewing}
      onVideoMetadataLoaded={host.onVideoMetadataLoaded}
      autoPlayVideo={host.autoPlayVideo}
      onListenOnlyHandoff={host.onListenOnlyHandoff}
      onListenOnlyDismissViewer={host.onListenOnlyDismissViewer}
      showListenOnly={host.showListenOnly}
      onAudioActivate={host.onAudioActivate}
    />
  )
}

export function PaneHost(props: PaneHostProps) {
  const runtime = usePaneRuntime()
  const unavailable = () => unavailablePersistedResourceTarget(props.window()?.resourceTarget)
  const ready = () => !props.pending() && !unavailable()
  const viewerDescriptor = () => viewerPaneDescriptorForWindow(props.window())

  return (
    <div
      class='relative h-full min-h-0 min-w-0 overflow-hidden'
      data-testid='space-pane-host'
      data-pane-id={props.paneId}
      data-runtime-key={props.runtimeKey}
      data-viewer-id={viewerDescriptor()?.id}
    >
      <Show when={props.pending()}>
        <ResourceResolvingPane />
      </Show>
      <Show when={unavailable()}>{(target) => <ResourceUnavailablePane target={target()} />}</Show>
      <Switch>
        <Match when={ready() && props.window()?.type === 'browser'}>
          <WorkspaceBrowserPane
            windowId={props.paneId}
            runtimeKey={props.runtimeKey}
            runtime={runtime?.browser(props.paneId)}
            preserveHistory={props.preserveBrowserHistory}
            surface={props.surface}
            workspace={props.workspace}
            sharePanel={props.sharePanel}
            fileIconContext={props.fileIconContext}
            shareAllowUpload={props.shareAllowUpload ?? false}
            shareCanEdit={props.shareCanEdit ?? false}
            shareCanDelete={props.shareCanDelete ?? false}
            shareIsKnowledgeBase={props.shareIsKnowledgeBase ?? false}
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
            onBeginFileOpenTargetPick={props.onBeginFileOpenTargetPick}
            onOpenFileInNewFloatingWindow={props.onOpenFileInNewFloatingWindow}
          />
        </Match>
        <Match when={ready() && props.window()?.type === 'viewer'}>
          <Show when={viewerDescriptor()} keyed>
            {(descriptor) => <RegistryViewerPane descriptor={descriptor} host={props} />}
          </Show>
        </Match>
        <Match when={ready() && props.window()?.type === 'hermes'}>
          <HermesChatPane
            window={props.window}
            contentVisible={props.contentVisible}
            onSessionCreated={props.onSessionCreated}
            onBranchCreated={props.onBranchCreated}
            onTitleChanged={props.onTitleChanged}
          />
        </Match>
      </Switch>
    </div>
  )
}
