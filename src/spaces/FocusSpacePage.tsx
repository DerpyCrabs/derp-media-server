import { persistedResourceTarget, type ResourceSummary, type ViewerId } from '@/lib/resource'
import { canCloseHermesWindow } from '@/lib/hermes-session-store'
import { projectSpaceToWorkspace, workspaceStateToSpace, type Space } from '@/lib/space'
import type { OptimisticSpaceClient } from '@/lib/space-client'
import { spaceCommandsToMatch } from '@/lib/space-sync'
import type { FileItem } from '@/lib/types'
import { MediaType } from '@/lib/types'
import type {
  PersistedWorkspaceState,
  WorkspaceSource,
  WorkspaceWindowDefinition,
} from '@/lib/use-workspace'
import type { VirtualOpenTarget } from '@/lib/virtual-directory'
import { workspaceBrowserDirTitle } from '@/lib/workspace-browser-dir-title'
import Bot from 'lucide-solid/icons/bot'
import FileText from 'lucide-solid/icons/file-text'
import Folder from 'lucide-solid/icons/folder'
import X from 'lucide-solid/icons/x'
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import { legacyFileItemFromPath, resourceForFileItem } from '../lib/legacy-resource-adapter'
import { EMPTY_FILE_ICON_CONTEXT } from '../lib/use-file-icon'
import { usePlaybackSession } from '../media/playback/PlaybackProvider'
import { playbackItemFromFileItem } from '../media/playback/items'
import { useWorkspacePageServerData } from '../workspace/workspace-page/use-workspace-page-server-data'
import { PaneHost } from './PaneHost'

const OWNER_SOURCE: WorkspaceSource = { kind: 'local', rootPath: null }

function parentPath(path: string): string {
  return path.split(/[/\\]/).slice(0, -1).join('/')
}

function paneShowsPath(window: WorkspaceWindowDefinition | undefined, path: string): boolean {
  const viewing = window?.initialState.viewing
  return (
    window?.type === 'viewer' &&
    typeof viewing === 'string' &&
    viewing.replace(/\\/g, '/') === path.replace(/\\/g, '/')
  )
}

function nextPaneId(workspace: PersistedWorkspaceState): string {
  let next = Math.max(1, workspace.nextWindowId)
  while (workspace.windows.some((window) => window.id === `space-pane-${next}`)) next += 1
  return `space-pane-${next}`
}

function iconFor(window: WorkspaceWindowDefinition) {
  if (window.type === 'browser') return <Folder class='size-4' />
  if (window.type === 'hermes') return <Bot class='size-4' />
  return <FileText class='size-4' />
}

