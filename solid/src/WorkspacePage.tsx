import type { GlobalSettings } from '@/lib/use-settings'
import type { FileItem } from '@/lib/types'
import { MediaType } from '@/lib/types'
import { getMediaType } from '@/lib/media-utils'
import { computeSnappedResizeWindows } from '@/lib/workspace-session-store'
import {
  createDefaultBounds,
  createFullscreenBounds,
  createWindowLayout,
  PLAYER_WINDOW_ID,
} from '@/lib/workspace-geometry'
import type {
  PersistedWorkspaceState,
  PinnedTaskbarItem,
  SnapZone,
  WorkspaceSource,
  WorkspaceWindowDefinition,
} from '@/lib/use-workspace'
import {
  normalizePersistedWorkspaceState,
  snapZoneToBoundsWithOccupied,
  workspaceStorageBaseKey,
  workspaceStorageSessionKey,
} from '@/lib/use-workspace'
import { detectSnapZone, type SnapDetectResult } from '@/lib/use-snap-zones'
import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import { api, post } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import File from 'lucide-solid/icons/file'
import FolderOpen from 'lucide-solid/icons/folder-open'
import Folder from 'lucide-solid/icons/folder'
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js'
import { useBrowserHistory, navigateSearchParams } from './browser-history'
import { applySnapPreviewLayout } from './workspace/snap-preview'
import { WorkspaceTilingPicker } from './workspace/WorkspaceTilingPicker'
import { WorkspaceBrowserPane, type WorkspaceShareConfig } from './workspace/WorkspaceBrowserPane'
import { WorkspaceViewerPane } from './workspace/WorkspaceViewerPane'
import { WorkspaceWindowChrome, type WorkspaceBounds } from './workspace/WorkspaceWindowChrome'

const DEFAULT_SOURCE: WorkspaceSource = { kind: 'local', rootPath: null }

function isWorkspaceRoute(pathname: string) {
  return pathname === '/workspace' || /^\/share\/[^/]+\/workspace\/?$/.test(pathname)
}

function defaultPersistedState(source: WorkspaceSource): PersistedWorkspaceState {
  return {
    windows: [
      {
        id: 'workspace-window-1',
        type: 'browser',
        title: 'Browser 1',
        iconName: null,
        iconPath: '',
        iconType: MediaType.FOLDER,
        iconIsVirtual: false,
        source,
        initialState: {},
        tabGroupId: null,
        layout: createWindowLayout(undefined, createDefaultBounds(0, 'browser'), 1),
      },
    ],
    activeWindowId: 'workspace-window-1',
    activeTabMap: {},
    nextWindowId: 2,
    pinnedTaskbarItems: [],
  }
}

function persistWorkspaceState(storageKey: string, state: PersistedWorkspaceState) {
  try {
    const serializable = {
      ...state,
      windows: state.windows.filter((w) => w.id !== PLAYER_WINDOW_ID),
      pinnedTaskbarItems: state.pinnedTaskbarItems ?? [],
    }
    localStorage.setItem(storageKey, JSON.stringify(serializable))
  } catch {}
}

function loadPersisted(storageKey: string): PersistedWorkspaceState | null {
  const raw = localStorage.getItem(storageKey)
  if (!raw) return null
  try {
    return normalizePersistedWorkspaceState(JSON.parse(raw) as unknown)
  } catch {
    return null
  }
}

type AuthConfig = { enabled: boolean; editableFolders: string[] }

export type WorkspacePageProps = {
  shareConfig?: { token: string; sharePath: string } | null
  shareWorkspaceTaskbarPins?: PinnedTaskbarItem[]
  shareCanEdit?: boolean
}

