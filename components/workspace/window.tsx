import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Rnd } from 'react-rnd'
import { Maximize2, Minimize2, Minus, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FileBrowser } from '@/components/workspace/file-browser'
import { ShareFileBrowser } from '@/components/workspace/share-file-browser'
import { ImageViewer } from '@/components/workspace/image-viewer'
import { PdfViewer } from '@/components/workspace/pdf-viewer'
import { TextViewer } from '@/components/workspace/text-viewer'
import { VideoPlayer } from '@/components/workspace/video-player'
import { VIRTUAL_FOLDERS } from '@/lib/constants'
import { useInMemoryNavigationSession, type NavigationSession } from '@/lib/navigation-session'
import { useFileIcon } from '@/lib/use-file-icon'
import { useMediaPlayer } from '@/lib/use-media-player'
import { getMediaType } from '@/lib/media-utils'
import { useSettings } from '@/lib/use-settings'
import { MediaType } from '@/lib/types'
import {
  getWorkspaceWindowTitle,
  type WorkspaceSource,
  type WorkspaceWindowDefinition,
  workspaceSourceToMediaContext,
} from '@/lib/use-workspace'
import { cn } from '@/lib/utils'
import { hasFileDragData, getFileDragData, type FileDragData } from '@/lib/file-drag-data'

type Bounds = { x: number; y: number; width: number; height: number }

export interface WindowGroupProps {
  tabs: WorkspaceWindowDefinition[]
  activeTabId: string | null
  editableFolders: string[]
  playbackSession: NavigationSession
  activeWindowId: string | null
  onFocus: (windowId: string) => void
  onMinimize: (windowId: string) => void
  onToggleMaximize: (windowId: string) => void
  onClose: (windowId: string) => void
  onUpdateBounds: (windowId: string, bounds: Bounds) => void
  onResizeSnapped: (windowId: string, bounds: Bounds, direction: string) => void
  onDragMove: (cursorX: number, cursorY: number, windowId: string) => void
  onDragStop: (windowId: string, bounds: Bounds, clientX: number, clientY: number) => void
  onPresentationChange: (
    windowId: string,
    presentation: {
      title?: string
      iconName?: string | null
      iconPath?: string | null
      iconType?: MediaType | null
      iconIsVirtual?: boolean
    },
  ) => void
  onNavigationStateChange: (windowId: string, dir: string | null, viewing: string | null) => void
  onRequestPlay: (source: WorkspaceSource, path: string, dir?: string) => void
  onRequestView: (source: WorkspaceSource, path: string, dir: string, type: MediaType) => void
  onOpenLayoutPicker: (windowId: string, anchorRect: DOMRect) => void
  onSelectTab: (tabGroupId: string, windowId: string) => void
  onCloseTab: (windowId: string) => void
  onAddTab: (sourceWindowId: string) => void
  onOpenInNewTabInSameWindow?: (
    sourceWindowId: string,
    file: { path: string; isDirectory: boolean; isVirtual?: boolean },
    currentPath: string,
  ) => string
  onDetachTab: (windowId: string, clientX: number, clientY: number) => void
  onRestoreDrag: (windowId: string, clientX: number, clientY: number) => void
  onDropFileToTabBar?: (
    targetWindowId: string,
    data: { path: string; isDirectory: boolean; source: WorkspaceSource },
  ) => void
}

function useWorkspaceWindowSession(
  localSession: NavigationSession,
  playbackSession: NavigationSession,
  source: WorkspaceSource,
  onRequestPlay: WindowGroupProps['onRequestPlay'],
  onRequestView: WindowGroupProps['onRequestView'],
): NavigationSession {
  const mergedState = useMemo(
    () => ({
      dir: localSession.state.dir,
      viewing: localSession.state.viewing,
      playing: playbackSession.state.playing,
      audioOnly: playbackSession.state.audioOnly,
    }),
    [
      localSession.state.dir,
      localSession.state.viewing,
      playbackSession.state.playing,
      playbackSession.state.audioOnly,
    ],
  )

  return useMemo(
    () => ({
      state: mergedState,
      navigateToFolder: localSession.navigateToFolder,
      viewFile: (path: string, dir?: string) => {
        const resolvedDir = dir ?? localSession.state.dir ?? ''
        const type = getMediaType(path.split('.').pop() ?? '')
        onRequestView(source, path, resolvedDir, type)
      },
      playFile: (path: string, dir?: string) =>
        onRequestPlay(source, path, dir ?? localSession.state.dir ?? undefined),
      closeViewer: localSession.closeViewer,
      closePlayer: playbackSession.closePlayer,
      setAudioOnly: playbackSession.setAudioOnly,
    }),
    [mergedState, localSession, playbackSession, source, onRequestPlay, onRequestView],
  )
}