export function FocusSpacePage(props: {
  space: () => Space
  client: OptimisticSpaceClient
  activePaneId: () => string | null
  onActivePaneChange: (paneId: string | null) => void
  onAddResource: () => void
  registerPresentationFlush?: (flush: () => void) => () => void
}) {
  const playbackSession = usePlaybackSession()
  const server = useWorkspacePageServerData({}, () => null)
  const sessionKey = () => `space-focus-session-v1:${encodeURIComponent(props.space().id)}`

  function initialActive(space: Space): string | null {
    const requested = props.activePaneId()
    if (requested && Object.hasOwn(space.panes, requested)) return requested
    try {
      const stored = localStorage.getItem(sessionKey())
      if (stored && Object.hasOwn(space.panes, stored)) return stored
    } catch {}
    return Object.keys(space.panes)[0] ?? null
  }

  const firstSpace = props.space()
  const [workspace, setWorkspace] = createSignal<PersistedWorkspaceState | null>(
    projectSpaceToWorkspace(firstSpace, {
      activeWindowId: initialActive(firstSpace),
      activeTabMap: {},
      nextWindowId: 1,
      pinnedTaskbarItems: [],
    }),
  )
  const [syncError, setSyncError] = createSignal<string | null>(null)
  let applyingProjection = false
  let syncTimer: ReturnType<typeof setTimeout> | undefined
  let projectedRevision = firstSpace.revision
  let backgroundVideoPaneId: string | null = null

  const paneIds = createMemo(() => workspace()?.windows.map((window) => window.id) ?? [])
  const activePaneId = createMemo(() => {
    const current = workspace()
    if (!current) return null
    if (
      current.activeWindowId &&
      current.windows.some((window) => window.id === current.activeWindowId)
    ) {
      return current.activeWindowId
    }
    return current.windows[0]?.id ?? null
  })

  function checkpointVideoPane(paneId: string) {
    const playback = playbackSession.getSnapshot()
    const host = [
      ...document.querySelectorAll<HTMLElement>('[data-testid="space-pane-host"]'),
    ].find((candidate) => candidate.dataset.paneId === paneId)
    const video = host?.querySelector<HTMLVideoElement>('video')
    const playbackSourceHref = playback.source
      ? new URL(playback.source.url, window.location.origin).href
      : null
    const videoHref = video?.currentSrc || video?.src
    if (
      video &&
      playback.source &&
      playback.phase === 'playing' &&
      Number(video.dataset.playbackGeneration) === playback.source.generation &&
      videoHref === playbackSourceHref &&
      Number.isFinite(video.currentTime)
    ) {
      const position = video.currentTime
      const duration = Number.isFinite(video.duration) ? video.duration : undefined
      playbackSession.dispatch({
        type: 'time',
        generation: playback.source.generation,
        position,
        ...(duration === undefined ? {} : { duration }),
      })
    }
    playbackSession.dispatch({ type: 'checkpoint' })
  }

  function handOffPlayingVideo(current: PersistedWorkspaceState, nextPaneId: string | null) {
    const playback = playbackSession.getSnapshot()
    const item = playback.currentItem
    const activeWindow = current.windows.find((window) => window.id === current.activeWindowId)
    const nextWindow = current.windows.find((window) => window.id === nextPaneId)
    if (!item || item.media !== 'video') {
      backgroundVideoPaneId = null
      return
    }
    if (
      playback.mode === 'audio' &&
      backgroundVideoPaneId === nextPaneId &&
      paneShowsPath(nextWindow, item.locator)
    ) {
      backgroundVideoPaneId = null
      playbackSession.dispatch({ type: 'setMode', mode: 'video' })
      return
    }
    if (playback.mode === 'video' && !paneShowsPath(nextWindow, item.locator)) {
      const videoPane = paneShowsPath(activeWindow, item.locator)
        ? activeWindow
        : current.windows.find((window) => paneShowsPath(window, item.locator))
      if (videoPane?.id === current.activeWindowId) checkpointVideoPane(videoPane.id)
      else playbackSession.dispatch({ type: 'checkpoint' })
      backgroundVideoPaneId = videoPane?.id ?? null
      playbackSession.dispatch({ type: 'setMode', mode: 'audio' })
    }
  }

  function selectPane(paneId: string | null, restoreVideo = true) {
    const current = workspace()
    if (current) {
      const playback = playbackSession.getSnapshot()
      const nextWindow = current.windows.find((window) => window.id === paneId)
      if (
        restoreVideo &&
        playback.mode === 'audio' &&
        playback.currentItem?.media === 'video' &&
        paneShowsPath(nextWindow, playback.currentItem.locator)
      ) {
        backgroundVideoPaneId = paneId
      } else if (!restoreVideo && backgroundVideoPaneId === paneId) {
        backgroundVideoPaneId = null
      }
      handOffPlayingVideo(current, paneId)
    }
    setWorkspace((current) => (current ? { ...current, activeWindowId: paneId } : current))
    props.onActivePaneChange(paneId)
    try {
      if (paneId) localStorage.setItem(sessionKey(), paneId)
      else localStorage.removeItem(sessionKey())
    } catch {}
  }

  function projectClientSpace() {
    const space = props.client.getSnapshot().space
    if (!space || space.id !== props.space().id || space.revision === projectedRevision) return
    projectedRevision = space.revision
    applyingProjection = true
    setWorkspace((current) => {
      const projected = projectSpaceToWorkspace(space, {
        activeWindowId: activePaneId(),
        activeTabMap: current?.activeTabMap ?? {},
        nextWindowId: current?.nextWindowId ?? 1,
        pinnedTaskbarItems: current?.pinnedTaskbarItems ?? [],
      })
      if (current) {
        const nextPaneId = projected.windows.some(
          (window) => window.id === projected.activeWindowId,
        )
          ? projected.activeWindowId
          : (projected.windows[0]?.id ?? null)
        handOffPlayingVideo(current, nextPaneId)
      }
      return projected
    })
    queueMicrotask(() => {
      applyingProjection = false
    })
  }

  const unsubscribe = props.client.subscribe(projectClientSpace)

  function flush() {
    if (syncTimer) {
      clearTimeout(syncTimer)
      syncTimer = undefined
    }
    const current = workspace()
    const space = props.client.getSnapshot().space
    if (!current || !space) return
    setSyncError(null)
    try {
      const desired = workspaceStateToSpace({
        id: space.id,
        name: space.name,
        state: current,
        revision: space.revision,
        createdAt: space.createdAt,
        updatedAt: space.updatedAt,
        origin: space.origin,
      })
      const merged = {
        ...desired,
        arrangements: { ...space.arrangements, tiled: desired.arrangements.tiled },
      }
      for (const command of spaceCommandsToMatch(space, merged)) {
        void props.client.dispatch(command).catch((cause: unknown) => {
          setSyncError(cause instanceof Error ? cause.message : 'Space could not save')
        })
      }
      projectedRevision = props.client.getSnapshot().space?.revision ?? projectedRevision
    } catch (cause) {
      setSyncError(cause instanceof Error ? cause.message : 'Space could not save')
    }
  }

  createEffect(() => {
    const current = workspace()
    if (!current || applyingProjection) return
    void current.windows
    if (syncTimer) clearTimeout(syncTimer)
    syncTimer = setTimeout(() => {
      syncTimer = undefined
      flush()
    }, 250)
  })

  createEffect(() => {
    const requested = props.activePaneId()
    const current = workspace()
    if (!current) return
    if (
      requested &&
      current.activeWindowId !== requested &&
      current.windows.some((window) => window.id === requested)
    ) {
      selectPane(requested, false)
      return
    }
    handOffPlayingVideo(current, current.activeWindowId)
  })

  createEffect(() => {
    const paneId = activePaneId()
    if (paneId !== props.activePaneId()) props.onActivePaneChange(paneId)
  })

  onMount(() => {
    const flushBeforeLeave = () => flush()
    const showSessionVideo = () => {
      const playback = playbackSession.getSnapshot()
      const item = playback.currentItem
      const current = workspace()
      if (!item || item.media !== 'video' || playback.mode !== 'video' || !current) return
      const existing = current.windows.find((window) => paneShowsPath(window, item.locator))
      backgroundVideoPaneId = null
      if (existing) {
        selectPane(existing.id)
        return
      }
      const legacy = legacyFileItemFromPath(item.locator, { displayName: item.name })
      const resource = resourceForFileItem(
        { ...legacy, type: MediaType.VIDEO },
        { presentation: 'video' },
      )
      addViewer(
        activePaneId() ?? '',
        {
          ...legacy,
          type: MediaType.VIDEO,
          resource: {
            ...resource,
            ref: { ...item.ref },
            ...(item.version ? { version: item.version } : {}),
            name: item.name,
          },
        },
        'video-player',
      )
    }
    const unregisterPresentationFlush = props.registerPresentationFlush?.(flush)
    window.addEventListener('pagehide', flushBeforeLeave)
    window.addEventListener('derp-playback-show-video', showSessionVideo)
    onCleanup(() => {
      unregisterPresentationFlush?.()
      window.removeEventListener('pagehide', flushBeforeLeave)
      window.removeEventListener('derp-playback-show-video', showSessionVideo)
    })
  })

  onCleanup(() => {
    if (syncTimer) clearTimeout(syncTimer)
    const current = workspace()
    if (current) handOffPlayingVideo(current, null)
    unsubscribe()
    flush()
  })

  function updateWindow(
    paneId: string,
    update: (window: WorkspaceWindowDefinition) => WorkspaceWindowDefinition,
  ) {
    setWorkspace((current) =>
      current
        ? {
            ...current,
            windows: current.windows.map((window) =>
              window.id === paneId ? update(window) : window,
            ),
          }
        : current,
    )
  }

  function navigateDir(paneId: string, dir: string, resource?: ResourceSummary) {
    updateWindow(paneId, (window) => ({
      ...window,
      title: workspaceBrowserDirTitle(dir),
      iconPath: dir,
      initialState: { ...window.initialState, dir, viewing: null },
      ...(resource ? { resourceTarget: persistedResourceTarget(resource) } : {}),
    }))
  }

  function addViewer(
    sourcePaneId: string,
    file: FileItem,
    viewerId?: ViewerId,
    sourceOverride?: WorkspaceSource,
  ) {
    setWorkspace((current) => {
      if (!current) return current
      const source =
        sourceOverride ??
        current.windows.find((window) => window.id === sourcePaneId)?.source ??
        OWNER_SOURCE
      const id = nextPaneId(current)
      const window: WorkspaceWindowDefinition = {
        id,
        type: 'viewer',
        title: file.name,
        iconName: null,
        iconPath: file.path,
        iconType: file.type,
        iconIsVirtual: false,
        source,
        initialState: { dir: parentPath(file.path), viewing: file.path },
        resourceTarget: persistedResourceTarget(file.resource),
        viewerId,
        tabGroupId: null,
      }
      queueMicrotask(() => selectPane(id))
      return {
        ...current,
        windows: [...current.windows, window],
        nextWindowId: current.nextWindowId + 1,
        activeWindowId: id,
      }
    })
  }

  function openReader(paneId: string, file: FileItem, viewerId?: ViewerId) {
    addViewer(paneId, file, viewerId)
    const createdId = workspace()?.activeWindowId
    if (createdId && file.isDirectory) {
      updateWindow(createdId, (window) => ({
        ...window,
        initialState: { ...window.initialState, readerKind: 'folder' },
      }))
    }
  }

  function openVirtual(paneId: string, file: FileItem, target: VirtualOpenTarget) {
    setWorkspace((current) => {
      if (!current) return current
      const existing = target.sessionId
        ? current.windows.find(
            (window) => window.type === 'hermes' && window.hermes?.sessionId === target.sessionId,
          )
        : undefined
      if (existing) {
        queueMicrotask(() => selectPane(existing.id))
        return { ...current, activeWindowId: existing.id }
      }
      const id = nextPaneId(current)
      const window: WorkspaceWindowDefinition = {
        id,
        type: 'hermes',
        title: target.type === 'hermesDraft' ? 'New Hermes session' : file.name,
        source: OWNER_SOURCE,
        initialState: {},
        resourceTarget: persistedResourceTarget(file.resource),
        hermes: {
          sessionId: target.sessionId,
          draftId: target.type === 'hermesDraft' ? crypto.randomUUID() : undefined,
          cwd: target.projectPath,
          readOnly: target.readOnly,
        },
      }
      queueMicrotask(() => selectPane(id))
      return {
        ...current,
        windows: [...current.windows, window],
        nextWindowId: current.nextWindowId + 1,
        activeWindowId: id,
      }
    })
  }

  function requestPlay(
    source: WorkspaceSource,
    file: FileItem,
    _dir?: string,
    plannedMedia?: 'audio' | 'video',
    viewerId?: ViewerId,
  ) {
    const media = plannedMedia ?? (file.type === MediaType.VIDEO ? 'video' : 'audio')
    const item = playbackItemFromFileItem({
      ...file,
      type: media === 'video' ? MediaType.VIDEO : MediaType.AUDIO,
    })
    if (item) {
      playbackSession.dispatch({ type: 'load', item, queue: [item], autoplay: true, mode: media })
    }
    if (media === 'video') addViewer(activePaneId() ?? '', file, viewerId, source)
  }

  function updateViewing(
    paneId: string,
    path: string,
    resource?: ResourceSummary,
    viewerId?: ViewerId,
  ) {
    updateWindow(paneId, (window) => ({
      ...window,
      title: path.split(/[/\\]/).at(-1) ?? path,
      iconPath: path,
      initialState: { ...window.initialState, viewing: path, dir: parentPath(path) },
      ...(resource ? { resourceTarget: persistedResourceTarget(resource) } : {}),
      ...(viewerId ? { viewerId } : {}),
    }))
  }

  function closePane(paneId: string) {
    const current = workspace()
    if (!current) return
    const closing = current.windows.find((window) => window.id === paneId)
    if (closing?.type === 'hermes' && !canCloseHermesWindow(closing.hermes)) return
    const windows = current.windows.filter((window) => window.id !== paneId)
    const active =
      current.activeWindowId === paneId ? (windows[0]?.id ?? null) : current.activeWindowId
    if (current.activeWindowId === paneId) handOffPlayingVideo(current, active)
    if (backgroundVideoPaneId === paneId) backgroundVideoPaneId = null
    setWorkspace({ ...current, windows, activeWindowId: active })
    props.onActivePaneChange(active)
    try {
      if (active) localStorage.setItem(sessionKey(), active)
      else localStorage.removeItem(sessionKey())
    } catch {}
  }

  function handleTabKey(event: KeyboardEvent, index: number) {
    const ids = paneIds()
    if (!ids.length) return
    let target = index
    if (event.key === 'ArrowRight') target = (index + 1) % ids.length
    else if (event.key === 'ArrowLeft') target = (index - 1 + ids.length) % ids.length
    else if (event.key === 'Home') target = 0
    else if (event.key === 'End') target = ids.length - 1
    else return
    event.preventDefault()
    const paneId = ids[target]!
    selectPane(paneId)
    document.querySelector<HTMLElement>(`[data-focus-tab-id="${CSS.escape(paneId)}"]`)?.focus()
  }

  return (
    <section class='absolute inset-0 flex min-h-0 flex-col bg-background' data-testid='space-focus'>
      <Show when={syncError()}>
        {(message) => (
          <div class='border-destructive/40 bg-destructive/5 border-b px-3 py-2 text-xs text-destructive'>
            {message()}
          </div>
        )}
      </Show>
      <div
        class='flex h-12 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-card px-2'
        role='tablist'
        aria-label='Space panes'
      >
        <For each={workspace()?.windows ?? []}>
          {(window, index) => (
            <div
              class='flex h-9 shrink-0 items-center rounded-md border border-transparent'
              classList={{ 'border-border bg-background': activePaneId() === window.id }}
            >
              <button
                type='button'
                role='tab'
                aria-selected={activePaneId() === window.id}
                tabindex={activePaneId() === window.id ? 0 : -1}
                data-focus-tab-id={window.id}
                class='flex h-full max-w-56 items-center gap-2 px-3 text-sm'
                onClick={() => selectPane(window.id)}
                onKeyDown={(event) => handleTabKey(event, index())}
              >
                {iconFor(window)}
                <span class='truncate'>{window.title}</span>
              </button>
              <button
                type='button'
                class='mr-1 inline-flex size-8 items-center justify-center rounded hover:bg-muted'
                aria-label={`Close ${window.title}`}
                onClick={() => closePane(window.id)}
              >
                <X class='size-3.5' />
              </button>
            </div>
          )}
        </For>
      </div>
      <Show
        when={paneIds().length > 0}
        fallback={
          <div class='flex min-h-0 flex-1 items-center justify-center p-6'>
            <div class='max-w-sm text-center'>
              <h2 class='font-semibold'>Space is empty</h2>
              <p class='text-muted-foreground mt-1 text-sm'>Add Library to begin.</p>
              <button
                type='button'
                class='bg-primary text-primary-foreground mt-4 min-h-11 rounded-md px-4 text-sm font-medium'
                onClick={props.onAddResource}
              >
                Add Resource
              </button>
            </div>
          </div>
        }
      >
        <div class='relative min-h-0 flex-1'>
          <Show when={activePaneId()} keyed>
            {(paneId) => {
              const window = createMemo(() =>
                workspace()?.windows.find((candidate) => candidate.id === paneId),
              )
              return (
                <div class='absolute inset-0'>
                  <PaneHost
                    runtimeKey={`${props.space().id}:${paneId}`}
                    preserveBrowserHistory
                    paneId={paneId}
                    window={window}
                    workspace={workspace}
                    contentVisible={() => true}
                    pending={() => false}
                    surface='workspace'
                    storageKey={`space:${props.space().id}:${paneId}`}
                    sharePanel={() => null}
                    editableFolders={server.editableFolders}
                    knowledgeBases={() => server.settingsQuery.data?.knowledgeBases ?? []}
                    fileIconContext={() => EMPTY_FILE_ICON_CONTEXT}
                    onNavigateDir={navigateDir}
                    onOpenViewer={addViewer}
                    onOpenReader={openReader}
                    onOpenVirtualTarget={openVirtual}
                    onOpenInNewTab={(id, file, _path, viewerId) => addViewer(id, file, viewerId)}
                    openInNewTabLabel='Open in new Pane'
                    onRequestPlay={requestPlay}
                    onOpenFileInNewFloatingWindow={(id, file, viewerId) =>
                      addViewer(id, file, viewerId)
                    }
                    onUpdateViewing={updateViewing}
                    onSessionCreated={(sessionId) =>
                      updateWindow(paneId, (current) => ({
                        ...current,
                        title:
                          current.title === 'New Hermes session' ? 'Hermes session' : current.title,
                        hermes: { ...current.hermes, sessionId, draftId: undefined },
                      }))
                    }
                    onBranchCreated={(sessionId, title) =>
                      openVirtual(
                        paneId,
                        legacyFileItemFromPath(`Hermes Sessions/session/${sessionId}`),
                        { type: 'hermesSession', sessionId, readOnly: false },
                      )
                    }
                    onTitleChanged={(title) =>
                      updateWindow(paneId, (current) => ({ ...current, title }))
                    }
                  />
                </div>
              )
            }}
          </Show>
        </div>
      </Show>
    </section>
  )
}
