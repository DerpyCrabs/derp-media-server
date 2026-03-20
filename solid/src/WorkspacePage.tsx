import { MediaType } from '@/lib/types'
import { createDefaultBounds, createWindowLayout, PLAYER_WINDOW_ID } from '@/lib/workspace-geometry'
import type { PersistedWorkspaceState, WorkspaceWindowDefinition } from '@/lib/use-workspace'
import {
  normalizePersistedWorkspaceState,
  workspaceStorageBaseKey,
  workspaceStorageSessionKey,
} from '@/lib/use-workspace'
import FolderOpen from 'lucide-solid/icons/folder-open'
import { For, Show, createEffect, untrack } from 'solid-js'
import { createStore } from 'solid-js/store'
import { useBrowserHistory, navigateSearchParams } from './browser-history'

const DEFAULT_SOURCE = { kind: 'local' as const, rootPath: null as string | null }

function defaultPersistedState(): PersistedWorkspaceState {
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
        source: DEFAULT_SOURCE,
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

export function WorkspacePage() {
  const history = useBrowserHistory()

  const [state, setState] = createStore<{ workspace: PersistedWorkspaceState | null }>({
    workspace: null,
  })

  createEffect(() => {
    const loc = history()
    if (loc.pathname !== '/workspace') return
    const params = new URLSearchParams(loc.search)
    if (params.get('ws')) return
    navigateSearchParams({ ws: crypto.randomUUID() }, 'replace')
  })

  createEffect(() => {
    const loc = history()
    if (loc.pathname !== '/workspace') return
    const sid = new URLSearchParams(loc.search).get('ws') ?? ''
    if (!sid) return
    const key = workspaceStorageSessionKey(workspaceStorageBaseKey(null), sid)
    untrack(() => {
      const loaded = loadPersisted(key)
      setState('workspace', loaded ?? defaultPersistedState())
    })
  })

  createEffect(() => {
    const loc = history()
    if (loc.pathname !== '/workspace') return
    const sid = new URLSearchParams(loc.search).get('ws') ?? ''
    const w = state.workspace
    if (!sid || !w) return
    const key = workspaceStorageSessionKey(workspaceStorageBaseKey(null), sid)
    persistWorkspaceState(key, w)
  })

  function openBrowser() {
    const w = state.workspace
    if (!w) return
    const n = w.nextWindowId
    const id = `workspace-window-${n}`
    const newWin: WorkspaceWindowDefinition = {
      id,
      type: 'browser',
      title: `Browser ${n}`,
      iconName: null,
      iconPath: '',
      iconType: MediaType.FOLDER,
      iconIsVirtual: false,
      source: DEFAULT_SOURCE,
      initialState: {},
      tabGroupId: null,
      layout: createWindowLayout(undefined, createDefaultBounds(w.windows.length, 'browser'), n),
    }
    setState('workspace', {
      ...w,
      windows: [...w.windows, newWin],
      nextWindowId: n + 1,
      activeWindowId: id,
    })
  }

  return (
    <div class='workspace-layout pointer-events-auto fixed inset-0 flex flex-col overflow-hidden bg-background select-none'>
      <div class='relative min-h-0 flex-1 overflow-hidden'>
        <Show when={state.workspace}>
          {(ws) => (
            <For each={ws().windows}>
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
                    <div class='flex h-8 items-center border-b border-border bg-muted/80 px-2 text-xs font-medium text-foreground'>
                      {win.title}
                    </div>
                    <div class='workspace-window-content min-h-0 flex-1 overflow-auto p-2 text-sm text-muted-foreground' />
                  </div>
                )
              }}
            </For>
          )}
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
        </div>
      </div>
    </div>
  )
}
