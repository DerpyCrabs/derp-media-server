import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AudioPlayer } from '@/components/workspace/audio-player'
import { Layout } from '@/components/workspace/layout'
import { Window } from '@/components/workspace/window'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import { useFileIcon } from '@/lib/use-file-icon'
import { getMediaType } from '@/lib/media-utils'
import { useMediaPlayer } from '@/lib/use-media-player'
import { useSettings } from '@/lib/use-settings'
import { MediaType } from '@/lib/types'
import { useWorkspace, workspaceSourceToMediaContext } from '@/lib/use-workspace'

export function WorkspacePage() {
  const {
    windows,
    activeWindowId,
    playbackSource,
    playbackSession,
    focusWindow,
    closeWindow,
    openBrowserWindow,
    openViewerWindow,
    openPlayerWindow,
    updateWindowBounds,
    updateWindowPresentation,
    setWindowMinimized,
    toggleWindowFullscreen,
    requestPlay,
  } = useWorkspace({
    initialDir:
      typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('dir') : null,
  })

  const { data: authConfig } = useQuery({
    queryKey: ['auth-config'],
    queryFn: () =>
      api<{ enabled: boolean; shareLinkDomain?: string; editableFolders: string[] }>(
        '/api/auth/config',
      ),
  })

  const editableFolders = authConfig?.editableFolders ?? []
  const playbackContext = workspaceSourceToMediaContext(playbackSource)
  const { settings } = useSettings('', true)
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
      windows.map((window) => ({
        id: window.id,
        label: window.title,
        active: window.id === activeWindowId,
        icon: getIcon(
          window.iconType ??
            (window.type === 'browser'
              ? MediaType.FOLDER
              : window.type === 'player'
                ? MediaType.VIDEO
                : window.initialState.viewing
                  ? getMediaType(window.initialState.viewing.split('.').pop() ?? '')
                  : MediaType.OTHER),
          window.iconPath ??
            (window.type === 'browser'
              ? (window.initialState.dir ?? '')
              : window.type === 'player'
                ? (playbackSession.state.playing ?? '')
                : (window.initialState.viewing ?? '')),
          (window.iconType ?? MediaType.OTHER) === MediaType.AUDIO,
          (window.iconType ?? (window.type === 'player' ? MediaType.VIDEO : MediaType.OTHER)) ===
            MediaType.VIDEO,
          window.iconIsVirtual ?? false,
        ),
        onSelect: () => focusWindow(window.id),
        onClose: () => {
          if (window.type === 'player') {
            playbackSession.closePlayer()
          }
          closeWindow(window.id)
        },
      })),
    [windows, activeWindowId, focusWindow, getIcon, playbackSession, closeWindow],
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
      <div className='relative h-full w-full overflow-hidden bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.035),transparent_28%),linear-gradient(to_bottom,rgba(255,255,255,0.02),transparent)]'>
        {windows.map((window) => (
          <Window
            key={window.id}
            window={window}
            editableFolders={editableFolders}
            playbackSession={playbackSession}
            active={window.id === activeWindowId}
            onFocus={() => focusWindow(window.id)}
            onMinimize={() => setWindowMinimized(window.id, true)}
            onToggleMaximize={() => toggleWindowFullscreen(window.id)}
            onClose={() => {
              if (window.type === 'player') {
                playbackSession.closePlayer()
              }
              closeWindow(window.id)
            }}
            onUpdateBounds={(bounds) => updateWindowBounds(window.id, bounds)}
            onPresentationChange={updateWindowPresentation}
            onRequestPlay={(source, path, dir) => requestPlay({ source, path, dir })}
            onRequestView={(source, path, dir) =>
              openViewerWindow({
                title: path.split(/[/\\]/).filter(Boolean).at(-1) || 'Viewer',
                source,
                initialState: { dir, viewing: path },
              })
            }
          />
        ))}
      </div>
    </Layout>
  )
}
