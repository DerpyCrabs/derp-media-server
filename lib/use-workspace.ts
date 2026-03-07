import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getMediaType } from '@/lib/media-utils'
import { useInMemoryNavigationSession, type NavigationState } from '@/lib/navigation-session'
import type { SourceContext } from '@/lib/source-context'
import { MediaType } from '@/lib/types'

export interface WorkspaceSource {
  kind: 'local' | 'share'
  rootPath?: string | null
  token?: string
  sharePath?: string | null
}

export interface WorkspaceWindowLayout {
  bounds?: {
    x: number
    y: number
    width: number
    height: number
  } | null
  fullscreen?: boolean
  dock?: 'left' | 'right' | 'top' | 'bottom' | null
  layoutId?: string | null
  minimized?: boolean
  zIndex?: number
  restoreBounds?: {
    x: number
    y: number
    width: number
    height: number
  } | null
}

export interface WorkspaceWindowDefinition {
  id: string
  type: 'browser' | 'viewer' | 'player'
  title: string
  iconName?: string | null
  iconPath?: string | null
  iconType?: MediaType | null
  iconIsVirtual?: boolean
  source: WorkspaceSource
  initialState: Partial<NavigationState>
  tabGroupId?: string | null
  layout?: WorkspaceWindowLayout
}

interface OpenWorkspaceWindowOptions {
  title?: string
  source?: WorkspaceSource
  initialState?: Partial<NavigationState>
  tabGroupId?: string | null
  layout?: WorkspaceWindowLayout
}

interface UseWorkspaceOptions {
  initialDir?: string | null
}

interface RequestPlayOptions {
  source: WorkspaceSource
  path: string
  dir?: string
}

interface UseWorkspaceResult {
  windows: WorkspaceWindowDefinition[]
  activeWindowId: string | null
  playbackSource: WorkspaceSource | null
  playbackSession: ReturnType<typeof useInMemoryNavigationSession>
  focusWindow: (windowId: string) => void
  closeWindow: (windowId: string) => void
  openBrowserWindow: (options?: OpenWorkspaceWindowOptions) => string
  openViewerWindow: (
    options: OpenWorkspaceWindowOptions & { initialState: Partial<NavigationState> },
  ) => string
  openPlayerWindow: (options?: Pick<RequestPlayOptions, 'source' | 'path'>) => string | null
  updateWindowBounds: (
    windowId: string,
    bounds: NonNullable<WorkspaceWindowLayout['bounds']>,
  ) => void
  updateWindowPresentation: (
    windowId: string,
    presentation: {
      title?: string
      iconName?: string | null
      iconPath?: string | null
      iconType?: MediaType | null
      iconIsVirtual?: boolean
    },
  ) => void
  setWindowMinimized: (windowId: string, minimized: boolean) => void
  toggleWindowFullscreen: (windowId: string) => void
  requestPlay: (options: RequestPlayOptions) => void
}

const DEFAULT_WORKSPACE_SOURCE: WorkspaceSource = { kind: 'local', rootPath: null }
const PLAYER_WINDOW_ID = 'workspace-player-window'
const TASKBAR_HEIGHT = 44
const PLAYER_EXTENSIONS = new Set(['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'])

function getSourceLabel(source: WorkspaceSource): string {
  return source.kind === 'share' ? 'Share' : 'Browser'
}

function getViewportSize() {
  if (typeof window === 'undefined') {
    return { width: 1280, height: 720 }
  }

  return {
    width: window.innerWidth,
    height: Math.max(window.innerHeight - TASKBAR_HEIGHT, 480),
  }
}

function createDefaultBounds(
  index: number,
  type: WorkspaceWindowDefinition['type'],
): NonNullable<WorkspaceWindowLayout['bounds']> {
  const viewport = getViewportSize()
  const maxWidth = Math.max(viewport.width - 48, 420)
  const maxHeight = Math.max(viewport.height - 48, 320)

  if (type === 'player') {
    const width = Math.min(Math.max(Math.round(viewport.width * 0.62), 720), maxWidth)
    const height = Math.min(Math.max(Math.round(viewport.height * 0.62), 420), maxHeight)

    return {
      x: Math.max(Math.round((viewport.width - width) / 2), 16),
      y: Math.max(Math.round((viewport.height - height) / 2), 16),
      width,
      height,
    }
  }

  const width = Math.min(Math.max(Math.round(viewport.width * 0.34), 420), maxWidth)
  const height = Math.min(Math.max(Math.round(viewport.height * 0.58), 360), maxHeight)
  const offset = index * 28

  return {
    x: Math.min(24 + offset, Math.max(viewport.width - width - 16, 16)),
    y: Math.min(24 + offset, Math.max(viewport.height - height - 16, 16)),
    width,
    height,
  }
}

