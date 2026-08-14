import type { CanvasWindow } from '@/lib/infinite-canvas'
import { createSearchCoordinator } from '@/src/features/search/coordinator'
import {
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MIN_QUERY_LENGTH,
  type SearchContributor,
  type SearchHit,
} from '@/src/features/search/contracts'
import { applicationSearchCoordinator } from '@/src/integrations/search'
import { resourceSummaryIcon, type FileIconContext } from '@/src/lib/use-file-icon'
import SquareStack from 'lucide-solid/icons/square-stack'
import { For, createSignal } from 'solid-js'
import { contentWindowKind } from '@/lib/content-window'
import { contentWindowFilesystemPath } from '@/src/integrations/current-window-content'
import { SearchPalette } from '@/src/features/search/SearchPalette'

type SearchScope = 'all' | 'canvas' | 'library'

type Props = {
  windows: CanvasWindow[]
  fileIconContext: FileIconContext
  onClose: () => void
  onWindow: (id: string) => void
  onResult: (result: SearchHit) => void
}

function windowDetail(window: CanvasWindow): string {
  return (
    contentWindowFilesystemPath(window.definition) ??
    (contentWindowKind(window.definition) === 'browser' ? 'Library root' : '')
  )
}

export function CanvasSearchPalette(props: Props) {
  const [scope, setScope] = createSignal<SearchScope>('all')
  const libraryContributorIds = () =>
    applicationSearchCoordinator.contributors.map((contributor) => contributor.id)
  const canvasContributor: SearchContributor = {
    id: 'canvas.windows',
    label: 'Open windows',
    async search(request) {
      const query = request.query.toLowerCase()
      return {
        results: props.windows.flatMap((window) => {
          const detail = windowDetail(window)
          if (!`${window.definition.title} ${detail}`.toLowerCase().includes(query)) return []
          return [
            {
              id: window.id,
              title: window.definition.title,
              detail,
              group: 'Open windows',
              metadata: { windowId: window.id },
            },
          ]
        }),
      }
    },
    execute(result) {
      const windowId = result.metadata?.windowId
      if (typeof windowId === 'string') props.onWindow(windowId)
    },
  }
  const coordinator = createSearchCoordinator(() => [
    ...applicationSearchCoordinator.contributors,
    canvasContributor,
  ])
  function select(item: SearchHit) {
    if (item.resource) props.onResult(item)
    else void coordinator.execute(item)
  }

  function resultPath(item: SearchHit): string | undefined {
    const path = item.resource?.metadata?.logicalPath
    return typeof path === 'string' ? path : undefined
  }

  return (
    <SearchPalette
      search={{
        coordinator,
        minimumQueryLength: 1,
        limit: SEARCH_DEFAULT_LIMIT,
        contributorIds: () =>
          scope() === 'canvas'
            ? [canvasContributor.id]
            : scope() === 'library'
              ? libraryContributorIds()
              : undefined,
      }}
      title='Search canvas and library'
      testId='canvas-search-palette'
      placeholder='Search windows, files and folders…'
      onClose={props.onClose}
      onSelect={select}
      chrome={{
        overlayClass:
          'fixed inset-0 z-[1100000] flex items-start justify-center bg-black/55 px-4 pt-[10vh]',
        dialogClass: 'max-w-2xl rounded-xl',
        resultsClass: 'min-h-52',
        dialogStyle: { 'max-height': 'min(480px, calc(100vh - 96px))' },
        toolbar: (
          <div class='flex gap-1 border-b border-border px-3 py-2'>
            <For
              each={
                [
                  ['all', 'All'],
                  ['canvas', 'Canvas'],
                  ['library', 'Library'],
                ] as Array<[SearchScope, string]>
              }
            >
              {([value, label]) => (
                <button
                  type='button'
                  class='rounded-full px-3 py-1 text-xs hover:bg-muted'
                  classList={{ 'bg-primary text-primary-foreground': scope() === value }}
                  onClick={() => setScope(value)}
                >
                  {label}
                </button>
              )}
            </For>
          </div>
        ),
      }}
      messages={{
        idle: `Search current canvas immediately. Type ${SEARCH_MIN_QUERY_LENGTH} characters for library results.`,
        empty: 'No matches.',
        stateClass: 'flex min-h-48 items-center justify-center text-sm text-muted-foreground',
        loadingClass: 'px-3 py-3 text-xs text-muted-foreground',
        loadingWithResults: true,
      }}
      result={{
        icon: (item) =>
          item.resource ? (
            resourceSummaryIcon(item.resource, props.fileIconContext)
          ) : (
            <SquareStack class='size-5' />
          ),
        group: (item) => item.group ?? item.contributorLabel,
        kind: (item) => (item.resource ? 'file' : 'window'),
        path: resultPath,
      }}
    />
  )
}
