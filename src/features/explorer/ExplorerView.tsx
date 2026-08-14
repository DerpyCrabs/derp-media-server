import {
  createBrowserExplorerStorage,
  createExplorerController,
  explorerResourceKey,
} from './controller'
import { ExplorerActionDialog, type ExplorerActionDialogState } from './ExplorerActionDialog'
import { ExplorerBreadcrumbs } from './ExplorerBreadcrumbs'
import { ExplorerVirtualizedItems } from './ExplorerVirtualizedItems'
import { collectDroppedUploadFiles } from '@/lib/collect-dropped-upload-files'
import type { ContentInstance } from '@/lib/domain/content'
import { resourceIsBrowsable } from '@/lib/domain/resource'
import { extractPasteDataFromClipboardData } from '@/lib/extract-paste-data'
import type { PasteData } from '@/lib/paste-data'
import { shouldOfferPasteAsNewFile } from '@/lib/should-offer-paste-as-new-file'
import { formatFileSize } from '@/lib/media-utils'
import { MoveToDialog } from '@/src/file-browser/MoveToDialog'
import { createLongPressContextMenuHandlers } from '@/src/lib/long-press-context-menu'
import type {
  ExplorerActionDescriptor,
  ExplorerDispatchResult,
  ExplorerItem,
  ExplorerLocation,
  ExplorerSnapshot,
} from './types'
import type { ExplorerHostAction, ExplorerViewProps } from './view-types'
import ArrowLeft from 'lucide-solid/icons/arrow-left'
import ArrowRight from 'lucide-solid/icons/arrow-right'
import File from 'lucide-solid/icons/file'
import FilePlus from 'lucide-solid/icons/file-plus'
import Folder from 'lucide-solid/icons/folder'
import FolderPlus from 'lucide-solid/icons/folder-plus'
import LayoutGrid from 'lucide-solid/icons/layout-grid'
import List from 'lucide-solid/icons/list'
import LoaderCircle from 'lucide-solid/icons/loader-circle'
import MoreHorizontal from 'lucide-solid/icons/more-horizontal'
import RefreshCw from 'lucide-solid/icons/refresh-cw'
import Search from 'lucide-solid/icons/search'
import TriangleAlert from 'lucide-solid/icons/triangle-alert'
import Upload from 'lucide-solid/icons/upload'
import BookOpenText from 'lucide-solid/icons/book-open-text'
import Star from 'lucide-solid/icons/star'
import {
  For,
  Show,
  Suspense,
  createEffect,
  createMemo,
  createSignal,
  lazy,
  on,
  onCleanup,
  onMount,
} from 'solid-js'

const LazyUnsupportedViewerContent = lazy(() =>
  import('@/src/features/viewer/UnsupportedViewerContent').then((module) => ({
    default: module.UnsupportedViewerContent,
  })),
)

type MenuState<TPayload> = Readonly<{
  x: number
  y: number
  item: ExplorerItem<TPayload>
  source?: 'item' | 'breadcrumb'
}>

function browseable<TPayload>(item: ExplorerItem<TPayload>): boolean {
  return resourceIsBrowsable(item.resource)
}

function actionOperation(action: ExplorerActionDescriptor): string {
  return action.operation
}

const COMPACT_TOOLBAR_ACTIONS_WIDTH = 560

function isRename(action: ExplorerActionDescriptor): boolean {
  return action.optimisticEffect === 'rename'
}

function isContentInstance(value: unknown): value is ContentInstance {
  if (typeof value !== 'object' || value === null) return false
  const instance = value as { id?: unknown; type?: unknown }
  return (
    typeof instance.id === 'string' &&
    (instance.type === 'explorer' ||
      instance.type === 'resource' ||
      instance.type === 'integration')
  )
}

function outcomeRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function resourceMetadata<TPayload>(item: ExplorerItem<TPayload>): Record<string, unknown> {
  return (item.resource.metadata ?? {}) as Record<string, unknown>
}

function resourceSubtitle<TPayload>(item: ExplorerItem<TPayload>): string | undefined {
  const subtitle = resourceMetadata(item).subtitle
  return typeof subtitle === 'string' ? subtitle : undefined
}

function resourceViewCount<TPayload>(item: ExplorerItem<TPayload>): number | undefined {
  const count = resourceMetadata(item).viewCount
  return typeof count === 'number' && Number.isFinite(count) ? count : undefined
}

function resourceTypeLabel<TPayload>(item: ExplorerItem<TPayload>): string {
  const extension = resourceMetadata(item).extension
  return (
    item.resource.mime ??
    (typeof extension === 'string' && extension ? extension : item.resource.kind)
  )
}

function contextMenuPosition(x: number, y: number) {
  const viewportWidth = typeof window === 'undefined' ? 1_024 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight
  const top = Math.max(8, Math.min(y, viewportHeight - 520))
  return {
    left: `${Math.max(8, Math.min(x, viewportWidth - 224))}px`,
    top: `${top}px`,
    'max-height': `${Math.max(120, viewportHeight - top - 8)}px`,
  }
}

function itemIcon<TPayload>(item: ExplorerItem<TPayload>, size: 'small' | 'large') {
  const Icon = browseable(item) ? Folder : File
  return (
    <Icon
      class={size === 'large' ? 'h-12 w-12 text-muted-foreground' : 'h-5 w-5 text-muted-foreground'}
      stroke-width={1.8}
      aria-hidden='true'
    />
  )
}

