import { useCallback, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ThemeSwitcher } from '@/components/theme-switcher'
import { AudioPlayer } from '@/components/workspace/audio-player'
import { Layout, type PinnedTaskbarItemView } from '@/components/workspace/layout'
import { WorkspaceWindowTaskbarRows } from '@/components/workspace/workspace-window-taskbar-rows'
import { WorkspaceNamedLayoutMenu } from '@/components/workspace/workspace-named-layout-menu'
import { SnapPreview } from '@/components/workspace/snap-preview'
import { TilingLayoutPicker } from '@/components/workspace/tiling-layout-picker'
import { WindowGroup, type Bounds } from '@/components/workspace/window'
import { Button } from '@/components/ui/button'
import { api, post } from '@/lib/api'
import { getIconComponent } from '@/lib/icon-utils'
import { useFileIcon } from '@/lib/use-file-icon'
import { getMediaType } from '@/lib/media-utils'
import { useMediaPlayer } from '@/lib/use-media-player'
import { useSettings, type GlobalSettings } from '@/lib/use-settings'
import { useSnapZones } from '@/lib/use-snap-zones'
import { MediaType } from '@/lib/types'
import { useSearchParams } from '@/lib/router'
import {
  useWorkspace,
  workspaceSourceToMediaContext,
  snapZoneToBoundsWithOccupied,
  type PinnedTaskbarItem,
  type PersistedWorkspaceState,
  type SnapZone,
  type WorkspaceSource,
} from '@/lib/use-workspace'
import { selectOrderedGroupIds, useWorkspaceSessionStore } from '@/lib/workspace-session-store'
import {
  useWorkspacePlaybackSession,
  useWorkspacePlaybackStore,
} from '@/lib/workspace-playback-store'
import { useWorkspaceSnapLayoutVisibility } from '@/lib/use-workspace-snap-layout-visibility'
import { useWorkspaceSessionUrl } from '@/lib/use-workspace-session-url'
import { queryKeys } from '@/lib/query-keys'
import {
  workspaceLayoutScopeFromShareToken,
  type WorkspaceLayoutPreset,
} from '@/lib/workspace-layout-presets'
import { getWorkspaceFileOpenTarget } from '@/lib/workspace-file-open-target'

interface LayoutPickerState {
  windowId: string
  anchorRect: DOMRect
}

interface WorkspacePageProps {
  shareConfig?: { token: string; sharePath: string } | null
  /** From share `/info` when in share workspace; avoids a second pins fetch. */
  shareWorkspaceTaskbarPins?: PinnedTaskbarItem[]
  /** From share `/info`; server-backed named layouts. */
  shareWorkspaceLayoutPresets?: WorkspaceLayoutPreset[]
}

