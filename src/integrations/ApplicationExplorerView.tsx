import { getResourceDragData, setResourceDragData } from '@/lib/resource-drag-data'
import type { ContentInstance } from '@/lib/domain/content'
import {
  resourceIsBrowsable,
  resourceLogicalPath,
  type ResourceSummary,
} from '@/lib/domain/resource'
import { ExplorerView } from '@/src/features/explorer/ExplorerView'
import type {
  ExplorerHistory,
  ExplorerLocation,
  ExplorerSnapshot,
} from '@/src/features/explorer/types'
import type { ExplorerHostAction } from '@/src/features/explorer/view-types'
import {
  EMPTY_FILE_ICON_CONTEXT,
  gridResourceSummaryIcon,
  resourceSummaryIcon,
  type FileIconContext,
} from '@/src/lib/use-file-icon'
import type { Accessor, JSX } from 'solid-js'
import {
  createApplicationExplorerDataSource,
  moveApplicationResource,
  type ApplicationExplorerPayload,
} from './explorer-adapter'

export type ApplicationExplorerHostAction = ExplorerHostAction<ApplicationExplorerPayload>
export type ApplicationExplorerSnapshot = ExplorerSnapshot<ApplicationExplorerPayload>

export type ApplicationExplorerViewProps = Readonly<{
  location: Accessor<ExplorerLocation>
  active?: Accessor<boolean>
  history?: ExplorerHistory
  editableFolders?: Accessor<readonly string[]>
  iconContext?: Accessor<FileIconContext>
  displayMode?: 'MediaServer' | 'Workspace'
  testId?: string
  dropZoneTestId?: string
  scrollMode?: 'contained' | 'window'
  hostActions?: Accessor<readonly ApplicationExplorerHostAction[]>
  toolbarEnd?: Accessor<JSX.Element>
  onNavigate?: (location: ExplorerLocation) => void
  onOpen(resource: ResourceSummary): void | Promise<void>
  onOpenContent?: (content: ContentInstance, resource: ResourceSummary) => void | Promise<void>
  onUnsupportedChange?: (resource: ResourceSummary | null) => void
  onSnapshot?: (snapshot: ApplicationExplorerSnapshot) => void
}>

function editableFoldersFor(
  resource: ResourceSummary,
  configured: readonly string[] | undefined,
): readonly string[] {
  if (configured) return configured
  const folders = resource.metadata?.editableFolders
  return Array.isArray(folders)
    ? folders.filter((folder): folder is string => typeof folder === 'string')
    : []
}

export function ApplicationExplorerView(props: ApplicationExplorerViewProps) {
  const dataSource = createApplicationExplorerDataSource(
    props.editableFolders ? { editableFolders: props.editableFolders } : {},
  )
  const iconContext = () => props.iconContext?.() ?? EMPTY_FILE_ICON_CONTEXT

  return (
    <ExplorerView<ApplicationExplorerPayload>
      location={props.location}
      dataSource={dataSource}
      active={props.active}
      history={props.history}
      displayMode={props.displayMode}
      testId={props.testId}
      dropZoneTestId={props.dropZoneTestId}
      scrollMode={props.scrollMode}
      hostActions={props.hostActions}
      toolbarEnd={props.toolbarEnd}
      itemDomValue={(item) => resourceLogicalPath(item.resource)}
      breadcrumbDomValue={(breadcrumb) =>
        breadcrumb.item ? resourceLogicalPath(breadcrumb.item.resource) : undefined
      }
      renderItemIcon={(item, size) =>
        size === 'large'
          ? gridResourceSummaryIcon(item.resource, iconContext())
          : resourceSummaryIcon(item.resource, iconContext())
      }
      destinationPicker={(_action, item) => {
        const path = resourceLogicalPath(item.resource)
        return path === undefined
          ? null
          : {
              filePath: path,
              editableFolders: editableFoldersFor(item.resource, props.editableFolders?.()),
            }
      }}
      onNavigate={props.onNavigate}
      onOpen={(item) => props.onOpen(item.resource)}
      onOpenContent={
        props.onOpenContent
          ? (content, item) => props.onOpenContent?.(content, item.resource)
          : undefined
      }
      onUnsupportedChange={
        props.onUnsupportedChange
          ? (item) => props.onUnsupportedChange?.(item?.resource ?? null)
          : undefined
      }
      onSnapshot={props.onSnapshot}
      onDragStart={(item, event) => {
        if (!event.dataTransfer) return
        setResourceDragData(event.dataTransfer, {
          key: item.resource.key,
          isDirectory: resourceIsBrowsable(item.resource),
        })
      }}
      onDropOnItem={(item, event) => {
        if (!resourceIsBrowsable(item.resource)) return
        const dragged = event.dataTransfer ? getResourceDragData(event.dataTransfer) : null
        if (!dragged) return
        event.preventDefault()
        void moveApplicationResource(dragged.key, item.resource)
      }}
    />
  )
}
