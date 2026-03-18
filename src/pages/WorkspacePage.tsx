import { useCallback, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ThemeSwitcher } from '@/components/theme-switcher'
import { AudioPlayer } from '@/components/workspace/audio-player'
import { Layout, type PinnedTaskbarItemView } from '@/components/workspace/layout'
import { SnapPreview } from '@/components/workspace/snap-preview'
import { TilingLayoutPicker } from '@/components/workspace/tiling-layout-picker'
import { WindowGroup, type Bounds } from '@/components/workspace/window'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { getIconComponent } from '@/lib/icon-utils'
import { useFileIcon } from '@/lib/use-file-icon'
import { getMediaType } from '@/lib/media-utils'
import { useMediaPlayer } from '@/lib/use-media-player'
import { useSettings } from '@/lib/use-settings'
import { useSnapZones } from '@/lib/use-snap-zones'
import { MediaType } from '@/lib/types'
import type { SnapZone, WorkspaceSource, WorkspaceWindowDefinition } from '@/lib/use-workspace'
import {
  useWorkspace,
  workspaceSourceToMediaContext,
  snapZoneToBoundsWithOccupied,
} from '@/lib/use-workspace'
import { useWorkspaceFocusStore } from '@/lib/workspace-focus-store'

interface LayoutPickerState {
  windowId: string
  anchorRect: DOMRect
}

interface WindowTabGroup {
  groupId: string
  windows: WorkspaceWindowDefinition[]
}

function groupWindowsByTab(windows: WorkspaceWindowDefinition[]): WindowTabGroup[] {
  const groups = new Map<string, WorkspaceWindowDefinition[]>()
  const order: string[] = []

  for (const w of windows) {
    const gid = w.tabGroupId ?? w.id
    const existing = groups.get(gid)
    if (existing) {
      existing.push(w)
    } else {
      groups.set(gid, [w])
      order.push(gid)
    }
  }

  return order.map((gid) => ({ groupId: gid, windows: groups.get(gid)! }))
}

interface WorkspacePageProps {
  shareConfig?: { token: string; sharePath: string } | null
}

