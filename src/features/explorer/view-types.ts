import type { JSX, Accessor } from 'solid-js'
import type { ContentInstance } from '@/lib/domain/content'
import type {
  ExplorerActionDescriptor,
  ExplorerBreadcrumb,
  ExplorerDataSource,
  ExplorerDispatchResult,
  ExplorerHistory,
  ExplorerItem,
  ExplorerLocation,
  ExplorerSnapshot,
  ExplorerStorage,
} from './types'

export type ExplorerHostAction<TPayload = unknown> = Readonly<{
  descriptor: ExplorerActionDescriptor & Readonly<{ scope: 'host' }>
  available?: (item: ExplorerItem<TPayload>) => boolean
  run(item: ExplorerItem<TPayload>): void | Promise<void>
}>

export type ExplorerActionInputResolution =
  | Readonly<{ run: true; input?: unknown }>
  | Readonly<{ run: false }>

export type ExplorerViewProps<TPayload = unknown> = Readonly<{
  location: Accessor<ExplorerLocation>
  dataSource: ExplorerDataSource<TPayload>
  active?: Accessor<boolean>
  history?: ExplorerHistory
  storage?: ExplorerStorage
  pageSize?: number
  loadMoreThreshold?: number
  displayMode?: 'MediaServer' | 'Workspace'
  searchPlaceholder?: string
  emptyLabel?: string
  testId?: string
  dropZoneTestId?: string
  scrollMode?: 'contained' | 'window'
  hostActions?: Accessor<readonly ExplorerHostAction<TPayload>[]>
  toolbarEnd?: Accessor<JSX.Element>
  itemDomValue?: (item: ExplorerItem<TPayload>) => string | undefined
  breadcrumbDomValue?: (breadcrumb: ExplorerBreadcrumb<TPayload>) => string | undefined
  renderItemIcon?: (item: ExplorerItem<TPayload>, size: 'small' | 'large') => JSX.Element
  destinationPicker?: (
    action: ExplorerActionDescriptor,
    item: ExplorerItem<TPayload>,
  ) => Readonly<{
    filePath: string
    editableFolders: readonly string[]
  }> | null
  resolveActionInput?: (
    action: ExplorerActionDescriptor,
    item?: ExplorerItem<TPayload>,
  ) => ExplorerActionInputResolution | Promise<ExplorerActionInputResolution>
  onNavigate?: (location: ExplorerLocation) => void
  onOpen: (item: ExplorerItem<TPayload>) => void | Promise<void>
  onOpenContent?: (content: ContentInstance, item: ExplorerItem<TPayload>) => void | Promise<void>
  onUnsupportedChange?: (item: ExplorerItem<TPayload> | null) => void
  onCommandResult?: (
    result: ExplorerDispatchResult<TPayload>,
    action: ExplorerActionDescriptor,
    item?: ExplorerItem<TPayload>,
  ) => void
  onSnapshot?: (snapshot: ExplorerSnapshot<TPayload>) => void
  onDragStart?: (item: ExplorerItem<TPayload>, event: DragEvent) => void
  onDropOnItem?: (item: ExplorerItem<TPayload>, event: DragEvent) => void
  onDropFiles?: (files: readonly File[], location: ExplorerLocation) => void | Promise<void>
}>
