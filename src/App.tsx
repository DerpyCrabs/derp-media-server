import { Match, Show, Suspense, Switch, createMemo, createResource, lazy } from 'solid-js'
import { getMediaTypeFromPath } from '@/lib/media-utils'
import { MediaType } from '@/lib/types'
import { navigateHref, useBrowserHistory } from './browser-history'
import { FileBrowser } from './FileBrowser'
import { hrefFor, parseRoute } from './lib/routes'
import { SurfaceSwitcher } from './SurfaceSwitcher'
import { ContentRuntimeView } from './features/content/ContentRuntimeView'
import { filesystemContentInstance } from './integrations/filesystem/content'
import { applicationContentRuntime } from './integrations/registry'
import { closeReader } from './reader/reader-url'
import { resourceKey } from '@/lib/domain/resource'
import { filesystemPathForResourceKey } from './integrations/filesystem/resource'

const WorkspacePage = lazy(() =>
  import('./WorkspacePage').then((module) => ({ default: module.WorkspacePage })),
)
const CanvasPage = lazy(() =>
  import('./CanvasPage').then((module) => ({ default: module.CanvasPage })),
)

function LoadingSurface() {
  return (
    <main class='flex min-h-screen items-center justify-center bg-background p-6 text-foreground'>
      <p class='text-sm text-muted-foreground'>Loading…</p>
    </main>
  )
}

function NotFoundPage() {
  const libraryHref = hrefFor({ kind: 'library' })

  return (
    <main
      class='flex min-h-screen items-center justify-center bg-background p-4 text-foreground'
      data-testid='not-found'
    >
      <div class='w-full max-w-md rounded-xl border border-border bg-card p-6 text-center text-card-foreground shadow-sm'>
        <p class='text-sm font-semibold text-primary'>404</p>
        <h1 class='mt-1 text-2xl font-semibold'>Page not found</h1>
        <p class='mt-2 text-sm text-muted-foreground'>This route does not exist.</p>
        <a
          href={libraryHref}
          class='mt-5 inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground'
          onClick={(event) => {
            if (
              event.button !== 0 ||
              event.defaultPrevented ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            ) {
              return
            }
            event.preventDefault()
            navigateHref(libraryHref, 'push')
          }}
        >
          Open Library
        </a>
      </div>
    </main>
  )
}

export function App() {
  const location = useBrowserHistory()
  const route = createMemo(() => parseRoute(location()))
  const readerPath = createMemo(() =>
    route().kind === 'notFound' ? null : (route().query.reader ?? null),
  )
  const readerContextPath = createMemo(() => {
    const { provider, resource } = route().query
    if (!provider || !resource) return ''
    try {
      return filesystemPathForResourceKey(resourceKey(provider, resource)) ?? ''
    } catch {
      return ''
    }
  })
  const readerRequest = createMemo(() => {
    const path = readerPath()
    if (!path) return null
    const folder = route().query.readerKind === 'folder'
    return {
      id: 'library-reader',
      path,
      readerKind: folder
        ? 'folder'
        : getMediaTypeFromPath(path) === MediaType.BOOK
          ? 'book'
          : 'pdf',
      surface: 'library',
      disposition: 'fullscreen',
      contextPath: readerContextPath(),
    } as const
  })
  const [readyReaderContent] = createResource(readerRequest, filesystemContentInstance)
  const visibleReaderContent = createMemo(() =>
    readerRequest() ? (readyReaderContent() ?? null) : null,
  )
  const showSurfaceSwitcher = createMemo(() => {
    const current = route()
    return (
      current.kind !== 'notFound' &&
      !current.query.viewing &&
      !current.query.playing &&
      !current.query.reader
    )
  })

  return (
    <>
      <Switch fallback={<NotFoundPage />}>
        <Match when={route().kind === 'library'}>
          <FileBrowser />
        </Match>
        <Match when={route().kind === 'workspace'}>
          <Suspense fallback={<LoadingSurface />}>
            <WorkspacePage />
          </Suspense>
        </Match>
        <Match when={route().kind === 'canvas'}>
          <Suspense fallback={<LoadingSurface />}>
            <CanvasPage />
          </Suspense>
        </Match>
        <Match when={route().kind === 'notFound'}>
          <NotFoundPage />
        </Match>
      </Switch>
      <Show when={showSurfaceSwitcher()}>
        <SurfaceSwitcher route={route} />
      </Show>
      <Show when={visibleReaderContent()}>
        <div class='fixed inset-0 z-[70] min-h-0 overflow-hidden bg-neutral-900'>
          <ContentRuntimeView
            runtime={applicationContentRuntime}
            instance={visibleReaderContent}
            onClose={closeReader}
          />
        </div>
      </Show>
    </>
  )
}
