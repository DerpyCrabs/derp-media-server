import type { ContentInstance } from '@/lib/domain/content'
import {
  createUrlSearchParamsMemo,
  navigateSearchParams,
  useBrowserHistory,
} from './browser-history'
import { ContentRuntimeView } from './features/content/ContentRuntimeView'
import type { HostOpenPlan } from './features/content/contracts'
import { createLibraryHost } from './features/content/hosts'
import { ExplorerView } from './features/explorer/ExplorerView'
import type { ExplorerHistory, ExplorerItem, ExplorerSnapshot } from './features/explorer/types'
import type { ExplorerHostAction } from './features/explorer/view-types'
import { openResource } from './integrations/open-resource'
import { applicationSearchCoordinator } from './integrations/search'
import { executeSearchHit } from './features/search/executor'
import type { SearchHit } from './features/search/contracts'
import {
  DEFAULT_FILESYSTEM_ROOT_ID,
  filesystemResourceKey,
  type ResourceSummary,
} from '@/lib/domain/resource'
import { playbackItemKey } from './features/playback'
import {
  filesystemAudioPlaybackQueue,
  filesystemPlaybackItemFromResource,
  filesystemPlaybackItemPath,
} from './integrations/filesystem/playback'
import { usePlaybackSession, usePlaybackSnapshot } from './features/playback/PlaybackProvider'
import { FileSearchButton } from './FileSearchPalette'
import {
  createApplicationExplorerDataSource,
  explorerLocationFromQuery,
  explorerLocationQuery,
  recordApplicationExplorerView,
  type ApplicationExplorerPayload,
} from './integrations/explorer-adapter'
import {
  filesystemPathForResourceKey,
  filesystemResourceIsDirectory,
} from './integrations/filesystem/resource'
import { applicationContentRegistry, applicationContentRuntime } from './integrations/registry'
import { hrefFor } from './lib/routes'
import {
  gridResourceSummaryIcon,
  resourceSummaryIcon,
  type FileIconContext,
} from './lib/use-file-icon'
import { useDynamicFavicon } from './lib/use-dynamic-favicon'
import { closeViewer, playFile, viewFile } from './lib/url-state-actions'
import { MainMediaPlayers } from './media/MainMediaPlayers'
import { openInReader } from './reader/reader-url'
import { ThemeSwitcher } from './ThemeSwitcher'
import { Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js'

function editableFoldersFor(item: ExplorerItem<ApplicationExplorerPayload>): readonly string[] {
  const folders = item.resource.metadata?.editableFolders
  return Array.isArray(folders)
    ? folders.filter((folder): folder is string => typeof folder === 'string')
    : []
}

function sameContentIdentity(left: ContentInstance, right: ContentInstance): boolean {
  if (left.id !== right.id || left.type !== right.type) return false
  if (left.type === 'integration' && right.type === 'integration') {
    return left.integration === right.integration && left.view === right.view
  }
  if (left.type === 'resource' && right.type === 'resource') {
    return (
      left.resource.provider === right.resource.provider &&
      left.resource.id === right.resource.id &&
      left.renderer === right.renderer
    )
  }
  return left.type === 'explorer' && right.type === 'explorer'
    ? left.location.provider === right.location.provider && left.location.id === right.location.id
    : false
}

export function FileBrowser() {
  const browserLocation = useBrowserHistory()
  const params = createUrlSearchParamsMemo(browserLocation)
  const currentLocation = createMemo(() => explorerLocationFromQuery(params()))
  const currentPath = createMemo(() => filesystemPathForResourceKey(currentLocation().key) ?? '')
  const playbackSession = usePlaybackSession()
  const playbackSnapshot = usePlaybackSnapshot()
  const [integrationContent, setIntegrationContent] = createSignal<ContentInstance | null>(null)
  const [explorerSnapshot, setExplorerSnapshot] =
    createSignal<ExplorerSnapshot<ApplicationExplorerPayload> | null>(null)
  const dataSource = createApplicationExplorerDataSource()
  let previousPlayingPath: string | null = null
  let playbackResolveVersion = 0
  let integrationDialogRef: HTMLDivElement | undefined
  let plannedLibraryResource: ResourceSummary | null = null

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
      const item = filesystemPlaybackItemFromResource(resource)
      if (!item) return
      const mode = item.media === 'video' && audioOnly ? 'audio' : item.media
      const current = playbackSession.getSnapshot()
      const sameCurrent =
        !!current.currentItem && playbackItemKey(current.currentItem) === playbackItemKey(item)
      const resources = snapshot?.items.map((candidate) => candidate.resource) ?? []
      const queue = item.media === 'audio' ? filesystemAudioPlaybackQueue(resources, item) : [item]
      if (!sameCurrent) {
        playbackSession.dispatch({ type: 'load', item, queue, mode, autoplay: true })
        return
      }
      if (current.mode !== mode) playbackSession.dispatch({ type: 'setMode', mode })
      if (item.media === 'audio') {
        playbackSession.dispatch({ type: 'setQueue', queue, current: current.currentItem ?? item })
      }
    })()
  })

  async function replaceIntegrationContent(content: ContentInstance) {
    const previous = integrationContent()
    if (previous && !sameContentIdentity(previous, content)) {
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

  function openFilesystemResource(resource: ResourceSummary) {
    const path = filesystemPathForResourceKey(resource.key)
    if (path === null) return
    if (filesystemResourceIsDirectory(resource)) {
      navigateSearchParams(explorerLocationQuery(resource.key), 'push')
      return
    }
    const item = filesystemPlaybackItemFromResource(resource)
    if (item) {
      const current = playbackSession.getSnapshot()
      const resources = explorerSnapshot()?.items.map((listed) => listed.resource) ?? []
      const queue = item.media === 'audio' ? filesystemAudioPlaybackQueue(resources, item) : [item]
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
      playFile(path)
      return
    }
    viewFile(path)
  }

  function placeLibraryPlan(plan: HostOpenPlan<'replace' | 'modal' | 'fullscreen'>) {
    const planned = plannedLibraryResource
    const resource =
      (planned &&
      planned.key.provider === plan.resource.provider &&
      planned.key.id === plan.resource.id
        ? planned
        : null) ??
      explorerSnapshot()?.items.find(
        (candidate) =>
          candidate.resource.key.provider === plan.resource.provider &&
          candidate.resource.key.id === plan.resource.id,
      )?.resource
    if (!resource) return
    if (plan.kind === 'browse') {
      navigateSearchParams(explorerLocationQuery(resource.key), 'push')
      return
    }
    if (filesystemPathForResourceKey(resource.key) !== null) {
      openFilesystemResource(resource)
      return
    }
    void replaceIntegrationContent({
      id: `library-${resource.key.provider}-${resource.key.id}`,
      type: 'resource',
      resource: resource.key,
      renderer: plan.renderer,
    })
  }

  const libraryHost = createLibraryHost({
    replace: placeLibraryPlan,
    modal: placeLibraryPlan,
    fullscreen: placeLibraryPlan,
    close(instanceId) {
      if (integrationContent()?.id === instanceId) void closeIntegrationContent()
    },
    focus(instanceId) {
      if (integrationContent()?.id === instanceId) integrationDialogRef?.focus()
    },
  })

  function openItem(item: ExplorerItem<ApplicationExplorerPayload>) {
    const browsable =
      item.resource.capabilities.includes('browse') || item.resource.presentation === 'browse'
    const playable =
      item.resource.presentation === 'audio' ||
      item.resource.presentation === 'video' ||
      item.resource.mime?.startsWith('audio/') ||
      item.resource.mime?.startsWith('video/')
    const intent = browsable ? 'browse' : playable ? 'play' : 'view'
    const plan = openResource(item.resource, intent, {
      surface: 'library',
      disposition:
        item.resource.presentation === 'pdf' ||
        item.resource.presentation === 'book' ||
        item.resource.mime === 'application/pdf' ||
        item.resource.mime === 'application/epub+zip'
          ? 'fullscreen'
          : browsable
            ? 'replace'
            : 'modal',
    })
    if (plan.status === 'ready') {
      void recordApplicationExplorerView(item.resource)
      plannedLibraryResource = item.resource
      try {
        libraryHost.open(plan as HostOpenPlan<'replace' | 'modal' | 'fullscreen'>)
      } finally {
        plannedLibraryResource = null
      }
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
        return openResource(resource, intent, { surface: 'library', disposition })
      },
      context: { surface: 'library', disposition: 'modal' },
      place(selected, plan) {
        if (!selected.resource || plan.status !== 'ready') return
        plannedLibraryResource = selected.resource
        try {
          libraryHost.open(plan as HostOpenPlan<'replace' | 'modal' | 'fullscreen'>)
        } finally {
          plannedLibraryResource = null
        }
      },
    })
  }

  function hostActions(): readonly ExplorerHostAction<ApplicationExplorerPayload>[] {
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
        available: (item) => filesystemResourceIsDirectory(item.resource),
        run: (item) => {
          window.open(
            new URL(
              hrefFor(
                { kind: 'library' },
                { provider: item.resource.key.provider, resource: item.resource.key.id },
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
        available: (item) => filesystemResourceIsDirectory(item.resource),
        run: (item) => {
          window.open(
            hrefFor(
              { kind: 'workspace' },
              { provider: item.resource.key.provider, resource: item.resource.key.id },
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
        available: (item) => filesystemResourceIsDirectory(item.resource),
        run: (item) => openInReader(item.resource),
      },
    ]
  }

  function iconContext(item: ExplorerItem<ApplicationExplorerPayload>): FileIconContext {
    const path = filesystemPathForResourceKey(item.resource.key)
    const metadata = item.resource.metadata ?? {}
    const playback = playbackSnapshot()
    const playingPath = playback.currentItem
      ? filesystemPlaybackItemPath(playback.currentItem)
      : null
    return {
      customIcons:
        path !== null && typeof metadata.customIcon === 'string'
          ? { [path]: metadata.customIcon }
          : {},
      knowledgeBases: path !== null && metadata.knowledgeBase === true ? [path] : [],
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
          <ExplorerView
            location={currentLocation}
            dataSource={dataSource}
            history={explorerHistory}
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
            itemDomValue={(item) => filesystemPathForResourceKey(item.resource.key) ?? undefined}
            breadcrumbDomValue={(location) =>
              filesystemPathForResourceKey(location.key) ?? undefined
            }
            renderItemIcon={(item, size) =>
              size === 'large'
                ? gridResourceSummaryIcon(item.resource, iconContext(item))
                : resourceSummaryIcon(item.resource, iconContext(item))
            }
            destinationPicker={(_action, item) => {
              const path = filesystemPathForResourceKey(item.resource.key)
              return path === null
                ? null
                : { filePath: path, editableFolders: editableFoldersFor(item) }
            }}
            onOpen={openItem}
            onSnapshot={(snapshot) => {
              setExplorerSnapshot(snapshot)
            }}
            onOpenContent={replaceIntegrationContent}
            onUnsupportedChange={(item) => {
              const path = item ? filesystemPathForResourceKey(item.resource.key) : null
              if (path !== null) viewFile(path)
              else closeViewer()
            }}
          />
        </div>
      </div>

      <Show when={integrationContent()}>
        <div
          ref={integrationDialogRef}
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