export function WorkspacePage(props: WorkspacePageProps = {}) {
  const history = useBrowserHistory()
  const queryClient = useQueryClient()

  const shareConfig = () => props.shareConfig ?? null

  const browserSource = createMemo(
    (): WorkspaceSource =>
      shareConfig()
        ? {
            kind: 'share',
            token: shareConfig()!.token,
            sharePath: shareConfig()!.sharePath,
          }
        : DEFAULT_SOURCE,
  )

  const storageSessionKeyFull = createMemo(() => {
    const loc = history()
    const sid = new URLSearchParams(loc.search).get('ws') ?? ''
    const base = workspaceStorageBaseKey(shareConfig()?.token ?? null)
    return { sid, key: sid ? workspaceStorageSessionKey(base, sid) : '' }
  })

  const [workspace, setWorkspace] = createSignal<PersistedWorkspaceState | null>(null)

  let workspaceAreaEl: HTMLDivElement | undefined
  let snapPreviewEl: HTMLDivElement | undefined
  const [layoutPicker, setLayoutPicker] = createSignal<{
    windowId: string
    anchor: DOMRect
  } | null>(null)
  let dragZoneRef: SnapDetectResult | null = null
  let draggedWindowIdForSnap: string | null = null

  const [pinsHydratedFor, setPinsHydratedFor] = createSignal('')

  const settingsQuery = useQuery(() => ({
    queryKey: queryKeys.settings(),
    queryFn: () => api<GlobalSettings>('/api/settings'),
    staleTime: Infinity,
    enabled: !shareConfig(),
  }))

  const authQuery = useQuery(() => ({
    queryKey: queryKeys.authConfig(),
    queryFn: () => api<AuthConfig>('/api/auth/config'),
    staleTime: Infinity,
    enabled: !shareConfig(),
  }))

  const editableFolders = createMemo((): string[] => {
    if (shareConfig()) return []
    return authQuery.data?.editableFolders ?? []
  })

  const sharePanel = createMemo((): WorkspaceShareConfig | null => {
    const c = shareConfig()
    if (!c) return null
    return { token: c.token, sharePath: c.sharePath }
  })

  const serverPinsReady = createMemo(() => (shareConfig() ? true : settingsQuery.isSuccess))

  const serverPinsList = createMemo((): PinnedTaskbarItem[] => {
    if (shareConfig()) return props.shareWorkspaceTaskbarPins ?? []
    return settingsQuery.data?.workspaceTaskbarPins ?? []
  })

  const persistPinsMutation = useMutation(() => ({
    mutationFn: (items: PinnedTaskbarItem[]) => {
      const c = shareConfig()
      if (c) {
        return post(`/api/share/${c.token}/workspaceTaskbarPins`, { items })
      }
      return post('/api/settings/workspaceTaskbarPins', { items })
    },
    onSettled: () => {
      const c = shareConfig()
      if (c) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.shareInfo(c.token) })
      } else {
        void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
      }
    },
  }))

  createEffect(() => {
    const loc = history()
    if (!isWorkspaceRoute(loc.pathname)) return
    let sid = new URLSearchParams(loc.search).get('ws') ?? ''
    if (!sid) {
      sid = crypto.randomUUID()
      navigateSearchParams({ ws: sid }, 'replace')
    }
    const base = workspaceStorageBaseKey(shareConfig()?.token ?? null)
    const key = workspaceStorageSessionKey(base, sid)
    untrack(() => {
      const loaded = loadPersisted(key)
      const src = browserSource()
      setWorkspace(loaded ?? defaultPersistedState(src))
      setPinsHydratedFor('')
    })
  })

  createEffect(() => {
    const { key } = storageSessionKeyFull()
    const w = workspace()
    if (!key || !w) return
    persistWorkspaceState(key, w)
  })

  createEffect(() => {
    if (!serverPinsReady()) return
    const { key } = storageSessionKeyFull()
    const w = workspace()
    if (!key || !w) return
    if (pinsHydratedFor() === key) return

    const serverPins = serverPinsList()
    untrack(() => {
      if (serverPins.length > 0) {
        setWorkspace((prev) => (prev ? { ...prev, pinnedTaskbarItems: serverPins } : prev))
      } else if ((w.pinnedTaskbarItems?.length ?? 0) > 0) {
        void persistPinsMutation.mutateAsync(w.pinnedTaskbarItems ?? [])
      }
    })
    setPinsHydratedFor(key)
  })

  function focusWindow(windowId: string) {
    const w = workspace()
    if (!w) return
    const maxZ = Math.max(...w.windows.map((x) => x.layout?.zIndex ?? 1), 1)
    setWorkspace({
      ...w,
      activeWindowId: windowId,
      windows: w.windows.map((win) =>
        win.id === windowId ? { ...win, layout: { ...win.layout, zIndex: maxZ + 1 } } : win,
      ),
    })
  }

  function closeWindow(windowId: string) {
    const w = workspace()
    if (!w) return
    const next = w.windows.filter((x) => x.id !== windowId)
    let active = w.activeWindowId
    if (active === windowId) {
      active = next[next.length - 1]?.id ?? active
    }
    setWorkspace({ ...w, windows: next, activeWindowId: active })
  }

  function updateWindowViewing(windowId: string, viewing: string) {
    const w = workspace()
    if (!w) return
    const title = viewing.split(/[/\\]/).pop() ?? 'File'
    setWorkspace({
      ...w,
      windows: w.windows.map((win) =>
        win.id === windowId
          ? { ...win, title, initialState: { ...win.initialState, viewing } }
          : win,
      ),
    })
  }

  function navigateDir(windowId: string, dir: string) {
    const w = workspace()
    if (!w) return
    setWorkspace({
      ...w,
      windows: w.windows.map((win) =>
        win.id === windowId ? { ...win, initialState: { ...win.initialState, dir } } : win,
      ),
    })
  }

  function openBrowser(options?: { source?: WorkspaceSource; initialState?: { dir?: string } }) {
    const w = workspace()
    if (!w) return
    const n = w.nextWindowId
    const id = `workspace-window-${n}`
    const source = options?.source ?? browserSource()
    const newWin: WorkspaceWindowDefinition = {
      id,
      type: 'browser',
      title: `Browser ${n}`,
      iconName: null,
      iconPath: '',
      iconType: MediaType.FOLDER,
      iconIsVirtual: false,
      source,
      initialState: options?.initialState?.dir != null ? { dir: options.initialState.dir } : {},
      tabGroupId: null,
      layout: createWindowLayout(undefined, createDefaultBounds(w.windows.length, 'browser'), n),
    }
    const maxZ = Math.max(...w.windows.map((x) => x.layout?.zIndex ?? 1), 1)
    newWin.layout = { ...newWin.layout, zIndex: maxZ + 1 }
    setWorkspace({
      ...w,
      windows: [...w.windows, newWin],
      nextWindowId: n + 1,
      activeWindowId: id,
    })
  }

  function openViewerFromBrowser(windowId: string, file: FileItem) {
    const w = workspace()
    const winDef = w?.windows.find((x) => x.id === windowId)
    if (!winDef) return
    openViewer(windowId, file, winDef.source)
  }

  function openViewer(_fromWindowId: string, file: FileItem, source: WorkspaceSource) {
    const w = workspace()
    if (!w) return
    const n = w.nextWindowId
    const id = `workspace-window-${n}`
    const parentDir = file.path.split(/[/\\]/).slice(0, -1).join('/') || ''
    const newWin: WorkspaceWindowDefinition = {
      id,
      type: 'viewer',
      title: file.name,
      iconName: null,
      iconPath: file.path,
      iconType: file.type,
      iconIsVirtual: false,
      source,
      initialState: { dir: parentDir, viewing: file.path },
      tabGroupId: null,
      layout: createWindowLayout(undefined, createDefaultBounds(w.windows.length, 'viewer'), n),
    }
    const maxZ = Math.max(...w.windows.map((x) => x.layout?.zIndex ?? 1), 1)
    newWin.layout = { ...newWin.layout, zIndex: maxZ + 1 }
    setWorkspace({
      ...w,
      windows: [...w.windows, newWin],
      nextWindowId: n + 1,
      activeWindowId: id,
    })
  }

  function addPinnedItem(file: FileItem) {
    const w = workspace()
    if (!w) return
    const source = browserSource()
    const pinKey = (p: PinnedTaskbarItem) => `${p.path}:${p.source.kind}:${p.source.token ?? ''}`
    const newKey = `${file.path}:${source.kind}:${source.token ?? ''}`
    if ((w.pinnedTaskbarItems ?? []).some((p) => pinKey(p) === newKey)) return
    const customIcons = settingsQuery.data?.customIcons ?? {}
    const item: PinnedTaskbarItem = {
      id: crypto.randomUUID(),
      path: file.path,
      isDirectory: file.isDirectory,
      title: file.name,
      customIconName: customIcons[file.path] ?? null,
      source,
    }
    const next = [...(w.pinnedTaskbarItems ?? []), item]
    setWorkspace({ ...w, pinnedTaskbarItems: next })
    void persistPinsMutation.mutateAsync(next)
  }

  function removePinnedItem(id: string) {
    const w = workspace()
    if (!w) return
    const next = (w.pinnedTaskbarItems ?? []).filter((p) => p.id !== id)
    setWorkspace({ ...w, pinnedTaskbarItems: next })
    void persistPinsMutation.mutateAsync(next)
  }

  function selectPinned(pin: PinnedTaskbarItem) {
    if (pin.isDirectory) {
      openBrowser({ source: pin.source, initialState: { dir: pin.path } })
      return
    }
    const ext = pin.path.split('.').pop()?.toLowerCase() ?? ''
    const type = getMediaType(ext)
    if (type === MediaType.VIDEO || type === MediaType.AUDIO) {
      return
    }
    const synthetic: FileItem = {
      path: pin.path,
      name: pin.title,
      isDirectory: false,
      isVirtual: false,
      size: 0,
      type,
      extension: ext,
    }
    openViewer('', synthetic, pin.source)
  }

  function getZoneBoundsForDrag(zone: SnapZone): WorkspaceBounds {
    const w = workspace()
    if (!w) return snapZoneToBoundsWithOccupied(zone, [])
    const ex = draggedWindowIdForSnap
    const occupied = w.windows
      .filter((x) => x.id !== ex && x.layout?.snapZone && x.layout.bounds)
      .map((x) => ({ bounds: x.layout!.bounds!, snapZone: x.layout!.snapZone! }))
    return snapZoneToBoundsWithOccupied(zone, occupied)
  }

  function handleDragPointerMove(windowId: string, clientX: number, clientY: number) {
    draggedWindowIdForSnap = windowId
    const c = workspaceAreaEl
    const p = snapPreviewEl
    if (!c || !p) return
    const rect = c.getBoundingClientRect()
    const z = detectSnapZone(clientX - rect.left, clientY - rect.top, rect.width, rect.height)
    dragZoneRef = z
    applySnapPreviewLayout(p, z, c, getZoneBoundsForDrag)
  }

  function restoreDrag(windowId: string, clientX: number, clientY: number) {
    const w = workspace()
    const container = workspaceAreaEl?.getBoundingClientRect()
    if (!w || !container) return
    const win = w.windows.find((x) => x.id === windowId)
    if (!win) return
    const currentBounds = win.layout?.bounds
    const restoreBounds = win.layout?.restoreBounds
    const restoredW = restoreBounds?.width ?? currentBounds?.width ?? 500
    const currentWidth = currentBounds?.width ?? restoredW
    const oX = container.left
    const grabRatio = currentBounds
      ? Math.min(Math.max((clientX - oX - currentBounds.x) / currentWidth, 0), 1)
      : 0.5
    const newX = clientX - oX - restoredW * grabRatio
    const newY = currentBounds?.y ?? 0
    unsnapWindow(windowId, { x: newX, y: newY })
  }

  function unsnapWindow(windowId: string, drop: { x: number; y: number } | null) {
    setWorkspace((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        windows: prev.windows.map((win) => {
          if (win.id !== windowId) return win
          const restored = win.layout?.restoreBounds ?? win.layout?.bounds
          return {
            ...win,
            layout: {
              ...win.layout,
              snapZone: null,
              fullscreen: false,
              bounds:
                drop && restored
                  ? { x: drop.x, y: drop.y, width: restored.width, height: restored.height }
                  : (restored ?? win.layout?.bounds ?? null),
              restoreBounds: null,
            },
          }
        }),
      }
    })
  }

  function snapWindowState(windowId: string, zone: SnapZone) {
    setWorkspace((prev) => {
      if (!prev) return prev
      const maxZ = Math.max(...prev.windows.map((x) => x.layout?.zIndex ?? 1), 1)
      const occupied = prev.windows
        .filter((x) => x.id !== windowId && x.layout?.snapZone && x.layout.bounds)
        .map((x) => ({ bounds: x.layout!.bounds!, snapZone: x.layout!.snapZone! }))
      const snapBounds = snapZoneToBoundsWithOccupied(zone, occupied)
      return {
        ...prev,
        activeWindowId: windowId,
        windows: prev.windows.map((win) =>
          win.id === windowId
            ? {
                ...win,
                layout: {
                  ...win.layout,
                  fullscreen: false,
                  snapZone: zone,
                  minimized: false,
                  zIndex: maxZ + 1,
                  bounds: snapBounds,
                  restoreBounds: win.layout?.restoreBounds ?? win.layout?.bounds ?? null,
                },
              }
            : win,
        ),
      }
    })
  }

  function toggleFullscreenWindow(windowId: string) {
    setWorkspace((prev) => {
      if (!prev) return prev
      const maxZ = Math.max(...prev.windows.map((x) => x.layout?.zIndex ?? 1), 1)
      return {
        ...prev,
        activeWindowId: windowId,
        windows: prev.windows.map((win) => {
          if (win.id !== windowId) return win
          const currentBounds = win.layout?.bounds ?? createDefaultBounds(0, win.type)
          const isFs = win.layout?.fullscreen ?? false
          return {
            ...win,
            layout: {
              ...win.layout,
              fullscreen: !isFs,
              snapZone: null,
              minimized: false,
              zIndex: maxZ + 1,
              bounds: isFs
                ? (win.layout?.restoreBounds ?? currentBounds)
                : createFullscreenBounds(),
              restoreBounds: isFs ? null : currentBounds,
            },
          }
        }),
      }
    })
  }

  function setWindowMinimized(windowId: string, minimized: boolean) {
    setWorkspace((prev) =>
      prev
        ? {
            ...prev,
            windows: prev.windows.map((win) =>
              win.id === windowId ? { ...win, layout: { ...win.layout, minimized } } : win,
            ),
          }
        : prev,
    )
  }

  function updateWindowBounds(windowId: string, bounds: WorkspaceBounds) {
    setWorkspace((prev) =>
      prev
        ? {
            ...prev,
            windows: prev.windows.map((win) =>
              win.id === windowId ? { ...win, layout: { ...win.layout, bounds } } : win,
            ),
          }
        : prev,
    )
  }

  function resizeSnappedWindowBounds(windowId: string, bounds: WorkspaceBounds, direction: string) {
    setWorkspace((prev) =>
      prev
        ? {
            ...prev,
            windows: computeSnappedResizeWindows(prev.windows, windowId, bounds, direction),
          }
        : prev,
    )
  }

  function onDragPointerEnd(
    windowId: string,
    bounds: WorkspaceBounds,
    clientX: number,
    clientY: number,
  ) {
    const zone = dragZoneRef
    const c = workspaceAreaEl
    const p = snapPreviewEl
    if (c && p) applySnapPreviewLayout(p, null, c, getZoneBoundsForDrag)
    dragZoneRef = null
    draggedWindowIdForSnap = null

    if (zone === 'top') {
      toggleFullscreenWindow(windowId)
      return
    }
    if (zone) {
      snapWindowState(windowId, zone as SnapZone)
      return
    }

    const w = workspace()?.windows.find((x) => x.id === windowId)
    if (w?.layout?.snapZone || w?.layout?.fullscreen) {
      unsnapWindow(windowId, { x: bounds.x, y: bounds.y })
      return
    }
    updateWindowBounds(windowId, bounds)
  }

  const [pinMenu, setPinMenu] = createSignal<{
    x: number
    y: number
    pinId: string
  } | null>(null)

  createEffect(() => {
    const m = pinMenu()
    if (!m) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Element | null
      if (t?.closest?.('[data-pin-context-menu]')) return
      setPinMenu(null)
    }
    document.addEventListener('mousedown', onDoc)
    onCleanup(() => document.removeEventListener('mousedown', onDoc))
  })

  const visibleWindows = createMemo(
    () => workspace()?.windows.filter((x) => !x.layout?.minimized) ?? [],
  )
  const pinnedItems = createMemo(() => workspace()?.pinnedTaskbarItems ?? [])

  return (
    <div class='workspace-layout pointer-events-auto fixed inset-0 flex flex-col overflow-hidden bg-background select-none'>
      <div
        class='relative min-h-0 flex-1 overflow-hidden'
        ref={(el) => {
          workspaceAreaEl = el
        }}
      >
        <div
          ref={(el) => {
            snapPreviewEl = el ?? undefined
          }}
          data-snap-preview
          class='pointer-events-none absolute rounded-sm border-2 border-blue-400/50 bg-blue-500/15 transition-all duration-150'
          style={{ display: 'none', 'z-index': 99999 }}
        />
        <For each={visibleWindows()}>
          {(win) => (
            <WorkspaceWindowChrome
              windowId={win.id}
              groupId={win.tabGroupId ?? win.id}
              workspace={workspace}
              isActive={workspace()?.activeWindowId === win.id}
              containerEl={() => workspaceAreaEl}
              onFocusWindow={focusWindow}
              onClose={closeWindow}
              onMinimize={(id) => setWindowMinimized(id, true)}
              onToggleFullscreen={toggleFullscreenWindow}
              onOpenLayoutPicker={(windowId, rect) => setLayoutPicker({ windowId, anchor: rect })}
              onRestoreDrag={restoreDrag}
              onDragPointerMove={handleDragPointerMove}
              onDragPointerEnd={onDragPointerEnd}
              onDragDuringMove={updateWindowBounds}
              onResizeSnapped={resizeSnappedWindowBounds}
              onUpdateBounds={updateWindowBounds}
            >
              <Show when={win.type === 'browser'}>
                <WorkspaceBrowserPane
                  windowId={win.id}
                  workspace={workspace}
                  sharePanel={sharePanel}
                  editableFolders={editableFolders()}
                  onNavigateDir={navigateDir}
                  onOpenViewer={openViewerFromBrowser}
                  onAddToTaskbar={addPinnedItem}
                />
              </Show>
              <Show when={win.type === 'viewer'}>
                <WorkspaceViewerPane
                  windowId={win.id}
                  workspace={workspace}
                  sharePanel={sharePanel}
                  editableFolders={editableFolders()}
                  shareCanEdit={props.shareConfig ? (props.shareCanEdit ?? false) : false}
                  onUpdateViewing={updateWindowViewing}
                />
              </Show>
            </WorkspaceWindowChrome>
          )}
        </For>
        <Show when={layoutPicker()}>
          {(get) => {
            const p = get()
            const c = workspaceAreaEl
            if (!c) return null
            return (
              <WorkspaceTilingPicker
                anchorRect={p.anchor}
                container={c}
                onSelectZone={(zone) => {
                  snapWindowState(p.windowId, zone)
                  setLayoutPicker(null)
                }}
                onSelectFullscreen={() => {
                  toggleFullscreenWindow(p.windowId)
                  setLayoutPicker(null)
                }}
                onClose={() => setLayoutPicker(null)}
              />
            )
          }}
        </Show>
      </div>

      <div class='relative bg-background px-3' style={{ 'z-index': '999999' }}>
        <div class='flex h-8 items-center gap-2'>
          <button
            type='button'
            title='Open browser window'
            class='flex h-7 w-7 shrink-0 items-center justify-center rounded-none text-amber-500 hover:bg-amber-500/15 hover:text-amber-400'
            onClick={() => openBrowser()}
          >
            <FolderOpen class='h-5 w-5' stroke-width={1.75} />
          </button>

          <div class='flex min-w-0 flex-1 items-center gap-2 overflow-x-auto'>
            <For each={pinnedItems()}>
              {(pin) => {
                const tooltip = `${pin.isDirectory ? 'Folder' : 'File'}: ${pin.path}`
                return (
                  <button
                    type='button'
                    title={tooltip}
                    aria-label={tooltip}
                    class='flex h-7 w-7 shrink-0 items-center justify-center rounded-none text-muted-foreground hover:bg-muted hover:text-foreground'
                    onClick={() => selectPinned(pin)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setPinMenu({ x: e.clientX, y: e.clientY, pinId: pin.id })
                    }}
                  >
                    <Show
                      when={pin.isDirectory}
                      fallback={<File class='h-5 w-5' stroke-width={1.75} />}
                    >
                      <Folder class='h-5 w-5' stroke-width={1.75} />
                    </Show>
                  </button>
                )
              }}
            </For>
          </div>
        </div>
      </div>

      <Show when={pinMenu()}>
        {(get) => {
          const m = get()
          return (
            <div
              data-pin-context-menu
              class='fixed z-[1000000] min-w-36 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md'
              style={{ left: `${m.x}px`, top: `${m.y}px` }}
              role='menu'
            >
              <button
                type='button'
                data-slot='context-menu-item'
                class='flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none select-none hover:bg-accent hover:text-accent-foreground'
                role='menuitem'
                onClick={() => {
                  removePinnedItem(m.pinId)
                  setPinMenu(null)
                }}
              >
                Unpin
              </button>
            </div>
          )
        }}
      </Show>
    </div>
  )
}
