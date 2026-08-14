import type { ResourceError, ResourceKey, ResourceSummary } from '@/lib/domain/resource'

export type ExplorerViewMode = 'list' | 'grid'
export type ExplorerSortField = 'default' | 'name' | 'kind' | 'size'
export type ExplorerSortDirection = 'ascending' | 'descending'
export type ExplorerStatus = 'idle' | 'loading' | 'ready' | 'error'

export type ExplorerLocation = Readonly<{
  key: ResourceKey
  path?: string
}>

export type ExplorerActionScope = 'resource' | 'location' | 'host'
export type ExplorerOptimisticEffect = 'rename' | 'delete'
export type ExplorerActionInteraction =
  | 'immediate'
  | 'name'
  | 'destination'
  | 'upload'
  | 'paste'
  | 'text'
  | 'appearance'

export type ExplorerActionForm =
  | Readonly<{
      kind: 'choice'
      title: string
      submitLabel: string
      choices: readonly Readonly<{ label: string; value: string }>[]
    }>
  | Readonly<{
      kind: 'project'
      title: string
      submitLabel: string
    }>
  | Readonly<{
      kind: 'appearance'
      title: string
      submitLabel: string
      icons: readonly string[]
    }>

export type ExplorerActionDescriptor = Readonly<{
  id: string
  label: string
  capability: string
  scope: ExplorerActionScope
  destructive?: boolean
  optimisticEffect?: ExplorerOptimisticEffect
  interaction?: ExplorerActionInteraction
  form?: ExplorerActionForm
}>

export type ExplorerBreadcrumb<TPayload = unknown> = Readonly<{
  name: string
  location: ExplorerLocation
  capabilities: readonly string[]
  item?: ExplorerItem<TPayload>
}>

export type ExplorerItem<TPayload = unknown> = Readonly<{
  key: string
  resource: ResourceSummary
  actions: readonly ExplorerActionDescriptor[]
  payload: TPayload
}>

export type ExplorerSearchDescriptor = Readonly<{
  label: string
  placeholder: string
}>

export type ExplorerSearchResult<TPayload = unknown> = Readonly<{
  item: ExplorerItem<TPayload>
  snippet?: string
  subtitle?: string
}>

export type ExplorerItemPreview = Readonly<{
  text?: string
  mime?: string
  size?: number
  version?: number
}>

export type ExplorerRecentItem<TPayload = unknown> = Readonly<{
  item: ExplorerItem<TPayload>
  modifiedAt?: string
}>

export type ExplorerPage<TPayload = unknown> = Readonly<{
  location: ExplorerLocation
  locationItem?: ExplorerItem<TPayload>
  breadcrumbs: readonly ExplorerBreadcrumb<TPayload>[]
  items: readonly ExplorerItem<TPayload>[]
  actions: readonly ExplorerActionDescriptor[]
  nextCursor?: string
  total: number
  refreshIntervalMs?: number
  defaultFileExtension?: string
  preferredViewMode?: ExplorerViewMode
  contentSearch?: ExplorerSearchDescriptor
  recentItems?: readonly ExplorerRecentItem<TPayload>[]
}>

export type ExplorerLoadReason = 'initialize' | 'navigate' | 'refresh' | 'loadMore' | 'reconcile'

export type ExplorerBrowseRequest = Readonly<{
  location: ExplorerLocation
  cursor?: string
  pageSize?: number
  signal: AbortSignal
  reason: ExplorerLoadReason
}>

export type ExplorerSearchRequest = Readonly<{
  location: ExplorerLocation
  query: string
  signal: AbortSignal
}>

export type ExplorerCommandRequest = Readonly<{
  actionId: string
  itemKey?: string
  input?: unknown
}>

export type ExplorerCommand<TPayload = unknown> = Readonly<{
  id: string
  action: ExplorerActionDescriptor
  item: ExplorerItem<TPayload>
  input?: unknown
}>

export type ExplorerCommandReceipt = Readonly<{
  commandId?: string
  affectedResources?: readonly ResourceKey[]
  outcome?: unknown
}>

export type ExplorerOptimisticUpdater<TPayload> = (
  items: readonly ExplorerItem<TPayload>[],
  command: ExplorerCommand<TPayload>,
) => readonly ExplorerItem<TPayload>[]

