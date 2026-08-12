import { isVirtualFolderPath } from '@/lib/constants'
import type { FileItem } from '@/lib/types'
import { MediaType } from '@/lib/types'
import {
  persistedResourceTarget,
  type PersistedResourceTarget,
  type ResourceSummary,
  type ViewerId,
} from '@/lib/resource'
import {
  backfillLegacyResourcePin,
  backfillLegacyResourceWindow,
  inspectResourceTarget,
  legacyResourceAttemptKey,
  legacyResourceIsPending,
  legacyResourceLocatorForPin,
  legacyResourceLocatorForWindow,
  reconcileResourceTargetPin,
  reconcileResourceTargetWindow,
  resolveLegacyResourceTarget,
  resourceTargetAttemptKey,
  resourceTargetIsPending,
  resourceTargetKey,
} from '@/lib/resource-target-resolution'
import type { AssistGridSpan } from '@/lib/workspace-assist-grid'
import {
  createDefaultBounds,
  createWindowLayout,
  getPlaybackTitle,
  getPlayerBoundsForAspectRatio,
  insertWindowAtGroupIndex,
  isVideoPath,
  maxWorkspaceWindowZ,
  WORKSPACE_WINDOW_MIN_VISIBLE_PX,
} from '@/lib/workspace-geometry'
import type { FileDragData } from '@/lib/file-drag-data'
import type {
  PersistedWorkspaceState,
  PinnedTaskbarItem,
  WorkspaceSource,
  WorkspaceWindowDefinition,
} from '@/lib/use-workspace'
import {
  projectSpaceToWorkspace,
  workspaceSessionState,
  workspaceStateToSpace,
  type Space,
} from '@/lib/space'
import {
  createBrowserSpaceTransport,
  createOptimisticSpaceClient,
  type OptimisticSpaceClient,
  type SpaceSaveStatus,
} from '@/lib/space-client'
import { sameSpaceContent, spaceCommandsToMatch } from '@/lib/space-sync'
import {
  resolveNewTabAnchorWindowId,
  serializeWorkspaceLayoutState,
  serializeWorkspacePersistedState,
  workspaceStorageBaseKey,
  workspaceStorageSessionKey,
} from '@/lib/use-workspace'
import {
  rememberWorkspaceVideoIntrinsics,
  viewerBoundsForVideoOpen,
} from '@/lib/workspace-video-intrinsics-preload'
import {
  resolveWorkspaceDeferredPresetApply,
  resolveWorkspaceInitialHydration,
} from '@/lib/workspace-bootstrap'
import { useWorkspacePreferredSnapStore } from '@/lib/workspace-preferred-snap-store'
import {
  getWorkspaceFileOpenTarget,
  useWorkspaceFileOpenTargetStore,
} from '@/lib/workspace-file-open-target'
import {
  layoutBoundsForWindowHighlight,
  pickWorkspaceWindowAtClientPoint,
} from '@/lib/workspace-file-open-target-picker'
import { workspaceBrowserDirTitle } from '@/lib/workspace-browser-dir-title'
import {
  For,
  Show,
  batch,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  untrack,
} from 'solid-js'
import { useThemeStore } from '@/lib/theme-store'
import { useStoreSync } from './lib/solid-store-sync'
import type { FileIconContext } from './lib/use-file-icon'
import {
  createUrlSearchParamsMemo,
  navigateSearchParams,
  useBrowserHistory,
} from './browser-history'
import { useAdminEventsStream } from './lib/use-admin-events-stream'
import { WorkspacePageCanvas } from './workspace/workspace-page/WorkspacePageCanvas'
import { WorkspacePageTaskbar } from './workspace/workspace-page/WorkspacePageTaskbar'
import type { WorkspacePageProps } from './workspace/workspace-page/workspace-page-types'
import { createWorkspaceSnapDragModel } from './workspace/workspace-page/create-workspace-snap-drag-model'
import { useWorkspacePageDocumentChrome } from './workspace/workspace-page/use-workspace-page-document-chrome'
import { useWorkspacePageLayoutBaseline } from './workspace/workspace-page/use-workspace-page-layout-baseline'
import { useWorkspacePageLocalPersistence } from './workspace/workspace-page/use-workspace-page-local-persistence'
import { useWorkspacePageServerData } from './workspace/workspace-page/use-workspace-page-server-data'

export type { WorkspacePageProps } from './workspace/workspace-page/workspace-page-types'
import {
  clampTabInsertIndex,
  ensureSplitActiveNotLeft,
  exitSplitViewState,
  groupIdForWindow,
  insertIndexAfterAllRightTabs,
  isSplitLeftTab,
  openInNewTabInGroupState,
  openInSplitViewFromBrowserState,
  orderedAllGroupIds,
  pruneTabGroupSplitsState,
  setSplitFractionState,
  setTabPinnedAndReorderState,
  splitWindowFromGroupState,
  tabsInGroup,
} from './workspace/tab-group-ops'
import { TaskbarGroupRow } from './workspace/WorkspaceTaskbarRows'
import type { WorkspaceVideoListenOnlyDetail } from './workspace/WorkspaceViewerPane'
import {
  clearSpaceWorkspaceRecovery,
  DEFAULT_WORKSPACE_SOURCE,
  defaultInitialBrowserTitle,
  inspectPersistedWorkspace,
  inspectSpaceWorkspaceRecovery,
  isWorkspaceRoute,
  markSpaceWorkspaceRecoveryCopy,
  persistSpaceWorkspaceRecovery,
  workspaceRecoveryCanReplay,
  workspaceSpaceRecoveryKey,
} from './workspace/workspace-page-persistence'
import { fileSearchResultToFileItem, type FileSearchResult } from '@/lib/file-search'
import type { VirtualOpenTarget } from '@/lib/virtual-directory'
import { canCloseHermesWindow } from '@/lib/hermes-session-store'
import {
  legacyFileItemFromPath,
  OWNER_OPEN_SCOPE,
  grantOpenScope,
  resourceForFileItem,
} from './lib/legacy-resource-adapter'
import { executeOpenPlan, openResource } from './lib/open-resource'
import { reconcileResolvedWindowPresentation } from './lib/resource-window-resolution'
import { viewerMediaType } from './lib/viewer-registry'
import { usePlaybackSession, usePlaybackSnapshot } from './media/playback/PlaybackProvider'
import { playbackItemFromFileItem } from './media/playback/items'
import { followAppLink, hrefForSpace, navigateSpace } from './lib/routes'

