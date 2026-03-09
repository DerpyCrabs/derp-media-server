import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AudioPlayer } from '@/components/workspace/audio-player'
import { Layout } from '@/components/workspace/layout'
import { SnapPreview } from '@/components/workspace/snap-preview'
import { TilingLayoutPicker } from '@/components/workspace/tiling-layout-picker'
import { WindowGroup } from '@/components/workspace/window'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { useFileIcon } from '@/lib/use-file-icon'
import { getMediaType } from '@/lib/media-utils'
import { useMediaPlayer } from '@/lib/use-media-player'
import { useSettings } from '@/lib/use-settings'
import { useSnapZones } from '@/lib/use-snap-zones'
import { MediaType } from '@/lib/types'
import type { SnapZone, WorkspaceWindowDefinition } from '@/lib/use-workspace'
import {
  useWorkspace,
  workspaceSourceToMediaContext,
  snapZoneToBoundsWithOccupied,
} from '@/lib/use-workspace'

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
  } = useWorkspace({
    initialDir:
      typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('dir') : null,
    shareConfig,
  })

  const containerRef = useRef<HTMLDivElement>(null)
  const [layoutPicker, setLayoutPicker] = useState<LayoutPickerState | null>(null)
  const windowsRef = useRef(windows)
  const mergeHighlightRef = useRef<string | null>(null)
  const draggedWindowIdRef = useRef<string | null>(null)

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

  useEffect(() => {
    windowsRef.current = windows
  }, [windows])

  const windowGroups = useMemo(() => groupWindowsByTab(windows), [windows])

  const findMergeTarget = useCallback(
    (clientX: number, clientY: number, draggedWindowId: string): string | null => {
      const ws = windowsRef.current
      const draggedW = ws.find((w) => w.id === draggedWindowId)
      const draggedGroupId = draggedW?.tabGroupId ?? draggedWindowId

      const elements = document.elementsFromPoint(clientX, clientY)
      for (const el of elements) {
        const groupEl = el.closest('[data-window-group]')
        if (!groupEl) continue
        const gid = groupEl.getAttribute('data-window-group')
        if (!gid || gid === draggedGroupId) continue

        const rect = groupEl.getBoundingClientRect()
        if (clientY >= rect.top && clientY <= rect.top + 32) {
          const targetW = ws.find((w) => (w.tabGroupId ?? w.id) === gid)
          return targetW?.id ?? null
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

      const targetId = findMergeTarget(clientX, clientY, draggedWindowId)
      const targetW = targetId ? windowsRef.current.find((w) => w.id === targetId) : null
      const gid = targetW ? (targetW.tabGroupId ?? targetId) : null
      if (gid === mergeHighlightRef.current) return

      if (mergeHighlightRef.current) {
        const prev = container.querySelector(`[data-window-group="${mergeHighlightRef.current}"]`)
        prev?.removeAttribute('data-merge-highlight')
      }

      mergeHighlightRef.current = gid

      if (gid) {
        const el = container.querySelector(`[data-window-group="${gid}"]`)
        el?.setAttribute('data-merge-highlight', '')
      }
    },
    [findMergeTarget],
  )

  const clearMergeHighlight = useCallback(() => {
    if (!mergeHighlightRef.current) return
    const container = containerRef.current
    if (container) {
      const prev = container.querySelector(`[data-window-group="${mergeHighlightRef.current}"]`)
      prev?.removeAttribute('data-merge-highlight')
    }
    mergeHighlightRef.current = null
  }, [])

  const handleDragMove = useCallback(
    (clientX: number, clientY: number, windowId: string) => {
      draggedWindowIdRef.current = windowId
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

  const handleDragStop = useCallback(
    (
      windowId: string,
      finalBounds: { x: number; y: number; width: number; height: number },
      clientX: number,
      clientY: number,
    ) => {
      clearMergeHighlight()

      const hitTargetId = findMergeTarget(clientX, clientY, windowId)
      if (hitTargetId) {
        onDragEnd(containerRef.current)
        mergeWindowIntoGroup(windowId, hitTargetId)
        return
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

  const handleDetachTab = useCallback(
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
            updateWindowBounds(windowId, {
              x: lastX - oX - dragOffsetX,
              y: Math.max(0, lastY - oY - dragOffsetY),
              width,
              height,
            })
          })
        }
      }

      const onMouseUp = (e: MouseEvent) => {
        cleanup()
        clearMergeHighlight()
        if (rafId) cancelAnimationFrame(rafId)

        const hitId = findMergeTarget(e.clientX, e.clientY, windowId)
        if (hitId) {
          onDragEnd(container)
          mergeWindowIntoGroup(windowId, hitId)
          return
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

  const handleCloseTab = useCallback(
    (windowId: string) => {
      const w = windows.find((win) => win.id === windowId)
      if (w?.type === 'player') {
        playbackSession.closePlayer()
      }

      if (w?.tabGroupId) {
        const groupId = w.tabGroupId
        const isActive = activeTabMap[groupId] === windowId
        if (isActive) {
          const groupTabs = windows.filter((win) => win.tabGroupId === groupId)
          const idx = groupTabs.findIndex((t) => t.id === windowId)
          const next = groupTabs[idx - 1] ?? groupTabs[idx + 1]
          if (next) {
            setActiveTab(groupId, next.id)
          }
        }
      }

      closeWindow(windowId)
    },
    [windows, closeWindow, playbackSession, activeTabMap, setActiveTab],
  )

  const handleDropFileToTabBar = useCallback(
    (
      targetWindowId: string,
      data: {
        path: string
        isDirectory: boolean
        source: import('@/lib/use-workspace').WorkspaceSource
      },
    ) => {
      const dir = data.isDirectory ? '' : data.path.split(/[/\\]/).slice(0, -1).join('/')
      openInNewTab(
        targetWindowId,
        { path: data.path, isDirectory: data.isDirectory },
        dir,
        data.source,
      )
    },
    [openInNewTab],
  )

  const { data: authConfig } = useQuery({
    queryKey: ['auth-config'],
    queryFn: () =>
      api<{ enabled: boolean; shareLinkDomain?: string; editableFolders: string[] }>(
        '/api/auth/config',
      ),
    enabled: !shareConfig,
  })

  const editableFolders = shareConfig
    ? [shareConfig.sharePath]
    : (authConfig?.editableFolders ?? [])
  const playbackContext = workspaceSourceToMediaContext(playbackSource)
  const { settings } = useSettings('', !shareConfig)
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
      windows
        .filter((w) => {
          if (!w.tabGroupId) return true
          const group = windows.filter((win) => win.tabGroupId === w.tabGroupId)
          return group[0]?.id === w.id
        })
        .map((window) => {
          const groupWindows = window.tabGroupId
            ? windows.filter((w) => w.tabGroupId === window.tabGroupId)
            : [window]
          const groupId = window.tabGroupId ?? window.id
          const activeTabId = activeTabMap[groupId] ?? window.id
          const displayWindow = groupWindows.find((w) => w.id === activeTabId) ?? window
          const tabCount = groupWindows.length
          return {
            id: window.id,
            label: tabCount > 1 ? `${displayWindow.title} (+${tabCount - 1})` : displayWindow.title,
            active: groupWindows.some((w) => w.id === activeWindowId),
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
            onSelect: () => focusWindow(window.id),
            onClose: () => {
              for (const w of groupWindows) {
                if (w.type === 'player') playbackSession.closePlayer()
                closeWindow(w.id)
              }
            },
          }
        }),
    [windows, activeWindowId, activeTabMap, focusWindow, getIcon, playbackSession, closeWindow],
  )

  return (
    <Layout
      items={taskbarItems}
      onNewBrowser={() => openBrowserWindow()}
      taskbarRightSlot={
        <AudioPlayer
          session={playbackSession}
          mediaContext={playbackContext}
          onShowVideo={() => {
            playbackSession.setAudioOnly(false)
            openPlayerWindow()
          }}
        />
      }
      emptyState={
        <div className='flex h-full items-center justify-center p-6'>
          <div className='w-full max-w-md rounded-xl border border-white/10 bg-black/55 p-8 text-center shadow-2xl backdrop-blur'>
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
        className='relative h-full w-full overflow-hidden bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.035),transparent_28%),linear-gradient(to_bottom,rgba(255,255,255,0.02),transparent)]'
      >
        <SnapPreview />
        {windowGroups.map((group) => (
          <WindowGroup
            key={group.groupId}
            tabs={group.windows}
            activeTabId={activeTabMap[group.groupId] ?? null}
            editableFolders={editableFolders}
            playbackSession={playbackSession}
            activeWindowId={activeWindowId}
            onFocus={focusWindow}
            onMinimize={(windowId) => setWindowMinimized(windowId, true)}
            onToggleMaximize={toggleWindowFullscreen}
            onClose={(windowId) => {
              const w = windows.find((win) => win.id === windowId)
              if (!w) return
              const groupId = w.tabGroupId ?? w.id
              const groupWindows = windows.filter((win) => (win.tabGroupId ?? win.id) === groupId)
              for (const win of groupWindows) {
                if (win.type === 'player') playbackSession.closePlayer()
                closeWindow(win.id)
              }
            }}
            onUpdateBounds={updateWindowBounds}
            onResizeSnapped={resizeSnappedWindow}
            onDragMove={handleDragMove}
            onDragStop={handleDragStop}
            onPresentationChange={updateWindowPresentation}
            onNavigationStateChange={handleNavigationStateChange}
            onRequestPlay={(source, path, dir) => requestPlay({ source, path, dir })}
            onRequestView={(source, path, dir) =>
              openViewerWindow({
                title: path.split(/[/\\]/).filter(Boolean).at(-1) || 'Viewer',
                source,
                initialState: { dir, viewing: path },
              })
            }
            onOpenLayoutPicker={(windowId, anchorRect) => setLayoutPicker({ windowId, anchorRect })}
            onSelectTab={setActiveTab}
            onCloseTab={handleCloseTab}
            onAddTab={addTabToGroup}
            onOpenInNewTabInSameWindow={openInNewTab}
            onDetachTab={handleDetachTab}
            onRestoreDrag={handleRestoreDrag}
            onDropFileToTabBar={handleDropFileToTabBar}
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