export function ExplorerView<TPayload>(props: ExplorerViewProps<TPayload>) {
  const controller = createExplorerController({
    dataSource: props.dataSource,
    initialLocation: props.location(),
    ...(props.history ? { history: props.history } : {}),
    storage: props.storage ?? createBrowserExplorerStorage(),
    ...(props.pageSize ? { pageSize: props.pageSize } : {}),
    ...(props.loadMoreThreshold === undefined
      ? {}
      : { loadMoreThreshold: props.loadMoreThreshold }),
  })
  const [revision, setRevision] = createSignal(controller.getSnapshot().revision)
  const [query, setQuery] = createSignal('')
  const [contentSearchOpen, setContentSearchOpen] = createSignal(false)
  const [contentSearchQuery, setContentSearchQuery] = createSignal('')
  const [contentSearchResults, setContentSearchResults] = createSignal<
    readonly import('./types').ExplorerSearchResult<TPayload>[]
  >([])
  const [contentSearchLoading, setContentSearchLoading] = createSignal(false)
  const [menu, setMenu] = createSignal<MenuState<TPayload> | null>(null)
  const [openWithMenu, setOpenWithMenu] = createSignal(false)
  const [backgroundMenu, setBackgroundMenu] = createSignal<Readonly<{
    x: number
    y: number
  }> | null>(null)
  const [dialog, setDialog] = createSignal<ExplorerActionDialogState<TPayload> | null>(null)
  const [uploadMenuOpen, setUploadMenuOpen] = createSignal(false)
  const [toolbarActionsOpen, setToolbarActionsOpen] = createSignal(false)
  const [toolbarWidth, setToolbarWidth] = createSignal(Number.POSITIVE_INFINITY)
  const [uploadStatus, setUploadStatus] = createSignal<
    | Readonly<{ kind: 'hidden' }>
    | Readonly<{ kind: 'uploading'; count: number }>
    | Readonly<{ kind: 'success' }>
    | Readonly<{ kind: 'error'; message: string }>
  >({ kind: 'hidden' })
  const [pasteState, setPasteState] = createSignal<Readonly<{
    action: ExplorerActionDescriptor
    data: PasteData
    name: string
  }> | null>(null)
  const [pasteExistingText, setPasteExistingText] = createSignal<string | null>(null)
  const [unsupportedItem, setUnsupportedItem] = createSignal<ExplorerItem<TPayload> | null>(null)
  const [dropActive, setDropActive] = createSignal(false)
  const [draggedItem, setDraggedItem] = createSignal<ExplorerItem<TPayload> | null>(null)
  let dropDepth = 0
  let scrollElement: HTMLDivElement | undefined
  let uploadFilesInput: HTMLInputElement | undefined
  let uploadFolderInput: HTMLInputElement | undefined
  let contentSearchInput: HTMLInputElement | undefined
  let toolbarElement: HTMLDivElement | undefined
  let ownedNavigationKey: string | null = null

  const snapshot = (): ExplorerSnapshot<TPayload> => {
    void revision()
    return controller.getSnapshot()
  }
  const filteredItems = createMemo(() => {
    const normalized = query().trim().toLocaleLowerCase()
    return normalized
      ? snapshot().items.filter((item) =>
          item.resource.name.toLocaleLowerCase().includes(normalized),
        )
      : snapshot().items
  })
  const pasteExistingItem = createMemo(() => {
    const current = pasteState()
    if (!current) return undefined
    const name = current.name.trim().toLocaleLowerCase()
    return snapshot().items.find((item) => item.resource.name.toLocaleLowerCase() === name)
  })
  const parentBreadcrumb = createMemo(() => snapshot().breadcrumbs.at(-2))
  const locationActions = createMemo(() =>
    snapshot().actions.filter(
      (action) => action.scope === 'location' && action.interaction !== 'paste',
    ),
  )
  const compactPrimaryLocationActions = createMemo(() =>
    locationActions().filter((action) => {
      const operation = actionOperation(action)
      return operation === 'createFile' || operation === 'createFolder'
    }),
  )
  const compactOverflowLocationActions = createMemo(() =>
    locationActions().filter((action) => !compactPrimaryLocationActions().includes(action)),
  )
  const compactToolbarActions = createMemo(
    () =>
      toolbarWidth() < COMPACT_TOOLBAR_ACTIONS_WIDTH && compactOverflowLocationActions().length > 0,
  )
  const hostActions = (item: ExplorerItem<TPayload>): readonly ExplorerHostAction<TPayload>[] =>
    (props.hostActions?.() ?? []).filter((action) => action.available?.(item) ?? true)
  const longPressHandlers = createLongPressContextMenuHandlers()

  createEffect(() => props.onSnapshot?.(snapshot()))

  const unsubscribe = controller.subscribe(() => setRevision(controller.getSnapshot().revision))
  onMount(() => void controller.dispatch({ type: 'initialize' }))
  onMount(() => {
    if (!toolbarElement) return
    const updateWidth = () =>
      setToolbarWidth(toolbarElement?.clientWidth ?? Number.POSITIVE_INFINITY)
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(toolbarElement)
    onCleanup(() => observer.disconnect())
  })
  onCleanup(() => {
    unsubscribe()
    controller.dispose()
  })

  createEffect(
    on(
      () => explorerResourceKey(props.location().key),
      (requestedKey) => {
        if (requestedKey === ownedNavigationKey) return
        const requested = props.location()
        if (explorerResourceKey(snapshot().location.key) !== explorerResourceKey(requested.key)) {
          void controller.dispatch({ type: 'navigate', location: requested, replace: true })
        }
      },
      { defer: true },
    ),
  )

  createEffect(() => {
    const interval = snapshot().refreshIntervalMs
    if (!interval) return
    const timer = window.setInterval(() => void controller.dispatch({ type: 'refresh' }), interval)
    onCleanup(() => window.clearInterval(timer))
  })

  createEffect(() => {
    const current = pasteState()
    const existing = pasteExistingItem()
    const preview = props.dataSource.preview
    setPasteExistingText(null)
    if (!current?.data.isTextContent || !existing || !preview) return
    const abort = new AbortController()
    void preview(existing, abort.signal)
      .then((result) => {
        if (!abort.signal.aborted) setPasteExistingText(result.text ?? '')
      })
      .catch(() => {
        if (!abort.signal.aborted) setPasteExistingText('Unable to load existing text preview')
      })
    onCleanup(() => abort.abort())
  })

  createEffect(() => {
    if (!snapshot().contentSearch) {
      setContentSearchOpen(false)
      setContentSearchQuery('')
      setContentSearchResults([])
      return
    }
    const search = props.dataSource.search
    const value = contentSearchQuery().trim()
    if (!contentSearchOpen() || !search || !value) {
      setContentSearchResults([])
      setContentSearchLoading(false)
      return
    }
    const abort = new AbortController()
    const timer = window.setTimeout(() => {
      setContentSearchLoading(true)
      void search({ location: snapshot().location, query: value, signal: abort.signal })
        .then((results) => {
          if (!abort.signal.aborted) setContentSearchResults(results)
        })
        .catch(() => {
          if (!abort.signal.aborted) setContentSearchResults([])
        })
        .finally(() => {
          if (!abort.signal.aborted) setContentSearchLoading(false)
        })
    }, 250)
    onCleanup(() => {
      window.clearTimeout(timer)
      abort.abort()
    })
  })

  onMount(() => {
    const handleSearchShortcut = (event: KeyboardEvent) => {
      if (!snapshot().contentSearch || !(props.active?.() ?? true)) return
      const target = event.target
      const inTextField =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault()
      } else if (event.key === '/' && !inTextField) {
        event.preventDefault()
      } else {
        return
      }
      setContentSearchOpen(true)
      queueMicrotask(() => contentSearchInput?.focus())
    }
    document.addEventListener('keydown', handleSearchShortcut)
    onCleanup(() => document.removeEventListener('keydown', handleSearchShortcut))
  })

  createEffect(() => {
    if (!menu() && !backgroundMenu()) return
    const dismiss = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element) || !target.closest('[data-explorer-action-menu]')) {
        setMenu(null)
        setBackgroundMenu(null)
      }
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMenu(null)
      setBackgroundMenu(null)
    }
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('keydown', escape)
    onCleanup(() => {
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('keydown', escape)
    })
  })

  createEffect(() => {
    if (!menu()) setOpenWithMenu(false)
  })

  createEffect(() => {
    if (!compactToolbarActions()) setToolbarActionsOpen(false)
  })

  createEffect(() => {
    if (!toolbarActionsOpen()) return
    const dismiss = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element) || !target.closest('[data-explorer-toolbar-actions]')) {
        setToolbarActionsOpen(false)
      }
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setToolbarActionsOpen(false)
    }
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('keydown', escape)
    onCleanup(() => {
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('keydown', escape)
    })
  })

  async function navigate(location: ExplorerLocation) {
    const key = explorerResourceKey(location.key)
    ownedNavigationKey = key
    try {
      const result = await controller.dispatch({ type: 'navigate', location })
      if (result.kind === 'state') props.onNavigate?.(result.snapshot.location)
    } finally {
      if (ownedNavigationKey === key) ownedNavigationKey = null
    }
  }

  async function openItem(item: ExplorerItem<TPayload>, event?: MouseEvent) {
    await controller.dispatch({
      type: 'select',
      key: item.key,
      mode: event?.shiftKey ? 'range' : event?.metaKey || event?.ctrlKey ? 'toggle' : 'replace',
    })
    if (event?.metaKey || event?.ctrlKey || event?.shiftKey) return
    if (browseable(item)) await navigate({ key: item.resource.key })
    else {
      const providerOpen = item.actions.find((action) => actionOperation(action) === 'open')
      if (providerOpen) await runAction(providerOpen, item)
      else if (item.resource.presentation === 'unsupported') {
        if (props.onUnsupportedChange) props.onUnsupportedChange(item)
        else setUnsupportedItem(item)
      } else await props.onOpen(item)
    }
  }

  async function runAction(
    action: ExplorerActionDescriptor,
    item?: ExplorerItem<TPayload>,
    input?: unknown,
  ) {
    const result = await controller.dispatch({
      type: 'command',
      command: {
        actionId: action.id,
        ...(item ? { itemKey: item.key } : {}),
        ...(input === undefined ? {} : { input }),
      },
    })
    if (result.kind === 'command') {
      const outcome = outcomeRecord(result.receipt.outcome)
      const content = outcome?.content
      if (item && isContentInstance(content)) await props.onOpenContent?.(content, item)
      const value = outcomeRecord(outcome?.value)
      if (typeof value?.text === 'string') await navigator.clipboard?.writeText(value.text)
      if (typeof value?.url === 'string') {
        const link = document.createElement('a')
        link.href = value.url
        link.download =
          typeof value.filename === 'string' ? value.filename : (item?.resource.name ?? '')
        link.click()
      }
    }
    props.onCommandResult?.(result, action, item)
    return result
  }

  async function invokeAction(action: ExplorerActionDescriptor, item?: ExplorerItem<TPayload>) {
    setMenu(null)
    if (action.interaction === 'upload') {
      setUploadMenuOpen((open) => !open)
      return
    }
    if (action.interaction === 'paste') return
    if (
      isRename(action) ||
      action.destructive ||
      action.interaction === 'name' ||
      action.interaction === 'destination' ||
      action.interaction === 'text' ||
      action.interaction === 'appearance'
    ) {
      setDialog({ action, ...(item ? { item } : {}) })
      return
    }
    const resolved = await props.resolveActionInput?.(action, item)
    if (resolved && !resolved.run) return
    await runAction(action, item, resolved?.input)
  }

  async function submitDialog(input?: unknown) {
    const current = dialog()
    if (!current) return
    const result = await runAction(current.action, current.item, input)
    if (result.kind === 'command') {
      setDialog(null)
      if (actionOperation(current.action) === 'createFile') {
        const name = outcomeRecord(input)?.name
        const created =
          typeof name === 'string'
            ? snapshot().items.find((item) => item.resource.name === name)
            : undefined
        if (created) await props.onOpen(created)
      }
    }
  }

  async function uploadFiles(files: readonly File[]) {
    const action = snapshot().actions.find((candidate) => candidate.interaction === 'upload')
    if (!action || files.length === 0) return
    setUploadMenuOpen(false)
    setUploadStatus({ kind: 'uploading', count: files.length })
    const result = await runAction(action, undefined, { files })
    if (result.kind === 'command') {
      setUploadStatus({ kind: 'success' })
      window.setTimeout(() => setUploadStatus({ kind: 'hidden' }), 2_000)
    } else if (result.kind === 'unavailable') {
      setUploadStatus({ kind: 'error', message: result.error.message })
    }
  }

  function handleUploadInput(event: Event & { currentTarget: HTMLInputElement }) {
    const input = event.currentTarget
    const files = [...(input.files ?? [])].map((file) => {
      const name = file.webkitRelativePath || file.name
      return new globalThis.File([file], name, {
        type: file.type,
        lastModified: file.lastModified,
      })
    })
    input.value = ''
    void uploadFiles(files)
  }

  async function handlePaste(event: ClipboardEvent) {
    const action = snapshot().actions.find((candidate) => candidate.interaction === 'paste')
    if (!action || !shouldOfferPasteAsNewFile(event)) return
    const data = await extractPasteDataFromClipboardData(event.clipboardData, {
      textSuggestedExtension: snapshot().defaultFileExtension === 'md' ? 'md' : 'txt',
    })
    if (!data) return
    event.preventDefault()
    setPasteState({ action, data, name: data.suggestedName })
  }

  onMount(() => {
    const handleDocumentPaste = (event: ClipboardEvent) => {
      if (!(props.active?.() ?? true)) return
      const target = event.target
      if (target instanceof Element && target.closest('[data-explorer-root]')) return
      void handlePaste(event)
    }
    document.addEventListener('paste', handleDocumentPaste)
    onCleanup(() => document.removeEventListener('paste', handleDocumentPaste))
  })

  async function submitPaste(mode: 'create' | 'replace' = 'create') {
    const current = pasteState()
    if (!current || !current.name.trim()) return
    const result = await runAction(current.action, undefined, {
      name: current.name.trim(),
      mode,
      ...(mode === 'replace' && typeof pasteExistingItem()?.resource.metadata?.version === 'number'
        ? { expectedVersion: pasteExistingItem()!.resource.metadata!.version }
        : {}),
      ...(current.data.isTextContent
        ? { content: current.data.content }
        : { base64Content: current.data.content }),
    })
    if (result.kind === 'command') {
      setPasteState(null)
      const created = snapshot().items.find(
        (item) => item.resource.name.toLocaleLowerCase() === current.name.toLocaleLowerCase(),
      )
      if (created) await props.onOpen(created)
    }
  }

  function handleKeyboard(event: KeyboardEvent) {
    if (!(props.active?.() ?? true)) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      void controller.dispatch({ type: 'focusMove', delta: event.key === 'ArrowDown' ? 1 : -1 })
      return
    }
    if (event.key === 'Enter') {
      const item = snapshot().items.find((candidate) => candidate.key === snapshot().focusedKey)
      if (item) void openItem(item)
    }
  }

  function fileDrop(event: DragEvent): boolean {
    return !!event.dataTransfer?.types.includes('Files')
  }

  function startItemDrag(item: ExplorerItem<TPayload>, event: DragEvent) {
    setDraggedItem(item)
    props.onDragStart?.(item, event)
  }

  function endItemDrag() {
    setDraggedItem(null)
  }

  function dragOverItem(item: ExplorerItem<TPayload>, event: DragEvent) {
    const source = draggedItem()
    const move = source?.actions.find((action) => actionOperation(action) === 'move')
    if (source) {
      if (
        move &&
        browseable(item) &&
        source.key !== item.key &&
        (props.canMoveItem?.(source, item) ?? true)
      ) {
        event.preventDefault()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
      }
      return
    }
    if (props.onDropOnItem) event.preventDefault()
  }

  function dropOnItem(item: ExplorerItem<TPayload>, event: DragEvent) {
    const source = draggedItem()
    const move = source?.actions.find((action) => actionOperation(action) === 'move')
    if (source) {
      if (
        move &&
        browseable(item) &&
        source.key !== item.key &&
        (props.canMoveItem?.(source, item) ?? true)
      ) {
        event.preventDefault()
        setDraggedItem(null)
        void runAction(move, source, { destination: item.resource.key })
      }
      return
    }
    props.onDropOnItem?.(item, event)
  }

  function dragEnter(event: DragEvent) {
    const acceptsUpload = snapshot().actions.some((action) => action.interaction === 'upload')
    if ((!props.onDropFiles && !acceptsUpload) || !fileDrop(event)) return
    event.preventDefault()
    dropDepth += 1
    setDropActive(true)
  }

  function dragLeave(event: DragEvent) {
    if (!fileDrop(event)) return
    event.preventDefault()
    dropDepth = Math.max(0, dropDepth - 1)
    if (dropDepth === 0) setDropActive(false)
  }

  function dropFiles(event: DragEvent) {
    const acceptsUpload = snapshot().actions.some((action) => action.interaction === 'upload')
    if ((!props.onDropFiles && !acceptsUpload) || !fileDrop(event)) return
    event.preventDefault()
    dropDepth = 0
    setDropActive(false)
    const transfer = event.dataTransfer
    if (!transfer) return
    void collectDroppedUploadFiles(transfer).then((files) => {
      if (files.length === 0) return
      if (props.onDropFiles) void props.onDropFiles(files, snapshot().location)
      else void uploadFiles(files)
    })
  }

  const renderListHeader = () => (
    <>
      <thead class='sticky top-0 z-10 bg-background/95 text-left text-xs text-muted-foreground backdrop-blur'>
        <tr class='border-b border-border'>
          <th class='explorer-list-icon w-16 p-2' />
          <th class='p-2 font-medium'>Name</th>
          <th class='explorer-list-kind w-28 p-2 font-medium'>Kind</th>
          <th class='explorer-list-size w-24 p-2 text-right font-medium'>Size</th>
          <th class='explorer-list-actions w-16 p-2' />
        </tr>
      </thead>
      <Show when={parentBreadcrumb()} keyed>
        {(parent) => (
          <tbody>
            <tr
              class='cursor-pointer border-b border-border hover:bg-muted/50'
              onClick={() => void navigate(parent.location)}
            >
              <td class='explorer-list-icon p-2 text-center'>
                <ArrowLeft class='inline h-4 w-4' />
              </td>
              <td class='p-2 font-medium'>..</td>
              <td class='explorer-list-kind p-2 text-muted-foreground'>folder</td>
              <td class='explorer-list-size p-2' />
              <td class='explorer-list-actions p-2' />
            </tr>
          </tbody>
        )}
      </Show>
    </>
  )

  const renderListRow = (item: ExplorerItem<TPayload>) => (
    <tr
      data-file-path={props.itemDomValue?.(item)}
      data-file-view-count={resourceViewCount(item)}
      data-resource-key={item.key}
      class='group cursor-pointer border-b border-border hover:bg-muted/50'
      classList={{
        'bg-primary/10': snapshot().selection.includes(item.key),
        'ring-1 ring-inset ring-primary/50': snapshot().focusedKey === item.key,
      }}
      tabindex={snapshot().focusedKey === item.key ? 0 : -1}
      draggable={
        !!props.onDragStart || item.actions.some((action) => actionOperation(action) === 'move')
      }
      onClick={(event) => void openItem(item, event)}
      onContextMenu={(event) => {
        event.preventDefault()
        void controller.dispatch({ type: 'select', key: item.key })
        setMenu({ x: event.clientX, y: event.clientY, item })
      }}
      {...longPressHandlers}
      onDragStart={(event) => startItemDrag(item, event)}
      onDragEnd={endItemDrag}
      onDragOver={(event) => dragOverItem(item, event)}
      onDrop={(event) => dropOnItem(item, event)}
    >
      <td class='explorer-list-icon p-2 text-center'>
        <span
          class='inline-flex'
          data-kb-root-icon={resourceMetadata(item).knowledgeBase === true ? 'true' : undefined}
        >
          {props.renderItemIcon?.(item, 'small') ?? itemIcon(item, 'small')}
        </span>
      </td>
      <td class='truncate p-2 font-medium' title={item.resource.name}>
        <div class='truncate'>{item.resource.name}</div>
        <Show when={resourceSubtitle(item)}>
          <div class='truncate text-[11px] font-normal text-muted-foreground'>
            {resourceSubtitle(item)}
          </div>
        </Show>
      </td>
      <td class='explorer-list-kind truncate p-2 text-muted-foreground'>{item.resource.kind}</td>
      <td class='explorer-list-size p-2 text-right tabular-nums text-muted-foreground'>
        <Show when={resourceViewCount(item) !== undefined}>
          <span data-testid='file-view-count' class='mr-2'>
            {resourceViewCount(item)} views
          </span>
        </Show>
        {item.resource.size === undefined ? '' : formatFileSize(item.resource.size)}
      </td>
      <td class='explorer-list-actions p-2'>
        <Show when={item.actions.find((action) => actionOperation(action) === 'favorite')} keyed>
          {(favoriteAction) => (
            <button
              type='button'
              class='explorer-list-favorite inline-flex size-11 items-center justify-center rounded opacity-100 hover:bg-muted md:size-7 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100'
              title={
                resourceMetadata(item).favorite === true
                  ? 'Remove from favorites'
                  : 'Add to favorites'
              }
              aria-label={
                resourceMetadata(item).favorite === true
                  ? 'Remove from favorites'
                  : 'Add to favorites'
              }
              onClick={(event) => {
                event.stopPropagation()
                void invokeAction(favoriteAction, item)
              }}
            >
              <Star
                class='h-4 w-4'
                fill={resourceMetadata(item).favorite === true ? 'currentColor' : 'none'}
              />
            </button>
          )}
        </Show>
        <button
          type='button'
          class='inline-flex size-11 items-center justify-center rounded opacity-100 hover:bg-muted md:size-7 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100'
          aria-label={`More actions for ${item.resource.name}`}
          onClick={(event) => {
            event.stopPropagation()
            const rect = event.currentTarget.getBoundingClientRect()
            setMenu({ x: rect.right, y: rect.bottom, item })
          }}
        >
          <MoreHorizontal class='h-4 w-4' />
        </button>
      </td>
    </tr>
  )

  const renderGridItem = (item: ExplorerItem<TPayload>) => (
    <div
      role='button'
      tabindex={snapshot().focusedKey === item.key ? 0 : -1}
      data-file-path={props.itemDomValue?.(item)}
      data-file-view-count={resourceViewCount(item)}
      data-resource-key={item.key}
      class='group relative flex min-h-32 flex-col items-center justify-center gap-3 overflow-hidden rounded-xl border border-border bg-card p-3 text-center hover:bg-muted/50'
      classList={{
        'border-primary bg-primary/10': snapshot().selection.includes(item.key),
        'ring-2 ring-primary/50': snapshot().focusedKey === item.key,
      }}
      draggable={
        !!props.onDragStart || item.actions.some((action) => actionOperation(action) === 'move')
      }
      onClick={(event) => void openItem(item, event)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          void openItem(item)
        }
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        void controller.dispatch({ type: 'select', key: item.key })
        setMenu({ x: event.clientX, y: event.clientY, item })
      }}
      {...longPressHandlers}
      onDragStart={(event) => startItemDrag(item, event)}
      onDragEnd={endItemDrag}
      onDragOver={(event) => dragOverItem(item, event)}
      onDrop={(event) => dropOnItem(item, event)}
    >
      <Show when={item.actions.find((action) => actionOperation(action) === 'favorite')} keyed>
        {(favoriteAction) => (
          <button
            type='button'
            class='absolute top-1 right-1 z-10 inline-flex size-11 items-center justify-center rounded bg-background/80 opacity-100 hover:bg-muted md:size-7 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100'
            title={
              resourceMetadata(item).favorite === true
                ? 'Remove from favorites'
                : 'Add to favorites'
            }
            aria-label={
              resourceMetadata(item).favorite === true
                ? 'Remove from favorites'
                : 'Add to favorites'
            }
            onClick={(event) => {
              event.stopPropagation()
              void invokeAction(favoriteAction, item)
            }}
          >
            <Star
              class='h-4 w-4'
              fill={resourceMetadata(item).favorite === true ? 'currentColor' : 'none'}
            />
          </button>
        )}
      </Show>
      <button
        type='button'
        class='absolute top-1 left-1 z-10 inline-flex size-11 items-center justify-center rounded bg-background/80 opacity-100 hover:bg-muted md:size-7 md:opacity-0 md:group-hover:opacity-100 md:focus:opacity-100'
        aria-label={`More actions for ${item.resource.name}`}
        onClick={(event) => {
          event.stopPropagation()
          const rect = event.currentTarget.getBoundingClientRect()
          setMenu({ x: rect.right, y: rect.bottom, item })
        }}
      >
        <MoreHorizontal class='h-4 w-4' />
      </button>
      <span
        class='inline-flex'
        data-kb-root-icon={resourceMetadata(item).knowledgeBase === true ? 'true' : undefined}
      >
        {props.renderItemIcon?.(item, 'large') ?? itemIcon(item, 'large')}
      </span>
      <span class='w-full truncate text-sm font-medium' title={item.resource.name}>
        {item.resource.name}
      </span>
      <Show when={resourceSubtitle(item)}>
        <span class='w-full truncate text-xs text-muted-foreground'>{resourceSubtitle(item)}</span>
      </Show>
    </div>
  )

  return (
    <div
      class='relative flex flex-1 flex-col bg-background text-foreground'
      classList={{
        'h-full min-h-0 overflow-hidden': props.scrollMode !== 'window',
        'min-h-screen': props.scrollMode === 'window',
      }}
      data-testid={props.testId ?? 'shared-explorer'}
      data-explorer-root
      tabindex={0}
      onKeyDown={handleKeyboard}
      onDragEnter={dragEnter}
      onDragLeave={dragLeave}
      onDragOver={(event) =>
        (props.onDropFiles ||
          snapshot().actions.some((action) => action.interaction === 'upload')) &&
        fileDrop(event) &&
        event.preventDefault()
      }
      onDrop={dropFiles}
      onPaste={(event) => {
        if (props.active?.() ?? true) void handlePaste(event)
      }}
    >
      <div
        ref={(element) => {
          toolbarElement = element
        }}
        class='flex min-h-9 shrink-0 items-center gap-1 border-b border-border bg-muted/40 px-2'
      >
        <button
          type='button'
          class='inline-flex h-7 w-7 items-center justify-center rounded hover:bg-muted disabled:opacity-40'
          aria-label='Back'
          disabled={!props.history}
          onClick={() => void controller.dispatch({ type: 'back' })}
        >
          <ArrowLeft class='h-4 w-4' />
        </button>
        <button
          type='button'
          class='inline-flex h-7 w-7 items-center justify-center rounded hover:bg-muted disabled:opacity-40'
          aria-label='Forward'
          disabled={!props.history}
          onClick={() => void controller.dispatch({ type: 'forward' })}
        >
          <ArrowRight class='h-4 w-4' />
        </button>
        <div
          data-testid='breadcrumb-slot'
          data-breadcrumb-slot
          class={`relative flex w-0 flex-1 items-center overflow-hidden whitespace-nowrap ${
            compactToolbarActions() ? 'min-w-24' : 'min-w-0'
          }`}
        >
          <ExplorerBreadcrumbs
            breadcrumbs={() => snapshot().breadcrumbs}
            displayMode={props.displayMode}
            domValue={props.breadcrumbDomValue}
            onNavigate={(location) => void navigate(location)}
            onContextMenu={(event, crumb) => {
              if (!crumb.item) return
              setMenu({
                x: event.clientX,
                y: event.clientY,
                item: crumb.item,
                source: 'breadcrumb',
              })
            }}
          />
        </div>
        <Show when={snapshot().contentSearch}>
          <button
            type='button'
            class='inline-flex h-7 w-7 items-center justify-center rounded hover:bg-muted'
            aria-label={snapshot().contentSearch?.label ?? 'Search contents'}
            title={`${snapshot().contentSearch?.label ?? 'Search contents'} (Ctrl+K)`}
            aria-pressed={contentSearchOpen()}
            onClick={() => {
              setContentSearchOpen((open) => !open)
              queueMicrotask(() => contentSearchInput?.focus())
            }}
          >
            <BookOpenText class='h-3.5 w-3.5' />
          </button>
        </Show>
        <For each={compactToolbarActions() ? compactPrimaryLocationActions() : locationActions()}>
          {(action) => (
            <div class='relative'>
              <button
                type='button'
                class='inline-flex h-7 min-w-7 items-center justify-center rounded px-1.5 text-xs hover:bg-muted disabled:opacity-50'
                disabled={snapshot().pendingCommands.length > 0}
                aria-label={
                  actionOperation(action) === 'createFile'
                    ? action.label.toLocaleLowerCase().startsWith('create new')
                      ? 'New file'
                      : action.label
                    : actionOperation(action) === 'createFolder'
                      ? action.label.toLocaleLowerCase().startsWith('create new')
                        ? 'New folder'
                        : action.label
                      : action.label
                }
                title={action.label}
                aria-expanded={action.interaction === 'upload' ? uploadMenuOpen() : undefined}
                onClick={() => void invokeAction(action)}
              >
                <Show
                  when={actionOperation(action) === 'createFile'}
                  fallback={
                    <Show
                      when={actionOperation(action) === 'createFolder'}
                      fallback={
                        <Show when={action.interaction === 'upload'} fallback={action.label}>
                          <Upload class='h-3.5 w-3.5' />
                        </Show>
                      }
                    >
                      <FolderPlus class='h-3.5 w-3.5' />
                    </Show>
                  }
                >
                  <FilePlus class='h-3.5 w-3.5' />
                </Show>
              </button>
              <Show when={action.interaction === 'upload' && uploadMenuOpen()}>
                <div
                  data-upload-menu
                  class='absolute top-full right-0 z-50 mt-1 min-w-36 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md'
                  role='menu'
                >
                  <button
                    type='button'
                    role='menuitem'
                    class='block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted'
                    onClick={() => uploadFilesInput?.click()}
                  >
                    Upload files
                  </button>
                  <button
                    type='button'
                    role='menuitem'
                    class='block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted'
                    onClick={() => uploadFolderInput?.click()}
                  >
                    Upload folder
                  </button>
                </div>
              </Show>
            </div>
          )}
        </For>
        <Show when={compactToolbarActions()}>
          <div class='relative shrink-0' data-explorer-toolbar-actions>
            <button
              type='button'
              class='inline-flex h-7 w-7 items-center justify-center rounded hover:bg-muted'
              aria-label='Location actions'
              title='Location actions'
              aria-haspopup='menu'
              aria-expanded={toolbarActionsOpen()}
              onClick={() => setToolbarActionsOpen((open) => !open)}
            >
              <MoreHorizontal class='h-3.5 w-3.5' />
            </button>
            <Show when={toolbarActionsOpen()}>
              <div
                data-testid='explorer-location-actions-menu'
                role='menu'
                class='absolute top-full right-0 z-[10020] mt-1 max-h-72 min-w-48 overflow-y-auto rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg'
              >
                <For each={compactOverflowLocationActions()}>
                  {(action) => (
                    <Show
                      when={action.interaction === 'upload'}
                      fallback={
                        <button
                          type='button'
                          role='menuitem'
                          class='block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50'
                          disabled={snapshot().pendingCommands.length > 0}
                          onClick={() => {
                            setToolbarActionsOpen(false)
                            void invokeAction(action)
                          }}
                        >
                          {action.label}
                        </button>
                      }
                    >
                      <button
                        type='button'
                        role='menuitem'
                        class='block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50'
                        disabled={snapshot().pendingCommands.length > 0}
                        onClick={() => {
                          setToolbarActionsOpen(false)
                          uploadFilesInput?.click()
                        }}
                      >
                        Upload files
                      </button>
                      <button
                        type='button'
                        role='menuitem'
                        class='block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted disabled:opacity-50'
                        disabled={snapshot().pendingCommands.length > 0}
                        onClick={() => {
                          setToolbarActionsOpen(false)
                          uploadFolderInput?.click()
                        }}
                      >
                        Upload folder
                      </button>
                    </Show>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>
        <input
          ref={(element) => {
            uploadFilesInput = element
          }}
          class='hidden'
          type='file'
          multiple
          onChange={handleUploadInput}
        />
        <input
          ref={(element) => {
            uploadFolderInput = element
          }}
          class='hidden'
          type='file'
          multiple
          {...({ webkitdirectory: '' } as { webkitdirectory: string })}
          onChange={handleUploadInput}
        />
        {props.toolbarEnd?.()}
        <button
          type='button'
          class='inline-flex h-7 w-7 items-center justify-center rounded hover:bg-muted'
          aria-label='Refresh'
          onClick={() => void controller.dispatch({ type: 'refresh' })}
        >
          <RefreshCw class='h-3.5 w-3.5' />
        </button>
        <button
          type='button'
          class='inline-flex h-7 w-7 items-center justify-center rounded hover:bg-muted'
          aria-label='List view'
          aria-pressed={snapshot().viewMode === 'list'}
          onClick={() => void controller.dispatch({ type: 'viewMode', viewMode: 'list' })}
        >
          <List class='h-3.5 w-3.5' />
        </button>
        <button
          type='button'
          class='inline-flex h-7 w-7 items-center justify-center rounded hover:bg-muted'
          aria-label='Grid view'
          aria-pressed={snapshot().viewMode === 'grid'}
          onClick={() => void controller.dispatch({ type: 'viewMode', viewMode: 'grid' })}
        >
          <LayoutGrid class='h-3.5 w-3.5' />
        </button>
      </div>

      <Show when={snapshot().contentSearch && contentSearchOpen()}>
        <div class='shrink-0 border-b border-border bg-muted/20 p-2' data-testid='kb-search-bar'>
          <input
            ref={(element) => {
              contentSearchInput = element
            }}
            type='text'
            placeholder={snapshot().contentSearch?.placeholder ?? 'Search contents...'}
            autocomplete='off'
            class='h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
            value={contentSearchQuery()}
            onInput={(event) => setContentSearchQuery(event.currentTarget.value)}
          />
        </div>
      </Show>

      <Show when={!contentSearchOpen() && snapshot().recentItems.length > 0}>
        <div
          data-testid='kb-recent-strip'
          class='flex min-w-0 shrink-0 gap-1 overflow-x-auto border-b border-border bg-muted/20 p-1.5'
        >
          <For each={snapshot().recentItems}>
            {(recent) => (
              <button
                type='button'
                class='flex shrink-0 items-center gap-1.5 rounded border border-border bg-background px-2 py-1 text-xs hover:bg-muted'
                draggable={!!props.onDragStart}
                onDragStart={(event) => props.onDragStart?.(recent.item, event)}
                onClick={() => void openItem(recent.item)}
              >
                <File class='h-3.5 w-3.5 text-muted-foreground' />
                <span class='max-w-40 truncate font-medium'>{recent.item.resource.name}</span>
              </button>
            )}
          </For>
        </div>
      </Show>

      <div class='flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5'>
        <label class='relative min-w-0 flex-1'>
          <span class='sr-only'>Search files</span>
          <Search class='pointer-events-none absolute top-1/2 left-2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground' />
          <input
            type='search'
            class='h-8 w-full rounded-md border border-input bg-background pr-2 pl-7 text-sm'
            placeholder={props.searchPlaceholder ?? 'Search this location'}
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </label>
        <select
          aria-label='Sort files'
          class='h-8 rounded-md border border-input bg-background px-2 text-xs'
          value={`${snapshot().sort.field}:${snapshot().sort.direction}`}
          onChange={(event) => {
            const [field, direction] = event.currentTarget.value.split(':') as [
              ExplorerSnapshot<TPayload>['sort']['field'],
              ExplorerSnapshot<TPayload>['sort']['direction'],
            ]
            void controller.dispatch({ type: 'sort', field, direction })
          }}
        >
          <option value='default:ascending'>Default</option>
          <option value='name:ascending'>Name A–Z</option>
          <option value='name:descending'>Name Z–A</option>
          <option value='kind:ascending'>Kind</option>
          <option value='size:ascending'>Size ascending</option>
          <option value='size:descending'>Size descending</option>
        </select>
      </div>

      <Show when={snapshot().error}>
        {(error) => (
          <div
            class={`flex items-center gap-2 border-b px-3 py-2 text-sm ${
              snapshot().stale
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-700'
                : 'border-destructive/30 bg-destructive/10 text-destructive'
            }`}
            role='alert'
            data-testid={snapshot().stale ? 'directory-refresh-error' : 'directory-list-error'}
          >
            <TriangleAlert class='h-4 w-4 shrink-0' />
            <span class='min-w-0 flex-1 truncate'>{error().message}</span>
            <button
              type='button'
              class='rounded border border-current/30 px-2 py-1 text-xs'
              onClick={() => void controller.dispatch({ type: 'refresh' })}
            >
              Retry
            </button>
          </div>
        )}
      </Show>

      <div
        ref={(element) => {
          scrollElement = element
        }}
        class='relative min-h-0 flex-1'
        classList={{
          'overflow-auto': props.scrollMode !== 'window',
          'overflow-visible': props.scrollMode === 'window',
        }}
        data-testid={props.dropZoneTestId ?? 'upload-drop-zone'}
        tabindex={-1}
        onContextMenu={(event) => {
          const target = event.target
          if (target instanceof Element && target.closest('[data-resource-key]')) return
          event.preventDefault()
          setBackgroundMenu({ x: event.clientX, y: event.clientY })
        }}
      >
        <Show when={contentSearchOpen() && contentSearchQuery().trim()}>
          <div class='absolute inset-0 z-20 overflow-auto bg-background'>
            <Show
              when={!contentSearchLoading()}
              fallback={
                <div class='flex h-full items-center justify-center gap-2 text-sm text-muted-foreground'>
                  <LoaderCircle class='h-4 w-4 animate-spin' />
                  Searching…
                </div>
              }
            >
              <Show
                when={contentSearchResults().length > 0}
                fallback={
                  <div class='flex h-full items-center justify-center text-sm text-muted-foreground'>
                    No results for &quot;{contentSearchQuery().trim()}&quot;
                  </div>
                }
              >
                <div class='divide-y divide-border'>
                  <For each={contentSearchResults()}>
                    {(result) => (
                      <button
                        type='button'
                        data-kb-search-result
                        class='block w-full px-3 py-3 text-left hover:bg-muted/50 focus:ring-2 focus:ring-inset focus:ring-ring focus:outline-none'
                        onClick={() => void openItem(result.item)}
                      >
                        <div class='truncate font-medium'>{result.item.resource.name}</div>
                        <Show when={result.subtitle}>
                          <div class='mt-0.5 truncate text-xs text-muted-foreground'>
                            {result.subtitle}
                          </div>
                        </Show>
                        <Show when={result.snippet}>
                          <div class='mt-1 line-clamp-2 text-sm text-muted-foreground'>
                            {result.snippet}
                          </div>
                        </Show>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </Show>
          </div>
        </Show>
        <Show
          when={snapshot().status !== 'loading' || snapshot().items.length > 0}
          fallback={
            <div
              data-testid='directory-loading'
              class='flex h-full items-center justify-center gap-2 text-sm text-muted-foreground'
            >
              <LoaderCircle class='h-4 w-4 animate-spin' />
              Loading…
            </div>
          }
        >
          <Show
            when={filteredItems().length > 0}
            fallback={
              <div data-testid='directory-empty' class='h-full text-sm text-muted-foreground'>
                <Show
                  when={snapshot().viewMode === 'list' && !query()}
                  fallback={
                    <div class='flex h-full items-center justify-center p-6'>
                      {query()
                        ? 'No matching resources.'
                        : (props.emptyLabel ?? 'This folder is empty')}
                    </div>
                  }
                >
                  <table class='w-full table-fixed border-collapse'>
                    <tbody>
                      <Show when={parentBreadcrumb()} keyed>
                        {(parent) => (
                          <tr
                            class='cursor-pointer border-b border-border hover:bg-muted/50'
                            onClick={() => void navigate(parent.location)}
                          >
                            <td class='w-20 p-2 text-center'>
                              <ArrowLeft class='inline h-4 w-4' />
                            </td>
                            <td class='p-2 font-medium'>..</td>
                            <td class='w-28 p-2' />
                            <td class='w-24 p-2' />
                            <td class='w-10 p-2' />
                          </tr>
                        )}
                      </Show>
                      <tr>
                        <td colspan='5' class='p-6 text-center'>
                          {props.emptyLabel ?? 'This folder is empty'}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </Show>
              </div>
            }
          >
            <ExplorerVirtualizedItems
              items={filteredItems}
              viewMode={() => snapshot().viewMode}
              getScrollElement={() => scrollElement}
              scrollMode={props.scrollMode}
              renderListHeader={renderListHeader}
              renderListRow={renderListRow}
              renderGridItem={renderGridItem}
              listColumnCount={5}
              listWrapperClass='explorer-list-container overflow-x-hidden'
              listClass='border-collapse text-sm'
              onVisibleRange={(range) => void controller.dispatch({ type: 'visibleRange', range })}
            />
          </Show>
          <Show when={snapshot().pagination.loadingMore}>
            <div class='flex items-center justify-center gap-2 p-3 text-xs text-muted-foreground'>
              <LoaderCircle class='h-3.5 w-3.5 animate-spin' />
              Loading more…
            </div>
          </Show>
        </Show>
      </div>

      <Show when={dropActive()}>
        <div class='pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/85 text-sm font-medium text-primary backdrop-blur-sm'>
          Drop files to upload
        </div>
      </Show>

      <Show when={menu()} keyed>
        {(current) => (
          <div
            data-explorer-action-menu
            data-slot={
              current.source === 'breadcrumb' ? 'breadcrumb-context-menu' : 'file-row-context-menu'
            }
            role='menu'
            class='fixed z-[10000] min-w-48 overflow-y-auto rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg'
            style={contextMenuPosition(current.x, current.y)}
          >
            <For each={current.item.actions}>
              {(action) => (
                <button
                  type='button'
                  role='menuitem'
                  data-slot='context-menu-item'
                  data-testid={
                    actionOperation(action) === 'customIcon'
                      ? 'breadcrumb-menu-set-icon'
                      : undefined
                  }
                  class={`block w-full rounded px-2 py-1.5 text-left hover:bg-muted ${
                    action.destructive ? 'text-destructive' : ''
                  }`}
                  onClick={() => void invokeAction(action, current.item)}
                >
                  {action.label}
                </button>
              )}
            </For>
            <Show when={current.item.actions.length > 0 && hostActions(current.item).length > 0}>
              <div class='my-1 h-px bg-border' />
            </Show>
            <For
              each={hostActions(current.item).filter(
                (action) => actionOperation(action.descriptor) !== 'openWithReader',
              )}
            >
              {(action) => (
                <button
                  type='button'
                  role='menuitem'
                  data-slot='context-menu-item'
                  data-testid={
                    actionOperation(action.descriptor) === 'openInNewTab'
                      ? 'breadcrumb-menu-open-new-tab'
                      : actionOperation(action.descriptor) === 'pickNewTabTarget'
                        ? 'workspace-pick-new-tab-target'
                        : actionOperation(action.descriptor) === 'openInSplitView'
                          ? 'workspace-file-menu-open-split-view'
                          : actionOperation(action.descriptor) === 'openInWorkspace'
                            ? 'breadcrumb-menu-open-workspace'
                            : undefined
                  }
                  class='block w-full rounded px-2 py-1.5 text-left hover:bg-muted'
                  onClick={() => {
                    setMenu(null)
                    void action.run(current.item)
                  }}
                >
                  {action.descriptor.label}
                </button>
              )}
            </For>
            <Show
              when={hostActions(current.item).find(
                (action) => actionOperation(action.descriptor) === 'openWithReader',
              )}
              keyed
            >
              {(readerAction) => (
                <div
                  class='relative'
                  onPointerEnter={() => setOpenWithMenu(true)}
                  onPointerLeave={() => setOpenWithMenu(false)}
                >
                  <button
                    type='button'
                    role='menuitem'
                    data-slot='context-menu-item'
                    data-testid='open-with-menu'
                    aria-haspopup='menu'
                    aria-expanded={openWithMenu()}
                    class='block w-full rounded px-2 py-1.5 text-left hover:bg-muted'
                    onClick={() => setOpenWithMenu(true)}
                  >
                    Open with...
                  </button>
                  <Show when={openWithMenu()}>
                    <div
                      role='menu'
                      data-explorer-action-menu
                      data-testid='open-with-submenu'
                      class='absolute top-[-4px] left-[calc(100%-2px)] z-10 min-w-36 rounded-md border border-border bg-popover p-1 shadow-md'
                    >
                      <button
                        type='button'
                        role='menuitem'
                        data-slot='context-menu-item'
                        data-testid='open-with-browser'
                        class='block w-full rounded px-2 py-1.5 text-left hover:bg-muted'
                        onClick={() => {
                          setMenu(null)
                          void openItem(current.item)
                        }}
                      >
                        Browser
                      </button>
                      <button
                        type='button'
                        role='menuitem'
                        data-slot='context-menu-item'
                        data-testid='open-with-reader'
                        class='block w-full rounded px-2 py-1.5 text-left hover:bg-muted'
                        onClick={() => {
                          setMenu(null)
                          void readerAction.run(current.item)
                        }}
                      >
                        Reader
                      </button>
                    </div>
                  </Show>
                </div>
              )}
            </Show>
          </div>
        )}
      </Show>

      <Show when={backgroundMenu()} keyed>
        {(current) => (
          <div
            data-explorer-action-menu
            data-testid='directory-background-context-menu'
            role='menu'
            class='fixed z-[10000] min-w-44 overflow-y-auto rounded-md border border-border bg-popover p-1 text-sm text-popover-foreground shadow-lg'
            style={contextMenuPosition(current.x, current.y)}
          >
            <For
              each={snapshot().actions.filter((action) => {
                const operation = actionOperation(action)
                return operation === 'createFile' || operation === 'createFolder'
              })}
            >
              {(action) => (
                <button
                  type='button'
                  role='menuitem'
                  data-testid={
                    actionOperation(action) === 'createFile'
                      ? 'directory-bg-menu-new-file'
                      : 'directory-bg-menu-new-folder'
                  }
                  class='block w-full rounded px-2 py-1.5 text-left hover:bg-muted'
                  onClick={() => {
                    setBackgroundMenu(null)
                    void invokeAction(action)
                  }}
                >
                  {actionOperation(action) === 'createFile' ? 'New file' : 'New folder'}
                </button>
              )}
            </For>
          </div>
        )}
      </Show>

      <Show when={uploadStatus()} keyed>
        {(status) => (
          <Show when={status.kind !== 'hidden'}>
            <div class='absolute right-3 bottom-3 z-50 rounded-md border border-border bg-popover px-3 py-2 text-sm shadow-lg'>
              <Show when={status.kind === 'uploading'}>
                Uploading {status.kind === 'uploading' ? status.count : 0} file(s)…
              </Show>
              <Show when={status.kind === 'success'}>Upload complete</Show>
              <Show when={status.kind === 'error'}>
                {status.kind === 'error' ? status.message : ''}
              </Show>
            </div>
          </Show>
        )}
      </Show>

      <Show when={unsupportedItem()} keyed>
        {(item) => (
          <div class='absolute inset-0 z-50'>
            <Suspense>
              <LazyUnsupportedViewerContent
                name={item.resource.name}
                extension={item.resource.name.split('.').at(-1)}
                size={item.resource.size}
                onClose={() => {
                  setUnsupportedItem(null)
                }}
                onDownload={() => {
                  const action = item.actions.find(
                    (candidate) => actionOperation(candidate) === 'download',
                  )
                  if (action) return runAction(action, item).then(() => undefined)
                }}
              />
            </Suspense>
          </div>
        )}
      </Show>

      <Show when={pasteState()} keyed>
        {(current) => {
          const existing = () => pasteExistingItem() !== undefined
          return (
            <div
              class='absolute inset-0 z-50 flex items-center justify-center bg-black/45 p-3'
              role='presentation'
              onClick={() => setPasteState(null)}
            >
              <div
                class='max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-card p-4 shadow-xl'
                role='dialog'
                aria-modal='true'
                aria-label={`Paste ${current.data.type}`}
                onClick={(event) => event.stopPropagation()}
              >
                <h2 class='text-base font-semibold'>
                  Paste {current.data.type[0]?.toUpperCase()}
                  {current.data.type.slice(1)}
                </h2>
                <Show when={current.data.showPreview}>
                  <Show
                    when={current.data.isTextContent}
                    fallback={
                      <div class='mt-3 rounded-md border border-border bg-muted/30 p-3 text-sm'>
                        <Show when={current.data.type === 'image'}>
                          <img
                            class='mx-auto max-h-56 max-w-full object-contain'
                            src={`data:${current.data.fileType || 'image/png'};base64,${current.data.content}`}
                            alt='Clipboard preview'
                          />
                        </Show>
                        <Show when={current.data.type !== 'image'}>
                          <p class='font-medium'>{current.data.suggestedName}</p>
                          <p class='mt-1 text-xs text-muted-foreground'>
                            {current.data.fileType || 'binary file'} ·{' '}
                            {formatFileSize(current.data.fileSize ?? 0)}
                          </p>
                        </Show>
                      </div>
                    }
                  >
                    <Show
                      when={pasteExistingItem() && pasteExistingText() !== null}
                      fallback={
                        <pre class='mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-xs'>
                          {current.data.content}
                        </pre>
                      }
                    >
                      <div class='mt-3 grid gap-3 sm:grid-cols-2' data-testid='paste-diff'>
                        <div>
                          <p class='mb-1 text-xs font-medium'>Existing</p>
                          <pre class='max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-xs'>
                            {pasteExistingText()}
                          </pre>
                        </div>
                        <div>
                          <p class='mb-1 text-xs font-medium'>Clipboard</p>
                          <pre class='max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-xs'>
                            {current.data.content}
                          </pre>
                        </div>
                      </div>
                    </Show>
                  </Show>
                </Show>
                <Show when={pasteExistingItem() && !current.data.isTextContent}>
                  <div
                    class='mt-3 grid grid-cols-2 gap-3 text-sm'
                    data-testid='binary-replacement-info'
                  >
                    <div class='rounded-md border border-border bg-muted/30 p-3'>
                      <p class='font-medium'>Existing</p>
                      <p class='mt-1 text-xs text-muted-foreground'>
                        {resourceTypeLabel(pasteExistingItem()!)} ·{' '}
                        {formatFileSize(pasteExistingItem()?.resource.size ?? 0)}
                      </p>
                    </div>
                    <div class='rounded-md border border-border bg-muted/30 p-3'>
                      <p class='font-medium'>Clipboard</p>
                      <p class='mt-1 text-xs text-muted-foreground'>
                        {current.data.fileType || 'binary file'} ·{' '}
                        {formatFileSize(current.data.fileSize ?? 0)}
                      </p>
                    </div>
                  </div>
                </Show>
                <input
                  autofocus
                  aria-label='Filename'
                  class='mt-3 h-9 w-full rounded-md border border-input bg-background px-3 text-sm'
                  value={current.name}
                  onInput={(event) =>
                    setPasteState({ ...current, name: event.currentTarget.value })
                  }
                />
                <Show when={existing()}>
                  <p class='mt-2 text-sm text-amber-600'>A file with this name already exists.</p>
                </Show>
                <div class='mt-4 flex flex-wrap justify-end gap-2'>
                  <button
                    type='button'
                    class='h-8 rounded-md border border-input px-3 text-sm'
                    onClick={() => setPasteState(null)}
                  >
                    Cancel
                  </button>
                  <Show when={existing()}>
                    <button
                      type='button'
                      class='h-8 rounded-md border border-input px-3 text-sm'
                      onClick={() =>
                        document
                          .querySelector<HTMLInputElement>('input[aria-label="Filename"]')
                          ?.focus()
                      }
                    >
                      Save with another name
                    </button>
                    <button
                      type='button'
                      class='h-8 rounded-md bg-destructive px-3 text-sm text-primary-foreground'
                      onClick={() => void submitPaste('replace')}
                    >
                      Replace
                    </button>
                  </Show>
                  <Show when={!existing()}>
                    <button
                      type='button'
                      class='h-8 rounded-md bg-primary px-3 text-sm text-primary-foreground'
                      onClick={() => void submitPaste()}
                    >
                      Paste
                    </button>
                  </Show>
                </div>
              </div>
            </div>
          )
        }}
      </Show>

      <Show when={dialog()} keyed>
        {(current) => {
          const destination = () =>
            current.item && current.action.interaction === 'destination'
              ? props.destinationPicker?.(current.action, current.item)
              : null
          return (
            <Show
              when={destination()}
              keyed
              fallback={
                <ExplorerActionDialog
                  state={current}
                  defaultFileExtension={snapshot().defaultFileExtension}
                  pending={snapshot().pendingCommands.length > 0}
                  onCancel={() => setDialog(null)}
                  onSubmit={(input) => void submitDialog(input)}
                />
              }
            >
              {(picker) => (
                <MoveToDialog
                  overlayScope='window'
                  onClose={() => setDialog(null)}
                  fileName={current.item?.resource.name ?? ''}
                  filePath={picker.filePath}
                  editableFolders={[...picker.editableFolders]}
                  mode={actionOperation(current.action) === 'copy' ? 'copy' : 'move'}
                  isPending={snapshot().pendingCommands.length > 0}
                  error={snapshot().error ? new Error(snapshot().error!.message) : null}
                  onConfirm={(destinationDir) => void submitDialog({ destination: destinationDir })}
                />
              )}
            </Show>
          )
        }}
      </Show>
    </div>
  )
}