export interface ExplorerDataSource<TPayload = unknown> {
  browse(request: ExplorerBrowseRequest): Promise<ExplorerPage<TPayload>>
  search?(request: ExplorerSearchRequest): Promise<readonly ExplorerSearchResult<TPayload>[]>
  preview?(item: ExplorerItem<TPayload>, signal: AbortSignal): Promise<ExplorerItemPreview>
  persistState?(location: ExplorerLocation, state: ExplorerStoredState): void | Promise<void>
  execute(command: ExplorerCommand<TPayload>, signal: AbortSignal): Promise<ExplorerCommandReceipt>
  optimisticUpdate?: ExplorerOptimisticUpdater<TPayload>
  subscribe?: (listener: () => void) => () => void
  dispose?: () => void
}

export interface ExplorerHistory {
  current(): ExplorerLocation
  push(location: ExplorerLocation): void
  replace(location: ExplorerLocation): void
  back(): void
  forward(): void
  subscribe(listener: (location: ExplorerLocation) => void): () => void
}

export type ExplorerStoredState = Readonly<{
  viewMode?: ExplorerViewMode
  sort?: Readonly<{
    field: ExplorerSortField
    direction: ExplorerSortDirection
  }>
  selection?: readonly string[]
  focusedKey?: string
}>

export interface ExplorerStorage {
  read(locationKey: string): ExplorerStoredState | undefined
  write(locationKey: string, state: ExplorerStoredState): void
}

export type ExplorerVisibleRange = Readonly<{
  startIndex: number
  endIndex: number
}>

export type ExplorerSnapshot<TPayload = unknown> = Readonly<{
  revision: number
  location: ExplorerLocation
  locationItem?: ExplorerItem<TPayload>
  breadcrumbs: readonly ExplorerBreadcrumb<TPayload>[]
  items: readonly ExplorerItem<TPayload>[]
  actions: readonly ExplorerActionDescriptor[]
  status: ExplorerStatus
  stale: boolean
  error?: ResourceError
  viewMode: ExplorerViewMode
  sort: Readonly<{
    field: ExplorerSortField
    direction: ExplorerSortDirection
  }>
  selection: readonly string[]
  focusedKey?: string
  pagination: Readonly<{
    nextCursor?: string
    total: number
    loadingMore: boolean
  }>
  visibleRange?: ExplorerVisibleRange
  pendingCommands: readonly string[]
  refreshIntervalMs?: number
  defaultFileExtension?: string
  contentSearch?: ExplorerSearchDescriptor
  recentItems: readonly ExplorerRecentItem<TPayload>[]
}>

export type ExplorerEvent =
  | Readonly<{ type: 'initialize' }>
  | Readonly<{ type: 'refresh' }>
  | Readonly<{ type: 'navigate'; location: ExplorerLocation; replace?: boolean }>
  | Readonly<{ type: 'back' }>
  | Readonly<{ type: 'forward' }>
  | Readonly<{ type: 'loadMore' }>
  | Readonly<{
      type: 'visibleRange'
      range: ExplorerVisibleRange
    }>
  | Readonly<{
      type: 'select'
      key: string
      mode?: 'replace' | 'toggle' | 'range'
    }>
  | Readonly<{ type: 'clearSelection' }>
  | Readonly<{ type: 'focusMove'; delta: number }>
  | Readonly<{
      type: 'sort'
      field: ExplorerSortField
      direction?: ExplorerSortDirection
    }>
  | Readonly<{ type: 'viewMode'; viewMode: ExplorerViewMode }>
  | Readonly<{ type: 'command'; command: ExplorerCommandRequest }>

export type ExplorerDispatchResult<TPayload = unknown> =
  | Readonly<{ kind: 'state'; snapshot: ExplorerSnapshot<TPayload> }>
  | Readonly<{ kind: 'stale' }>
  | Readonly<{ kind: 'command'; receipt: ExplorerCommandReceipt }>
  | Readonly<{ kind: 'unavailable'; error: ResourceError }>

export interface ExplorerController<TPayload = unknown> {
  getSnapshot(): ExplorerSnapshot<TPayload>
  subscribe(listener: () => void): () => void
  dispatch(event: ExplorerEvent): Promise<ExplorerDispatchResult<TPayload>>
  dispose(): void
}
