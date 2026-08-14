import type { ContentInstance } from '@/lib/domain/content'
import type { FileSearchResult } from '@/lib/file-search'
import { fileSearchResultToFileItem } from '@/lib/file-search'
import { getMediaTypeFromPath } from '@/lib/media-utils'
import { MediaType, type FileItem } from '@/lib/types'
import {
  createUrlSearchParamsMemo,
  navigateSearchParams,
  useBrowserHistory,
} from './browser-history'
import { ContentRuntimeView } from './features/content/ContentRuntimeView'
import type { HostOpenPlan } from './features/content/contracts'
import { createLibraryHost } from './features/content/hosts'
import { ExplorerView } from './features/explorer/ExplorerView'
import type {
  ExplorerHistory,
  ExplorerItem,
  ExplorerLocation,
  ExplorerSnapshot,
} from './features/explorer/types'
import type { ExplorerHostAction } from './features/explorer/view-types'
import { openResource } from './integrations/open-resource'
import { audioPlaybackQueueFromFiles, playbackItemFromFileItem } from './features/playback'
import { usePlaybackSession, usePlaybackSnapshot } from './features/playback/PlaybackProvider'
import { FileSearchButton } from './FileSearchPalette'
import {
  createApplicationExplorerDataSource,
  legacyExplorerLocation,
  legacyExplorerPath,
  legacyFileItemForResource,
  legacyFilesystemExplorerPath,
  recordApplicationExplorerView,
  type ApplicationExplorerPayload,
} from './integrations/explorer-adapter'
import { applicationContentRuntime } from './integrations/registry'
import { hrefFor } from './lib/routes'
import { fileItemIcon, gridHeroIcon, type FileIconContext } from './lib/use-file-icon'
import { useDynamicFavicon } from './lib/use-dynamic-favicon'
import { closeViewer, playFile, viewFile } from './lib/url-state-actions'
import { MainMediaPlayers } from './media/MainMediaPlayers'
import { openInReader } from './reader/reader-url'
import { ThemeSwitcher } from './ThemeSwitcher'
import { Show, createEffect, createMemo, createSignal, onCleanup } from 'solid-js'