export function WorkspacePage({ shareConfig = null }: WorkspacePageProps) {
  const {
    storageKey,
    windows,
    activeWindowId,
    playbackSource,
    playbackSession,
    activeTabMap,
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
  } = useWorkspace({
    initialDir:
      typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('dir') : null,
    shareConfig,
  })

  const containerRef = useRef<HTMLDivElement>(null)
  const [layoutPicker, setLayoutPicker] = useState<LayoutPickerState | null>(null)
  const [draggingTabBounds, setDraggingTabBounds] = useState<{
    windowId: string
    bounds: Bounds
  } | null>(null)
  const windowsRef = useRef(windows)
  const playbackSessionRef = useRef(playbackSession)
  const mergeHighlightRef = useRef<string | null>(null)
  const draggedWindowIdRef = useRef<string | null>(null)
  const mergeThrottleLastRef = useRef(0)
  const MERGE_HIGHLIGHT_THROTTLE_MS = 50

  windowsRef.current = windows
  playbackSessionRef.current = playbackSession

  const setWindowMinimizedRef = useRef(setWindowMinimized)
  const requestPlayRef = useRef(requestPlay)
  const openViewerWindowRef = useRef(openViewerWindow)
  const setLayoutPickerRef = useRef(setLayoutPicker)
  const closeWindowRef = useRef(closeWindow)
  const addTabToGroupRef = useRef(addTabToGroup)
  const openInNewTabRef = useRef(openInNewTab)
  const setActiveTabRef = useRef(setActiveTab)
  setWindowMinimizedRef.current = setWindowMinimized
  requestPlayRef.current = requestPlay
  openViewerWindowRef.current = openViewerWindow
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
  const handleRequestView = useCallback((source: WorkspaceSource, path: string, dir: string) => {
    openViewerWindowRef.current({
      title: path.split(/[/\\]/).filter(Boolean).at(-1) || 'Viewer',
      source,
      initialState: { dir, viewing: path },
    })
  }, [])
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
      if (win.type === 'player') playbackSessionRef.current.closePlayer()
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

  const windowGroups = useMemo(() => groupWindowsByTab(windows), [windows])

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

  const handleCloseTabImpl = useCallback(
    (windowId: string) => {
      const ws = windowsRef.current
      const w = ws.find((win) => win.id === windowId)
      if (w?.type === 'player') {
        playbackSessionRef.current.closePlayer()
      }

      if (w?.tabGroupId) {
        const groupId = w.tabGroupId
        const focusState = useWorkspaceFocusStore.getState().getFocusState(storageKey)
        const isActive = focusState.activeTabMap[groupId] === windowId
        if (isActive) {
          const groupTabs = ws.filter((win) => win.tabGroupId === groupId)
          const idx = groupTabs.findIndex((t) => t.id === windowId)
          const next = groupTabs[idx - 1] ?? groupTabs[idx + 1]
          if (next) {
            setActiveTabRef.current(groupId, next.id)
          }
        }
      }

      closeWindowRef.current(windowId)
    },
    [storageKey],
  )
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
  const { getIcon } = useFileIcon({
    customIcons: settings.customIcons,
    playingPath: playbackSession.state.playing,
    currentFile: currentMediaFile,
    mediaPlayerIsPlaying,
    mediaType: currentMediaType,
  })
  const taskbarItems = useMemo(
    () =>
      windowGroups.map((group) => {
        const groupWindows = group.windows
        const groupId = group.groupId
        const leader = groupWindows[0]
        const activeTabId = activeTabMap[groupId] ?? leader?.id
        const displayWindow =
          groupWindows.find((w) => w.id === activeTabId) ?? leader ?? groupWindows[0]
        const tabCount = groupWindows.length
        const path =
          displayWindow.iconPath ??
          (displayWindow.type === 'browser'
            ? (displayWindow.initialState.dir ?? '')
            : displayWindow.type === 'player'
              ? (playbackSession.state.playing ?? '')
              : (displayWindow.initialState.viewing ?? ''))
        const isDir = displayWindow.type === 'browser'
        const tooltip = path ? `${isDir ? 'Folder' : 'File'}: ${path}` : displayWindow.title
        const dragData =
          path && displayWindow.source
            ? {
                path,
                isDirectory: isDir,
                sourceKind: displayWindow.source.kind,
                sourceToken: displayWindow.source.token,
              }
            : undefined
        return {
          id: groupId,
          label: tabCount > 1 ? `${displayWindow.title} (+${tabCount - 1})` : displayWindow.title,
          active: groupWindows.some((w) => w.id === activeWindowId),
          tooltip,
          dragData,
          icon: getIcon(
            displayWindow.iconType ??
              (displayWindow.type === 'browser'
                ? MediaType.FOLDER
                : displayWindow.type === 'player'
                  ? MediaType.VIDEO
                  : displayWindow.initialState.viewing
                    ? getMediaType(displayWindow.initialState.viewing.split('.').pop() ?? '')
                    : MediaType.OTHER),
            displayWindow.iconPath ??
              (displayWindow.type === 'browser'
                ? (displayWindow.initialState.dir ?? '')
                : displayWindow.type === 'player'
                  ? (playbackSession.state.playing ?? '')
                  : (displayWindow.initialState.viewing ?? '')),
            (displayWindow.iconType ?? MediaType.OTHER) === MediaType.AUDIO,
            (displayWindow.iconType ??
              (displayWindow.type === 'player' ? MediaType.VIDEO : MediaType.OTHER)) ===
              MediaType.VIDEO,
            displayWindow.iconIsVirtual ?? false,
          ),
          onSelect: () => {
            const leaderId = leader?.id ?? groupWindows[0]?.id
            const isMinimized = leader?.layout?.minimized ?? false
            const isActive = groupWindows.some((w) => w.id === activeWindowId)
            if (isMinimized) {
              focusWindow(leaderId)
            } else if (isActive) {
              setWindowMinimized(leaderId, true)
            } else {
              focusWindow(leaderId)
            }
          },
          onClose: () => {
            for (const w of groupWindows) {
              if (w.type === 'player') playbackSession.closePlayer()
              closeWindow(w.id)
            }
          },
        }
      }),
    [
      windowGroups,
      activeWindowId,
      activeTabMap,
      focusWindow,
      setWindowMinimized,
      getIcon,
      playbackSession,
      closeWindow,
    ],
  )

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
      items={taskbarItems}
      pinnedItems={pinnedTaskbarItemViews}
      onNewBrowser={() => openBrowserWindow()}
      taskbarRightSlot={
        <>
          <AudioPlayer
            session={playbackSession}
            mediaContext={playbackContext}
            onShowVideo={() => {
              playbackSession.setAudioOnly(false)
              openPlayerWindow()
            }}
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
        {windowGroups.map((group) => (
          <WindowGroup
            key={group.groupId}
            storageKey={storageKey}
            tabs={group.windows}
            editableFolders={editableFolders}
            playbackSession={playbackSession}
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
            onDetachTab={handleDetachTab}
            onRestoreDrag={handleRestoreDrag}
            onDropFileToTabBar={handleDropFileToTabBar}
            onAddToTaskbar={handleAddToTaskbar}
            overrideBounds={
              draggingTabBounds && group.windows.some((w) => w.id === draggingTabBounds.windowId)
                ? draggingTabBounds.bounds
                : undefined
            }
          />
        ))}
        {layoutPicker && (
          <TilingLayoutPicker
            anchorRect={layoutPicker.anchorRect}
            containerRef={containerRef}
            onSelectZone={handleLayoutSelect}
            onSelectFullscreen={handleLayoutFullscreen}
            onClose={() => setLayoutPicker(null)}
          />
        )}
      </div>
    </Layout>
  )
}
