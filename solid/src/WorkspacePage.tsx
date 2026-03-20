import type { GlobalSettings } from '@/lib/use-settings'
import type { FileItem } from '@/lib/types'
import { MediaType } from '@/lib/types'
import { getMediaType } from '@/lib/media-utils'
import { createDefaultBounds, createWindowLayout, PLAYER_WINDOW_ID } from '@/lib/workspace-geometry'
import type {
  PersistedWorkspaceState,
  PinnedTaskbarItem,
  WorkspaceSource,
  WorkspaceWindowDefinition,
} from '@/lib/use-workspace'
import {
  normalizePersistedWorkspaceState,
  workspaceStorageBaseKey,
  workspaceStorageSessionKey,
} from '@/lib/use-workspace'
import { useMutation, useQuery, useQueryClient } from '@tanstack/solid-query'
import { api, post } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import File from 'lucide-solid/icons/file'
import FolderOpen from 'lucide-solid/icons/folder-open'
import Folder from 'lucide-solid/icons/folder'
import X from 'lucide-solid/icons/x'
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from 'solid-js'
import { useBrowserHistory, navigateSearchParams } from './browser-history'
import { WorkspaceBrowserPane, type WorkspaceShareConfig } from './workspace/WorkspaceBrowserPane'
import { WorkspaceViewerPane } from './workspace/WorkspaceViewerPane'

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

  const windows = createMemo(() => workspace()?.windows ?? [])
  const pinnedItems = createMemo(() => workspace()?.pinnedTaskbarItems ?? [])

  return (
    <div class='workspace-layout pointer-events-auto fixed inset-0 flex flex-col overflow-hidden bg-background select-none'>
      <div class='relative min-h-0 flex-1 overflow-hidden'>
        <For each={windows()}>
          {(win) => {
            const b = () => win.layout?.bounds
            return (
              <div
                class='absolute flex flex-col overflow-hidden rounded-md border border-border bg-card shadow-md'
                data-window-group={win.tabGroupId ?? win.id}
                style={{
                  left: `${b()?.x ?? 0}px`,
                  top: `${b()?.y ?? 0}px`,
                  width: `${b()?.width ?? 400}px`,
                  height: `${b()?.height ?? 300}px`,
                  'z-index': win.layout?.zIndex ?? 1,
                }}
              >
                <div class='flex h-8 shrink-0 items-stretch border-b border-border bg-muted/80'>
                  <div
                    data-testid='window-drag-handle'
                    class='flex min-w-0 flex-1 cursor-grab items-center px-2 text-xs font-medium text-foreground select-none active:cursor-grabbing'
                    onMouseDown={() => focusWindow(win.id)}
                  >
                    <span class='truncate'>{win.title}</span>
                  </div>
                  <div
                    class='workspace-window-buttons flex shrink-0 items-stretch'
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <button
                      type='button'
                      class='text-muted-foreground hover:bg-muted inline-flex h-full w-8 items-center justify-center'
                      onClick={() => closeWindow(win.id)}
                      aria-label={`Close ${win.title}`}
                    >
                      <X class='h-3.5 w-3.5' stroke-width={2} />
                    </button>
                  </div>
                </div>
                <div class='workspace-window-content min-h-0 flex-1 overflow-hidden text-sm text-muted-foreground'>
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
                </div>
              </div>
            )
          }}
        </For>
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