export function WorkspacePage(props: WorkspacePageProps = {}) {
  const playbackSession = usePlaybackSession()
  const playbackSnapshot = usePlaybackSnapshot()
  const history = useBrowserHistory()
  const urlSearchParams = createUrlSearchParamsMemo(history)

  const shareConfig = () => props.shareConfig ?? null
  const durableSpace = () => props.initialSpace ?? null
  const server = useWorkspacePageServerData(props, shareConfig)
  useAdminEventsStream(!props.shareConfig)

  const browserSource = createMemo(
    (): WorkspaceSource =>
      shareConfig()
        ? {
            kind: 'share',
            token: shareConfig()!.token,
            sharePath: shareConfig()!.sharePath,
          }
        : DEFAULT_WORKSPACE_SOURCE,
  )

  const storageSessionKeyFull = createMemo(() => {
    const space = durableSpace()
    if (space) {
      return { sid: space.id, key: `space-session-workspace-${encodeURIComponent(space.id)}` }
    }
    const sid = urlSearchParams().get('ws') ?? ''
    const base = workspaceStorageBaseKey(shareConfig()?.token ?? null)
    return { sid, key: sid ? workspaceStorageSessionKey(base, sid) : '' }
  })
  const spaceRecoveryStorageKey = createMemo(() => {
    const space = durableSpace()
    return space ? workspaceSpaceRecoveryKey(space.id) : ''
  })

  const [workspace, setWorkspace] = createSignal<PersistedWorkspaceState | null>(null)
  const [spaceSaveStatus, setSpaceSaveStatus] = createSignal<SpaceSaveStatus>('saved')
  const [spaceSaveError, setSpaceSaveError] = createSignal<string | null>(null)
  const [recoveredSpaceId, setRecoveredSpaceId] = createSignal<string | null>(null)
  const [corruptDraft, setCorruptDraft] = createSignal<{ key: string; raw: string } | null>(null)
  const [corruptSpaceRecovery, setCorruptSpaceRecovery] = createSignal<{ raw: string } | null>(null)
  const [staleWorkspaceRecoveryPending, setStaleWorkspaceRecoveryPending] = createSignal(false)
  const [scratchSavePending, setScratchSavePending] = createSignal(false)
  const [scratchSaveError, setScratchSaveError] = createSignal<string | null>(null)
  let spaceClient: OptimisticSpaceClient | null = null
  let spaceClientUnsubscribe: (() => void) | null = null
  let applyingSpaceProjection = false
  let lastSpaceProjection = ''
  let queuedWorkspaceSync: PersistedWorkspaceState | null = null
  let workspaceSyncTimer: ReturnType<typeof setTimeout> | null = null
  let lastConfirmedSpaceRevision = 0
  let retryStaleWorkspaceRecovery: (() => Promise<void>) | null = null
  let resolvedResourceSummaries = new Map<string, ResourceSummary>()
  const [resourceResolutionAttempts, setResourceResolutionAttempts] = createSignal<
    ReadonlySet<string>
  >(new Set())

  createEffect(() => {
    const requested = props.activePaneId
    const current = workspace()
    if (!requested || !current || current.activeWindowId === requested) return
    if (!current.windows.some((window) => window.id === requested)) return
    setWorkspace({ ...current, activeWindowId: requested })
  })

  createEffect(() => {
    const paneId = workspace()?.activeWindowId ?? null
    if (paneId !== props.activePaneId) props.onActivePaneChange?.(paneId)
  })

  function isResourceTargetPending(target: PersistedResourceTarget | null | undefined): boolean {
    return resourceTargetIsPending(
      target,
      resourceResolutionAttempts(),
      storageSessionKeyFull().key,
    )
  }

  function isResourceWindowPending(window: WorkspaceWindowDefinition | undefined): boolean {
    if (!window) return false
    return (
      isResourceTargetPending(window.resourceTarget) ||
      legacyResourceIsPending(
        legacyResourceLocatorForWindow(window),
        resourceResolutionAttempts(),
        storageSessionKeyFull().key,
      )
    )
  }

  function isResourcePinPending(pin: PinnedTaskbarItem): boolean {
    return (
      isResourceTargetPending(pin.resourceTarget) ||
      legacyResourceIsPending(
        legacyResourceLocatorForPin(pin),
        resourceResolutionAttempts(),
        storageSessionKeyFull().key,
      )
    )
  }

  function openScopeForSource(source: WorkspaceSource) {
    return source.kind === 'share'
      ? grantOpenScope(source.token ?? shareConfig()?.token ?? '')
      : OWNER_OPEN_SCOPE
  }

  function resourceForWorkspaceTarget(
    file: FileItem,
    resourceTarget?: PersistedResourceTarget,
  ): ResourceSummary {
    if (resourceTarget) {
      const resolved = resolvedResourceSummaries.get(resourceTargetKey(resourceTarget))
      if (resolved) return resolved
    }
    const resource = resourceForFileItem(file)
    if (file.resource || !resourceTarget) return resource
    return {
      ...resource,
      ref: { ...resourceTarget.ref },
      locator: { ...resource.locator, providerLocator: resourceTarget.legacyLocator },
      legacyLocator: resourceTarget.legacyLocator,
      ...(resourceTarget.availability ? { availability: resourceTarget.availability } : {}),
    }
  }

  const [layoutPicker, setLayoutPicker] = createSignal<{
    windowId: string
    anchor: DOMRect
  } | null>(null)

  const [fileOpenTargetPick, setFileOpenTargetPick] = createSignal<{
    sourceBrowserId: string
  } | null>(null)
  const [fileOpenPickHoverId, setFileOpenPickHoverId] = createSignal<string | null>(null)

  const preferredSnapTick = useStoreSync(useWorkspacePreferredSnapStore)
  const themeTick = useStoreSync(useThemeStore)
  const baseline = useWorkspacePageLayoutBaseline(workspace, setWorkspace)
  const snap = createWorkspaceSnapDragModel({ workspace, setWorkspace, preferredSnapTick })

  useWorkspacePageDocumentChrome(workspace, themeTick)

  useWorkspacePageLocalPersistence({
    storageSessionKeyFull,
    workspace,
    isShareSession: () => !!shareConfig(),
    enabled: () => !durableSpace() && !corruptDraft(),
  })

  function workspaceDeviceSession(seed?: PersistedWorkspaceState | null) {
    const local = seed ?? workspace()
    return {
      activeWindowId: local?.activeWindowId ?? null,
      activeTabMap: structuredClone(local?.activeTabMap ?? {}),
      nextWindowId: local?.nextWindowId ?? 1,
      pinnedTaskbarItems: structuredClone(
        local?.pinnedTaskbarItems ?? server.serverPinsList() ?? [],
      ),
      ...(local?.browserTabTitle ? { browserTabTitle: local.browserTabTitle } : {}),
      ...(local?.browserTabIcon ? { browserTabIcon: local.browserTabIcon } : {}),
      ...(local?.browserTabIconColor ? { browserTabIconColor: local.browserTabIconColor } : {}),
      fileOpenTarget: local?.fileOpenTarget ?? getWorkspaceFileOpenTarget(),
    }
  }

  type StoredSpaceWorkspaceSession = Pick<
    PersistedWorkspaceState,
    'activeWindowId' | 'activeTabMap' | 'nextWindowId'
  >

  function loadSpaceWorkspaceSession(): StoredSpaceWorkspaceSession | null {
    if (!durableSpace()) return null
    try {
      const raw = localStorage.getItem(storageSessionKeyFull().key)
      if (!raw) return null
      const value = JSON.parse(raw) as Partial<StoredSpaceWorkspaceSession>
      if (
        (value.activeWindowId !== null && typeof value.activeWindowId !== 'string') ||
        !value.activeTabMap ||
        typeof value.activeTabMap !== 'object' ||
        Array.isArray(value.activeTabMap) ||
        !Object.values(value.activeTabMap).every((paneId) => typeof paneId === 'string') ||
        !Number.isSafeInteger(value.nextWindowId) ||
        Number(value.nextWindowId) < 1
      ) {
        return null
      }
      return {
        activeWindowId: value.activeWindowId ?? null,
        activeTabMap: structuredClone(value.activeTabMap),
        nextWindowId: Number(value.nextWindowId),
      }
    } catch {
      return null
    }
  }

  function persistSpaceWorkspaceSession(current: PersistedWorkspaceState) {
    if (!durableSpace()) return
    try {
      const session = workspaceSessionState(current)
      localStorage.setItem(
        storageSessionKeyFull().key,
        JSON.stringify({
          activeWindowId: session.activeWindowId,
          activeTabMap: session.activeTabMap,
          nextWindowId: session.nextWindowId,
        }),
      )
    } catch {}
  }

  function spaceProjectionKey(space: NonNullable<ReturnType<typeof durableSpace>>) {
    return JSON.stringify({
      id: space.id,
      revision: space.revision,
      panes: space.panes,
      tiled: space.arrangements.tiled,
    })
  }

  function persistDurableWorkspaceRecovery(current: PersistedWorkspaceState) {
    const key = spaceRecoveryStorageKey()
    if (!key || corruptSpaceRecovery() || staleWorkspaceRecoveryPending()) return
    persistSpaceWorkspaceRecovery(
      localStorage,
      key,
      current,
      Math.max(1, lastConfirmedSpaceRevision),
    )
  }

  function clearDurableWorkspaceRecovery() {
    const key = spaceRecoveryStorageKey()
    if (key && !corruptSpaceRecovery() && !staleWorkspaceRecoveryPending()) {
      clearSpaceWorkspaceRecovery(localStorage, key)
    }
  }

  function applySpaceClientSnapshot() {
    const currentSpace = spaceClient?.getSnapshot()
    if (!currentSpace?.space) return
    setSpaceSaveStatus(currentSpace.status)
    setSpaceSaveError(currentSpace.error)
    setRecoveredSpaceId(currentSpace.recoveredCopy?.id ?? null)
    if (corruptSpaceRecovery()) {
      setSpaceSaveStatus('failed')
      setSpaceSaveError('Unreadable local Workspace recovery needs attention')
    }
    if (currentSpace.status === 'saved' && currentSpace.pending === 0) {
      lastConfirmedSpaceRevision = currentSpace.space.revision
    }
    const projectionKey = spaceProjectionKey(currentSpace.space)
    if (projectionKey === lastSpaceProjection) return
    lastSpaceProjection = projectionKey
    applyingSpaceProjection = true
    setWorkspace((previous) =>
      projectSpaceToWorkspace(currentSpace.space!, workspaceDeviceSession(previous)),
    )
    queueMicrotask(() => {
      applyingSpaceProjection = false
    })
  }

  function flushWorkspaceSpaceSync() {
    if (!spaceClient || corruptSpaceRecovery() || staleWorkspaceRecoveryPending()) return
    try {
      while (queuedWorkspaceSync && spaceClient) {
        const desiredWorkspace = queuedWorkspaceSync
        queuedWorkspaceSync = null
        const clientSnapshot = spaceClient.getSnapshot()
        const currentSpace = clientSnapshot.space
        if (!currentSpace) continue
        const desiredSpace = workspaceStateToSpace({
          id: currentSpace.id,
          name: currentSpace.name,
          state: desiredWorkspace,
          revision: currentSpace.revision,
          createdAt: currentSpace.createdAt,
          updatedAt: currentSpace.updatedAt,
          origin: currentSpace.origin,
        })
        const desiredWithOtherArrangements = {
          ...desiredSpace,
          arrangements: {
            ...currentSpace.arrangements,
            tiled: desiredSpace.arrangements.tiled,
          },
        }
        if (sameSpaceContent(currentSpace, desiredWithOtherArrangements)) continue
        const saves = spaceCommandsToMatch(currentSpace, desiredWithOtherArrangements).map(
          (command) => spaceClient!.dispatch(command),
        )
        void Promise.all(saves)
          .then(() => {
            const latestWorkspace = workspace()
            const latestSnapshot = spaceClient?.getSnapshot()
            if (!latestWorkspace || !latestSnapshot?.space || latestSnapshot.pending > 0) return
            const latestDesired = workspaceStateToSpace({
              id: latestSnapshot.space.id,
              name: latestSnapshot.space.name,
              state: latestWorkspace,
              revision: latestSnapshot.space.revision,
              createdAt: latestSnapshot.space.createdAt,
              updatedAt: latestSnapshot.space.updatedAt,
              origin: latestSnapshot.space.origin,
            })
            if (
              sameSpaceContent(latestSnapshot.space, {
                ...latestDesired,
                arrangements: {
                  ...latestSnapshot.space.arrangements,
                  tiled: latestDesired.arrangements.tiled,
                },
              })
            ) {
              clearDurableWorkspaceRecovery()
            }
          })
          .catch((error: unknown) => {
            setSpaceSaveStatus(spaceClient?.getSnapshot().status ?? 'failed')
            setSpaceSaveError(error instanceof Error ? error.message : 'Space could not save')
          })
      }
    } catch (error) {
      setSpaceSaveStatus(spaceClient?.getSnapshot().status ?? 'failed')
      setSpaceSaveError(error instanceof Error ? error.message : 'Space could not save')
    }
  }

  createEffect(() => {
    const initialSpace = durableSpace()
    if (!initialSpace || shareConfig()) return
    if (!spaceClient || spaceClient.getSnapshot().space?.id !== initialSpace.id) {
      spaceClientUnsubscribe?.()
      if (spaceClient && spaceClient !== props.spaceClient) spaceClient.dispose()
      spaceClient =
        props.spaceClient ??
        createOptimisticSpaceClient({
          transport: createBrowserSpaceTransport(),
          initialSpace,
        })
      lastConfirmedSpaceRevision = initialSpace.revision
      spaceClientUnsubscribe = spaceClient.subscribe(applySpaceClientSnapshot)
      retryStaleWorkspaceRecovery = null
      setStaleWorkspaceRecoveryPending(false)
      const storedSession = loadSpaceWorkspaceSession()
      const recoveryInspection = inspectSpaceWorkspaceRecovery(
        localStorage,
        spaceRecoveryStorageKey(),
      )
      const recovery = recoveryInspection.kind === 'loaded' ? recoveryInspection.recovery : null
      const recoveryMatchesInitialSpace = (() => {
        if (!recovery) return false
        const candidate = workspaceStateToSpace({
          id: initialSpace.id,
          name: initialSpace.name,
          state: recovery.workspace,
          revision: initialSpace.revision,
          createdAt: initialSpace.createdAt,
          updatedAt: initialSpace.updatedAt,
          origin: initialSpace.origin,
        })
        return sameSpaceContent(initialSpace, {
          ...candidate,
          arrangements: {
            ...initialSpace.arrangements,
            tiled: candidate.arrangements.tiled,
          },
        })
      })()
      setCorruptSpaceRecovery(
        recoveryInspection.kind === 'corrupt' ? { raw: recoveryInspection.raw } : null,
      )
      if (
        recovery &&
        (recoveryMatchesInitialSpace || (props.spaceClient?.getSnapshot().pending ?? 0) > 0)
      ) {
        clearDurableWorkspaceRecovery()
        const projectedWorkspace = projectSpaceToWorkspace(initialSpace, {
          ...workspaceDeviceSession(),
          ...(storedSession ?? {}),
        })
        applyingSpaceProjection = true
        setWorkspace(projectedWorkspace)
        persistSpaceWorkspaceSession(projectedWorkspace)
        queueMicrotask(() => {
          applyingSpaceProjection = false
        })
      } else if (recovery && workspaceRecoveryCanReplay(recovery, initialSpace.revision)) {
        const recoveredWorkspace = storedSession
          ? { ...recovery.workspace, ...storedSession }
          : recovery.workspace
        lastSpaceProjection = spaceProjectionKey(initialSpace)
        applyingSpaceProjection = true
        setWorkspace(recoveredWorkspace)
        persistSpaceWorkspaceSession(recoveredWorkspace)
        queuedWorkspaceSync = structuredClone(recoveredWorkspace)
        if (workspaceSyncTimer) clearTimeout(workspaceSyncTimer)
        workspaceSyncTimer = setTimeout(() => {
          workspaceSyncTimer = null
          void flushWorkspaceSpaceSync()
        }, 0)
        queueMicrotask(() => {
          applyingSpaceProjection = false
        })
      } else if (recovery) {
        setStaleWorkspaceRecoveryPending(true)
        const recoveredId =
          recovery.recoveredSpaceId ?? globalThis.crypto?.randomUUID?.() ?? `space-${Date.now()}`
        const recoveredNameSuffix = ' (recovered)'
        const recoveredName = `${initialSpace.name
          .slice(0, 120 - recoveredNameSuffix.length)
          .trimEnd()}${recoveredNameSuffix}`
        const recovered = workspaceStateToSpace({
          id: recoveredId,
          name: recoveredName,
          state: recovery.workspace,
          origin: initialSpace.origin,
        })
        markSpaceWorkspaceRecoveryCopy(localStorage, spaceRecoveryStorageKey(), recoveredId)
        queueMicrotask(() => {
          setSpaceSaveStatus('conflict')
          setSpaceSaveError('Local Workspace recovery was based on an older Space revision')
        })
        const recoveryTransport = createBrowserSpaceTransport()
        let recoverySaveRunning = false
        retryStaleWorkspaceRecovery = async () => {
          if (recoverySaveRunning) return
          recoverySaveRunning = true
          setSpaceSaveStatus(navigator.onLine === false ? 'offline' : 'saving')
          try {
            let saved: Space
            try {
              saved = await recoveryTransport.load(recoveredId)
              if (saved.deletedAt !== undefined) throw new Error('Recovered Space is deleted')
            } catch {
              saved = await recoveryTransport.apply({
                command: {
                  type: 'create',
                  id: recovered.id,
                  name: recovered.name,
                  origin: 'workspace',
                  panes: recovered.panes,
                  arrangements: recovered.arrangements,
                },
              })
            }
            markSpaceWorkspaceRecoveryCopy(localStorage, spaceRecoveryStorageKey(), saved.id)
            setRecoveredSpaceId(saved.id)
            setStaleWorkspaceRecoveryPending(false)
            setSpaceSaveStatus('conflict')
            setSpaceSaveError('Local Workspace recovery was saved as a separate Space')
            retryStaleWorkspaceRecovery = null
          } catch (error) {
            setSpaceSaveStatus(navigator.onLine === false ? 'offline' : 'failed')
            setSpaceSaveError(
              error instanceof Error ? error.message : 'Recovered Space could not save',
            )
          } finally {
            recoverySaveRunning = false
          }
        }
        void retryStaleWorkspaceRecovery()
      } else if (storedSession) {
        applyingSpaceProjection = true
        setWorkspace(
          projectSpaceToWorkspace(initialSpace, {
            ...workspaceDeviceSession(),
            ...storedSession,
          }),
        )
        queueMicrotask(() => {
          applyingSpaceProjection = false
        })
      }
      applySpaceClientSnapshot()
      if (recoveryInspection.kind === 'corrupt') {
        setSpaceSaveStatus('failed')
        setSpaceSaveError('Unreadable local Workspace recovery needs attention')
      }
      const onOnline = () => {
        spaceClient?.setOnline(true)
        if (retryStaleWorkspaceRecovery) void retryStaleWorkspaceRecovery()
      }
      const onOffline = () => spaceClient?.setOnline(false)
      window.addEventListener('online', onOnline)
      window.addEventListener('offline', onOffline)
      onCleanup(() => {
        window.removeEventListener('online', onOnline)
        window.removeEventListener('offline', onOffline)
      })
    } else {
      const snapshot = spaceClient.getSnapshot()
      if (snapshot.pending === 0 && snapshot.space?.revision !== initialSpace.revision) {
        void spaceClient.load(initialSpace.id).catch((error: unknown) => {
          setSpaceSaveError(error instanceof Error ? error.message : 'Space could not reload')
        })
      }
    }
  })

  createEffect(() => {
    const currentWorkspace = workspace()
    if (!durableSpace() || !currentWorkspace || applyingSpaceProjection) return
    persistSpaceWorkspaceSession(currentWorkspace)
    if (staleWorkspaceRecoveryPending()) return
    if (corruptSpaceRecovery()) {
      setSpaceSaveStatus('failed')
      setSpaceSaveError('Unreadable local Workspace recovery needs attention')
      return
    }
    persistDurableWorkspaceRecovery(currentWorkspace)
    queuedWorkspaceSync = structuredClone(currentWorkspace)
    if (workspaceSyncTimer) clearTimeout(workspaceSyncTimer)
    workspaceSyncTimer = setTimeout(() => {
      workspaceSyncTimer = null
      void flushWorkspaceSpaceSync()
    }, 300)
  })

  onMount(() => {
    const flushDurableWorkspace = () => {
      const currentWorkspace = workspace()
      if (!durableSpace() || !currentWorkspace) return
      persistSpaceWorkspaceSession(currentWorkspace)
      if (corruptSpaceRecovery() || staleWorkspaceRecoveryPending()) return
      persistDurableWorkspaceRecovery(currentWorkspace)
      queuedWorkspaceSync = structuredClone(currentWorkspace)
      if (workspaceSyncTimer) {
        clearTimeout(workspaceSyncTimer)
        workspaceSyncTimer = null
      }
      void flushWorkspaceSpaceSync()
    }
    const unregisterPresentationFlush = props.registerPresentationFlush?.(flushDurableWorkspace)
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushDurableWorkspace()
    }
    const blockStaleRecoveryKeyboardInput = (event: KeyboardEvent) => {
      if (!staleWorkspaceRecoveryPending()) return
      const target = event.target
      if (target instanceof Element && target.closest('[data-stale-recovery-overlay]')) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    window.addEventListener('pagehide', flushDurableWorkspace)
    window.addEventListener('keydown', blockStaleRecoveryKeyboardInput, true)
    document.addEventListener('visibilitychange', onVisibilityChange)
    onCleanup(() => {
      unregisterPresentationFlush?.()
      window.removeEventListener('pagehide', flushDurableWorkspace)
      window.removeEventListener('keydown', blockStaleRecoveryKeyboardInput, true)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    })
  })

  onCleanup(() => {
    if (workspaceSyncTimer) clearTimeout(workspaceSyncTimer)
    const currentWorkspace = workspace()
    if (durableSpace() && currentWorkspace && !corruptSpaceRecovery()) {
      queuedWorkspaceSync = structuredClone(currentWorkspace)
      void flushWorkspaceSpaceSync()
    }
    spaceClientUnsubscribe?.()
    if (spaceClient && spaceClient !== props.spaceClient) spaceClient.dispose()
  })

  createEffect(() => {
    const w = workspace()
    const t = w?.fileOpenTarget
    if (t !== 'new-tab' && t !== 'new-window') return
    const cur = useWorkspaceFileOpenTargetStore.getState().target
    if (cur !== t) {
      useWorkspaceFileOpenTargetStore.getState().setTarget(t)
    }
  })

  createEffect(() => {
    if (!fileOpenTargetPick()) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setFileOpenTargetPick(null)
        setFileOpenPickHoverId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    onCleanup(() => window.removeEventListener('keydown', onKey))
  })

  const [pinsHydratedFor, setPinsHydratedFor] = createSignal('')

  let lastHydratedStorageKey = ''

  createEffect(() => {
    const loc = history()
    if (!isWorkspaceRoute(loc.pathname)) return
    const sp = urlSearchParams()
    let sid = sp.get('ws') ?? ''
    if (!sid) {
      sid = crypto.randomUUID()
      navigateSearchParams({ ws: sid }, 'replace')
    }
    const base = workspaceStorageBaseKey(shareConfig()?.token ?? null)
    const key = workspaceStorageSessionKey(base, sid)
    const inspection = inspectPersistedWorkspace(localStorage, key)
    setCorruptDraft(inspection.kind === 'corrupt' ? { key, raw: inspection.raw } : null)
    const dirParam = sp.get('dir')
    const presetParam = sp.get('preset')
    void server.settingsQuery.isSuccess
    void server.serverLayoutPresets()
    const presetsReadyNow = shareConfig() ? true : server.settingsQuery.isSuccess
    // Always prefer session draft in localStorage over a named preset in the URL.
    const loaded = inspection.kind === 'loaded' ? inspection.workspace : null
    const src = browserSource()
    const scope = server.layoutScope()
    const presetsList = server.serverLayoutPresets()

    if (lastHydratedStorageKey !== key) {
      lastHydratedStorageKey = key
      const initial = resolveWorkspaceInitialHydration({
        dirParam,
        presetParam,
        loaded,
        presetsReadyNow,
        presetsList,
        layoutScope: scope,
        source: src,
      })
      untrack(() => {
        if (initial.kind === 'defer-preset') {
          setPinsHydratedFor('')
          return
        }
        if (initial.baselineSnapshot && initial.baselinePresetId) {
          baseline.setLayoutBaselinePresetId(initial.baselinePresetId)
          baseline.setLayoutBaselineSerialized(
            serializeWorkspaceLayoutState(initial.baselineSnapshot),
          )
          baseline.setLayoutBaselineSnapshot(initial.baselineSnapshot)
        } else {
          baseline.resetLayoutBaseline()
        }
        setWorkspace(initial.workspace)
        if (initial.stripPresetFromUrl) {
          navigateSearchParams({ preset: null }, 'replace')
        }
        setPinsHydratedFor('')
      })
      return
    }

    const deferred = resolveWorkspaceDeferredPresetApply({
      presetParam,
      presetsReadyNow,
      hasPersistedDraft: inspection.kind !== 'missing',
      presetsList,
      layoutScope: scope,
    })
    if (!deferred) return
    untrack(() => {
      if (deferred.kind === 'apply') {
        baseline.setLayoutBaselinePresetId(deferred.baselinePresetId)
        baseline.setLayoutBaselineSerialized(
          serializeWorkspaceLayoutState(deferred.baselineSnapshot),
        )
        baseline.setLayoutBaselineSnapshot(deferred.baselineSnapshot)
        setWorkspace(deferred.workspace)
      }
      if (deferred.stripPresetFromUrl) {
        navigateSearchParams({ preset: null }, 'replace')
      }
      setPinsHydratedFor('')
    })
  })

  createEffect(() => {
    if (!server.serverPinsReady()) return
    const { key } = storageSessionKeyFull()
    const w = workspace()
    if (!key || !w) return
    if (pinsHydratedFor() === key) return

    const serverPins = server.serverPinsList()
    untrack(() => {
      if (serverPins.length > 0) {
        setWorkspace((prev) => (prev ? { ...prev, pinnedTaskbarItems: serverPins } : prev))
      } else if ((w.pinnedTaskbarItems?.length ?? 0) > 0) {
        void server.persistPinsMutation.mutateAsync(w.pinnedTaskbarItems ?? [])
      }
    })
    setPinsHydratedFor(key)
  })

  let resourceResolutionSnapshot = ''
  let resourceResolutionController: AbortController | null = null
  onCleanup(() => resourceResolutionController?.abort())

  createEffect(() => {
    const { key } = storageSessionKeyFull()
    const current = workspace()
    if (!key || !current || !server.serverPinsReady() || pinsHydratedFor() !== key) return

    const targets = new Map<string, PersistedResourceTarget>()
    const legacyLocators = new Set<string>()
    for (const window of current.windows) {
      if (window.resourceTarget) {
        targets.set(resourceTargetKey(window.resourceTarget), window.resourceTarget)
      } else {
        const locator = legacyResourceLocatorForWindow(window)
        if (locator !== null) legacyLocators.add(locator)
      }
    }
    for (const pin of current.pinnedTaskbarItems ?? []) {
      if (pin.resourceTarget) {
        targets.set(resourceTargetKey(pin.resourceTarget), pin.resourceTarget)
      } else {
        const locator = legacyResourceLocatorForPin(pin)
        if (locator !== null) legacyLocators.add(locator)
      }
    }

    const share = shareConfig()
    const access = share
      ? ({ kind: 'grant', token: share.token } as const)
      : ({ kind: 'owner', surface: 'workspace' } as const)
    const presentationContext = {
      surface: 'workspace',
      scope: share ? grantOpenScope(share.token) : OWNER_OPEN_SCOPE,
    } as const
    const snapshot = `${key}\u0000${access.kind === 'grant' ? access.token : 'owner'}\u0000${[
      ...[...targets.keys()].map((target) => `ref:${target}`),
      ...[...legacyLocators].map((locator) => `legacy:${locator.replace(/\\/g, '/')}`),
    ]
      .sort()
      .join('\u0001')}`
    if (snapshot === resourceResolutionSnapshot) return
    resourceResolutionSnapshot = snapshot
    resolvedResourceSummaries = new Map()
    resourceResolutionController?.abort()
    const controller = new AbortController()
    resourceResolutionController = controller

    void Promise.all([
      Promise.all(
        [...targets].map(async ([targetKey, target]) => {
          try {
            return [
              targetKey,
              target,
              await inspectResourceTarget(target, access, controller.signal),
            ] as const
          } catch {
            return [targetKey, target, null] as const
          }
        }),
      ),
      Promise.all(
        [...legacyLocators].map(async (locator) => {
          try {
            return [
              locator,
              await resolveLegacyResourceTarget(locator, access, controller.signal),
            ] as const
          } catch {
            return [locator, null] as const
          }
        }),
      ),
    ]).then(([resolved, legacyResolved]) => {
      if (controller.signal.aborted || resourceResolutionSnapshot !== snapshot) return
      const summaries = new Map(
        resolved.map(([targetKey, _target, summary]) => [targetKey, summary] as const),
      )
      const legacySummaries = new Map(legacyResolved)
      resolvedResourceSummaries = new Map([
        ...resolved.flatMap(([targetKey, _target, summary]) =>
          summary ? ([[targetKey, summary]] as const) : [],
        ),
        ...legacyResolved.flatMap(([_, summary]) =>
          summary
            ? ([[`${summary.ref.libraryId}\u0000${summary.ref.resourceId}`, summary]] as const)
            : [],
        ),
      ])
      const latest = workspace()
      if (!latest || storageSessionKeyFull().key !== key) {
        if (resourceResolutionSnapshot === snapshot) resourceResolutionSnapshot = ''
        return
      }

      const windows = latest.windows.map((window) => {
        const target = window.resourceTarget
        if (target) {
          const summary = summaries.get(resourceTargetKey(target))
          if (!summary) return window
          return reconcileResolvedWindowPresentation(
            reconcileResourceTargetWindow(window, summary),
            summary,
            presentationContext,
          )
        }
        const locator = legacyResourceLocatorForWindow(window)
        const summary = locator === null ? null : legacySummaries.get(locator)
        if (locator === null || !summary) return window
        return reconcileResolvedWindowPresentation(
          backfillLegacyResourceWindow(window, locator, summary),
          summary,
          presentationContext,
        )
      })
      const currentPins = latest.pinnedTaskbarItems ?? []
      const pins = currentPins.map((pin) => {
        const target = pin.resourceTarget
        if (target) {
          const summary = summaries.get(resourceTargetKey(target))
          return summary ? reconcileResourceTargetPin(pin, summary) : pin
        }
        const locator = legacyResourceLocatorForPin(pin)
        const summary = locator === null ? null : legacySummaries.get(locator)
        return locator !== null && summary ? backfillLegacyResourcePin(pin, locator, summary) : pin
      })
      const pinsChanged = pins.some((pin, index) => {
        const before = currentPins[index]
        return (
          !!before &&
          (pin.path !== before.path ||
            pin.title !== before.title ||
            pin.isDirectory !== before.isDirectory ||
            pin.resourceTarget?.legacyLocator !== before.resourceTarget?.legacyLocator ||
            pin.resourceTarget?.ref.libraryId !== before.resourceTarget?.ref.libraryId ||
            pin.resourceTarget?.ref.resourceId !== before.resourceTarget?.ref.resourceId ||
            pin.resourceTarget?.availability !== before.resourceTarget?.availability)
        )
      })
      batch(() => {
        setWorkspace({ ...latest, windows, pinnedTaskbarItems: pins })
        setResourceResolutionAttempts((previous) => {
          const next = new Set(previous)
          for (const [, target] of resolved) next.add(resourceTargetAttemptKey(target, key))
          for (const [locator] of legacyResolved) {
            next.add(legacyResourceAttemptKey(locator, key))
          }
          return next
        })
      })
      if (pinsChanged) void server.persistPinsMutation.mutateAsync(pins)
    })
  })

  function focusWindow(windowId: string) {
    const w = workspace()
    if (!w) return
    let target = w.windows.find((x) => x.id === windowId)
    if (!target) return
    const gid = groupIdForWindow(target)
    let focusWindowId = windowId
    if (isSplitLeftTab(w, gid, windowId)) {
      const members = tabsInGroup(w.windows, gid)
      const splitId = w.tabGroupSplits?.[gid]?.leftTabId
      const firstRight = members.find((m) => m.id !== splitId)
      if (!firstRight) return
      const cur = w.activeTabMap[gid]
      focusWindowId =
        cur && cur !== splitId && members.some((m) => m.id === cur) ? cur : firstRight.id
      target = w.windows.find((x) => x.id === focusWindowId)
    }
    if (!target) return
    const leader = tabsInGroup(w.windows, gid)[0]
    const groupMinimized = leader?.layout?.minimized ?? false
    if (w.activeWindowId === focusWindowId && !groupMinimized) return
    const maxZ = maxWorkspaceWindowZ(w.windows)
    const newZ = maxZ + 1
    setWorkspace({
      ...w,
      activeWindowId: focusWindowId,
      activeTabMap: { ...w.activeTabMap, [gid]: focusWindowId },
      windows: w.windows.map((win) =>
        groupIdForWindow(win) === gid
          ? { ...win, layout: { ...win.layout, zIndex: newZ, minimized: false } }
          : win,
      ),
    })
  }

  function stopWorkspacePlaybackFromTaskbar() {
    playbackSession.dispatch({ type: 'stop' })
  }

  function closeWindow(windowId: string) {
    const w = workspace()
    if (!w) return
    const t = w.windows.find((x) => x.id === windowId)
    const gid = t ? groupIdForWindow(t) : windowId
    const toRemove = new Set(w.windows.filter((x) => groupIdForWindow(x) === gid).map((x) => x.id))
    if (w.windows.some((x) => toRemove.has(x.id) && !canCloseHermesWindow(x.hermes))) return
    const next = w.windows.filter((x) => !toRemove.has(x.id))
    let active = w.activeWindowId
    if (active != null && toRemove.has(active)) {
      active = next[next.length - 1]?.id ?? active
    }
    const nextTabMap = { ...w.activeTabMap }
    delete nextTabMap[gid]
    setWorkspace({ ...w, windows: next, activeWindowId: active, activeTabMap: nextTabMap })
  }

  function setActiveTab(groupId: string, tabId: string) {
    setWorkspace((prev) => {
      if (!prev) return prev
      if (isSplitLeftTab(prev, groupId, tabId)) {
        const split = prev.tabGroupSplits?.[groupId]
        if (!split) return prev
        const members = tabsInGroup(prev.windows, groupId)
        const firstRight = members.find((m) => m.id !== split.leftTabId)
        if (!firstRight) return prev
        const cur = prev.activeTabMap[groupId]
        const effectiveRight =
          cur && cur !== split.leftTabId && members.some((m) => m.id === cur) ? cur : firstRight.id
        const maxZ = maxWorkspaceWindowZ(prev.windows)
        const newZ = maxZ + 1
        return {
          ...prev,
          activeWindowId: effectiveRight,
          activeTabMap: { ...prev.activeTabMap, [groupId]: effectiveRight },
          windows: prev.windows.map((win) =>
            groupIdForWindow(win) === groupId
              ? { ...win, layout: { ...win.layout, zIndex: newZ, minimized: false } }
              : win,
          ),
        }
      }
      return {
        ...prev,
        activeTabMap: { ...prev.activeTabMap, [groupId]: tabId },
        activeWindowId: tabId,
      }
    })
  }

  function closeTab(tabId: string, opts?: { ignoreTabPinForListenOnlyDismiss?: boolean }) {
    setWorkspace((prev) => {
      if (!prev) return prev
      let work = prev
      const v0 = work.windows.find((w) => w.id === tabId)
      if (!v0) return prev
      const g0 = groupIdForWindow(v0)
      if (work.tabGroupSplits?.[g0]?.leftTabId === tabId) {
        work = exitSplitViewState(work, g0)
      }
      const victim = work.windows.find((w) => w.id === tabId)
      if (!victim) return pruneTabGroupSplitsState(work)
      if (!canCloseHermesWindow(victim.hermes)) return work
      if (victim.tabPinned && !opts?.ignoreTabPinForListenOnlyDismiss) return work
      const gid = groupIdForWindow(victim)
      const members = work.windows.filter((w) => groupIdForWindow(w) === gid)
      if (members.length <= 1) {
        const next = work.windows.filter((w) => w.id !== tabId)
        let active = work.activeWindowId
        if (active === tabId) active = next.length > 0 ? (next[next.length - 1]?.id ?? null) : null
        const nextMap = { ...work.activeTabMap }
        delete nextMap[gid]
        return pruneTabGroupSplitsState({
          ...work,
          windows: next,
          activeWindowId: active,
          activeTabMap: nextMap,
        })
      }
      let next = work.windows.filter((w) => w.id !== tabId)
      const still = next.filter((w) => groupIdForWindow(w) === gid)
      const nextMap = { ...work.activeTabMap }
      if (still.length === 1) {
        next = next.map((w) => (w.id === still[0].id ? { ...w, tabGroupId: null } : w))
        delete nextMap[gid]
      } else if (work.activeTabMap[gid] === tabId) {
        nextMap[gid] = still[0]?.id ?? work.activeTabMap[gid]
      }
      let active = work.activeWindowId
      if (active === tabId) {
        active = nextMap[gid] ?? still[0]?.id ?? next[next.length - 1]?.id ?? active
      }
      return pruneTabGroupSplitsState({
        ...work,
        windows: next,
        activeWindowId: active,
        activeTabMap: nextMap,
      })
    })
  }

  function listenOnlyHandoffFromWorkspaceViewer(
    tabId: string,
    detail: WorkspaceVideoListenOnlyDetail,
  ) {
    if (!storageSessionKeyFull().key) return
    const activeItem = playbackSession.getSnapshot().currentItem
    const file = legacyFileItemFromPath(detail.path)
    const item =
      activeItem?.locator === detail.path && activeItem.media === 'video'
        ? activeItem
        : playbackItemFromFileItem({ ...file, type: MediaType.VIDEO })
    if (item) {
      playbackSession.dispatch({
        type: 'load',
        item,
        queue: [item],
        autoplay: true,
        position: detail.videoCurrentTime,
        mode: 'audio',
      })
    }
    closeTab(tabId, { ignoreTabPinForListenOnlyDismiss: true })
  }

  function toggleTabPinned(tabId: string) {
    setWorkspace((prev) => {
      if (!prev) return prev
      const w = prev.windows.find((x) => x.id === tabId)
      if (
        !w ||
        (w.type === 'viewer' && w.initialState?.viewing && isVideoPath(w.initialState.viewing))
      )
        return prev
      const gid = groupIdForWindow(w)
      if (isSplitLeftTab(prev, gid, tabId)) return prev
      return setTabPinnedAndReorderState(prev, tabId, !w.tabPinned)
    })
  }

  function handleTabPullStart(groupId: string, tabId: string, e: PointerEvent) {
    const c = snap.getWorkspaceAreaElement()?.getBoundingClientRect()
    if (!c) return

    const prev = workspace()
    if (!prev) return
    if (isSplitLeftTab(prev, groupId, tabId)) return
    const pulledWin = prev.windows.find((x) => x.id === tabId)
    if (pulledWin?.tabPinned) return
    const members = prev.windows.filter((w) => groupIdForWindow(w) === groupId)
    if (members.length <= 1) return

    const startX = e.clientX
    const startY = e.clientY
    const threshold = 40
    let pulled = false
    let grabDx = 0
    let grabDy = 0
    const clampPullDragX = (nx: number, curWidth: number) => {
      const vis = WORKSPACE_WINDOW_MIN_VISIBLE_PX
      return Math.max(vis - curWidth, Math.min(nx, c.width - vis))
    }
    const clampPullDragY = (ny: number, curHeight: number) => {
      const vis = WORKSPACE_WINDOW_MIN_VISIBLE_PX
      return Math.max(vis - curHeight, Math.min(ny, c.height - vis))
    }

    const onMove = (ev: PointerEvent) => {
      if (!pulled) {
        const dy = ev.clientY - startY
        const dx = Math.abs(ev.clientX - startX)
        if (dy <= threshold && dx <= threshold) return
        pulled = true

        const win = prev.windows.find((x) => x.id === tabId)
        if (!win) {
          cleanup()
          return
        }
        const currentBounds = win.layout?.bounds
        const restoreBounds = win.layout?.restoreBounds
        const width = restoreBounds?.width ?? currentBounds?.width ?? 500
        const height = restoreBounds?.height ?? currentBounds?.height ?? 400
        const newX = ev.clientX - c.left - width / 2
        const newY = Math.max(0, ev.clientY - c.top - 16)

        const next = splitWindowFromGroupState(prev, tabId, { x: newX, y: newY, width, height })
        setWorkspace(next)
        focusWindow(tabId)

        const wb = next.windows.find((w) => w.id === tabId)?.layout?.bounds
        if (!wb) {
          cleanup()
          return
        }
        grabDx = ev.clientX - c.left - wb.x
        grabDy = ev.clientY - c.top - wb.y

        snap.handleDragPointerMove(tabId, ev.clientX, ev.clientY)
        const cur = next.windows.find((w) => w.id === tabId)?.layout?.bounds ?? wb
        let nx = clampPullDragX(ev.clientX - c.left - grabDx, cur.width)
        let ny = clampPullDragY(ev.clientY - c.top - grabDy, cur.height)
        snap.updateWindowBounds(tabId, { ...cur, x: nx, y: ny })
        return
      }

      snap.handleDragPointerMove(tabId, ev.clientX, ev.clientY)
      const cur = workspace()?.windows.find((w) => w.id === tabId)?.layout?.bounds
      if (!cur) return
      let nx = clampPullDragX(ev.clientX - c.left - grabDx, cur.width)
      let ny = clampPullDragY(ev.clientY - c.top - grabDy, cur.height)
      snap.updateWindowBounds(tabId, { ...cur, x: nx, y: ny })
    }

    const onUp = (ev: PointerEvent) => {
      cleanup()
      if (!pulled) return
      const final = workspace()?.windows.find((w) => w.id === tabId)?.layout?.bounds
      if (final) {
        snap.onDragPointerEnd(tabId, final, ev.clientX, ev.clientY)
      }
    }

    function cleanup() {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
    }

    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
  }

  function requestPlay(
    source: WorkspaceSource,
    path: string,
    dir?: string,
    resourceTarget?: PersistedResourceTarget,
    plannedMedia?: 'audio' | 'video',
    plannedViewerId?: ViewerId,
    resourceSummary?: ResourceSummary,
  ) {
    const key = storageSessionKeyFull().key
    if (!key) return
    const video = plannedMedia ? plannedMedia === 'video' : isVideoPath(path)
    const baseFile = legacyFileItemFromPath(path)
    const baseResource = resourceForFileItem(baseFile)
    const resource =
      resourceSummary ??
      (resourceTarget
        ? {
            ...baseResource,
            ref: { ...resourceTarget.ref },
            legacyLocator: resourceTarget.legacyLocator,
            availability: resourceTarget.availability ?? ('present' as const),
          }
        : baseResource)
    const activeItem = playbackSession.getSnapshot().currentItem
    const playbackItem =
      activeItem?.locator === path && activeItem.media === (video ? 'video' : 'audio')
        ? activeItem
        : playbackItemFromFileItem({
            ...baseFile,
            type: video ? MediaType.VIDEO : MediaType.AUDIO,
            resource,
          })
    if (!video) {
      if (playbackItem) {
        playbackSession.dispatch({
          type: 'load',
          item: playbackItem,
          queue: [playbackItem],
          autoplay: true,
          mode: 'audio',
        })
      }
      return
    }
    const w = workspace()
    if (!w) return

    if (playbackItem) {
      playbackSession.dispatch({
        type: 'load',
        item: playbackItem,
        queue: [playbackItem],
        autoplay: true,
        mode: 'video',
      })
    }

    let work: PersistedWorkspaceState = w

    const focusExistingMediaWindow = (target: WorkspaceWindowDefinition) => {
      const maxZ = maxWorkspaceWindowZ(work.windows) + 1
      const gid = groupIdForWindow(target)
      setWorkspace({
        ...work,
        activeWindowId: target.id,
        activeTabMap: { ...work.activeTabMap, [gid]: target.id },
        windows: work.windows.map((win) =>
          groupIdForWindow(win) === gid
            ? { ...win, layout: { ...win.layout, zIndex: maxZ, minimized: false } }
            : win,
        ),
      })
    }

    const existingViewer = work.windows.find(
      (win) => win.type === 'viewer' && win.initialState?.viewing === path,
    )
    if (existingViewer) {
      focusExistingMediaWindow(existingViewer)
      return
    }

    const activeWin = work.windows.find((x) => x.id === work.activeWindowId)
    let attachGroupId: string | null = null
    if (activeWin) {
      const gid = groupIdForWindow(activeWin)
      const members = tabsInGroup(work.windows, gid)
      const hasSplit = !!work.tabGroupSplits?.[gid]
      if (hasSplit || members.length > 1) {
        attachGroupId = gid
      }
    }

    const parentDir = path.split(/[/\\]/).slice(0, -1).join('/') || ''
    const initialDir = dir && dir.length > 0 ? dir : parentDir || null

    const viewerId = `workspace-win-${work.nextWindowId}`
    const nextNextId = work.nextWindowId + 1
    const baseWindows = work.windows
    const zIndex = maxWorkspaceWindowZ(baseWindows) + 1
    const nextTabMap = { ...work.activeTabMap }

    if (attachGroupId) {
      const anchor =
        baseWindows.find((x) => x.id === activeWin!.id) ??
        tabsInGroup(baseWindows, attachGroupId)[0]
      if (anchor) {
        const lb = anchor.layout
        const sharedLayout = lb
          ? {
              bounds: lb.bounds,
              fullscreen: lb.fullscreen,
              snapZone: lb.snapZone,
              tiling: lb.tiling,
              minimized: false,
              zIndex: lb.zIndex ?? zIndex,
              restoreBounds: lb.restoreBounds,
            }
          : createWindowLayout(undefined, createDefaultBounds(baseWindows.length, 'viewer'), zIndex)

        const groupMembers = tabsInGroup(baseWindows, attachGroupId)
        const split = work.tabGroupSplits?.[attachGroupId]
        let idx =
          split && split.leftTabId
            ? insertIndexAfterAllRightTabs(groupMembers, split.leftTabId)
            : groupMembers.length
        idx = clampTabInsertIndex(baseWindows, attachGroupId, idx)

        const newWin: WorkspaceWindowDefinition = {
          id: viewerId,
          type: 'viewer',
          title: getPlaybackTitle(path),
          iconName: null,
          iconPath: path,
          iconType: MediaType.VIDEO,
          iconIsVirtual: false,
          source,
          initialState: { viewing: path, dir: initialDir },
          resourceTarget,
          viewerId: plannedViewerId ?? 'video-player',
          tabGroupId: attachGroupId,
          layout: sharedLayout,
        }
        const nextWindows = insertWindowAtGroupIndex(baseWindows, newWin, attachGroupId, idx)
        let nextState: PersistedWorkspaceState = {
          ...work,
          windows: nextWindows,
          nextWindowId: nextNextId,
          activeWindowId: viewerId,
          activeTabMap: { ...nextTabMap, [attachGroupId]: viewerId },
        }
        nextState = ensureSplitActiveNotLeft(nextState)
        setWorkspace(nextState)
        return
      }
    }

    const newWin: WorkspaceWindowDefinition = {
      id: viewerId,
      type: 'viewer',
      title: getPlaybackTitle(path),
      iconName: null,
      iconPath: path,
      iconType: MediaType.VIDEO,
      iconIsVirtual: false,
      source,
      initialState: { viewing: path, dir: initialDir },
      resourceTarget,
      viewerId: plannedViewerId ?? 'video-player',
      tabGroupId: null,
      layout: createWindowLayout(
        undefined,
        viewerBoundsForVideoOpen(path, source, baseWindows.length),
        zIndex,
      ),
    }
    setWorkspace({
      ...work,
      windows: [...baseWindows, newWin],
      nextWindowId: nextNextId,
      activeWindowId: viewerId,
      activeTabMap: nextTabMap,
    })
  }

  onMount(() => {
    const showSessionVideo = () => {
      const snapshot = playbackSession.getSnapshot()
      const item = snapshot.currentItem
      if (!item || item.media !== 'video' || snapshot.mode !== 'video') return
      const existing = workspace()?.windows.find(
        (win) => win.type === 'viewer' && win.initialState?.viewing === item.locator,
      )
      if (existing) {
        focusWindow(existing.id)
        return
      }
      requestPlay(
        browserSource(),
        item.locator,
        item.locator.split(/[/\\]/).slice(0, -1).join('/') || undefined,
        { ref: { ...item.ref }, legacyLocator: item.locator },
        'video',
        'video-player',
      )
    }
    window.addEventListener('derp-playback-show-video', showSessionVideo)
    onCleanup(() => window.removeEventListener('derp-playback-show-video', showSessionVideo))
  })

  function resizeViewerWindowForVideoMetadata(
    windowId: string,
    videoWidth: number,
    videoHeight: number,
  ) {
    if (videoWidth <= 0 || videoHeight <= 0) return
    const aspect = videoWidth / videoHeight
    setWorkspace((prev) => {
      if (!prev) return prev
      const viewer = prev.windows.find((x) => x.id === windowId)
      if (!viewer || viewer.type !== 'viewer') return prev
      const currentBounds = viewer.layout?.bounds ?? null
      const newBounds = getPlayerBoundsForAspectRatio(aspect, currentBounds)
      const viewing = viewer.initialState?.viewing
      if (viewing) {
        rememberWorkspaceVideoIntrinsics(viewer.source, viewing, videoWidth, videoHeight)
      }
      const pb = viewer.layout?.bounds
      if (
        pb &&
        pb.x === newBounds.x &&
        pb.y === newBounds.y &&
        pb.width === newBounds.width &&
        pb.height === newBounds.height
      ) {
        return prev
      }
      return {
        ...prev,
        windows: prev.windows.map((win) =>
          win.id === windowId
            ? {
                ...win,
                layout: {
                  ...win.layout,
                  bounds: newBounds,
                },
              }
            : win,
        ),
      }
    })
  }

  function updateWindowViewing(
    windowId: string,
    viewing: string,
    resource?: ResourceSummary,
    viewerId?: ViewerId,
  ) {
    const w = workspace()
    if (!w) return
    const title = viewing.split(/[/\\]/).pop() ?? 'File'
    setWorkspace({
      ...w,
      windows: w.windows.map((win) =>
        win.id === windowId
          ? {
              ...win,
              title,
              iconPath: viewing,
              iconType:
                (viewerId ? viewerMediaType(viewerId) : null) ?? win.iconType ?? MediaType.OTHER,
              initialState: { ...win.initialState, viewing },
              resourceTarget: persistedResourceTarget(resource),
              viewerId: viewerId ?? win.viewerId,
            }
          : win,
      ),
    })
  }

  function navigateDir(windowId: string, dir: string, resource?: ResourceSummary) {
    const w = workspace()
    if (!w) return
    setWorkspace({
      ...w,
      windows: w.windows.map((win) => {
        if (win.id !== windowId) return win
        const next = {
          ...win,
          initialState: { ...win.initialState, dir },
          resourceTarget: persistedResourceTarget(resource),
        }
        if (win.type !== 'browser') return next
        const title = workspaceBrowserDirTitle(dir)
        return {
          ...next,
          title,
          iconPath: dir,
          iconType: MediaType.FOLDER,
          iconIsVirtual: isVirtualFolderPath(dir),
        }
      }),
    })
  }

  function openInNewTabInSameWindow(
    sourceWindowId: string,
    file: {
      path: string
      isDirectory: boolean
      isVirtual?: boolean
      resource?: ResourceSummary
      resourceTarget?: PersistedResourceTarget
      viewerId?: ViewerId
    },
    currentPath: string,
    insertIndex?: number,
    sourceOverride?: WorkspaceSource,
    viewerId?: ViewerId,
  ) {
    setWorkspace((prev) =>
      prev
        ? openInNewTabInGroupState(
            prev,
            sourceWindowId,
            { ...file, viewerId: viewerId ?? file.viewerId },
            currentPath,
            insertIndex,
            sourceOverride,
          )
        : prev,
    )
  }

  function dropFileToTabBar(
    targetLeaderWindowId: string,
    data: FileDragData,
    insertIndex?: number,
  ) {
    const sc = shareConfig()
    const source: WorkspaceSource =
      data.sourceKind === 'share'
        ? {
            kind: 'share',
            token: data.sourceToken ?? '',
            sharePath: sc?.sharePath ?? '',
          }
        : { kind: 'local', rootPath: null }
    const file = legacyFileItemFromPath(data.path, {
      displayName: data.path.split(/[/\\]/).filter(Boolean).at(-1) ?? 'File',
      isDirectory: data.isDirectory,
      isVirtual: !!data.virtualOpenTarget,
      resource: data.resource,
    })
    if (data.virtualOpenTarget) {
      const target = data.virtualOpenTarget
      const openTarget =
        target.type === 'hermesSession' && target.sessionId
          ? {
              type: 'hermesSession' as const,
              sessionId: target.sessionId,
              readOnly: target.readOnly,
            }
          : target.type === 'hermesDraft'
            ? {
                type: 'hermesDraft' as const,
                ...(target.projectPath ? { projectPath: target.projectPath } : {}),
                readOnly: target.readOnly,
              }
            : undefined
      if (!openTarget) return
      const resource = data.resource
        ? data.resource.openTarget
          ? data.resource
          : { ...data.resource, openTarget }
        : resourceForFileItem(file, {
            kind: openTarget.type === 'hermesSession' ? 'conversation' : 'draft',
            presentation: 'conversation',
            providerOperations: ['read'],
            openTarget,
          })
      const plan = openResource(resource, 'default', {
        surface: 'workspace',
        scope: openScopeForSource(source),
      })
      executeOpenPlan(plan, (planned) => {
        if (planned.kind === 'conversation') {
          openHermesFromBrowser(targetLeaderWindowId, file, planned.target, true)
        }
      })
      return
    }
    const plan = openResource(resourceForWorkspaceTarget(file, data.resourceTarget), 'default', {
      surface: 'workspace',
      scope: openScopeForSource(source),
    })
    executeOpenPlan(plan, (planned) => {
      if (planned.kind === 'blocked' || planned.kind === 'conversation') return
      const viewerId =
        planned.kind === 'viewer' || planned.kind === 'playback' ? planned.viewer.id : undefined
      const dir = data.isDirectory ? '' : data.path.split(/[/\\]/).slice(0, -1).join('/')
      setWorkspace((prev) =>
        prev
          ? openInNewTabInGroupState(
              prev,
              targetLeaderWindowId,
              {
                ...file,
                resourceTarget: data.resourceTarget,
                viewerId,
              },
              dir,
              insertIndex,
              source,
            )
          : prev,
      )
    })
  }

  function openBrowser(options?: {
    source?: WorkspaceSource
    initialState?: { dir?: string }
    resourceTarget?: PersistedResourceTarget
  }) {
    const w = workspace()
    if (!w) return
    const n = w.nextWindowId
    const id = `workspace-window-${n}`
    const source = options?.source ?? browserSource()
    const dirOpt = options?.initialState?.dir
    const initialState = dirOpt != null ? { dir: dirOpt } : {}
    const effectiveDir = dirOpt ?? ''
    const browserTitle =
      effectiveDir !== ''
        ? workspaceBrowserDirTitle(effectiveDir)
        : source.kind === 'share'
          ? defaultInitialBrowserTitle(source)
          : workspaceBrowserDirTitle('')
    const newWin: WorkspaceWindowDefinition = {
      id,
      type: 'browser',
      title: browserTitle,
      iconName: null,
      iconPath: effectiveDir,
      iconType: MediaType.FOLDER,
      iconIsVirtual: isVirtualFolderPath(effectiveDir),
      source,
      initialState,
      resourceTarget: options?.resourceTarget,
      tabGroupId: null,
      layout: createWindowLayout(undefined, createDefaultBounds(w.windows.length, 'browser'), n),
    }
    const maxZ = maxWorkspaceWindowZ(w.windows)
    newWin.layout = { ...newWin.layout, zIndex: maxZ + 1 }
    setWorkspace({
      ...w,
      windows: [...w.windows, newWin],
      nextWindowId: n + 1,
      activeWindowId: id,
    })
  }

  function openViewerFromBrowser(windowId: string, file: FileItem, viewerId?: ViewerId) {
    const w = workspace()
    const winDef = w?.windows.find((x) => x.id === windowId)
    if (!winDef) return
    const dir = winDef.initialState?.dir ?? ''
    const gid = groupIdForWindow(winDef)
    const splitBrowserLeft =
      !!w?.tabGroupSplits?.[gid]?.leftTabId &&
      w.tabGroupSplits[gid]!.leftTabId === windowId &&
      winDef.type === 'browser'
    if (getWorkspaceFileOpenTarget() === 'new-tab') {
      const anchorId = w ? resolveNewTabAnchorWindowId(w, windowId) : windowId
      openInNewTabInSameWindow(anchorId, file, dir, undefined, winDef.source, viewerId)
      return
    }
    if (splitBrowserLeft) {
      openInNewTabInSameWindow(windowId, file, dir, undefined, winDef.source, viewerId)
      return
    }
    openViewer(windowId, file, winDef.source, undefined, viewerId)
  }

  function openHermesFromBrowser(
    windowId: string,
    file: FileItem,
    target: VirtualOpenTarget,
    forceTab = false,
  ) {
    if (props.shareConfig) return
    const w = workspace()
    if (!w) return
    if (target.sessionId) {
      const existing = w.windows.find(
        (win) => win.type === 'hermes' && win.hermes?.sessionId === target.sessionId,
      )
      if (existing) {
        focusWindow(existing.id)
        return
      }
    }
    const id = `workspace-window-${w.nextWindowId}`
    const sourceWindow = w.windows.find((win) => win.id === windowId)
    const attachToTab = (forceTab || getWorkspaceFileOpenTarget() === 'new-tab') && sourceWindow
    const gid = attachToTab ? groupIdForWindow(sourceWindow) : null
    const newWin: WorkspaceWindowDefinition = {
      id,
      type: 'hermes',
      title: target.type === 'hermesDraft' ? 'New Hermes session' : file.name,
      iconName: null,
      iconPath: file.path,
      iconIsVirtual: true,
      source: { kind: 'local', rootPath: null },
      initialState: {},
      resourceTarget: persistedResourceTarget(file.resource),
      tabGroupId: gid,
      hermes: {
        sessionId: target.sessionId,
        draftId: target.type === 'hermesDraft' ? crypto.randomUUID() : undefined,
        cwd: target.projectPath,
        readOnly: target.readOnly,
      },
      layout:
        attachToTab && sourceWindow?.layout
          ? { ...sourceWindow.layout, minimized: false }
          : createWindowLayout(
              undefined,
              createDefaultBounds(w.windows.length, 'viewer'),
              maxWorkspaceWindowZ(w.windows) + 1,
            ),
    }
    setWorkspace({
      ...w,
      windows: [...w.windows, newWin],
      nextWindowId: w.nextWindowId + 1,
      activeWindowId: id,
      activeTabMap: gid ? { ...w.activeTabMap, [gid]: id } : w.activeTabMap,
    })
  }

  function bindHermesSession(windowId: string, sessionId: string) {
    setWorkspace((prev) =>
      prev
        ? {
            ...prev,
            windows: prev.windows.map((win) =>
              win.id === windowId
                ? {
                    ...win,
                    title: win.title === 'New Hermes session' ? 'Hermes session' : win.title,
                    iconPath: `Hermes Sessions/session/${sessionId}`,
                    hermes: { ...win.hermes, sessionId, draftId: undefined },
                  }
                : win,
            ),
          }
        : prev,
    )
  }

  function openHermesBranch(windowId: string, sessionId: string, title: string) {
    openHermesFromBrowser(
      windowId,
      {
        name: title,
        path: `Hermes Sessions/session/${sessionId}`,
        type: MediaType.OTHER,
        size: 0,
        extension: '',
        isDirectory: false,
        isVirtual: true,
      },
      { type: 'hermesSession', sessionId, readOnly: false },
      true,
    )
  }

  function renameHermesWindow(windowId: string, title: string) {
    setWorkspace((current) =>
      current
        ? {
            ...current,
            windows: current.windows.map((window) =>
              window.id === windowId ? { ...window, title } : window,
            ),
          }
        : current,
    )
  }

  function openInSplitViewFromBrowserPane(
    windowId: string,
    file: FileItem,
    plannedMedia?: 'audio' | 'video',
    viewerId?: ViewerId,
  ) {
    const w = workspace()
    const winDef = w?.windows.find((x) => x.id === windowId)
    if (!winDef || winDef.type !== 'browser') return
    const dir = winDef.initialState?.dir ?? ''
    if ((plannedMedia ?? (file.type === MediaType.AUDIO ? 'audio' : undefined)) === 'audio') {
      requestPlay(
        winDef.source,
        file.path,
        dir || undefined,
        persistedResourceTarget(file.resource),
        'audio',
        viewerId,
        file.resource,
      )
      return
    }
    setWorkspace((prev) =>
      prev
        ? openInSplitViewFromBrowserState(prev, windowId, { ...file, viewerId }, dir, winDef.source)
        : prev,
    )
  }

  function setSplitPaneFraction(groupId: string, fraction: number) {
    setWorkspace((prev) => (prev ? setSplitFractionState(prev, groupId, fraction) : prev))
  }

  function startSplitPaneDrag(groupId: string, e: PointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    const row = (e.currentTarget as HTMLElement).parentElement
    if (!row) return
    const onMove = (ev: PointerEvent) => {
      const r = row.getBoundingClientRect()
      const wpx = Math.max(1, r.width)
      setSplitPaneFraction(groupId, (ev.clientX - r.left) / wpx)
    }
    const onUp = () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
  }

  function openFileInNewFloatingWindow(windowId: string, file: FileItem, viewerId?: ViewerId) {
    const w = workspace()
    const winDef = w?.windows.find((x) => x.id === windowId)
    if (!winDef || file.isDirectory) return
    openViewer(windowId, file, winDef.source, undefined, viewerId)
  }

  function openViewer(
    _fromWindowId: string,
    file: FileItem,
    source: WorkspaceSource,
    resourceTargetOverride?: PersistedResourceTarget,
    viewerId?: ViewerId,
  ) {
    const w = workspace()
    if (!w) return
    const n = w.nextWindowId
    const id = `workspace-window-${n}`
    const parentDir = file.path.split(/[/\\]/).slice(0, -1).join('/') || ''
    const plannedType = (viewerId ? viewerMediaType(viewerId) : null) ?? file.type
    const newWin: WorkspaceWindowDefinition = {
      id,
      type: 'viewer',
      title: file.name,
      iconName: null,
      iconPath: file.path,
      iconType: plannedType,
      iconIsVirtual: false,
      source,
      initialState: { dir: parentDir, viewing: file.path },
      resourceTarget: persistedResourceTarget(file.resource) ?? resourceTargetOverride,
      viewerId,
      tabGroupId: null,
      layout: createWindowLayout(
        undefined,
        plannedType === MediaType.VIDEO
          ? viewerBoundsForVideoOpen(file.path, source, w.windows.length)
          : createDefaultBounds(w.windows.length, 'viewer'),
        n,
      ),
    }
    const maxZ = maxWorkspaceWindowZ(w.windows)
    newWin.layout = { ...newWin.layout, zIndex: maxZ + 1 }
    setWorkspace({
      ...w,
      windows: [...w.windows, newWin],
      nextWindowId: n + 1,
      activeWindowId: id,
    })
  }

  function openReaderFromBrowser(fromWindowId: string, file: FileItem, viewerId?: ViewerId) {
    const w = workspace()
    const sourceWindow = w?.windows.find((window) => window.id === fromWindowId)
    if (!w || !sourceWindow || !file.isDirectory) return
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
      source: sourceWindow.source,
      initialState: {
        dir: parentDir,
        viewing: file.path,
        readerKind: 'folder',
      },
      resourceTarget: persistedResourceTarget(file.resource),
      viewerId,
      tabGroupId: null,
      layout: createWindowLayout(undefined, createDefaultBounds(w.windows.length, 'viewer'), n),
    }
    newWin.layout = { ...newWin.layout, zIndex: maxWorkspaceWindowZ(w.windows) + 1 }
    setWorkspace({
      ...w,
      windows: [...w.windows, newWin],
      nextWindowId: n + 1,
      activeWindowId: id,
    })
  }

  function openGlobalSearchResult(result: FileSearchResult) {
    const file = fileSearchResultToFileItem(result)
    const source = browserSource()
    const plan = openResource(resourceForFileItem(file), 'default', {
      surface: 'workspace',
      scope: openScopeForSource(source),
    })
    executeOpenPlan(plan, (planned) => {
      if (planned.kind === 'browse') {
        openBrowser({
          source,
          initialState: { dir: file.path },
          resourceTarget: persistedResourceTarget(file.resource),
        })
        return
      }
      if (planned.kind === 'playback') {
        requestPlay(
          source,
          file.path,
          result.parentPath || undefined,
          persistedResourceTarget(file.resource),
          planned.media,
          planned.viewer.id,
          file.resource,
        )
        return
      }
      if (planned.kind === 'viewer') {
        openViewer(workspace()?.activeWindowId ?? '', file, source, undefined, planned.viewer.id)
      }
    })
  }

  function addPinnedItem(file: FileItem) {
    const w = workspace()
    if (!w) return
    const source = browserSource()
    const pinKey = (p: PinnedTaskbarItem) => `${p.path}:${p.source.kind}:${p.source.token ?? ''}`
    const newKey = `${file.path}:${source.kind}:${source.token ?? ''}`
    if ((w.pinnedTaskbarItems ?? []).some((p) => pinKey(p) === newKey)) return
    const customIcons = server.settingsQuery.data?.customIcons ?? {}
    const item: PinnedTaskbarItem = {
      id: crypto.randomUUID(),
      path: file.path,
      isDirectory: file.isDirectory,
      title: file.name,
      customIconName: customIcons[file.path] ?? null,
      isVirtual: file.isVirtual,
      source,
      resourceTarget: persistedResourceTarget(file.resource),
    }
    const next = [...(w.pinnedTaskbarItems ?? []), item]
    setWorkspace({ ...w, pinnedTaskbarItems: next })
    void server.persistPinsMutation.mutateAsync(next)
  }

  function removePinnedItem(id: string) {
    const w = workspace()
    if (!w) return
    const next = (w.pinnedTaskbarItems ?? []).filter((p) => p.id !== id)
    setWorkspace({ ...w, pinnedTaskbarItems: next })
    void server.persistPinsMutation.mutateAsync(next)
  }

  async function selectPinned(pin: PinnedTaskbarItem) {
    if (pin.resourceTarget?.availability || isResourcePinPending(pin)) return
    if (pin.isVirtual) {
      if (props.shareConfig) return
      const response = await fetch(
        `/api/virtual-directory/open?path=${encodeURIComponent(pin.path)}`,
      )
      if (!response.ok) return
      const payload = await response.json()
      const target = payload.openTarget as VirtualOpenTarget | undefined
      if (target) {
        const synthetic: FileItem = {
          path: pin.path,
          name: pin.title,
          isDirectory: false,
          isVirtual: true,
          size: 0,
          type: MediaType.OTHER,
          extension: '',
        }
        const openTarget =
          target.type === 'hermesSession' && target.sessionId
            ? {
                type: 'hermesSession' as const,
                sessionId: target.sessionId,
                readOnly: target.readOnly,
              }
            : target.type === 'hermesDraft'
              ? {
                  type: 'hermesDraft' as const,
                  ...(target.projectPath ? { projectPath: target.projectPath } : {}),
                  readOnly: target.readOnly,
                }
              : undefined
        if (!openTarget) return
        const plan = openResource(
          resourceForFileItem(synthetic, {
            kind: openTarget.type === 'hermesSession' ? 'conversation' : 'draft',
            presentation: 'conversation',
            providerOperations: ['read'],
            openTarget,
          }),
          'default',
          { surface: 'workspace', scope: openScopeForSource(pin.source) },
        )
        executeOpenPlan(plan, (planned) => {
          if (planned.kind === 'conversation') {
            openHermesFromBrowser(workspace()?.activeWindowId ?? '', synthetic, planned.target)
          }
        })
      }
      return
    }
    const synthetic = legacyFileItemFromPath(pin.path, {
      displayName: pin.title,
      isDirectory: pin.isDirectory,
    })
    const plan = openResource(
      resourceForWorkspaceTarget(synthetic, pin.resourceTarget),
      'default',
      {
        surface: 'workspace',
        scope: openScopeForSource(pin.source),
      },
    )
    executeOpenPlan(plan, (planned) => {
      if (planned.kind === 'browse') {
        openBrowser({
          source: pin.source,
          initialState: { dir: pin.path },
          resourceTarget: pin.resourceTarget,
        })
        return
      }
      if (planned.kind === 'playback') {
        requestPlay(
          pin.source,
          pin.path,
          pin.path.split(/[/\\]/).slice(0, -1).join('/') || undefined,
          pin.resourceTarget,
          planned.media,
          planned.viewer.id,
        )
        return
      }
      if (planned.kind === 'viewer') {
        openViewer('', synthetic, pin.source, pin.resourceTarget, planned.viewer.id)
      }
    })
  }

  const [pinMenu, setPinMenu] = createSignal<{
    x: number
    y: number
    pinId: string
  } | null>(null)

  const playbackPlayingPath = createMemo(() => {
    return playbackSnapshot().currentItem?.locator ?? null
  })

  const suppressWorkspaceTaskbarAudioForVideoViewer = createMemo(() => {
    const w = workspace()
    const st = playbackSnapshot()
    const path = st.currentItem?.locator
    if (!path || st.currentItem?.media !== 'video' || st.mode === 'audio' || !w) return false
    const norm = (p: string) => p.replace(/\\/g, '/').toLowerCase()
    const n = norm(path)
    return w.windows.some((win) => {
      if (win.type !== 'viewer') return false
      const v = win.initialState?.viewing
      if (!v || norm(v) !== n) return false
      return isVideoPath(v)
    })
  })

  const workspaceAudioChromeVisible = createMemo(() => {
    const state = playbackSnapshot()
    return (
      !!state.currentItem &&
      (state.currentItem.media === 'audio' || state.mode === 'audio') &&
      !suppressWorkspaceTaskbarAudioForVideoViewer()
    )
  })

  const workspaceFileIconContext = (): FileIconContext => {
    const tm = playbackSnapshot()
    const sp = server.sharePanel()
    const playing = tm.currentItem?.locator ?? null
    const audioMode = !!(playing && tm.mode === 'audio')

    return {
      customIcons: server.settingsQuery.data?.customIcons ?? {},
      knowledgeBases: server.settingsQuery.data?.knowledgeBases ?? [],
      playingPath: playing,
      currentFile: audioMode ? playing : null,
      mediaPlayerIsPlaying: audioMode ? tm.desiredPlaying : false,
      mediaType: audioMode ? 'audio' : null,
      mediaShare: sp ? { token: sp.token, sharePath: sp.sharePath } : undefined,
    }
  }

  const taskbarMouseHandled = { current: false }
  const orderedWindowGroupIds = createMemo(() => orderedAllGroupIds(workspace()?.windows ?? []))
  const taskbarActiveWindowId = createMemo(() => workspace()?.activeWindowId ?? null)

  const pinnedItems = createMemo(() => workspace()?.pinnedTaskbarItems ?? [])
  const hasWorkspaceWindows = createMemo(() => (workspace()?.windows.length ?? 0) > 0)
  const hasAnyTaskbarItems = createMemo(
    () => pinnedItems().length > 0 || orderedWindowGroupIds().length > 0,
  )

  /** Solid <For> passes props.each to mapArray as the list; it must be an array, not a memo fn. */
  const taskbarWindowRows = createMemo(() => (
    <For each={orderedWindowGroupIds()}>
      {(groupId) => (
        <TaskbarGroupRow
          groupId={groupId}
          workspace={workspace}
          activeWindowId={taskbarActiveWindowId}
          playingPath={playbackPlayingPath}
          fileIconContext={workspaceFileIconContext}
          taskbarMouseHandled={taskbarMouseHandled}
          focusWindow={focusWindow}
          setWindowMinimized={snap.setWindowMinimized}
          closeWindow={closeWindow}
        />
      )}
    </For>
  ))

  function handleWorkspaceTilingPick(windowId: string, span: AssistGridSpan) {
    snap.applyTilingPickerPick(windowId, span)
    setLayoutPicker(null)
  }

  function beginFileOpenTargetPick(sourceBrowserId: string) {
    setFileOpenTargetPick({ sourceBrowserId })
    setFileOpenPickHoverId(null)
  }

  function cancelFileOpenTargetPick() {
    setFileOpenTargetPick(null)
    setFileOpenPickHoverId(null)
  }

  async function saveScratchAsSpace() {
    const currentWorkspace = workspace()
    if (!currentWorkspace || shareConfig() || durableSpace()) return
    if (
      corruptDraft() &&
      !window.confirm(
        'The stored draft is unreadable. Save the fresh fallback as a Space? The original local data will remain unchanged for export.',
      )
    ) {
      return
    }
    const suggested = `Workspace ${new Date().toLocaleDateString()}`
    const requested = window.prompt('Name this Space', suggested)?.trim()
    if (!requested) return
    setScratchSavePending(true)
    setScratchSaveError(null)
    try {
      const id = globalThis.crypto?.randomUUID?.() ?? `space-${Date.now()}`
      const desired = workspaceStateToSpace({ id, name: requested, state: currentWorkspace })
      const scratchStorageKey = storageSessionKeyFull().key
      const sourceKey = scratchStorageKey || `workspace-unsaved:${id}`
      const serializedCurrent = serializeWorkspacePersistedState(currentWorkspace)
      const storedRaw = scratchStorageKey ? localStorage.getItem(scratchStorageKey) : null
      const rawSource = corruptDraft()?.raw ?? storedRaw ?? serializedCurrent
      if (scratchStorageKey && !storedRaw && !corruptDraft()) {
        localStorage.setItem(scratchStorageKey, serializedCurrent)
      }
      const { space: saved } = await createBrowserSpaceTransport().importWorkspace({
        sourceKey,
        raw: rawSource,
        id,
        name: requested,
        panes: desired.panes,
        arrangements: desired.arrangements,
      })
      navigateSpace(saved.id)
    } catch (error) {
      setScratchSaveError(error instanceof Error ? error.message : 'Workspace could not save')
    } finally {
      setScratchSavePending(false)
    }
  }

  function exportCorruptDraft() {
    const corrupt = corruptDraft()
    if (!corrupt) return
    const blob = new Blob([corrupt.raw], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `workspace-corrupt-${Date.now()}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  function exportCorruptSpaceRecovery() {
    const corrupt = corruptSpaceRecovery()
    if (!corrupt) return
    const blob = new Blob([corrupt.raw], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `workspace-recovery-corrupt-${Date.now()}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  function discardCorruptSpaceRecovery() {
    const currentWorkspace = workspace()
    if (
      !corruptSpaceRecovery() ||
      !window.confirm(
        'Discard the unreadable local Workspace recovery? Export it first if you may need it.',
      )
    ) {
      return
    }
    clearSpaceWorkspaceRecovery(localStorage, spaceRecoveryStorageKey())
    setCorruptSpaceRecovery(null)
    setSpaceSaveError(null)
    setSpaceSaveStatus('saved')
    if (!currentWorkspace) return
    persistDurableWorkspaceRecovery(currentWorkspace)
    queuedWorkspaceSync = structuredClone(currentWorkspace)
    void flushWorkspaceSpaceSync()
  }

  function updateFileOpenPickHover(clientX: number, clientY: number) {
    const w = workspace()
    const area = snap.getWorkspaceAreaElement()
    if (!w || !area) {
      setFileOpenPickHoverId(null)
      return
    }
    const rect = area.getBoundingClientRect()
    setFileOpenPickHoverId(pickWorkspaceWindowAtClientPoint(w.windows, rect, clientX, clientY))
  }

  function clearBrowserFileOpenTarget(browserId: string) {
    setWorkspace((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        windows: prev.windows.map((win) => {
          if (win.id !== browserId || win.type !== 'browser') return win
          if (win.fileOpenTargetWindowId == null) return win
          const { fileOpenTargetWindowId: _omit, ...rest } = win
          return rest as WorkspaceWindowDefinition
        }),
      }
    })
  }

  function commitFileOpenTargetPick(targetWindowId: string) {
    const pick = fileOpenTargetPick()
    if (!pick) return
    if (targetWindowId === pick.sourceBrowserId) {
      clearBrowserFileOpenTarget(pick.sourceBrowserId)
      cancelFileOpenTargetPick()
      return
    }
    setWorkspace((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        windows: prev.windows.map((win) =>
          win.id === pick.sourceBrowserId && win.type === 'browser'
            ? { ...win, fileOpenTargetWindowId: targetWindowId }
            : win,
        ),
      }
    })
    cancelFileOpenTargetPick()
  }

  createEffect(() => {
    if (!fileOpenTargetPick()) return
    const prevCursor = document.body.style.cursor
    document.body.style.cursor = 'crosshair'
    const onMove = (e: PointerEvent) => {
      updateFileOpenPickHover(e.clientX, e.clientY)
    }
    const onUp = (e: PointerEvent) => {
      const w = workspace()
      const area = snap.getWorkspaceAreaElement()
      if (!w || !area) {
        cancelFileOpenTargetPick()
        return
      }
      const rect = area.getBoundingClientRect()
      const id = pickWorkspaceWindowAtClientPoint(w.windows, rect, e.clientX, e.clientY)
      if (id) commitFileOpenTargetPick(id)
      else cancelFileOpenTargetPick()
    }
    document.addEventListener('pointermove', onMove, { capture: true })
    document.addEventListener('pointerup', onUp, { capture: true })
    onCleanup(() => {
      document.body.style.cursor = prevCursor
      document.removeEventListener('pointermove', onMove, { capture: true })
      document.removeEventListener('pointerup', onUp, { capture: true })
    })
  })

  return (
    <div
      class={`workspace-layout pointer-events-auto ${props.embedded ? 'absolute inset-0' : 'fixed inset-0'} flex flex-col overflow-hidden bg-background select-none`}
      classList={{ 'pb-[var(--playback-audio-chrome-height)]': workspaceAudioChromeVisible() }}
    >
      <Show
        when={
          !shareConfig() &&
          (durableSpace() || corruptDraft() || corruptSpaceRecovery() || scratchSaveError())
        }
      >
        <div class='pointer-events-auto absolute top-3 right-3 z-[100100] flex max-w-sm flex-col items-end gap-2'>
          <Show when={durableSpace()}>
            <div
              class='bg-card/95 rounded-md border border-border px-3 py-2 text-xs shadow-md backdrop-blur'
              data-testid='workspace-space-save-status'
            >
              <span class='font-medium capitalize'>{spaceSaveStatus()}</span>
              <Show when={spaceSaveError()}>
                {(error) => <span class='text-destructive ml-2'>{error()}</span>}
              </Show>
              <Show when={spaceSaveStatus() === 'failed' || spaceSaveStatus() === 'offline'}>
                <button
                  type='button'
                  class='ml-2 underline'
                  onClick={() =>
                    retryStaleWorkspaceRecovery
                      ? void retryStaleWorkspaceRecovery()
                      : void spaceClient?.retry()
                  }
                >
                  Retry
                </button>
              </Show>
              <Show when={recoveredSpaceId()}>
                {(spaceId) => (
                  <a
                    class='ml-2 font-medium underline'
                    href={hrefForSpace(spaceId())}
                    onClick={(event) => followAppLink(event, hrefForSpace(spaceId()))}
                  >
                    Open recovered copy
                  </a>
                )}
              </Show>
            </div>
          </Show>
          <Show when={corruptDraft()}>
            <div class='bg-card/95 rounded-md border border-destructive/50 p-3 text-xs shadow-md backdrop-blur'>
              <p class='font-medium'>This local Workspace draft is unreadable.</p>
              <p class='text-muted-foreground mt-1'>The original data is still stored unchanged.</p>
              <button type='button' class='mt-2 font-medium underline' onClick={exportCorruptDraft}>
                Export original draft
              </button>
            </div>
          </Show>
          <Show when={corruptSpaceRecovery()}>
            <div
              class='rounded-md border border-destructive/50 bg-card/95 p-3 text-xs shadow-md backdrop-blur'
              data-testid='workspace-corrupt-recovery'
            >
              <p class='font-medium'>This local Workspace recovery is unreadable.</p>
              <p class='mt-1 text-muted-foreground'>
                It remains stored unchanged until you decide.
              </p>
              <div class='mt-2 flex gap-3'>
                <button
                  type='button'
                  class='font-medium underline'
                  onClick={exportCorruptSpaceRecovery}
                >
                  Export original
                </button>
                <button
                  type='button'
                  class='font-medium text-destructive underline'
                  onClick={discardCorruptSpaceRecovery}
                >
                  Discard recovery
                </button>
              </div>
            </div>
          </Show>
          <Show when={scratchSaveError()}>
            {(error) => (
              <div class='bg-card/95 rounded-md border border-destructive/50 px-3 py-2 text-xs shadow-md backdrop-blur'>
                {error()}
              </div>
            )}
          </Show>
        </div>
      </Show>
      <Show when={staleWorkspaceRecoveryPending()}>
        <div
          data-testid='workspace-stale-recovery-blocker'
          data-stale-recovery-overlay
          class='pointer-events-auto fixed inset-0 z-[100200] flex items-center justify-center bg-background/75 p-4 backdrop-blur-sm'
        >
          <div
            role='alert'
            class='max-w-md rounded-lg border border-border bg-card p-5 text-sm shadow-xl'
          >
            <p class='font-semibold'>Saving older local Workspace changes</p>
            <p class='mt-2 text-muted-foreground'>
              Editing is paused until those changes are safely stored as a separate recovered Space.
            </p>
            <Show when={spaceSaveStatus() !== 'saving'}>
              <button
                type='button'
                data-testid='workspace-stale-recovery-retry'
                class='mt-4 rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground hover:bg-primary/90'
                onClick={() => void retryStaleWorkspaceRecovery?.()}
              >
                Retry recovered copy
              </button>
            </Show>
          </div>
        </div>
      </Show>
      <div
        class='relative min-h-0 flex-1 overflow-hidden'
        ref={(el) => snap.bindWorkspaceAreaRoot(el)}
      >
        <WorkspacePageCanvas
          hasWorkspaceWindows={hasWorkspaceWindows}
          onOpenBrowser={() => openBrowser()}
          bindSnapPreview={(el) => snap.bindSnapPreview(el)}
          workspaceAreaNode={snap.workspaceAreaNode}
          getWorkspaceAreaElement={snap.getWorkspaceAreaElement}
          snapAssistShown={snap.snapAssistShown}
          engageSnapAssistFromHandle={snap.engageSnapAssistFromHandle}
          disengageSnapAssistFromPanel={snap.disengageSnapAssistFromPanel}
          assistHoverPick={snap.assistHoverPick}
          bindSnapAssistRoot={(el) => snap.bindSnapAssistRoot(el)}
          renderedGroupIds={orderedWindowGroupIds}
          workspace={workspace}
          setWorkspace={setWorkspace}
          mergeTargetPreview={snap.mergeTargetPreview}
          dragSnapWindowId={snap.dragSnapWindowId}
          layoutPicker={layoutPicker}
          closeLayoutPicker={() => setLayoutPicker(null)}
          onTilingPick={handleWorkspaceTilingPick}
          setTilingPickerHoverPreview={snap.setTilingPickerHoverPreview}
          openLayoutPicker={(windowId, anchor) => setLayoutPicker({ windowId, anchor })}
          pageProps={props}
          sharePanel={server.sharePanel}
          editableFolders={server.editableFolders}
          knowledgeBases={() => server.settingsQuery.data?.knowledgeBases ?? []}
          storageKey={() => storageSessionKeyFull().key}
          resourceWindowIsPending={isResourceWindowPending}
          workspaceFileIconContext={workspaceFileIconContext}
          focusWindow={focusWindow}
          closeWindow={closeWindow}
          setWindowMinimized={snap.setWindowMinimized}
          toggleFullscreenWindow={snap.toggleFullscreenWindow}
          restoreDrag={snap.restoreDrag}
          handleDragPointerMove={snap.handleDragPointerMove}
          onDragPointerEnd={snap.onDragPointerEnd}
          updateWindowBounds={snap.updateWindowBounds}
          resizeSnappedWindowBounds={snap.resizeSnappedWindowBounds}
          setActiveTab={setActiveTab}
          closeTab={closeTab}
          toggleTabPinned={toggleTabPinned}
          handleTabPullStart={handleTabPullStart}
          dropFileToTabBar={dropFileToTabBar}
          startSplitPaneDrag={startSplitPaneDrag}
          navigateDir={navigateDir}
          openViewerFromBrowser={openViewerFromBrowser}
          openReaderFromBrowser={openReaderFromBrowser}
          openHermesFromBrowser={openHermesFromBrowser}
          bindHermesSession={bindHermesSession}
          openHermesBranch={openHermesBranch}
          renameHermesWindow={renameHermesWindow}
          addPinnedItem={addPinnedItem}
          openInNewTabInSameWindow={openInNewTabInSameWindow}
          openInSplitViewFromBrowserPane={openInSplitViewFromBrowserPane}
          requestPlay={(source, file, dir, plannedMedia, viewerId) =>
            requestPlay(
              source,
              file.path,
              dir,
              persistedResourceTarget(file.resource),
              plannedMedia,
              viewerId,
              file.resource,
            )
          }
          updateWindowViewing={updateWindowViewing}
          resizeViewerWindowForVideoMetadata={resizeViewerWindowForVideoMetadata}
          listenOnlyHandoff={listenOnlyHandoffFromWorkspaceViewer}
          onBeginFileOpenTargetPick={beginFileOpenTargetPick}
          openFileInNewFloatingWindow={openFileInNewFloatingWindow}
        />
        <Show when={fileOpenTargetPick()}>
          <Show when={fileOpenPickHoverId()} keyed fallback={null}>
            {(hid) => {
              const b = layoutBoundsForWindowHighlight(workspace()?.windows ?? [], hid)
              if (!b) return null
              return (
                <div
                  class='pointer-events-none absolute z-[100001] rounded-sm border-2 border-primary bg-primary/15'
                  style={{
                    left: `${b.x}px`,
                    top: `${b.y}px`,
                    width: `${b.width}px`,
                    height: `${b.height}px`,
                  }}
                />
              )
            }}
          </Show>
        </Show>
      </div>
      <WorkspacePageTaskbar
        pageProps={props}
        onOpenBrowser={() => openBrowser()}
        onOpenSearchResult={openGlobalSearchResult}
        hasAnyTaskbarItems={hasAnyTaskbarItems}
        pinnedItems={pinnedItems}
        taskbarGroupIds={orderedWindowGroupIds}
        taskbarWindowRows={taskbarWindowRows}
        storageSessionKey={() => storageSessionKeyFull().key}
        resourcePinIsPending={isResourcePinPending}
        browserSource={browserSource}
        workspace={workspace}
        setWorkspace={setWorkspace}
        settingsData={() => server.settingsQuery.data}
        layoutScope={server.layoutScope}
        serverLayoutPresets={server.serverLayoutPresets}
        presetsReady={server.presetsReady}
        collectLayoutSnapshot={baseline.collectLayoutSnapshot}
        applyLayoutSnapshot={baseline.applyLayoutSnapshot}
        syncLayoutBaselineToCurrent={baseline.syncLayoutBaselineToCurrent}
        revertLayoutToBaseline={baseline.revertLayoutToBaseline}
        declareBaselinePresetId={baseline.declareBaselinePresetId}
        isLayoutDirty={baseline.isLayoutDirty}
        layoutBaselinePresetId={baseline.layoutBaselinePresetId}
        workspaceFileIconContext={workspaceFileIconContext}
        selectPinned={selectPinned}
        removePinnedItem={removePinnedItem}
        pinMenu={pinMenu}
        setPinMenu={setPinMenu}
        focusWindow={focusWindow}
        stopWorkspacePlaybackFromTaskbar={stopWorkspacePlaybackFromTaskbar}
        requestPlay={requestPlay}
        suppressTaskbarAudioChrome={suppressWorkspaceTaskbarAudioForVideoViewer}
      />
      <Show when={!shareConfig() && !durableSpace()}>
        <button
          type='button'
          class='bg-card hover:bg-muted absolute right-3 bottom-[calc(3rem+0.75rem)] z-[100050] min-h-10 rounded-md border border-border px-3 text-xs font-medium shadow-md disabled:opacity-50'
          disabled={!workspace() || scratchSavePending()}
          data-testid='workspace-save-as-space'
          onClick={() => void saveScratchAsSpace()}
        >
          {scratchSavePending() ? 'Saving…' : 'Save as Space'}
        </button>
      </Show>
    </div>
  )
}
