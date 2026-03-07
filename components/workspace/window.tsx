import { useEffect, useMemo } from 'react'
import { Rnd } from 'react-rnd'
import { Maximize2, Minimize2, Minus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FileBrowser } from '@/components/workspace/file-browser'
import { ImageViewer } from '@/components/workspace/image-viewer'
import { PdfViewer } from '@/components/workspace/pdf-viewer'
import { TextViewer } from '@/components/workspace/text-viewer'
import { UnsupportedViewer } from '@/components/workspace/unsupported-viewer'
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

interface WorkspaceWindowProps {
  window: WorkspaceWindowDefinition
  editableFolders: string[]
  playbackSession: NavigationSession
  active: boolean
  onFocus: () => void
  onMinimize: () => void
  onToggleMaximize: () => void
  onClose: () => void
  onUpdateBounds: (bounds: { x: number; y: number; width: number; height: number }) => void
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
  onRequestPlay: (source: WorkspaceSource, path: string, dir?: string) => void
  onRequestView: (source: WorkspaceSource, path: string, dir: string, type: MediaType) => void
}

function useWorkspaceWindowSession(
  localSession: NavigationSession,
  playbackSession: NavigationSession,
  source: WorkspaceSource,
  onRequestPlay: WorkspaceWindowProps['onRequestPlay'],
  onRequestView: WorkspaceWindowProps['onRequestView'],
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

function WorkspaceSharePlaceholder({ title }: { title: string }) {
  return (
    <div className='flex h-full min-h-64 items-center justify-center border-t border-white/8 bg-neutral-950 p-6 text-center text-sm text-muted-foreground'>
      {title} is ready for a share-backed source, but share workspace windows are not enabled yet.
    </div>
  )
}

export function Window({
  window,
  editableFolders,
  playbackSession,
  active,
  onFocus,
  onMinimize,
  onToggleMaximize,
  onClose,
  onUpdateBounds,
  onPresentationChange,
  onRequestPlay,
  onRequestView,
}: WorkspaceWindowProps) {
  const bounds = window.layout?.bounds
  const localSession = useInMemoryNavigationSession(window.initialState)
  const mergedWindowSession = useWorkspaceWindowSession(
    localSession,
    playbackSession,
    window.source,
    onRequestPlay,
    onRequestView,
  )
  const windowSession = window.type === 'player' ? playbackSession : mergedWindowSession
  const mediaContext = workspaceSourceToMediaContext(window.source)
  const currentDir = localSession.state.dir || ''
  const isLocalBrowserWindow = window.type === 'browser' && window.source.kind === 'local'
  const { settings } = useSettings(currentDir, isLocalBrowserWindow)
  const currentMediaFile = useMediaPlayer((state) => state.currentFile)
  const currentMediaType = useMediaPlayer((state) => state.mediaType)
  const mediaPlayerIsPlaying = useMediaPlayer((state) => state.isPlaying)
  const resolvedTitle =
    window.type === 'browser'
      ? currentDir.split(/[/\\]/).filter(Boolean).at(-1) || 'Home'
      : window.type === 'viewer' && localSession.state.viewing
        ? localSession.state.viewing.split(/[/\\]/).filter(Boolean).at(-1) ||
          getWorkspaceWindowTitle(window)
        : getWorkspaceWindowTitle(window)
  const resolvedIconName =
    window.iconName !== undefined
      ? window.iconName
      : isLocalBrowserWindow
        ? (settings.customIcons[currentDir] ?? null)
        : null
  const resolvedIconPath =
    window.iconPath !== undefined
      ? (window.iconPath ?? '')
      : window.type === 'browser'
        ? currentDir
        : window.type === 'player'
          ? (playbackSession.state.playing ?? '')
          : (localSession.state.viewing ?? '')
  const resolvedIconType =
    window.iconType !== undefined && window.iconType !== null
      ? window.iconType
      : window.type === 'browser'
        ? MediaType.FOLDER
        : window.type === 'player'
          ? MediaType.VIDEO
          : localSession.state.viewing
            ? getMediaType(localSession.state.viewing.split('.').pop() ?? '')
            : MediaType.OTHER
  const resolvedIconIsVirtual =
    window.iconIsVirtual !== undefined
      ? window.iconIsVirtual
      : (Object.values(VIRTUAL_FOLDERS) as string[]).includes(currentDir)
  const { getIcon } = useFileIcon({
    customIcons: settings.customIcons,
    playingPath: playbackSession.state.playing,
    currentFile: currentMediaFile,
    mediaPlayerIsPlaying,
    mediaType: currentMediaType,
  })
  useEffect(() => {
    if (window.type !== 'browser' && window.type !== 'viewer') return

    onPresentationChange(window.id, {
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
    window.id,
    window.type,
  ])

  if (!bounds || window.layout?.minimized) {
    return null
  }

  return (
    <Rnd
      size={{ width: bounds.width, height: bounds.height }}
      position={{ x: bounds.x, y: bounds.y }}
      minWidth={360}
      minHeight={260}
      bounds='parent'
      disableDragging={window.layout?.fullscreen}
      enableResizing={!window.layout?.fullscreen}
      dragHandleClassName='workspace-window-drag-handle'
      cancel='.workspace-window-content, button, input, textarea, select, a, audio, video, [data-no-window-drag]'
      style={{ zIndex: window.layout?.zIndex ?? 1 }}
      onDragStart={onFocus}
      onResizeStart={onFocus}
      onDragStop={(_event, data) =>
        onUpdateBounds({ x: data.x, y: data.y, width: bounds.width, height: bounds.height })
      }
      onResizeStop={(_event, _direction, ref, _delta, position) =>
        onUpdateBounds({
          x: position.x,
          y: position.y,
          width: ref.offsetWidth,
          height: ref.offsetHeight,
        })
      }
    >
      <div
        className={cn(
          'flex h-full min-h-0 min-w-0 flex-col overflow-hidden border border-white/8 bg-neutral-950 shadow-2xl',
          active && 'border-white/12 shadow-black/60',
        )}
        onMouseDown={onFocus}
      >
        <div className='workspace-window-drag-handle flex h-8 cursor-grab items-center gap-1.5 border-b border-white/8 bg-neutral-900 px-2 active:cursor-grabbing'>
          <div className='flex h-5 w-5 items-center justify-center text-muted-foreground'>
            {resolvedIconType
              ? getIcon(
                  resolvedIconType,
                  resolvedIconPath,
                  resolvedIconType === MediaType.AUDIO,
                  resolvedIconType === MediaType.VIDEO,
                  resolvedIconIsVirtual,
                )
              : null}
          </div>
          <div className='min-w-0 flex-1 truncate text-[11px] font-medium text-foreground'>
            {resolvedTitle}
          </div>
          <Button
            variant='ghost'
            size='icon-xs'
            className='shrink-0 rounded-none text-muted-foreground hover:bg-white/8 hover:text-foreground'
            onClick={onMinimize}
          >
            <Minus className='h-3.5 w-3.5' />
          </Button>
          <Button
            variant='ghost'
            size='icon-xs'
            className='shrink-0 rounded-none text-muted-foreground hover:bg-white/8 hover:text-foreground'
            onClick={onToggleMaximize}
          >
            {window.layout?.fullscreen ? (
              <Minimize2 className='h-3.5 w-3.5' />
            ) : (
              <Maximize2 className='h-3.5 w-3.5' />
            )}
          </Button>
          <Button
            variant='ghost'
            size='icon-xs'
            className='shrink-0 rounded-none text-muted-foreground hover:bg-white/8 hover:text-foreground'
            onClick={onClose}
          >
            <X className='h-3.5 w-3.5' />
          </Button>
        </div>

        <div className='workspace-window-content min-h-0 flex-1 overflow-hidden'>
          {window.type === 'player' ? (
            <VideoPlayer session={playbackSession} mediaContext={mediaContext} />
          ) : window.type === 'viewer' ? (
            <>
              <ImageViewer session={windowSession} mediaContext={mediaContext} />
              <PdfViewer session={windowSession} mediaContext={mediaContext} />
              <TextViewer
                editableFolders={editableFolders}
                session={windowSession}
                mediaContext={mediaContext}
              />
              <UnsupportedViewer session={windowSession} mediaContext={mediaContext} />
            </>
          ) : window.source.kind === 'share' ? (
            <WorkspaceSharePlaceholder title={resolvedTitle} />
          ) : (
            <FileBrowser editableFolders={editableFolders} session={windowSession} />
          )}
        </div>
      </div>
    </Rnd>
  )
}