export function WorkspacePage({
  shareConfig = null,
  shareWorkspaceTaskbarPins,
  shareWorkspaceLayoutPresets,
}: WorkspacePageProps) {
  const queryClient = useQueryClient()
  const workspaceSessionId = useWorkspaceSessionUrl()
  const searchParams = useSearchParams()
  const initialDir = searchParams.get('dir')
  const presetParam = searchParams.get('preset')
  const layoutScope = workspaceLayoutScopeFromShareToken(shareConfig?.token ?? null)

  const { data: globalSettings, isSuccess: adminSettingsReady } = useQuery({
    queryKey: queryKeys.settings(),
    queryFn: () => api<GlobalSettings>('/api/settings'),
    staleTime: Infinity,
    enabled: !shareConfig,
  })

  const serverLayoutPresets = shareConfig
    ? (shareWorkspaceLayoutPresets ?? [])
    : (globalSettings?.workspaceLayoutPresets ?? [])

  const initialLayoutSnapshot = useMemo((): PersistedWorkspaceState | null => {
    if (!presetParam) return null
    const preset = serverLayoutPresets.find((p) => p.id === presetParam && p.scope === layoutScope)
    if (!preset) return null
    return preset.snapshot
  }, [presetParam, layoutScope, serverLayoutPresets])

  const initialLayoutPresetId = useMemo(
    () => (initialLayoutSnapshot && presetParam ? presetParam : null),
    [initialLayoutSnapshot, presetParam],
  )

  const persistPinsMutation = useMutation({
    mutationFn: async (vars: { items: PinnedTaskbarItem[]; shareToken?: string }) => {
      if (vars.shareToken) {
        return post(`/api/share/${vars.shareToken}/workspaceTaskbarPins`, { items: vars.items })
      }
      return post('/api/settings/workspaceTaskbarPins', { items: vars.items })
    },
    onSettled: (_data, _err, vars) => {
      if (vars.shareToken) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.shareInfo(vars.shareToken) })
      } else {
        void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
      }
    },
  })

  const persistTaskbarPinsToServer = useCallback(
    (items: PinnedTaskbarItem[]) => {
      persistPinsMutation.mutate({ items, shareToken: shareConfig?.token })
    },
    [shareConfig?.token, persistPinsMutation],
  )

  const serverTaskbarPins = shareConfig
    ? (shareWorkspaceTaskbarPins ?? [])
    : (globalSettings?.workspaceTaskbarPins ?? [])
  const serverTaskbarPinsReady = shareConfig ? true : adminSettingsReady

  const {
    storageKey,
    windows,
    playbackSource,
    focusWindow,
    closeWindow,
    openBrowserWindow,
    openViewerWindow,
    openPlayerWindow,
    updateWindowBounds,
    updateWindowPresentation,
    setWindowMinimized,
    toggleWindowFullscreen,
    snapWindow,
    unsnapWindow,
    resizeSnappedWindow,
    mergeWindowIntoGroup,
    splitWindowFromGroup,
    addTabToGroup,
    openInNewTab,
    setActiveTab,
    updateWindowNavigationState,
    requestPlay,
    pinnedTaskbarItems,
    addPinnedItem,
    removePinnedItem,
    collectLayoutSnapshot,
    applyLayoutSnapshot,
    revertLayoutToBaseline,
    syncLayoutBaselineToCurrent,
    isLayoutDirty,
    layoutBaselinePresetId,
    declareBaselinePresetId,
  } = useWorkspace({
    initialDir,
    workspaceSessionId,
    initialLayoutSnapshot,
    initialLayoutPresetId,
    shareConfig,
    serverTaskbarPins,
    serverTaskbarPinsReady,
    persistTaskbarPinsToServer,
  })

  const playbackSession = useWorkspacePlaybackSession(storageKey)

  const { visibleIds: visibleSnapLayoutIds } = useWorkspaceSnapLayoutVisibility()

  const orderedGroupIds = useWorkspaceSessionStore(
    useShallow((s) => selectOrderedGroupIds(s.sessions, storageKey)),
  )

  const containerRef = useRef<HTMLDivElement>(null)
  const [layoutPicker, setLayoutPicker] = useState<LayoutPickerState | null>(null)
  const [draggingTabBounds, setDraggingTabBounds] = useState<{
    windowId: string
    bounds: Bounds
  } | null>(null)
  const windowsRef = useRef(windows)
  const storageKeyRef = useRef(storageKey)
  const mergeHighlightRef = useRef<string | null>(null)
  const draggedWindowIdRef = useRef<string | null>(null)
  const mergeThrottleLastRef = useRef(0)
  const MERGE_HIGHLIGHT_THROTTLE_MS = 50

  windowsRef.current = windows
  storageKeyRef.current = storageKey

  const setWindowMinimizedRef = useRef(setWindowMinimized)
  const requestPlayRef = useRef(requestPlay)
  const openViewerWindowRef = useRef(openViewerWindow)
  const openBrowserWindowRef = useRef(openBrowserWindow)
  const setLayoutPickerRef = useRef(setLayoutPicker)
  const closeWindowRef = useRef(closeWindow)
  const addTabToGroupRef = useRef(addTabToGroup)
  const openInNewTabRef = useRef(openInNewTab)
  const setActiveTabRef = useRef(setActiveTab)
  setWindowMinimizedRef.current = setWindowMinimized
  requestPlayRef.current = requestPlay
  openViewerWindowRef.current = openViewerWindow
  openBrowserWindowRef.current = openBrowserWindow
  setLayoutPickerRef.current = setLayoutPicker
  closeWindowRef.current = closeWindow
  addTabToGroupRef.current = addTabToGroup
  openInNewTabRef.current = openInNewTab
  setActiveTabRef.current = setActiveTab

  const handleMinimize = useCallback((windowId: string) => {
    setWindowMinimizedRef.current(windowId, true)
  }, [])
  const handleRequestPlay = useCallback((source: WorkspaceSource, path: string, dir?: string) => {
    requestPlayRef.current({ source, path, dir })
  }, [])
  const handleRequestView = useCallback(
    (source: WorkspaceSource, sourceWindowId: string, path: string, dir: string) => {
      if (getWorkspaceFileOpenTarget() === 'new-tab') {
        openInNewTabRef.current(sourceWindowId, { path, isDirectory: false }, dir, source)
        return
      }
      openViewerWindowRef.current({
        title: path.split(/[/\\]/).filter(Boolean).at(-1) || 'Viewer',
        source,
        initialState: { dir, viewing: path },
      })
    },
    [],
  )
  const handleOpenLayoutPicker = useCallback((windowId: string, anchorRect: DOMRect) => {
    setLayoutPickerRef.current({ windowId, anchorRect })
  }, [])

  const handleCloseWindowGroup = useCallback((windowId: string) => {
    const ws = windowsRef.current
    const w = ws.find((win) => win.id === windowId)
    if (!w) return
    const groupId = w.tabGroupId ?? w.id
    const groupWindows = ws.filter((win) => (win.tabGroupId ?? win.id) === groupId)
    for (const win of groupWindows) {
      if (win.type === 'player') {
        useWorkspacePlaybackStore.getState().closePlayer(storageKeyRef.current)
      }
      closeWindowRef.current(win.id)
    }
  }, [])

  const getZoneBounds = useCallback((zone: SnapZone) => {
    const ws = windowsRef.current
    const excludeId = draggedWindowIdRef.current
    const excludeW = excludeId ? ws.find((w) => w.id === excludeId) : null
    const excludeGroupId = excludeW ? (excludeW.tabGroupId ?? excludeId) : null
    const occupied = ws
      .filter(
        (w) =>
          w.layout?.snapZone &&
          w.layout?.bounds &&
          (excludeGroupId == null || (w.tabGroupId ?? w.id) !== excludeGroupId),
      )
      .map((w) => ({ bounds: w.layout!.bounds!, snapZone: w.layout!.snapZone! }))
    return snapZoneToBoundsWithOccupied(zone, occupied)
  }, [])

  const { onDragMove, onDragEnd } = useSnapZones({ getZoneBounds })

  windowsRef.current = windows

  const draggingGroupId = useMemo(() => {
    if (!draggingTabBounds) return null
    const w = windows.find((x) => x.id === draggingTabBounds.windowId)
    return w ? (w.tabGroupId ?? w.id) : null
  }, [draggingTabBounds, windows])

  type MergeTarget = { groupId: string; insertIndex: number }

  const findMergeTarget = useCallback(
    (clientX: number, clientY: number, draggedWindowId: string): MergeTarget | null => {
      const ws = windowsRef.current
      const draggedW = ws.find((w) => w.id === draggedWindowId)
      const draggedGroupId = draggedW?.tabGroupId ?? draggedWindowId

      const elements = document.elementsFromPoint(clientX, clientY)
      for (const el of elements) {
        const slotEl =
          el.closest?.('[data-tab-drop-slot]') ??
          (el.hasAttribute?.('data-tab-drop-slot') ? el : null)
        if (slotEl && slotEl instanceof HTMLElement) {
          const slot = slotEl.getAttribute('data-tab-drop-slot')
          if (!slot) continue
          const [gid, indexStr] = slot.split(':')
          const insertIndex = parseInt(indexStr, 10)
          if (!gid || gid === draggedGroupId || Number.isNaN(insertIndex)) continue
          return { groupId: gid, insertIndex }
        }
      }
      for (const el of elements) {
        const groupEl = el.closest('[data-window-group]')
        if (!groupEl) continue
        const gid = groupEl.getAttribute('data-window-group')
        if (!gid || gid === draggedGroupId) continue

        const rect = groupEl.getBoundingClientRect()
        if (clientY >= rect.top && clientY <= rect.top + 32) {
          const groupWindows = ws.filter((w) => (w.tabGroupId ?? w.id) === gid)
          return { groupId: gid, insertIndex: groupWindows.length }
        }
        return null
      }
      return null
    },
    [],
  )

  const updateMergeHighlight = useCallback(
    (clientX: number, clientY: number, draggedWindowId: string) => {
      const container = containerRef.current
      if (!container) return

      const target = findMergeTarget(clientX, clientY, draggedWindowId)
      const slotKey = target ? `${target.groupId}:${target.insertIndex}` : null
      if (slotKey === mergeHighlightRef.current) return

      if (mergeHighlightRef.current) {
        const prev = container.querySelector(`[data-tab-drop-slot="${mergeHighlightRef.current}"]`)
        prev?.removeAttribute('data-merge-highlight')
      }

      mergeHighlightRef.current = slotKey

      if (slotKey) {
        const el = container.querySelector(`[data-tab-drop-slot="${slotKey}"]`)
        el?.setAttribute('data-merge-highlight', '')
      }
    },
    [findMergeTarget],
  )

  const clearMergeHighlight = useCallback(() => {
    if (!mergeHighlightRef.current) return
    const container = containerRef.current
    if (container) {
      const prev = container.querySelector(`[data-tab-drop-slot="${mergeHighlightRef.current}"]`)
      prev?.removeAttribute('data-merge-highlight')
    }
    mergeHighlightRef.current = null
  }, [])

  const handleDragMove = useCallback(
    (clientX: number, clientY: number, windowId: string) => {
      draggedWindowIdRef.current = windowId
      const now = Date.now()
      const throttled = now - mergeThrottleLastRef.current < MERGE_HIGHLIGHT_THROTTLE_MS
      if (throttled && containerRef.current) {
        onDragMove(clientX, clientY, containerRef.current, mergeHighlightRef.current !== null)
        return
      }
      mergeThrottleLastRef.current = now
      const mergeTarget = findMergeTarget(clientX, clientY, windowId)
      if (mergeTarget) {
        if (containerRef.current) onDragMove(clientX, clientY, containerRef.current, true)
        updateMergeHighlight(clientX, clientY, windowId)
      } else {
        if (containerRef.current) onDragMove(clientX, clientY, containerRef.current, false)
        clearMergeHighlight()
      }
    },
    [onDragMove, findMergeTarget, updateMergeHighlight, clearMergeHighlight],
  )

  const handleDragStopImpl = useCallback(
    (
      windowId: string,
      finalBounds: { x: number; y: number; width: number; height: number },
      clientX: number,
      clientY: number,
    ) => {
      clearMergeHighlight()

      const hitTarget = findMergeTarget(clientX, clientY, windowId)
      if (hitTarget) {
        const targetWindow = windowsRef.current.find(
          (w) => (w.tabGroupId ?? w.id) === hitTarget.groupId,
        )
        if (targetWindow) {
          onDragEnd(containerRef.current)
          mergeWindowIntoGroup(windowId, targetWindow.id, hitTarget.insertIndex)
          return
        }
      }

      const zone = onDragEnd(containerRef.current)
      if (zone) {
        if (zone === 'top') {
          toggleWindowFullscreen(windowId)
        } else {
          snapWindow(windowId, zone)
        }
        return
      }

      const w = windowsRef.current.find((win) => win.id === windowId)
      if (w?.layout?.snapZone || w?.layout?.fullscreen) {
        unsnapWindow(windowId, { x: finalBounds.x, y: finalBounds.y })
        return
      }
      updateWindowBounds(windowId, finalBounds)
    },
    [
      onDragEnd,
      snapWindow,
      toggleWindowFullscreen,
      unsnapWindow,
      updateWindowBounds,
      findMergeTarget,
      mergeWindowIntoGroup,
      clearMergeHighlight,
    ],
  )
  const handleDragStopRef = useRef(handleDragStopImpl)
  handleDragStopRef.current = handleDragStopImpl
  const handleDragStop = useCallback(
    (
      windowId: string,
      finalBounds: { x: number; y: number; width: number; height: number },
      clientX: number,
      clientY: number,
    ) => handleDragStopRef.current(windowId, finalBounds, clientX, clientY),
    [],
  )

  const handleDetachTabImpl = useCallback(
    (windowId: string, clientX: number, clientY: number) => {
      const w = windowsRef.current.find((win) => win.id === windowId)
      if (!w) return

      const currentBounds = w.layout?.bounds
      const restoreBounds = w.layout?.restoreBounds
      const width = restoreBounds?.width ?? currentBounds?.width ?? 500
      const height = restoreBounds?.height ?? currentBounds?.height ?? 400

      const container = containerRef.current
      if (!container) return
      const containerRect = container.getBoundingClientRect()
      const oX = containerRect.left
      const oY = containerRect.top

      const initialX = clientX - oX - width / 2
      const initialY = Math.max(0, clientY - oY - 16)

      splitWindowFromGroup(windowId, { x: initialX, y: initialY, width, height })
      focusWindow(windowId)

      const dragOffsetX = width / 2
      const dragOffsetY = 16
      let rafId = 0
      let lastX = clientX
      let lastY = clientY

      const onMouseMove = (e: MouseEvent) => {
        lastX = e.clientX
        lastY = e.clientY
        draggedWindowIdRef.current = windowId
        const mergeTarget = findMergeTarget(e.clientX, e.clientY, windowId)
        if (mergeTarget) {
          onDragMove(e.clientX, e.clientY, container, true)
          updateMergeHighlight(e.clientX, e.clientY, windowId)
        } else {
          onDragMove(e.clientX, e.clientY, container, false)
          clearMergeHighlight()
        }

        if (!rafId) {
          rafId = requestAnimationFrame(() => {
            rafId = 0
            setDraggingTabBounds({
              windowId,
              bounds: {
                x: lastX - oX - dragOffsetX,
                y: Math.max(0, lastY - oY - dragOffsetY),
                width,
                height,
              },
            })
          })
        }
      }

      const onMouseUp = (e: MouseEvent) => {
        cleanup()
        clearMergeHighlight()
        setDraggingTabBounds(null)
        if (rafId) cancelAnimationFrame(rafId)

        const hitTarget = findMergeTarget(e.clientX, e.clientY, windowId)
        if (hitTarget) {
          const targetWindow = windowsRef.current.find(
            (w) => (w.tabGroupId ?? w.id) === hitTarget.groupId,
          )
          if (targetWindow) {
            onDragEnd(container)
            mergeWindowIntoGroup(windowId, targetWindow.id, hitTarget.insertIndex)
            return
          }
        }

        const snapZone = onDragEnd(container)
        if (snapZone) {
          if (snapZone === 'top') {
            toggleWindowFullscreen(windowId)
          } else {
            snapWindow(windowId, snapZone)
          }
          return
        }

        updateWindowBounds(windowId, {
          x: e.clientX - oX - dragOffsetX,
          y: Math.max(0, e.clientY - oY - dragOffsetY),
          width,
          height,
        })
      }

      const cleanup = () => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }

      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [
      splitWindowFromGroup,
      focusWindow,
      updateWindowBounds,
      onDragMove,
      onDragEnd,
      snapWindow,
      toggleWindowFullscreen,
      mergeWindowIntoGroup,
      findMergeTarget,
      updateMergeHighlight,
      clearMergeHighlight,
    ],
  )
  const handleDetachTabRef = useRef(handleDetachTabImpl)
  handleDetachTabRef.current = handleDetachTabImpl
  const handleDetachTab = useCallback(
    (windowId: string, clientX: number, clientY: number) =>
      handleDetachTabRef.current(windowId, clientX, clientY),
    [],
  )

  const handleRestoreDrag = useCallback(
    (windowId: string, clientX: number, _clientY: number) => {
      const w = windowsRef.current.find((win) => win.id === windowId)
      if (!w) return

      const currentBounds = w.layout?.bounds
      const restoreBounds = w.layout?.restoreBounds
      const restoredW = restoreBounds?.width ?? currentBounds?.width ?? 500

      const container = containerRef.current
      if (!container) return
      const oX = container.getBoundingClientRect().left

      const currentWidth = currentBounds?.width ?? restoredW
      const grabRatio = currentBounds
        ? Math.min(Math.max((clientX - oX - currentBounds.x) / currentWidth, 0), 1)
        : 0.5

      const newX = clientX - oX - restoredW * grabRatio
      const newY = currentBounds?.y ?? 0

      unsnapWindow(windowId, { x: newX, y: newY })
    },
    [unsnapWindow],
  )

  const handleLayoutSelect = useCallback(
    (zone: SnapZone) => {
      if (layoutPicker) {
        snapWindow(layoutPicker.windowId, zone)
        setLayoutPicker(null)
      }
    },
    [layoutPicker, snapWindow],
  )

  const handleLayoutFullscreen = useCallback(() => {
    if (layoutPicker) {
      toggleWindowFullscreen(layoutPicker.windowId)
      setLayoutPicker(null)
    }
  }, [layoutPicker, toggleWindowFullscreen])

  const handleNavigationStateChange = useCallback(
    (windowId: string, dir: string | null, viewing: string | null) => {
      updateWindowNavigationState(windowId, { dir, viewing })
    },
    [updateWindowNavigationState],
  )

  const handleCloseTabImpl = useCallback((windowId: string) => {
    const ws = windowsRef.current
    const w = ws.find((win) => win.id === windowId)
    if (w?.type === 'player') {
      useWorkspacePlaybackStore.getState().closePlayer(storageKeyRef.current)
    }
    closeWindowRef.current(windowId)
  }, [])
  const handleCloseTabRef = useRef(handleCloseTabImpl)
  handleCloseTabRef.current = handleCloseTabImpl
  const handleCloseTab = useCallback((windowId: string) => handleCloseTabRef.current(windowId), [])

  const handleDropFileToTabBarImpl = useCallback(
    (
      targetWindowId: string,
      data: {
        path: string
        isDirectory: boolean
        source: import('@/lib/use-workspace').WorkspaceSource
      },
      insertIndex?: number,
    ) => {
      const dir = data.isDirectory ? '' : data.path.split(/[/\\]/).slice(0, -1).join('/')
      openInNewTabRef.current(
        targetWindowId,
        { path: data.path, isDirectory: data.isDirectory },
        dir,
        data.source,
        insertIndex,
      )
    },
    [],
  )
  const handleDropFileToTabBarRef = useRef(handleDropFileToTabBarImpl)
  handleDropFileToTabBarRef.current = handleDropFileToTabBarImpl
  const handleDropFileToTabBar = useCallback(
    (
      targetWindowId: string,
      data: {
        path: string
        isDirectory: boolean
        source: import('@/lib/use-workspace').WorkspaceSource
      },
      insertIndex?: number,
    ) => handleDropFileToTabBarRef.current(targetWindowId, data, insertIndex),
    [],
  )

  const handleAddTab = useCallback((sourceWindowId: string) => {
    addTabToGroupRef.current(sourceWindowId)
  }, [])

  const handleOpenInNewTabInSameWindow = useCallback(
    (
      sourceWindowId: string,
      file: { path: string; isDirectory: boolean; isVirtual?: boolean },
      currentPath: string,
      sourceOverride?: import('@/lib/use-workspace').WorkspaceSource,
      insertIndex?: number,
    ) => openInNewTabRef.current(sourceWindowId, file, currentPath, sourceOverride, insertIndex),
    [],
  )

  const handleOpenInStandaloneWindow = useCallback(
    (
      sourceWindowId: string,
      file: { path: string; isDirectory: boolean; isVirtual?: boolean },
      currentPath: string,
      sourceOverride?: WorkspaceSource,
    ) => {
      const sourceWindow = windowsRef.current.find((w) => w.id === sourceWindowId)
      if (!sourceWindow || file.isVirtual) return
      const source = sourceOverride ?? sourceWindow.source
      if (file.isDirectory) {
        openBrowserWindowRef.current({ source, initialState: { dir: file.path } })
      } else {
        const dir = file.path.split(/[/\\]/).slice(0, -1).join('/') || currentPath
        const title = file.path.split(/[/\\]/).filter(Boolean).at(-1) || 'Viewer'
        openViewerWindowRef.current({ title, source, initialState: { dir, viewing: file.path } })
      }
    },
    [],
  )

  const { data: authConfig } = useQuery({
    queryKey: ['auth-config'],
    queryFn: () =>
      api<{ enabled: boolean; shareLinkDomain?: string; editableFolders: string[] }>(
        '/api/auth/config',
      ),
    enabled: !shareConfig,
  })

  const editableFolders = useMemo(
    () => (shareConfig ? [shareConfig.sharePath] : (authConfig?.editableFolders ?? [])),
    [shareConfig, authConfig?.editableFolders],
  )
  const playbackContext = useMemo(
    () => workspaceSourceToMediaContext(playbackSource),
    [playbackSource],
  )
  const { settings } = useSettings('', !shareConfig)
  const defaultSource = useMemo(
    () =>
      shareConfig
        ? { kind: 'share' as const, token: shareConfig.token, sharePath: shareConfig.sharePath }
        : { kind: 'local' as const, rootPath: null },
    [shareConfig],
  )
  const handleAddToTaskbar = useCallback(
    (file: { path: string; isDirectory: boolean; name: string }) => {
      addPinnedItem({
        path: file.path,
        isDirectory: file.isDirectory,
        title: file.name,
        customIconName: settings.customIcons[file.path] ?? null,
        source: defaultSource,
      })
    },
    [addPinnedItem, defaultSource, settings.customIcons],
  )
  const currentMediaFile = useMediaPlayer((state) => state.currentFile)
  const currentMediaType = useMediaPlayer((state) => state.mediaType)
  const mediaPlayerIsPlaying = useMediaPlayer((state) => state.isPlaying)
  const playingPathForIcons = useWorkspacePlaybackStore((s) => s.byKey[storageKey]?.playing ?? null)
  const { getIcon } = useFileIcon({
    customIcons: settings.customIcons,
    playingPath: playingPathForIcons,
    currentFile: currentMediaFile,
    mediaPlayerIsPlaying,
    mediaType: currentMediaType,
  })
  const pinnedTaskbarItemViews = useMemo((): PinnedTaskbarItemView[] => {
    return pinnedTaskbarItems.map((pin) => {
      const customName = pin.customIconName ?? settings.customIcons[pin.path]
      const mediaType = pin.isDirectory
        ? MediaType.FOLDER
        : getMediaType(pin.path.split('.').pop() ?? '')
      const iconNode = customName
        ? (() => {
            const C = getIconComponent(customName)
            return C ? (
              <C className='h-5 w-5 text-muted-foreground' />
            ) : (
              getIcon(
                mediaType,
                pin.path,
                mediaType === MediaType.AUDIO,
                mediaType === MediaType.VIDEO,
                false,
              )
            )
          })()
        : getIcon(
            mediaType,
            pin.path,
            mediaType === MediaType.AUDIO,
            mediaType === MediaType.VIDEO,
            false,
          )
      const tooltip = `${pin.isDirectory ? 'Folder' : 'File'}: ${pin.path}`
      const dragData = {
        path: pin.path,
        isDirectory: pin.isDirectory,
        sourceKind: pin.source.kind,
        sourceToken: pin.source.token,
      }
      return {
        id: pin.id,
        label: pin.title,
        icon: iconNode,
        tooltip,
        dragData,
        onSelect: () => {
          if (pin.isDirectory) {
            openBrowserWindow({ source: pin.source, initialState: { dir: pin.path } })
          } else if (mediaType === MediaType.VIDEO || mediaType === MediaType.AUDIO) {
            const parentDir = pin.path.split(/[/\\]/).slice(0, -1).join('/')
            requestPlay({ source: pin.source, path: pin.path, dir: parentDir })
          } else {
            const parentDir = pin.path.split(/[/\\]/).slice(0, -1).join('/')
            openViewerWindow({
              source: pin.source,
              title: pin.title,
              initialState: { dir: parentDir, viewing: pin.path },
            })
          }
        },
        onUnpin: () => removePinnedItem(pin.id),
      }
    })
  }, [
    pinnedTaskbarItems,
    settings.customIcons,
    getIcon,
    openBrowserWindow,
    openViewerWindow,
    requestPlay,
    removePinnedItem,
  ])

  return (
    <Layout
      hasWorkspaceWindows={orderedGroupIds.length > 0}
      windowTaskbar={(handledByMouseDownRef) => (
        <WorkspaceWindowTaskbarRows
          storageKey={storageKey}
          handledByMouseDownRef={handledByMouseDownRef}
          getIcon={getIcon}
          focusWindow={focusWindow}
          setWindowMinimized={setWindowMinimized}
          closeWindow={closeWindow}
        />
      )}
      pinnedItems={pinnedTaskbarItemViews}
      onNewBrowser={() => openBrowserWindow()}
      taskbarRightSlot={
        <>
          {isLayoutDirty ? (
            <span
              className='mr-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:text-amber-400'
              title={
                layoutBaselinePresetId
                  ? 'Layout changed since this saved preset was applied'
                  : 'Layout changed since the last baseline'
              }
            >
              Modified
            </span>
          ) : null}
          <AudioPlayer
            session={playbackSession}
            mediaContext={playbackContext}
            onShowVideo={() => {
              useWorkspacePlaybackStore.getState().setAudioOnly(storageKey, false)
              openPlayerWindow()
            }}
          />
          <WorkspaceNamedLayoutMenu
            scope={layoutScope}
            shareToken={shareConfig?.token ?? null}
            presets={serverLayoutPresets}
            presetsReady={shareConfig ? true : adminSettingsReady}
            collectLayoutSnapshot={collectLayoutSnapshot}
            applyLayoutSnapshot={applyLayoutSnapshot}
            syncLayoutBaselineToCurrent={syncLayoutBaselineToCurrent}
            revertLayoutToBaseline={revertLayoutToBaseline}
            declareBaselinePresetId={declareBaselinePresetId}
            isLayoutDirty={isLayoutDirty}
            layoutBaselinePresetId={layoutBaselinePresetId}
          />
          <ThemeSwitcher variant='taskbar' />
        </>
      }
      emptyState={
        <div className='flex h-full items-center justify-center p-6'>
          <div className='w-full max-w-md rounded-xl border border-border bg-card/95 p-8 text-center shadow-2xl backdrop-blur'>
            <div className='space-y-3'>
              <div className='text-lg font-medium'>No windows are open</div>
              <div className='text-sm text-muted-foreground'>
                Start a browser window to build your workspace.
              </div>
              <Button onClick={() => openBrowserWindow()}>Open Browser</Button>
            </div>
          </div>
        </div>
      }
    >
      <div
        ref={containerRef}
        className='relative h-full w-full overflow-hidden bg-[radial-gradient(circle_at_top,var(--color-foreground)/0.03,transparent_28%),linear-gradient(to_bottom,var(--color-foreground)/0.02,transparent)]'
      >
        <SnapPreview />
        {orderedGroupIds.map((groupId) => (
          <WindowGroup
            key={groupId}
            storageKey={storageKey}
            groupId={groupId}
            editableFolders={editableFolders}
            onFocus={focusWindow}
            onMinimize={handleMinimize}
            onToggleMaximize={toggleWindowFullscreen}
            onClose={handleCloseWindowGroup}
            onUpdateBounds={updateWindowBounds}
            onResizeSnapped={resizeSnappedWindow}
            onDragMove={handleDragMove}
            onDragStop={handleDragStop}
            onPresentationChange={updateWindowPresentation}
            onNavigationStateChange={handleNavigationStateChange}
            onRequestPlay={handleRequestPlay}
            onRequestView={handleRequestView}
            onOpenLayoutPicker={handleOpenLayoutPicker}
            onSelectTab={setActiveTab}
            onCloseTab={handleCloseTab}
            onAddTab={handleAddTab}
            onOpenInNewTabInSameWindow={handleOpenInNewTabInSameWindow}
            onOpenInStandaloneWindow={handleOpenInStandaloneWindow}
            onDetachTab={handleDetachTab}
            onRestoreDrag={handleRestoreDrag}
            onDropFileToTabBar={handleDropFileToTabBar}
            onAddToTaskbar={handleAddToTaskbar}
            overrideBounds={draggingGroupId === groupId ? draggingTabBounds?.bounds : undefined}
          />
        ))}
        {layoutPicker && (
          <TilingLayoutPicker
            anchorRect={layoutPicker.anchorRect}
            containerRef={containerRef}
            visibleSnapLayoutIds={visibleSnapLayoutIds}
            onSelectZone={handleLayoutSelect}
            onSelectFullscreen={handleLayoutFullscreen}
            onClose={() => setLayoutPicker(null)}
          />
        )}
      </div>
    </Layout>
  )
}
