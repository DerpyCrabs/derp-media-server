import { available, modelOwner, view, controllerView, type Snapshot } from 'effectweb'
import { queryCache } from '@/lib/api/cache'
import { configQuery, settingsQuery, type ServerConfig } from '@/lib/api/queries'
import type { GlobalSettings } from '@/lib/models/settings-types'
import { browserHistory } from '@/lib/browser/browser-history'
import { getPlaybackSession, playbackSource } from '@/features/playback/PlaybackProvider'
import { subscribeAdminEvents } from '@/lib/api/admin-events-stream'
import { createDynamicFavicon } from './dynamic-favicon'
import { clearImageSelection, setMediaSelection } from '@/features/media-ai/selection'
import {
  FileBrowser,
  type FileBrowserHost,
  type FileBrowserPresentation,
  type FileBrowserListingContext,
} from '@/features/explorer/FileBrowser'
import { FileSearchButton } from '@/features/explorer/FileSearchPalette'
import { openInReader } from '@/features/reader/reader-url'
import { playbackItemFromFileItem, playbackPathMatches } from '@/features/playback'
import { HermesChatDialog } from '@/features/hermes/HermesChatDialog'
import { FloatingScrollActions } from '@/features/explorer/FloatingScrollActions'
import { navigateToFolder } from '@/features/explorer/navigate-folder'
import { applyPathMutationToUrl, playFile, viewFile } from '@/lib/browser/url-state-actions'
import { fileSearchResultToFileItem, type FileSearchResult } from '@/lib/files/file-search'
import { MediaType, type FileItem } from '@/lib/files/types'
import { isHermesOpenTarget, type HermesOpenTarget } from '@/features/hermes/hermes-open-target'
import { ThemeSwitcher } from './ThemeSwitcher'
import {
  createMediaCenterPlaybackSync,
  mediaCenterPlaybackQueue,
} from './media-center-playback-sync'
import { observeQuery } from '@effectweb/query'
const scrollScope = 'main-file-browser'
const MediaCenterToolbar = view(
  (props: {
    hideSearch?: boolean
    searchOpen?: boolean
    onSearchOpenChange?: (open: boolean) => void
    present: (request: FileBrowserPresentation) => void
    navigate: (path: string) => void
  }) => {
    function openSearchResult(result: FileSearchResult) {
      props.onSearchOpenChange?.(false)
      const file = fileSearchResultToFileItem(result)
      if (file.isDirectory) {
        props.navigate(file.path)
        return
      }
      props.present({ kind: 'default', file, sourceDir: result.parentPath, orderedFiles: [] })
    }
    return (
      <>
        <FileSearchButton
          title='Search library'
          testId='classic-file-search-trigger'
          class={props.hideSearch ? 'hidden' : undefined}
          open={props.searchOpen}
          onOpenChange={props.onSearchOpenChange}
          onSelect={openSearchResult}
        />
        <ThemeSwitcher />
      </>
    )
  },
)
type Props = {
  hideSearch?: boolean
  searchOpen?: boolean
  onSearchOpenChange?: (open: boolean) => void
}
function browserPlayback(state: ReturnType<typeof playbackSource.model>) {
  return {
    currentFile: state.currentItem?.locator ?? null,
    mode: state.currentItem ? state.mode : null,
    playing: state.phase === 'playing',
  }
}
type HermesViewer = { file: FileItem; target: HermesOpenTarget } | null
function createMediaBrowser(props: Props) {
  let listing: FileBrowserListingContext = { files: [], orderedFiles: [] }
  const owner = modelOwner({
    props,
    history: browserHistory.model(),
    playback: browserPlayback(playbackSource.model()),
    config: undefined as Snapshot<ServerConfig> | undefined,
    settings: undefined as Snapshot<GlobalSettings> | undefined,
    hermesViewer: null as HermesViewer,
  })
  const actions = {
    setHermesViewer: (hermesViewer: HermesViewer): void => owner.patch({ hermesViewer }),
    onListingChange: (next: FileBrowserListingContext): void => {
      listing = next
      syncPlayback()
    },
  }
  const playbackProps = () => {
    const params = new URLSearchParams(owner.read().history.search)
    return {
      playingPath: params.get('playing'),
      audioOnly: params.get('audioOnly') === 'true',
      files: listing.files,
      displayedFiles: listing.orderedFiles,
    }
  }
  const playbackSync = owner.own(createMediaCenterPlaybackSync(playbackProps()))
  function syncPlayback() {
    playbackSync.receive(playbackProps())
  }
  const favicon = owner.own(createDynamicFavicon())
  const updateFavicon = () => {
    const state = owner.read()
    const params = new URLSearchParams(state.history.search)
    favicon.update({
      icons: state.settings?.customIcons ?? {},
      nav: {
        dir: params.get('dir'),
        viewing: params.get('viewing'),
        playing: params.get('playing'),
      },
    })
  }
  observeQuery(owner, queryCache, configQuery, 'config', available).select(true)
  observeQuery(owner, queryCache, settingsQuery, (result) => {
    owner.patch({ settings: available(result) })
    updateFavicon()
  }).select(true)
  owner.own(
    browserHistory.subscribe(() => {
      owner.patch({ history: browserHistory.model() })
      updateFavicon()
      syncPlayback()
    }),
  )
  owner.own(
    playbackSource.subscribe((state) => {
      const next = browserPlayback(state)
      const previous = owner.read().playback
      if (
        next.currentFile !== previous.currentFile ||
        next.mode !== previous.mode ||
        next.playing !== previous.playing
      )
        owner.patch({ playback: next })
    }),
  )
  owner.own(subscribeAdminEvents(applyPathMutationToUrl))
  updateFavicon()
  return {
    source: owner.source,
    ...actions,
    receive: (props: Props) => owner.patch({ props }),
    dispose: owner.dispose,
  }
}
export const MediaCenterFileBrowser = controllerView(
  { controller: createMediaBrowser },
  view((model) => {
    const props = model.props
    const params = new URLSearchParams(model.history.search)
    const currentPath = params.get('dir') ?? ''
    const playingPath = params.get('playing')
    const { setHermesViewer } = model.actions
    const iconContext = {
      customIcons: model.settings?.customIcons ?? {},
      knowledgeBases: model.settings?.knowledgeBases ?? [],
      playingPath,
      currentFile: model.playback.currentFile,
      mediaPlayerIsPlaying: model.playback.playing,
      mediaType: model.playback.mode,
    }
    function present(request: FileBrowserPresentation) {
      const { file, sourceDir } = request
      if (file.type === MediaType.IMAGE) clearImageSelection()
      if (file.type === MediaType.AUDIO || file.type === MediaType.VIDEO) setMediaSelection([])
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
      const playbackSession = getPlaybackSession()
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
      editableFolders: model.config?.editableFolders ?? [],
      mediaRoots: model.config?.mediaRoots ?? [],
      iconContext,
      navigate: (path) => navigateToFolder(path || null),
      present,
      actions: {
        openNewTab: openInNewTab,
        openOtherSurface: openInWorkspace,
        otherSurfaceLabel: 'Open in Workspace',
      },
      toolbarExtras: () => (
        <MediaCenterToolbar
          hideSearch={props.hideSearch}
          searchOpen={props.searchOpen}
          onSearchOpenChange={props.onSearchOpenChange}
          present={present}
          navigate={(path) => navigateToFolder(path)}
        />
      ),
      onListingChange: model.actions.onListingChange,
      children: (
        <>
          {model.hermesViewer ? (
            <HermesChatDialog
              file={model.hermesViewer.file}
              target={model.hermesViewer.target}
              onClose={() => setHermesViewer(null)}
            />
          ) : null}
          <FloatingScrollActions playingPath={playingPath ?? ''} scrollScope={scrollScope} />
        </>
      ),
    }
    return <FileBrowser host={host} />
  }),
)