interface TabContentProps {
  window: WorkspaceWindowDefinition
  editableFolders: string[]
  playbackSession: NavigationSession
  visible: boolean
  onPresentationChange: WindowGroupProps['onPresentationChange']
  onNavigationStateChange: WindowGroupProps['onNavigationStateChange']
  onRequestPlay: WindowGroupProps['onRequestPlay']
  onRequestView: WindowGroupProps['onRequestView']
  onOpenInNewTabInSameWindow: WindowGroupProps['onOpenInNewTabInSameWindow']
}

function TabContent({
  window: win,
  editableFolders,
  playbackSession,
  visible,
  onPresentationChange,
  onNavigationStateChange,
  onRequestPlay,
  onRequestView,
  onOpenInNewTabInSameWindow,
}: TabContentProps) {
  const localSession = useInMemoryNavigationSession(win.initialState)
  const mergedWindowSession = useWorkspaceWindowSession(
    localSession,
    playbackSession,
    win.source,
    onRequestPlay,
    onRequestView,
  )
  const windowSession = win.type === 'player' ? playbackSession : mergedWindowSession
  const mediaContext = workspaceSourceToMediaContext(win.source)
  const currentDir = localSession.state.dir || ''
  const isLocalBrowserWindow = win.type === 'browser' && win.source.kind === 'local'
  const { settings } = useSettings(currentDir, isLocalBrowserWindow)

  const resolvedTitle =
    win.type === 'browser'
      ? currentDir.split(/[/\\]/).filter(Boolean).at(-1) || 'Home'
      : win.type === 'viewer' && localSession.state.viewing
        ? localSession.state.viewing.split(/[/\\]/).filter(Boolean).at(-1) ||
          getWorkspaceWindowTitle(win)
        : getWorkspaceWindowTitle(win)
  const resolvedIconName =
    win.iconName !== undefined
      ? win.iconName
      : isLocalBrowserWindow
        ? (settings.customIcons[currentDir] ?? null)
        : null
  const resolvedIconPath =
    win.iconPath !== undefined
      ? (win.iconPath ?? '')
      : win.type === 'browser'
        ? currentDir
        : win.type === 'player'
          ? (playbackSession.state.playing ?? '')
          : (localSession.state.viewing ?? '')
  const resolvedIconType =
    win.iconType !== undefined && win.iconType !== null
      ? win.iconType
      : win.type === 'browser'
        ? MediaType.FOLDER
        : win.type === 'player'
          ? MediaType.VIDEO
          : localSession.state.viewing
            ? getMediaType(localSession.state.viewing.split('.').pop() ?? '')
            : MediaType.OTHER
  const resolvedIconIsVirtual =
    win.iconIsVirtual !== undefined
      ? win.iconIsVirtual
      : (Object.values(VIRTUAL_FOLDERS) as string[]).includes(currentDir)

  useEffect(() => {
    if (win.type !== 'browser' && win.type !== 'viewer') return
    onPresentationChange(win.id, {
      title: resolvedTitle,
      iconName: resolvedIconName,
      iconPath: resolvedIconPath,
      iconType: resolvedIconType,
      iconIsVirtual: resolvedIconIsVirtual,
    })
  }, [
    onPresentationChange,
    resolvedIconIsVirtual,
    resolvedIconName,
    resolvedIconPath,
    resolvedIconType,
    resolvedTitle,
    win.id,
    win.type,
  ])

  useEffect(() => {
    if (win.type === 'player') return
    onNavigationStateChange(win.id, localSession.state.dir, localSession.state.viewing)
  }, [
    onNavigationStateChange,
    win.id,
    win.type,
    localSession.state.dir,
    localSession.state.viewing,
  ])

  if (!visible) return null

  return (
    <div className='workspace-window-content relative min-h-0 flex-1 overflow-hidden'>
      {win.type === 'player' ? (
        <VideoPlayer session={playbackSession} mediaContext={mediaContext} />
      ) : win.type === 'viewer' ? (
        <>
          <ImageViewer session={windowSession} mediaContext={mediaContext} />
          <PdfViewer session={windowSession} mediaContext={mediaContext} />
          <TextViewer
            editableFolders={editableFolders}
            session={windowSession}
            mediaContext={mediaContext}
          />
        </>
      ) : win.source.kind === 'share' ? (
        <ShareFileBrowser
          session={windowSession}
          onOpenInNewTabInSameWindow={
            onOpenInNewTabInSameWindow
              ? (file) => onOpenInNewTabInSameWindow(win.id, file, localSession.state.dir || '')
              : undefined
          }
        />
      ) : (
        <FileBrowser
          editableFolders={editableFolders}
          session={windowSession}
          onOpenInNewTabInSameWindow={
            onOpenInNewTabInSameWindow
              ? (file) => onOpenInNewTabInSameWindow(win.id, file, localSession.state.dir || '')
              : undefined
          }
        />
      )}
    </div>
  )
}