function pathFromLocation(location: ExplorerLocation): string {
  return legacyExplorerPath(location.key) ?? ''
}

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
  const currentPath = createMemo(() => params().get('dir') ?? '')
  const playbackSession = usePlaybackSession()
  const playbackSnapshot = usePlaybackSnapshot()
  const [integrationContent, setIntegrationContent] = createSignal<ContentInstance | null>(null)
  const [explorerSnapshot, setExplorerSnapshot] =
    createSignal<ExplorerSnapshot<ApplicationExplorerPayload> | null>(null)
  const dataSource = createApplicationExplorerDataSource()
  let previousPlayingPath: string | null = null
  let integrationDialogRef: HTMLDivElement | undefined
  let plannedLibraryItem: ExplorerItem<ApplicationExplorerPayload> | null = null

  createEffect(() => {
    const path = params().get('playing')
    if (!path) {
      if (previousPlayingPath) playbackSession.dispatch({ type: 'stop' })
      previousPlayingPath = null
      return
    }
    previousPlayingPath = path
    const listed = explorerSnapshot()
      ?.items.map((item) => legacyFileItemForResource(item.resource))
      .find((file) => file?.path.replace(/\\/g, '/') === path.replace(/\\/g, '/'))
    const type = getMediaTypeFromPath(path)
    const file: FileItem = listed ?? {
      path,
      name: path.split(/[/\\]/).at(-1) || path,
      type,
      size: 0,
      extension: path.split('.').at(-1) ?? '',
      isDirectory: false,
    }
    const item = playbackItemFromFileItem(file)
    if (!item) return
    const mode =
      item.media === 'video' && params().get('audioOnly') === 'true' ? 'audio' : item.media
    const current = playbackSession.getSnapshot()
    const sameCurrent =
      current.currentItem?.locator.replace(/\\/g, '/') === item.locator.replace(/\\/g, '/')
    const listedFiles =
      explorerSnapshot()?.items.flatMap((candidate) => {
        const candidateFile = legacyFileItemForResource(candidate.resource)
        return candidateFile ? [candidateFile] : []
      }) ?? []
    const queue =
      item.media === 'audio' ? audioPlaybackQueueFromFiles(listedFiles, {}, item) : [item]
    if (!sameCurrent) {
      playbackSession.dispatch({ type: 'load', item, queue, mode, autoplay: true })
      return
    }
    if (current.mode !== mode) playbackSession.dispatch({ type: 'setMode', mode })
    if (item.media === 'audio') {
      playbackSession.dispatch({ type: 'setQueue', queue, current: current.currentItem ?? item })
    }
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
      const path = legacyExplorerPath(location.resource.key)
      const icon = location.resource.metadata?.customIcon
      return path !== null && typeof icon === 'string' ? { [path]: icon } : {}
    },
    { getSearch: () => browserLocation().search },
  )

  const explorerHistory: ExplorerHistory = {
    current: () => legacyExplorerLocation(currentPath()),
    push(location) {
      navigateSearchParams({ dir: pathFromLocation(location) || null }, 'push')
    },
    replace(location) {
      navigateSearchParams({ dir: pathFromLocation(location) || null }, 'replace')
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

  function openFile(file: FileItem, sourceDir = currentPath()) {
    if (file.isDirectory) {
      navigateSearchParams({ dir: file.path || null }, 'push')
      return
    }
    if (file.type === MediaType.AUDIO || file.type === MediaType.VIDEO) {
      const item = playbackItemFromFileItem(file)
      if (!item) return
      const current = playbackSession.getSnapshot()
      const listedFiles =
        explorerSnapshot()?.items.flatMap((listed) => {
          const listedFile = legacyFileItemForResource(listed.resource)
          return listedFile ? [listedFile] : []
        }) ?? []
      const queue =
        item.media === 'audio' ? audioPlaybackQueueFromFiles(listedFiles, {}, item) : [item]
      if (current.currentItem?.locator === item.locator && current.mode === item.media) {
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
      playFile(file.path, sourceDir)
      return
    }
    viewFile(file.path, sourceDir)
  }

  function placeLibraryPlan(plan: HostOpenPlan<'replace' | 'modal' | 'fullscreen'>) {
    const planned = plannedLibraryItem
    const item =
      (planned &&
      planned.resource.key.provider === plan.resource.provider &&
      planned.resource.key.id === plan.resource.id
        ? planned
        : null) ??
      explorerSnapshot()?.items.find(
        (candidate) =>
          candidate.resource.key.provider === plan.resource.provider &&
          candidate.resource.key.id === plan.resource.id,
      )
    const file = item ? legacyFileItemForResource(item.resource) : null
    if (file) openFile(file)
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
    const file = legacyFileItemForResource(item.resource)
    if (!file) return
    const intent = file.isDirectory
      ? 'browse'
      : file.type === MediaType.AUDIO || file.type === MediaType.VIDEO
        ? 'play'
        : 'view'
    const plan = openResource(item.resource, intent, {
      surface: 'library',
      disposition:
        file.type === MediaType.PDF || file.type === MediaType.BOOK
          ? 'fullscreen'
          : file.isDirectory
            ? 'replace'
            : 'modal',
    })
    if (plan.status === 'ready') {
      void recordApplicationExplorerView(item.resource)
      plannedLibraryItem = item
      try {
        libraryHost.open(plan as HostOpenPlan<'replace' | 'modal' | 'fullscreen'>)
      } finally {
        plannedLibraryItem = null
      }
    }
  }

  function openSearchResult(result: FileSearchResult) {
    openFile(fileSearchResultToFileItem(result), result.parentPath)
  }

  function hostActions(): readonly ExplorerHostAction<ApplicationExplorerPayload>[] {
    return [
      {
        descriptor: {
          id: 'host.openInNewTab',
          label: 'Open in new tab',
          capability: 'host.newTab',
          scope: 'host',
        },
        available: (item) => {
          const file = legacyFileItemForResource(item.resource)
          return !!file?.isDirectory && !file.isVirtual
        },
        run: (item) => {
          const file = legacyFileItemForResource(item.resource)
          if (!file) return
          window.open(
            new URL(
              hrefFor({ kind: 'library' }, file.path ? { dir: file.path } : undefined),
              window.location.origin,
            ).href,
            '_blank',
          )
        },
      },
      {
        descriptor: {
          id: 'host.openInWorkspace',
          label: 'Open in Workspace',
          capability: 'host.workspace',
          scope: 'host',
        },
        available: (item) => {
          const file = legacyFileItemForResource(item.resource)
          return !!file?.isDirectory && !file.isVirtual
        },
        run: (item) => {
          const file = legacyFileItemForResource(item.resource)
          if (!file) return
          window.open(
            hrefFor({ kind: 'workspace' }, file.path ? { dir: file.path } : undefined),
            '_blank',
          )
        },
      },
      {
        descriptor: {
          id: 'host.openWithReader',
          label: 'Open with Reader',
          capability: 'host.reader',
          scope: 'host',
        },
        available: (item) => {
          const file = legacyFileItemForResource(item.resource)
          return !!file?.isDirectory && !file.isVirtual
        },
        run: (item) => {
          const file = legacyFileItemForResource(item.resource)
          if (file) openInReader(file)
        },
      },
    ]
  }

  function iconContext(item: ExplorerItem<ApplicationExplorerPayload>): FileIconContext {
    const file = legacyFileItemForResource(item.resource)
    const metadata = item.resource.metadata ?? {}
    const playback = playbackSnapshot()
    return {
      customIcons:
        file && typeof metadata.customIcon === 'string' ? { [file.path]: metadata.customIcon } : {},
      knowledgeBases: file && metadata.knowledgeBase === true ? [file.path] : [],
      playingPath: playback.currentItem?.locator ?? null,
      currentFile: playback.currentItem?.locator ?? null,
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
            location={() => legacyExplorerLocation(currentPath())}
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
            itemDomValue={(item) => legacyExplorerPath(item.resource.key) ?? undefined}
            breadcrumbDomValue={(location) => legacyExplorerPath(location.key) ?? undefined}
            renderItemIcon={(item, size) => {
              const file = legacyFileItemForResource(item.resource)
              if (!file) return undefined
              return size === 'large'
                ? gridHeroIcon(file, iconContext(item))
                : fileItemIcon(file, iconContext(item))
            }}
            destinationPicker={(_action, item) => {
              const path = legacyFilesystemExplorerPath(item.resource.key)
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
              const file = item ? legacyFileItemForResource(item.resource) : null
              if (file) viewFile(file.path, currentPath())
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