function createFullscreenBounds(): NonNullable<WorkspaceWindowLayout['bounds']> {
  const viewport = getViewportSize()

  return {
    x: 0,
    y: 0,
    width: Math.max(viewport.width, 360),
    height: Math.max(viewport.height, 240),
  }
}

function createWindowLayout(
  layout: WorkspaceWindowLayout | undefined,
  fallbackBounds: NonNullable<WorkspaceWindowLayout['bounds']>,
  zIndex: number,
): WorkspaceWindowLayout {
  return {
    bounds: layout?.bounds ?? fallbackBounds,
    dock: layout?.dock ?? null,
    fullscreen: layout?.fullscreen ?? false,
    layoutId: layout?.layoutId ?? null,
    minimized: layout?.minimized ?? false,
    zIndex: layout?.zIndex ?? zIndex,
    restoreBounds: layout?.restoreBounds ?? null,
  }
}

function getPlaybackTitle(path: string | undefined) {
  if (!path) return 'Video Player'

  const normalized = path.replace(/\\/g, '/')
  const fileName = normalized.split('/').pop()
  return fileName || 'Video Player'
}

function isVideoPath(path: string) {
  const extension = path.split('.').pop()?.toLowerCase()
  return extension ? PLAYER_EXTENSIONS.has(extension) : false
}

function getInitialWindowIcon(
  type: WorkspaceWindowDefinition['type'],
  initialState: Partial<NavigationState>,
): Pick<WorkspaceWindowDefinition, 'iconPath' | 'iconType' | 'iconIsVirtual'> {
  if (type === 'browser') {
    return {
      iconPath: initialState.dir ?? '',
      iconType: MediaType.FOLDER,
      iconIsVirtual: false,
    }
  }

  if (type === 'player') {
    return {
      iconPath: initialState.playing ?? '',
      iconType: MediaType.VIDEO,
      iconIsVirtual: false,
    }
  }

  if (type === 'viewer' && initialState.viewing) {
    return {
      iconPath: initialState.viewing,
      iconType: getMediaType(initialState.viewing.split('.').pop() ?? ''),
      iconIsVirtual: false,
    }
  }

  return {
    iconPath: '',
    iconType: MediaType.OTHER,
    iconIsVirtual: false,
  }
}

export function workspaceSourceToMediaContext(
  source: WorkspaceSource | null | undefined,
): SourceContext | undefined {
  if (!source || source.kind !== 'share') {
    return undefined
  }

  return {
    shareToken: source.token ?? null,
    sharePath: source.sharePath ?? null,
  }
}

export function getWorkspaceWindowTitle(
  window: Pick<WorkspaceWindowDefinition, 'title' | 'type' | 'source'>,
): string {
  if (window.title.trim()) {
    return window.title
  }

  if (window.type === 'player') {
    return 'Video Player'
  }

  return window.type === 'viewer'
    ? `${getSourceLabel(window.source)} Viewer`
    : getSourceLabel(window.source)
}