function getTabIcon(
  tab: WorkspaceWindowDefinition,
  getIcon: ReturnType<typeof useFileIcon>['getIcon'],
) {
  const iconType = tab.iconType ?? (tab.type === 'browser' ? MediaType.FOLDER : MediaType.OTHER)
  const iconPath = tab.iconPath ?? (tab.type === 'browser' ? (tab.initialState.dir ?? '') : '')
  return getIcon(
    iconType,
    iconPath,
    iconType === MediaType.AUDIO,
    iconType === MediaType.VIDEO,
    tab.iconIsVirtual ?? false,
  )
}

interface TabStripProps {
  tabs: WorkspaceWindowDefinition[]
  visibleTabId: string
  groupId: string
  getIcon: ReturnType<typeof useFileIcon>['getIcon']
  onSelectTab: (tabGroupId: string, windowId: string) => void
  onFocus: (windowId: string) => void
  onCloseTab: (windowId: string) => void
  onTabDragDetach: (tabId: string, e: React.MouseEvent) => void
  onDropFile?: (data: FileDragData) => void
}

function TabStrip({
  tabs,
  visibleTabId,
  groupId,
  getIcon,
  onSelectTab,
  onFocus,
  onCloseTab,
  onTabDragDetach,
  onDropFile,
}: TabStripProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState({ left: false, right: false })
  const [fileDragOver, setFileDragOver] = useState(false)

  const checkOverflow = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setOverflow({
      left: el.scrollLeft > 2,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
    })
  }, [])

  useEffect(() => {
    checkOverflow()
    const el = scrollRef.current
    if (!el) return
    el.addEventListener('scroll', checkOverflow, { passive: true })
    const ro = new ResizeObserver(checkOverflow)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', checkOverflow)
      ro.disconnect()
    }
  }, [checkOverflow, tabs.length])

  const scrollBy = useCallback((delta: number) => {
    scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' })
  }, [])

  return (
    <div
      className={cn(
        'workspace-tab-strip relative flex min-w-0 flex-1 items-center',
        fileDragOver && 'ring-1 ring-inset ring-primary bg-primary/10',
      )}
      data-tab-drop-target
      onDragOver={(e) => {
        if (!onDropFile || !hasFileDragData(e.dataTransfer)) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'copy'
        setFileDragOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setFileDragOver(false)
        }
      }}
      onDrop={(e) => {
        setFileDragOver(false)
        if (!onDropFile) return
        const data = getFileDragData(e.dataTransfer)
        if (!data) return
        e.preventDefault()
        e.stopPropagation()
        onDropFile(data)
      }}
    >
      {overflow.left && (
        <button
          type='button'
          data-no-window-drag
          className='absolute left-0 z-10 flex h-8 w-5 items-center justify-center bg-linear-to-r from-muted to-transparent text-muted-foreground'
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => scrollBy(-120)}
        >
          <span className='text-[10px]'>&#9666;</span>
        </button>
      )}
      <div
        ref={scrollRef}
        className='scrollbar-none flex min-w-0 flex-1 items-center overflow-x-scroll'
        onWheel={(e) => {
          e.stopPropagation()
          scrollRef.current?.scrollBy({ left: e.deltaY || e.deltaX, behavior: 'instant' })
        }}
      >
        {tabs.map((tab) => {
          const isActiveTab = tab.id === visibleTabId
          return (
            <div
              key={tab.id}
              data-no-window-drag
              className={cn(
                'flex h-8 min-w-0 max-w-[180px] shrink-0 cursor-pointer items-center gap-1 border-r border-border px-2',
                isActiveTab ? 'bg-background' : 'bg-muted/50 hover:bg-muted',
              )}
              onMouseDown={(e) => {
                e.stopPropagation()
                onSelectTab(groupId, tab.id)
                onFocus(tab.id)
                onTabDragDetach(tab.id, e)
              }}
            >
              <div className='flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground'>
                {getTabIcon(tab, getIcon)}
              </div>
              <span className='min-w-0 truncate text-[11px] font-medium text-foreground'>
                {getWorkspaceWindowTitle(tab)}
              </span>
              <button
                type='button'
                className='ml-auto shrink-0 rounded-sm p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground'
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation()
                  onCloseTab(tab.id)
                }}
              >
                <X className='h-2.5 w-2.5' />
              </button>
            </div>
          )
        })}
      </div>
      {overflow.right && (
        <button
          type='button'
          data-no-window-drag
          className='absolute right-0 z-10 flex h-8 w-5 items-center justify-center bg-linear-to-l from-muted to-transparent text-muted-foreground'
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => scrollBy(120)}
        >
          <span className='text-[10px]'>&#9656;</span>
        </button>
      )}
    </div>
  )
}

