import { getFileDragData, setFileDragData } from '@/lib/file-drag-data'
import { openResource } from '@/src/integrations/open-resource'
import { FILESYSTEM_RENDERER_ID } from '@/src/integrations/filesystem/renderers'
import { ExplorerView } from '@/src/features/explorer/ExplorerView'
import type { ExplorerHostAction } from '@/src/features/explorer/view-types'
import type { ApplicationExplorerPayload } from '@/src/integrations/explorer-adapter'
import {
  createApplicationExplorerDataSource,
  moveFilesystemItemByPath,
} from '@/src/integrations/explorer-adapter'
import {
  filesystemPathForResourceKey,
  filesystemResourceIsDirectory,
} from '@/src/integrations/filesystem/resource'
import { gridResourceSummaryIcon, resourceSummaryIcon } from '@/src/lib/use-file-icon'
import type { WorkspaceBrowserPaneProps } from './workspace-browser-pane-types'

export function WorkspaceBrowserPane(props: WorkspaceBrowserPaneProps) {
  const dataSource = createApplicationExplorerDataSource({
    editableFolders: () => props.editableFolders,
  })

  async function openItem(resource: ApplicationExplorerPayload['resource']) {
    const plan = openResource(resource, 'default', props.resourceOpenContext())
    if (
      plan.status === 'ready' &&
      plan.kind === 'render' &&
      (plan.renderer === FILESYSTEM_RENDERER_ID.audio ||
        plan.renderer === FILESYSTEM_RENDERER_ID.video)
    ) {
      props.onRequestPlay?.(resource, props.location().key)
      return
    }
    if (plan.status === 'ready' && plan.kind === 'browse') {
      props.onNavigate(props.windowId, { key: resource.key })
      return
    }
    if (filesystemPathForResourceKey(resource.key) !== null) {
      props.onOpenViewer(props.windowId, resource)
      return
    }
    if (plan.status === 'ready' && plan.kind === 'render') {
      props.onOpenContent?.(
        props.windowId,
        {
          id: props.windowId,
          type: 'resource',
          resource: plan.resource,
          renderer: plan.renderer,
        },
        resource,
      )
    }
  }

  const hostActions = (): readonly ExplorerHostAction<ApplicationExplorerPayload>[] => {
    const actions: ExplorerHostAction<ApplicationExplorerPayload>[] = []
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
        available: (item) => filesystemPathForResourceKey(item.resource.key) !== null,
        run: (item) => props.onOpenInNewTab?.(props.windowId, item.resource),
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
        available: (item) => filesystemPathForResourceKey(item.resource.key) !== null,
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
      available: (item) => filesystemResourceIsDirectory(item.resource),
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
        available: (item) =>
          filesystemPathForResourceKey(item.resource.key) !== null &&
          !filesystemResourceIsDirectory(item.resource),
        run: (item) => props.onOpenFileInNewFloatingWindow?.(props.windowId, item.resource),
      })
    }
    return actions
  }

  return (
    <ExplorerView
      location={props.location}
      dataSource={dataSource}
      active={props.active}
      displayMode='Workspace'
      dropZoneTestId='workspace-upload-drop-zone'
      hostActions={hostActions}
      itemDomValue={(item) => filesystemPathForResourceKey(item.resource.key) ?? undefined}
      breadcrumbDomValue={(location) => filesystemPathForResourceKey(location.key) ?? undefined}
      renderItemIcon={(item, size) =>
        size === 'large'
          ? gridResourceSummaryIcon(item.resource, props.fileIconContext())
          : resourceSummaryIcon(item.resource, props.fileIconContext())
      }
      destinationPicker={(_action, item) => {
        const path = filesystemPathForResourceKey(item.resource.key)
        return path === null ? null : { filePath: path, editableFolders: props.editableFolders }
      }}
      onNavigate={(location) => props.onNavigate(props.windowId, location)}
      onOpen={(item) => openItem(item.resource)}
      onOpenContent={(content, item) =>
        props.onOpenContent?.(props.windowId, content, item.resource)
      }
      onDragStart={(item, event) => {
        const path = filesystemPathForResourceKey(item.resource.key)
        if (path === null || !event.dataTransfer) return
        setFileDragData(event.dataTransfer, {
          path,
          isDirectory: filesystemResourceIsDirectory(item.resource),
          sourceKind: 'local',
        })
      }}
      onDropOnItem={(item, event) => {
        if (!item.resource.capabilities.includes('browse')) return
        const transfer = event.dataTransfer
        const dragged = transfer ? getFileDragData(transfer) : null
        if (!dragged) return
        event.preventDefault()
        void moveFilesystemItemByPath(dragged.path, item.resource)
      }}
    />
  )
}
