import { getFileDragData, setFileDragData } from '@/lib/file-drag-data'
import { openResource } from '@/src/integrations/open-resource'
import { BUILT_IN_RENDERER_ID } from '@/src/features/open/renderer-registry'
import { ExplorerView } from '@/src/features/explorer/ExplorerView'
import type { ExplorerHostAction } from '@/src/features/explorer/view-types'
import type { ApplicationExplorerPayload } from '@/src/integrations/explorer-adapter'
import {
  createApplicationExplorerDataSource,
  legacyExplorerPath,
  legacyFilesystemExplorerPath,
  moveLegacyFilesystemItem,
  legacyFileItemForResource,
} from '@/src/integrations/explorer-adapter'
import { fileItemIcon, gridHeroIcon } from '@/src/lib/use-file-icon'
import type { WorkspaceBrowserPaneProps } from './workspace-browser-pane-types'

export function WorkspaceBrowserPane(props: WorkspaceBrowserPaneProps) {
  const dataSource = createApplicationExplorerDataSource({
    editableFolders: () => props.editableFolders,
    knowledgeBases: () => props.fileIconContext().knowledgeBases,
  })

  async function openItem(resource: ApplicationExplorerPayload['resource']) {
    const file = legacyFileItemForResource(resource)
    if (!file) return
    const plan = openResource(resource, 'default', props.resourceOpenContext())
    if (
      plan.status === 'ready' &&
      plan.kind === 'render' &&
      (plan.renderer === BUILT_IN_RENDERER_ID.audio || plan.renderer === BUILT_IN_RENDERER_ID.video)
    ) {
      props.onRequestPlay?.(
        props.source(),
        file.path,
        legacyExplorerPath(props.location().key) || undefined,
      )
      return
    }
    if (plan.status === 'ready' && plan.kind === 'browse') {
      props.onNavigate(props.windowId, { key: resource.key })
      return
    }
    props.onOpenViewer(props.windowId, file)
  }

  const hostActions = (): readonly ExplorerHostAction<ApplicationExplorerPayload>[] => {
    const actions: ExplorerHostAction<ApplicationExplorerPayload>[] = []
    if (props.onAddToTaskbar) {
      actions.push({
        descriptor: {
          id: 'host.addToTaskbar',
          label: 'Add to taskbar',
          capability: 'host.taskbar',
          scope: 'host',
        },
        available: (item) => !!legacyFileItemForResource(item.resource),
        run: (item) => {
          const file = legacyFileItemForResource(item.resource)
          if (file) props.onAddToTaskbar?.(file)
        },
      })
    }
    if (props.onOpenInNewTab) {
      actions.push({
        descriptor: {
          id: 'host.openInNewTab',
          label: props.openInNewTabLabel ?? 'Open in new tab',
          capability: 'host.newTab',
          scope: 'host',
        },
        run: (item) => {
          const file = legacyFileItemForResource(item.resource)
          if (!file) return
          props.onOpenInNewTab?.(
            props.windowId,
            { path: file.path, isDirectory: file.isDirectory, isVirtual: file.isVirtual },
            legacyExplorerPath(props.location().key) ?? '',
          )
        },
      })
    }
    if (props.onOpenInSplitView) {
      actions.push({
        descriptor: {
          id: 'host.openInSplitView',
          label: 'Open in split view',
          capability: 'host.splitView',
          scope: 'host',
        },
        run: (item) => {
          const file = legacyFileItemForResource(item.resource)
          if (file) props.onOpenInSplitView?.(props.windowId, file)
        },
      })
    }
    actions.push({
      descriptor: {
        id: 'host.openWithReader',
        label: 'Open with Reader',
        capability: 'host.reader',
        scope: 'host',
      },
      available: (item) => legacyFileItemForResource(item.resource)?.isDirectory === true,
      run: (item) => {
        const file = legacyFileItemForResource(item.resource)
        if (file) props.onOpenReader(props.windowId, file)
      },
    })
    if (props.onOpenFileInNewFloatingWindow) {
      actions.push({
        descriptor: {
          id: 'host.openInNewWindow',
          label: 'Open in new window',
          capability: 'host.newWindow',
          scope: 'host',
        },
        available: (item) => !item.resource.capabilities.includes('browse'),
        run: (item) => {
          const file = legacyFileItemForResource(item.resource)
          if (file) props.onOpenFileInNewFloatingWindow?.(props.windowId, file)
        },
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
      itemDomValue={(item) => legacyExplorerPath(item.resource.key) ?? undefined}
      breadcrumbDomValue={(location) => legacyExplorerPath(location.key) ?? undefined}
      renderItemIcon={(item, size) => {
        const file = legacyFileItemForResource(item.resource)
        if (!file) return undefined
        const metadata = item.resource.metadata ?? {}
        const current = props.fileIconContext()
        const iconContext = {
          ...current,
          customIcons:
            typeof metadata.customIcon === 'string'
              ? { ...current.customIcons, [file.path]: metadata.customIcon }
              : current.customIcons,
          knowledgeBases:
            metadata.knowledgeBase === true && !current.knowledgeBases.includes(file.path)
              ? [...current.knowledgeBases, file.path]
              : current.knowledgeBases,
        }
        return size === 'large' ? gridHeroIcon(file, iconContext) : fileItemIcon(file, iconContext)
      }}
      destinationPicker={(_action, item) => {
        const path = legacyFilesystemExplorerPath(item.resource.key)
        return path === null ? null : { filePath: path, editableFolders: props.editableFolders }
      }}
      onNavigate={(location) => props.onNavigate(props.windowId, location)}
      onOpen={(item) => openItem(item.resource)}
      onOpenContent={(content, item) =>
        props.onOpenContent?.(props.windowId, content, item.resource)
      }
      onDragStart={(item, event) => {
        const file = legacyFileItemForResource(item.resource)
        if (!file || !event.dataTransfer) return
        setFileDragData(event.dataTransfer, {
          path: file.path,
          isDirectory: file.isDirectory,
          sourceKind: 'local',
          ...(file.isVirtual ? { isVirtual: true } : {}),
        })
      }}
      onDropOnItem={(item, event) => {
        if (!item.resource.capabilities.includes('browse')) return
        const transfer = event.dataTransfer
        const dragged = transfer ? getFileDragData(transfer) : null
        if (!dragged || dragged.isVirtual) return
        event.preventDefault()
        void moveLegacyFilesystemItem(dragged.path, item.resource)
      }}
    />
  )
}