export function useWorkspace({ initialDir = null }: UseWorkspaceOptions = {}): UseWorkspaceResult {
  const playbackSession = useInMemoryNavigationSession()
  const nextWindowIdRef = useRef(2)
  const nextZIndexRef = useRef(2)

  const [windows, setWindows] = useState<WorkspaceWindowDefinition[]>([
    {
      id: 'workspace-window-1',
      type: 'browser',
      title: 'Browser 1',
      iconName: null,
      iconPath: initialDir ?? '',
      iconType: MediaType.FOLDER,
      iconIsVirtual: false,
      source: DEFAULT_WORKSPACE_SOURCE,
      initialState: initialDir ? { dir: initialDir } : {},
      tabGroupId: null,
      layout: createWindowLayout(undefined, createDefaultBounds(0, 'browser'), 1),
    },
  ])
  const [activeWindowId, setActiveWindowId] = useState<string | null>('workspace-window-1')
  const [playbackSource, setPlaybackSource] = useState<WorkspaceSource | null>(
    DEFAULT_WORKSPACE_SOURCE,
  )

  const updateWindow = useCallback(
    (
      windowId: string,
      updater: (window: WorkspaceWindowDefinition) => WorkspaceWindowDefinition,
    ) => {
      setWindows((current) =>
        current.map((window) => (window.id === windowId ? updater(window) : window)),
      )
    },
    [],
  )

  const createWindow = useCallback(
    (
      type: WorkspaceWindowDefinition['type'],
      {
        title,
        source = DEFAULT_WORKSPACE_SOURCE,
        initialState = {},
        tabGroupId = null,
        layout = {},
      }: OpenWorkspaceWindowOptions,
    ) => {
      const id = `workspace-window-${nextWindowIdRef.current++}`
      const zIndex = nextZIndexRef.current++
      const windowCount = windows.filter((window) => window.type === type).length
      const initialIcon = getInitialWindowIcon(type, initialState)
      const nextWindow: WorkspaceWindowDefinition = {
        id,
        type,
        title:
          title ??
          `${type === 'viewer' ? 'Viewer' : type === 'player' ? 'Player' : getSourceLabel(source)} ${
            windowCount + 1
          }`,
        iconName: null,
        ...initialIcon,
        source,
        initialState,
        tabGroupId,
        layout: createWindowLayout(layout, createDefaultBounds(windows.length, type), zIndex),
      }

      setWindows((current) => [...current, nextWindow])
      setActiveWindowId(id)
      return id
    },
    [windows],
  )

  const openBrowserWindow = useCallback(
    (options: OpenWorkspaceWindowOptions = {}) => createWindow('browser', options),
    [createWindow],
  )

  const focusWindow = useCallback(
    (windowId: string) => {
      const zIndex = nextZIndexRef.current++
      updateWindow(windowId, (window) => ({
        ...window,
        layout: {
          ...window.layout,
          minimized: false,
          zIndex,
        },
      }))
      setActiveWindowId(windowId)
    },
    [updateWindow],
  )

  const openPlayerWindow = useCallback(
    (options?: Pick<RequestPlayOptions, 'source' | 'path'>) => {
      const playingPath = options?.path ?? playbackSession.state.playing
      if (!playingPath || !isVideoPath(playingPath)) {
        return null
      }

      const existing = windows.find((window) => window.id === PLAYER_WINDOW_ID)
      const source = options?.source ?? playbackSource ?? DEFAULT_WORKSPACE_SOURCE
      const zIndex = nextZIndexRef.current++

      if (existing) {
        updateWindow(PLAYER_WINDOW_ID, (window) => ({
          ...window,
          title: getPlaybackTitle(playingPath),
          source,
          layout: {
            ...window.layout,
            minimized: false,
            zIndex,
          },
        }))
        setActiveWindowId(PLAYER_WINDOW_ID)
        return PLAYER_WINDOW_ID
      }

      const nextWindow: WorkspaceWindowDefinition = {
        id: PLAYER_WINDOW_ID,
        type: 'player',
        title: getPlaybackTitle(playingPath),
        iconName: null,
        iconPath: playingPath,
        iconType: MediaType.VIDEO,
        iconIsVirtual: false,
        source,
        initialState: {},
        tabGroupId: null,
        layout: createWindowLayout(
          undefined,
          createDefaultBounds(windows.length, 'player'),
          zIndex,
        ),
      }

      setWindows((current) => [...current, nextWindow])
      setActiveWindowId(PLAYER_WINDOW_ID)
      return PLAYER_WINDOW_ID
    },
    [playbackSession.state.playing, playbackSource, updateWindow, windows],
  )

  const openViewerWindow = useCallback(
    (options: OpenWorkspaceWindowOptions & { initialState: Partial<NavigationState> }) =>
      createWindow('viewer', options),
    [createWindow],
  )

  const updateWindowBounds = useCallback(
    (windowId: string, bounds: NonNullable<WorkspaceWindowLayout['bounds']>) => {
      updateWindow(windowId, (window) => ({
        ...window,
        layout: {
          ...window.layout,
          bounds,
        },
      }))
    },
    [updateWindow],
  )

  const updateWindowPresentation = useCallback(
    (
      windowId: string,
      presentation: {
        title?: string
        iconName?: string | null
        iconPath?: string | null
        iconType?: MediaType | null
        iconIsVirtual?: boolean
      },
    ) => {
      updateWindow(windowId, (window) => {
        const nextTitle = presentation.title ?? window.title
        const nextIconName =
          presentation.iconName === undefined ? (window.iconName ?? null) : presentation.iconName
        const nextIconPath =
          presentation.iconPath === undefined ? (window.iconPath ?? null) : presentation.iconPath
        const nextIconType =
          presentation.iconType === undefined ? (window.iconType ?? null) : presentation.iconType
        const nextIconIsVirtual =
          presentation.iconIsVirtual === undefined
            ? (window.iconIsVirtual ?? false)
            : presentation.iconIsVirtual

        if (
          nextTitle === window.title &&
          nextIconName === (window.iconName ?? null) &&
          nextIconPath === (window.iconPath ?? null) &&
          nextIconType === (window.iconType ?? null) &&
          nextIconIsVirtual === (window.iconIsVirtual ?? false)
        ) {
          return window
        }

        return {
          ...window,
          title: nextTitle,
          iconName: nextIconName,
          iconPath: nextIconPath,
          iconType: nextIconType,
          iconIsVirtual: nextIconIsVirtual,
        }
      })
    },
    [updateWindow],
  )

  const setWindowMinimized = useCallback(
    (windowId: string, minimized: boolean) => {
      updateWindow(windowId, (window) => ({
        ...window,
        layout: {
          ...window.layout,
          minimized,
        },
      }))
      setActiveWindowId((current) => (current === windowId && minimized ? null : windowId))
    },
    [updateWindow],
  )

  const toggleWindowFullscreen = useCallback(
    (windowId: string) => {
      const zIndex = nextZIndexRef.current++
      updateWindow(windowId, (window) => {
        const currentBounds = window.layout?.bounds ?? createDefaultBounds(0, window.type)
        const isFullscreen = window.layout?.fullscreen ?? false

        return {
          ...window,
          layout: {
            ...window.layout,
            fullscreen: !isFullscreen,
            minimized: false,
            zIndex,
            bounds: isFullscreen
              ? (window.layout?.restoreBounds ?? currentBounds)
              : createFullscreenBounds(),
            restoreBounds: isFullscreen ? null : currentBounds,
          },
        }
      })
      setActiveWindowId(windowId)
    },
    [updateWindow],
  )

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    const syncFullscreenWindows = () => {
      const nextBounds = createFullscreenBounds()

      setWindows((current) => {
        let hasChanges = false

        const nextWindows = current.map((window) => {
          if (!window.layout?.fullscreen) {
            return window
          }

          const currentBounds = window.layout.bounds
          if (
            currentBounds &&
            currentBounds.x === nextBounds.x &&
            currentBounds.y === nextBounds.y &&
            currentBounds.width === nextBounds.width &&
            currentBounds.height === nextBounds.height
          ) {
            return window
          }

          hasChanges = true
          return {
            ...window,
            layout: {
              ...window.layout,
              bounds: nextBounds,
            },
          }
        })

        return hasChanges ? nextWindows : current
      })
    }

    window.addEventListener('resize', syncFullscreenWindows)
    return () => window.removeEventListener('resize', syncFullscreenWindows)
  }, [])

  const closeWindow = useCallback(
    (windowId: string) => {
      setWindows((current) => {
        const nextWindows = current.filter((window) => window.id !== windowId)
        setActiveWindowId((currentActive) => {
          if (currentActive !== windowId) {
            return currentActive
          }

          return nextWindows.at(-1)?.id ?? null
        })
        return nextWindows
      })
    },
    [setWindows],
  )

  const requestPlay = useCallback(
    ({ source, path, dir }: RequestPlayOptions) => {
      setPlaybackSource(source)
      playbackSession.playFile(path, dir)

      if (isVideoPath(path)) {
        const zIndex = nextZIndexRef.current++
        setWindows((current) => {
          const existing = current.find((window) => window.id === PLAYER_WINDOW_ID)
          if (!existing) {
            return [
              ...current,
              {
                id: PLAYER_WINDOW_ID,
                type: 'player',
                title: getPlaybackTitle(path),
                iconName: null,
                iconPath: path,
                iconType: MediaType.VIDEO,
                iconIsVirtual: false,
                source,
                initialState: {},
                tabGroupId: null,
                layout: createWindowLayout(
                  undefined,
                  createDefaultBounds(current.length, 'player'),
                  zIndex,
                ),
              },
            ]
          }

          return current.map((window) =>
            window.id === PLAYER_WINDOW_ID
              ? {
                  ...window,
                  title: getPlaybackTitle(path),
                  iconPath: path,
                  iconType: MediaType.VIDEO,
                  iconIsVirtual: false,
                  source,
                  layout: {
                    ...window.layout,
                    minimized: false,
                    zIndex,
                  },
                }
              : window,
          )
        })
        setActiveWindowId(PLAYER_WINDOW_ID)
        return
      }

      setWindows((current) => current.filter((window) => window.id !== PLAYER_WINDOW_ID))
      setActiveWindowId((current) => (current === PLAYER_WINDOW_ID ? null : current))
    },
    [playbackSession],
  )

  return useMemo(
    () => ({
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
    }),
    [
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
    ],
  )
}