function SingleTabHeader({
  leader,
  getIcon,
  onDropFile,
}: {
  leader: WorkspaceWindowDefinition
  getIcon: ReturnType<typeof useFileIcon>['getIcon']
  onDropFile?: (data: FileDragData) => void
}) {
  const [fileDragOver, setFileDragOver] = useState(false)

  return (
    <div
      className={cn(
        'flex min-w-0 flex-1 items-center gap-1.5 px-2',
        fileDragOver && 'ring-1 ring-inset ring-primary bg-primary/10',
      )}
      data-tab-drop-target
      onDragOver={(e) => {
        if (!onDropFile || !hasFileDragData(e.dataTransfer)) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'copy'
        setFileDragOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setFileDragOver(false)
        }
      }}
      onDrop={(e) => {
        setFileDragOver(false)
        if (!onDropFile) return
        const data = getFileDragData(e.dataTransfer)
        if (!data) return
        e.preventDefault()
        e.stopPropagation()
        onDropFile(data)
      }}
    >
      <div className='flex h-5 w-5 items-center justify-center text-muted-foreground'>
        {getTabIcon(leader, getIcon)}
      </div>
      <div className='min-w-0 flex-1 truncate text-[11px] font-medium text-foreground'>
        {getWorkspaceWindowTitle(leader)}
      </div>
    </div>
  )
}

