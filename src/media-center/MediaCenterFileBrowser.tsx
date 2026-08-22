import { createMemo, createSignal, Show } from 'solid-js'
import {
  FileBrowser,
  type FileBrowserHost,
  type FileBrowserPresentation,
} from '@/features/explorer/FileBrowser'
import { FileSearchButton } from '@/features/explorer/FileSearchPalette'
import { useExplorerSettings } from '@/features/explorer/use-explorer-settings'
import { useDynamicFavicon } from '@/media-center/use-dynamic-favicon'
import { openInReader } from '@/features/reader/reader-url'
import { playbackItemFromFileItem, playbackPathMatches } from '@/features/playback'
import { usePlaybackSession, usePlaybackSnapshot } from '@/features/playback/PlaybackProvider'
import { HermesChatDialog } from '@/features/hermes/HermesChatDialog'
import { FloatingScrollActions } from '@/features/explorer/FloatingScrollActions'
import { navigateToFolder } from '@/features/explorer/navigate-folder'
import { useAdminEventsStream } from '@/lib/api/use-admin-events-stream'
import { useServerConfigQuery } from '@/lib/api/use-app-data'
import { createUrlSearchParamsMemo, useBrowserHistory } from '@/lib/browser/browser-history'
import { applyPathMutationToUrl, playFile, viewFile } from '@/lib/browser/url-state-actions'
import { fileSearchResultToFileItem, type FileSearchResult } from '@/lib/files/file-search'
import { MediaType, type FileItem } from '@/lib/files/types'
import { isHermesOpenTarget, type HermesOpenTarget } from '@/features/hermes/hermes-open-target'
import { fileIconContextEquals, type FileIconContext } from '@/features/explorer/use-file-icon'
import { ThemeSwitcher } from './ThemeSwitcher'
import { MediaCenterPlaybackSync, mediaCenterPlaybackQueue } from './MediaCenterPlaybackSync'

const scrollScope = () => 'main-file-browser'

function MediaCenterToolbar(props: {
  present: (request: FileBrowserPresentation) => void
  navigate: (path: string) => void
}) {
  function openSearchResult(result: FileSearchResult) {
    const file = fileSearchResultToFileItem(result)
    if (file.isDirectory) {
      props.navigate(file.path)
      return
    }
    props.present({
      kind: 'default',
      file,
      sourceDir: result.parentPath,
      orderedFiles: [],
    })
  }
  return (
    <>
      <FileSearchButton
        title='Search library'
        testId='classic-file-search-trigger'
        onSelect={openSearchResult}
      />
      <ThemeSwitcher />
    </>
  )
}

export function MediaCenterFileBrowser() {
  const history = useBrowserHistory()
  const params = createUrlSearchParamsMemo(history)
  const playbackSession = usePlaybackSession()
  const playbackSnapshot = usePlaybackSnapshot()
  const config = useServerConfigQuery()
  const { knowledgeBases, customIcons } = useExplorerSettings()
  const [hermesViewer, setHermesViewer] = createSignal<{
    file: FileItem
    target: HermesOpenTarget
  } | null>(null)
  useAdminEventsStream(true, applyPathMutationToUrl)
  useDynamicFavicon(() => customIcons(), { getSearch: () => history().search })

  const currentPath = createMemo(() => params().get('dir') ?? '')
  const playingPath = createMemo(() => params().get('playing'))
  const iconContext = createMemo(
    (): FileIconContext => {
      const playback = playbackSnapshot()
      return {
        customIcons: customIcons(),
        knowledgeBases: knowledgeBases(),
        playingPath: playingPath(),
        currentFile: playback.currentItem?.locator ?? null,
        mediaPlayerIsPlaying: playback.phase === 'playing',
        mediaType: playback.currentItem ? playback.mode : null,
      }
    },
    { equals: fileIconContextEquals },
  )

  function present(request: FileBrowserPresentation) {
    const { file, sourceDir } = request
    if (request.kind === 'reader') {
      openInReader(file)
      return
    }
    if (request.kind === 'virtual') {
      if (isHermesOpenTarget(request.target)) setHermesViewer({ file, target: request.target })
      return
    }
    if (file.type !== MediaType.AUDIO && file.type !== MediaType.VIDEO) {
      viewFile(file.path, sourceDir)
      return
    }
    const item = playbackItemFromFileItem(file)
    if (!item) return
    const state = playbackSession.getSnapshot()
    if (
      state.currentItem &&
      playbackPathMatches(state.currentItem, item.locator) &&
      state.mode === item.media
    ) {
      playbackSession.dispatch({ type: 'toggle' })
    } else {
      playbackSession.dispatch({
        type: 'load',
        item,
        queue: mediaCenterPlaybackQueue([...request.orderedFiles], item),
        mode: item.media,
        autoplay: true,
      })
    }
    playFile(file.path, sourceDir)
  }

  function openInNewTab(file: FileItem | null, sourceDir: string) {
    const next = new URLSearchParams()
    if (file?.isDirectory) {
      next.set('dir', file.path)
    } else if (file) {
      if (sourceDir) next.set('dir', sourceDir)
      next.set(
        file.type === MediaType.AUDIO || file.type === MediaType.VIDEO ? 'playing' : 'viewing',
        file.path,
      )
    }
    const query = next.toString()
    window.open(
      `${window.location.origin}${window.location.pathname || '/'}${query ? `?${query}` : ''}`,
      '_blank',
    )
  }

  function openInWorkspace(file: FileItem | null) {
    if (file?.isVirtual) return
    const next = new URLSearchParams()
    if (file?.path) next.set('dir', file.path)
    const query = next.toString()
    window.open(query ? `/workspace?${query}` : '/workspace', '_blank')
  }

  const host: FileBrowserHost = {
    layout: 'media',
    currentPath,
    editableFolders: () => config.data?.editableFolders ?? [],
    mediaRoots: () => config.data?.mediaRoots ?? [],
    iconContext,
    navigate: (path) => navigateToFolder(path || null),
    present,
    actions: {
      openNewTab: openInNewTab,
      openOtherSurface: openInWorkspace,
      otherSurfaceLabel: 'Open in Workspace',
    },
    toolbarExtras: () => (
      <MediaCenterToolbar present={present} navigate={(path) => navigateToFolder(path)} />
    ),
    renderExtras: (listing) => (
      <>
        <MediaCenterPlaybackSync
          playingPath={playingPath}
          audioOnly={() => params().get('audioOnly') === 'true'}
          session={playbackSession}
          files={listing.files}
          displayedFiles={listing.orderedFiles}
        />
        <Show when={hermesViewer()} keyed>
          {(viewer) => (
            <HermesChatDialog
              file={viewer.file}
              target={viewer.target}
              onClose={() => setHermesViewer(null)}
            />
          )}
        </Show>
        <FloatingScrollActions playingPath={() => playingPath() ?? ''} scrollScope={scrollScope} />
      </>
    ),
  }

  return <FileBrowser host={host} />
}
