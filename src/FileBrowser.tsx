import type { ContentInstance } from '@/lib/domain/content'
import {
  createUrlSearchParamsMemo,
  navigateSearchParams,
  useBrowserHistory,
} from './browser-history'
import { ContentRuntimeView } from './features/content/ContentRuntimeView'
import { contentRuntimeIdentity } from './features/content/runtime'
import { contentForOpenPlan, type OpenReadyPlan } from './features/open/open-resource'
import type { ExplorerHistory } from './features/explorer/types'
import { openResource } from './integrations/open-resource'
import { applicationSearchCoordinator } from './integrations/search'
import { executeSearchHit } from './features/search/executor'
import type { SearchHit } from './features/search/contracts'
import {
  DEFAULT_FILESYSTEM_ROOT_ID,
  filesystemResourceKey,
  resourceIsBrowsable,
  type ResourceSummary,
} from '@/lib/domain/resource'
import { playbackItemKey } from './features/playback'
import { usePlaybackSession, usePlaybackSnapshot } from './features/playback/PlaybackProvider'
import { FileSearchButton } from './FileSearchPalette'
import {
  explorerLocationFromQuery,
  explorerLocationQuery,
  recordApplicationExplorerView,
} from './integrations/explorer-adapter'
import {
  ApplicationExplorerView,
  type ApplicationExplorerHostAction,
  type ApplicationExplorerSnapshot,
} from './integrations/ApplicationExplorerView'
import { filesystemPathForResourceKey } from './integrations/filesystem/resource'
import { applicationContentRegistry, applicationContentRuntime } from './integrations/registry'
import { hrefFor } from './lib/routes'
import type { FileIconContext } from './lib/use-file-icon'
import { useDynamicFavicon } from './lib/use-dynamic-favicon'
import { closeViewer, playFile, viewFile } from './lib/url-state-actions'
import { MainMediaPlayers } from './media/MainMediaPlayers'
import { openInReader } from './reader/reader-url'
import { ThemeSwitcher } from './ThemeSwitcher'
import { Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js'

export function FileBrowser() {
  const browserLocation = useBrowserHistory()
  const params = createUrlSearchParamsMemo(browserLocation)
  const currentLocation = createMemo(() => explorerLocationFromQuery(params()))
  const currentPath = createMemo(() => filesystemPathForResourceKey(currentLocation().key) ?? '')
  const playbackSession = usePlaybackSession()
  const playbackSnapshot = usePlaybackSnapshot()
  const [integrationContent, setIntegrationContent] = createSignal<ContentInstance | null>(null)
  const [explorerSnapshot, setExplorerSnapshot] = createSignal<ApplicationExplorerSnapshot | null>(
    null,
  )
  let previousPlayingPath: string | null = null
  let playbackResolveVersion = 0

  createEffect(() => {
    const path = params().get('playing')
    const version = ++playbackResolveVersion
    if (!path) {
      if (previousPlayingPath) playbackSession.dispatch({ type: 'stop' })
      previousPlayingPath = null
      return
    }
    previousPlayingPath = path
    const snapshot = explorerSnapshot()
    const listed = snapshot?.items.find(
      (candidate) =>
        filesystemPathForResourceKey(candidate.resource.key)?.replace(/\\/g, '/') ===
        path.replace(/\\/g, '/'),
    )?.resource
    const audioOnly = params().get('audioOnly') === 'true'
    void (async () => {
      const key = filesystemResourceKey(DEFAULT_FILESYSTEM_ROOT_ID, path)
      const inspector = applicationContentRegistry.inspect(key)
      const resource = listed ?? (inspector ? await inspector.inspect(key) : null)
      if (!resource || version !== playbackResolveVersion) return
      const item = applicationContentRegistry.playbackItem(resource)
      if (!item) return
      const mode = item.media === 'video' && audioOnly ? 'audio' : item.media
      const current = playbackSession.getSnapshot()
      const sameCurrent =
        !!current.currentItem && playbackItemKey(current.currentItem) === playbackItemKey(item)
      const resources = snapshot?.items.map((candidate) => candidate.resource) ?? []
      const queue = applicationContentRegistry.playbackQueue(resources, item)
      if (!sameCurrent) {
        playbackSession.dispatch({
          type: 'load',
          item,
          queue,
          mode,
          autoplay: true,
        })
        return
      }
      if (current.mode !== mode) playbackSession.dispatch({ type: 'setMode', mode })
      if (item.media === 'audio') {
        playbackSession.dispatch({
          type: 'setQueue',
          queue,
          current: current.currentItem ?? item,
        })
      }
    })()
  })

  async function replaceIntegrationContent(content: ContentInstance) {
    const previous = integrationContent()
    if (previous && contentRuntimeIdentity(previous) !== contentRuntimeIdentity(content)) {
      if (!(await applicationContentRuntime.canClose(previous))) return
      if (integrationContent() !== previous) return
      await applicationContentRuntime.release(previous)
    }
    setIntegrationContent(content)
  }

  async function closeIntegrationContent() {
    const current = integrationContent()
    if (!current || !(await applicationContentRuntime.canClose(current))) return
    await applicationContentRuntime.release(current)
    if (integrationContent() === current) setIntegrationContent(null)
  }

  onCleanup(() => {
    const current = integrationContent()
    if (current) void applicationContentRuntime.release(current)
  })

  useDynamicFavicon(
    () => {
      const location = explorerSnapshot()?.locationItem
      if (!location) return {}
      const path = filesystemPathForResourceKey(location.resource.key)
      const icon = location.resource.metadata?.customIcon
      return path !== null && typeof icon === 'string' ? { [path]: icon } : {}
    },
    {
      state: () => ({
        directory: currentPath(),
        viewing: params().get('viewing'),
        playing: params().get('playing'),
      }),
    },
  )

  const explorerHistory: ExplorerHistory = {
    current: currentLocation,
    push(location) {
      navigateSearchParams(explorerLocationQuery(location.key), 'push')
    },
    replace(location) {
      navigateSearchParams(explorerLocationQuery(location.key), 'replace')
    },
    back() {
      window.history.back()
    },
    forward() {
      window.history.forward()
    },
    subscribe() {
      return () => undefined
    },
  }

  function openLibraryResource(resource: ResourceSummary): boolean {
    const path = filesystemPathForResourceKey(resource.key)
    if (resourceIsBrowsable(resource)) {
      navigateSearchParams(explorerLocationQuery(resource.key), 'push')
      return true
    }
    const item = applicationContentRegistry.playbackItem(resource)
    if (item) {
      const current = playbackSession.getSnapshot()
      const resources = explorerSnapshot()?.items.map((listed) => listed.resource) ?? []
      const queue = applicationContentRegistry.playbackQueue(resources, item)
      if (
        current.currentItem &&
        playbackItemKey(current.currentItem) === playbackItemKey(item) &&
        current.mode === item.media
      ) {
        playbackSession.dispatch({ type: 'toggle' })
      } else {
        playbackSession.dispatch({
          type: 'load',
          item,
          queue,
          mode: item.media,
          autoplay: true,
        })
      }
      if (path !== null) playFile(path)
      return true
    }
    if (path === null) return false
    viewFile(path)
    return true
  }

  function placeLibraryPlan(plan: OpenReadyPlan) {
    const resource = plan.summary
    if (plan.kind === 'browse') {
      navigateSearchParams(explorerLocationQuery(resource.key), 'push')
      return
    }
    if (openLibraryResource(resource)) return
    void replaceIntegrationContent(
      contentForOpenPlan(plan, `library-${resource.key.provider}-${resource.key.id}`),
    )
  }

  function openItem(resource: ResourceSummary) {
    const browsable = resourceIsBrowsable(resource)
    const playable = applicationContentRegistry.playbackItem(resource) !== null
    const intent = browsable ? 'browse' : playable ? 'play' : 'view'
    const plan = openResource(resource, intent, {
      surface: 'library',
      disposition:
        resource.presentation === 'pdf' ||
        resource.presentation === 'book' ||
        resource.mime === 'application/pdf' ||
        resource.mime === 'application/epub+zip'
          ? 'fullscreen'
          : browsable
            ? 'replace'
            : 'modal',
    })
    if (plan.status === 'ready') {
      void recordApplicationExplorerView(resource)
      placeLibraryPlan(plan)
    }
  }

  function openSearchResult(hit: SearchHit) {
    void executeSearchHit(applicationSearchCoordinator, hit, {
      opener(resource, intent) {
        const disposition = resource.capabilities.includes('browse')
          ? 'replace'
          : resource.mime === 'application/pdf' || resource.mime === 'application/epub+zip'
            ? 'fullscreen'
            : 'modal'
        return openResource(resource, intent, {
          surface: 'library',
          disposition,
        })
      },
      context: { surface: 'library', disposition: 'modal' },
      place(selected, plan) {
        if (!selected.resource || plan.status !== 'ready') return
        placeLibraryPlan(plan)
      },
    })
  }

  function hostActions(): readonly ApplicationExplorerHostAction[] {
    return [
      {
        descriptor: {
          id: 'host.openInNewTab',
          operation: 'openInNewTab',
          label: 'Open in new tab',
          capability: 'host.newTab',
          scope: 'host',
          interaction: 'immediate',
        },
        available: (item) => resourceIsBrowsable(item.resource),
        run: (item) => {
          window.open(
            new URL(
              hrefFor(
                { kind: 'library' },
                {
                  provider: item.resource.key.provider,
                  resource: item.resource.key.id,
                },
              ),
              window.location.origin,
            ).href,
            '_blank',
          )
        },
      },
      {
        descriptor: {
          id: 'host.openInWorkspace',
          operation: 'openInWorkspace',
          label: 'Open in Workspace',
          capability: 'host.workspace',
          scope: 'host',
          interaction: 'immediate',
        },
        available: (item) => resourceIsBrowsable(item.resource),
        run: (item) => {
          window.open(
            hrefFor(
              { kind: 'workspace' },
              {
                provider: item.resource.key.provider,
                resource: item.resource.key.id,
              },
            ),
            '_blank',
          )
        },
      },
      {
        descriptor: {
          id: 'host.openWithReader',
          operation: 'openWithReader',
          label: 'Open with Reader',
          capability: 'host.reader',
          scope: 'host',
          interaction: 'immediate',
        },
        available: (item) => resourceIsBrowsable(item.resource),
        run: (item) => openInReader(item.resource),
      },
    ]
  }

  function iconContext(): FileIconContext {
    const playback = playbackSnapshot()
    const playingPath = playback.currentItem
      ? filesystemPathForResourceKey(playback.currentItem.resource)
      : null
    return {
      customIcons: {},
      knowledgeBases: [],
      playingPath,
      currentFile: playingPath,
      mediaPlayerIsPlaying: playback.phase === 'playing',
      mediaType: playback.currentItem?.media ?? null,
    }
  }

  return (
    <div class='min-h-screen bg-background'>
      <MainMediaPlayers />
      <div
        class='container mx-auto min-h-screen p-0 lg:p-4'
        classList={{
          'max-[649px]:pb-[calc(2.875rem+env(safe-area-inset-bottom,0px))] min-[650px]:pb-12':
            !!playbackSnapshot().currentItem && playbackSnapshot().mode === 'audio',
        }}
        data-testid='media-chrome-pad-root'
      >
        <div
          data-testid='library-explorer-shell'
          class='min-h-[32rem] border-border bg-card shadow-sm lg:rounded-xl lg:border'
        >
          <ApplicationExplorerView
            location={currentLocation}
            history={explorerHistory}
            iconContext={iconContext}
            testId='file-browser'
            dropZoneTestId='upload-drop-zone'
            scrollMode='window'
            hostActions={hostActions}
            toolbarEnd={() => (
              <>
                <FileSearchButton
                  title='Search library'
                  testId='classic-file-search-trigger'
                  onSelect={openSearchResult}
                />
                <ThemeSwitcher />
              </>
            )}
            onOpen={openItem}
            onSnapshot={(snapshot) => {
              setExplorerSnapshot(snapshot)
            }}
            onOpenContent={replaceIntegrationContent}
            onUnsupportedChange={(resource) => {
              const path = resource ? filesystemPathForResourceKey(resource.key) : null
              if (path !== null) viewFile(path)
              else closeViewer()
            }}
          />
        </div>
      </div>

      <Show when={integrationContent()}>
        <div
          role='dialog'
          aria-modal='true'
          tabindex={-1}
          class='fixed inset-0 z-[70] min-h-0 overflow-hidden bg-background'
        >
          <button
            type='button'
            class='absolute top-2 right-2 z-20 inline-flex min-h-11 items-center rounded-md border border-border bg-background/90 px-3 text-sm font-medium shadow-sm hover:bg-muted'
            aria-label='Close integration content'
            onClick={() => void closeIntegrationContent()}
          >
            Close
          </button>
          <ContentRuntimeView
            runtime={applicationContentRuntime}
            instance={integrationContent}
            onReplace={(content) => void replaceIntegrationContent(content)}
            onOpen={(content) => {
              void replaceIntegrationContent(content)
            }}
            onClose={() => void closeIntegrationContent()}
          />
        </div>
      </Show>
    </div>
  )
}