export function WindowGroup({
  tabs,
  activeTabId,
  editableFolders,
  playbackSession,
  activeWindowId,
  onFocus,
  onMinimize,
  onToggleMaximize,
  onClose,
  onUpdateBounds,
  onResizeSnapped,
  onDragMove,
  onDragStop: onDragStopProp,
  onPresentationChange,
  onNavigationStateChange,
  onRequestPlay,
  onRequestView,
  onOpenLayoutPicker,
  onSelectTab,
  onCloseTab,
  onAddTab,
  onOpenInNewTabInSameWindow,
  onDetachTab,
  onRestoreDrag,
  onDropFileToTabBar,
}: WindowGroupProps) {
  const leader = tabs[0] as WorkspaceWindowDefinition | undefined
  const leaderId = leader?.id ?? ''
  const bounds = leader?.layout?.bounds
  const isSnapped = !!leader?.layout?.snapZone
  const isFullscreen = !!leader?.layout?.fullscreen
  const hasTabs = tabs.length > 1
  const visibleTabId = activeTabId ?? leaderId
  const isActive = tabs.some((t) => t.id === activeWindowId)
  const groupId = leader?.tabGroupId ?? leaderId

  const currentMediaFile = useMediaPlayer((state) => state.currentFile)
  const currentMediaType = useMediaPlayer((state) => state.mediaType)
  const mediaPlayerIsPlaying = useMediaPlayer((state) => state.isPlaying)
  const { settings } = useSettings('', false)
  const { getIcon } = useFileIcon({
    customIcons: settings.customIcons,
    playingPath: playbackSession.state.playing,
    currentFile: currentMediaFile,
    mediaPlayerIsPlaying,
    mediaType: currentMediaType,
  })

  const dragOccurredRef = useRef(false)

  const handleDrag = useCallback(
    (e: unknown) => {
      dragOccurredRef.current = true
      const ev = e as {
        clientX?: number
        clientY?: number
        touches?: { clientX: number; clientY: number }[]
      }
      const clientX = ev.touches?.[0]?.clientX ?? ev.clientX ?? 0
      const clientY = ev.touches?.[0]?.clientY ?? ev.clientY ?? 0
      onDragMove(clientX, clientY, leaderId)
    },
    [onDragMove, leaderId],
  )

  const handleDragStop = useCallback(
    (event: unknown, data: { x: number; y: number }) => {
      dragOccurredRef.current = false
      if (bounds) {
        const ev = event as { clientX?: number; clientY?: number }
        onDragStopProp(
          leaderId,
          { x: data.x, y: data.y, width: bounds.width, height: bounds.height },
          ev.clientX ?? 0,
          ev.clientY ?? 0,
        )
      }
    },
    [bounds, leaderId, onDragStopProp],
  )

  const handleDragStart = useCallback(
    (e: unknown) => {
      dragOccurredRef.current = false
      onFocus(leaderId)

      if (isSnapped || isFullscreen) {
        const ev = e as { clientX?: number; clientY?: number }
        onRestoreDrag(leaderId, ev.clientX ?? 0, ev.clientY ?? 0)
      }
    },
    [onFocus, leaderId, isSnapped, isFullscreen, onRestoreDrag],
  )

  const guardClick = useCallback((handler: () => void) => {
    if (dragOccurredRef.current) {
      dragOccurredRef.current = false
      return
    }
    handler()
  }, [])

  const snapResizeHandles = useMemo(() => {
    if (!isSnapped) return true
    const zone = leader?.layout?.snapZone
    if (!zone) return true
    const handles: Record<string, boolean> = {
      top: false,
      bottom: false,
      left: false,
      right: false,
      topLeft: false,
      topRight: false,
      bottomLeft: false,
      bottomRight: false,
    }
    const hasRightEdge = [
      'left',
      'top-left',
      'bottom-left',
      'left-third',
      'center-third',
      'left-two-thirds',
      'top-left-third',
      'top-center-third',
      'bottom-left-third',
      'bottom-center-third',
    ].includes(zone)
    const hasLeftEdge = [
      'right',
      'top-right',
      'bottom-right',
      'right-third',
      'center-third',
      'right-two-thirds',
      'top-right-third',
      'top-center-third',
      'bottom-right-third',
      'bottom-center-third',
    ].includes(zone)
    const hasBottomEdge = [
      'top-left',
      'top-right',
      'top-left-third',
      'top-center-third',
      'top-right-third',
    ].includes(zone)
    const hasTopEdge = [
      'bottom-left',
      'bottom-right',
      'bottom-left-third',
      'bottom-center-third',
      'bottom-right-third',
    ].includes(zone)
    if (hasRightEdge) handles.right = true
    if (hasLeftEdge) handles.left = true
    if (hasBottomEdge) handles.bottom = true
    if (hasTopEdge) handles.top = true
    return handles
  }, [isSnapped, leader?.layout?.snapZone])

  const handleMaximizeContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      onOpenLayoutPicker(leaderId, rect)
    },
    [onOpenLayoutPicker, leaderId],
  )

  const handleFileDrop = useCallback(
    (data: FileDragData) => {
      if (!onDropFileToTabBar) return
      const source: WorkspaceSource =
        data.sourceKind === 'share'
          ? { kind: 'share', token: data.sourceToken }
          : { kind: 'local', rootPath: null }
      onDropFileToTabBar(leaderId, {
        path: data.path,
        isDirectory: data.isDirectory,
        source,
      })
    },
    [onDropFileToTabBar, leaderId],
  )

  const handleTabDragDetach = useCallback(
    (tabId: string, e: React.MouseEvent) => {
      if (tabs.length <= 1) return
      e.stopPropagation()
      const startY = e.clientY
      const startX = e.clientX
      const threshold = 40

      const onMouseMove = (ev: MouseEvent) => {
        const dy = ev.clientY - startY
        const dx = Math.abs(ev.clientX - startX)
        if (dy > threshold || dx > threshold) {
          onDetachTab(tabId, ev.clientX, ev.clientY)
          cleanup()
        }
      }
      const onMouseUp = () => cleanup()
      const cleanup = () => {
        document.removeEventListener('mousemove', onMouseMove)
        document.removeEventListener('mouseup', onMouseUp)
      }
      document.addEventListener('mousemove', onMouseMove)
      document.addEventListener('mouseup', onMouseUp)
    },
    [tabs.length, onDetachTab],
  )

  if (!leader || !bounds || leader.layout?.minimized) {
    return null
  }

  const visibleTab = tabs.find((t) => t.id === visibleTabId) ?? leader

  return (
    <Rnd
      size={{ width: bounds.width, height: bounds.height }}
      position={{ x: bounds.x, y: bounds.y }}
      minWidth={360}
      minHeight={260}
      disableDragging={false}
      enableResizing={isFullscreen ? false : snapResizeHandles}
      dragHandleClassName='workspace-window-drag-handle'
      cancel='.workspace-window-content, input, textarea, select, a, audio, video, img, [data-no-window-drag], .workspace-window-buttons'
      style={{ zIndex: leader.layout?.zIndex ?? 1 }}
      onDragStart={handleDragStart}
      onDrag={handleDrag}
      onResizeStart={() => onFocus(leader.id)}
      onDragStop={handleDragStop}
      onResize={(_event, direction, ref, _delta, position) => {
        if (isSnapped) {
          onResizeSnapped(
            leader.id,
            {
              x: position.x,
              y: position.y,
              width: ref.offsetWidth,
              height: ref.offsetHeight,
            },
            direction,
          )
        }
      }}
      onResizeStop={(_event, direction, ref, _delta, position) => {
        const newBounds = {
          x: position.x,
          y: position.y,
          width: ref.offsetWidth,
          height: ref.offsetHeight,
        }
        if (isSnapped) {
          onResizeSnapped(leader.id, newBounds, direction)
        } else {
          onUpdateBounds(leader.id, newBounds)
        }
      }}
    >
      <div
        data-window-group={groupId}
        className={cn(
          'flex h-full min-h-0 min-w-0 flex-col overflow-hidden border border-border bg-background shadow-2xl',
          isActive && 'border-border shadow-black/20',
        )}
        onMouseDown={() => onFocus(visibleTab.id)}
      >
        <div className='flex h-8 items-stretch border-b border-border bg-muted'>
          <div
            data-testid='window-drag-handle'
            className='workspace-window-drag-handle flex min-w-0 flex-1 cursor-grab items-center active:cursor-grabbing'
          >
            {hasTabs ? (
              <TabStrip
                tabs={tabs}
                visibleTabId={visibleTabId}
                groupId={groupId}
                getIcon={getIcon}
                onSelectTab={onSelectTab}
                onFocus={onFocus}
                onCloseTab={onCloseTab}
                onTabDragDetach={handleTabDragDetach}
                onDropFile={onDropFileToTabBar ? handleFileDrop : undefined}
              />
            ) : (
              <SingleTabHeader
                leader={leader}
                getIcon={getIcon}
                onDropFile={onDropFileToTabBar ? handleFileDrop : undefined}
              />
            )}
          </div>
          <div
            className='workspace-window-drag-handle min-w-[48px] shrink-0 cursor-grab active:cursor-grabbing'
            aria-hidden
          />
          <div
            data-no-window-drag
            className='workspace-window-buttons flex h-full shrink-0 items-stretch gap-0 self-stretch pl-3'
            onMouseDown={(e) => e.stopPropagation()}
          >
            <Button
              variant='ghost'
              className='h-full w-8 min-w-8 shrink-0 rounded-none p-0 text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-3.5'
              onClick={() => guardClick(() => onAddTab(leader.id))}
            >
              <Plus />
            </Button>
            <Button
              variant='ghost'
              className='h-full w-8 min-w-8 shrink-0 rounded-none p-0 text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-3.5'
              onClick={() => guardClick(() => onMinimize(leader.id))}
            >
              <Minus />
            </Button>
            <Button
              variant='ghost'
              className='h-full w-8 min-w-8 shrink-0 rounded-none p-0 text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-3.5'
              onClick={() => guardClick(() => onToggleMaximize(leader.id))}
              onContextMenu={handleMaximizeContextMenu}
            >
              {isFullscreen ? <Minimize2 /> : <Maximize2 />}
            </Button>
            <Button
              variant='ghost'
              className='h-full w-8 min-w-8 shrink-0 rounded-none p-0 text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-3.5'
              onClick={() => guardClick(() => onClose(leader.id))}
            >
              <X />
            </Button>
          </div>
        </div>

        {tabs.map((tab) => (
          <TabContent
            key={tab.id}
            window={tab}
            editableFolders={editableFolders}
            playbackSession={playbackSession}
            visible={tab.id === visibleTabId}
            onPresentationChange={onPresentationChange}
            onNavigationStateChange={onNavigationStateChange}
            onRequestPlay={onRequestPlay}
            onRequestView={onRequestView}
            onOpenInNewTabInSameWindow={onOpenInNewTabInSameWindow}
          />
        ))}
      </div>
    </Rnd>
  )
}
