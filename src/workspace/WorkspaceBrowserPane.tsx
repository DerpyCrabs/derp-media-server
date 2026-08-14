import { openResource } from '@/src/integrations/open-resource'
import { resourceIsBrowsable, type ResourceSummary } from '@/lib/domain/resource'
import {
  ApplicationExplorerView,
  type ApplicationExplorerHostAction,
} from '@/src/integrations/ApplicationExplorerView'
import { applicationContentRegistry } from '@/src/integrations/registry'
import { useWorkspaceFileOpenTargetStore } from '@/lib/workspace-file-open-target'
import { useStoreSync } from '@/src/lib/solid-store-sync'
import type { WorkspaceBrowserPaneProps } from './workspace-browser-pane-types'

export function WorkspaceBrowserPane(props: WorkspaceBrowserPaneProps) {
  const fileOpenTargetTick = useStoreSync(useWorkspaceFileOpenTargetStore)

  function usesNewTabFileTarget() {
    void fileOpenTargetTick()
    return useWorkspaceFileOpenTargetStore.getState().target === 'new-tab'
  }

  async function openItem(resource: ResourceSummary) {
    const plan = openResource(resource, 'default', props.resourceOpenContext())
    if (plan.status !== 'ready') return
    if (plan.kind === 'render' && applicationContentRegistry.playbackItem(resource)) {
      props.onRequestPlay?.(resource, props.location().key)
      return
    }
    if (plan.kind === 'browse') {
      props.onNavigate(props.windowId, { key: resource.key })
      return
    }
    props.onOpenResource(props.windowId, resource)
  }

  const hostActions = (): readonly ApplicationExplorerHostAction[] => {
    const actions: ApplicationExplorerHostAction[] = []
    if (props.onAddToTaskbar) {
      actions.push({
        descriptor: {
          id: 'host.addToTaskbar',
          operation: 'addToTaskbar',
          label: 'Add to taskbar',
          capability: 'host.taskbar',
          scope: 'host',
          interaction: 'immediate',
        },
        run: (item) => props.onAddToTaskbar?.(item.resource),
      })
    }
    if (props.onOpenInNewTab) {
      actions.push({
        descriptor: {
          id: 'host.openInNewTab',
          operation: 'openInNewTab',
          label: props.openInNewTabLabel ?? 'Open in new tab',
          capability: 'host.newTab',
          scope: 'host',
          interaction: 'immediate',
        },
        run: (item) => props.onOpenInNewTab?.(props.windowId, item.resource),
      })
    }
    if (props.onBeginFileOpenTargetPick && usesNewTabFileTarget()) {
      actions.push({
        descriptor: {
          id: 'host.pickNewTabTarget',
          operation: 'pickNewTabTarget',
          label: 'Choose where new tabs open…',
          capability: 'host.pickNewTabTarget',
          scope: 'host',
          interaction: 'immediate',
        },
        run: () => props.onBeginFileOpenTargetPick?.(),
      })
    }
    if (props.onOpenInSplitView) {
      actions.push({
        descriptor: {
          id: 'host.openInSplitView',
          operation: 'openInSplitView',
          label: 'Open in split view',
          capability: 'host.splitView',
          scope: 'host',
          interaction: 'immediate',
        },
        run: (item) => props.onOpenInSplitView?.(props.windowId, item.resource),
      })
    }
    actions.push({
      descriptor: {
        id: 'host.openWithReader',
        operation: 'openWithReader',
        label: 'Open with Reader',
        capability: 'host.reader',
        scope: 'host',
        interaction: 'immediate',
      },
      available: (item) =>
        openResource(item.resource, 'read', props.resourceOpenContext()).status === 'ready',
      run: (item) => props.onOpenReader(props.windowId, item.resource),
    })
    if (props.onOpenFileInNewFloatingWindow) {
      actions.push({
        descriptor: {
          id: 'host.openInNewWindow',
          operation: 'openInNewWindow',
          label: 'Open in new window',
          capability: 'host.newWindow',
          scope: 'host',
          interaction: 'immediate',
        },
        available: (item) => !resourceIsBrowsable(item.resource),
        run: (item) => props.onOpenFileInNewFloatingWindow?.(props.windowId, item.resource),
      })
    }
    return actions
  }

  return (
    <ApplicationExplorerView
      location={props.location}
      active={props.active}
      editableFolders={() => props.editableFolders}
      iconContext={props.fileIconContext}
      displayMode='Workspace'
      dropZoneTestId='workspace-upload-drop-zone'
      hostActions={hostActions}
      onNavigate={(location) => props.onNavigate(props.windowId, location)}
      onOpen={openItem}
      onOpenContent={(content, resource) =>
        props.onOpenContent?.(props.windowId, content, resource)
      }
    />
  )
}
