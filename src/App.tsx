import {
  Match,
  Show,
  Suspense,
  Switch,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  lazy,
  onCleanup,
  onMount,
} from 'solid-js'
import { getMediaTypeFromPath } from '@/lib/media-utils'
import { MediaType } from '@/lib/types'
import { navigateHref, navigateSearchParams, useBrowserHistory } from './browser-history'
import { FileBrowser } from './FileBrowser'
import { hrefFor, parseRoute } from './lib/routes'
import { SurfaceSwitcher } from './SurfaceSwitcher'
import { ContentRuntimeView } from './features/content/ContentRuntimeView'
import { filesystemContentInstance } from './integrations/filesystem/content'
import { applicationContentRuntime } from './integrations/registry'
import { resourceKey } from '@/lib/domain/resource'
import { filesystemPathForResourceKey } from './integrations/filesystem/resource'
import { createSurfaceLifecycleCoordinator } from './features/content/surface-lifecycle'
import type { AppRoute, AppSurface } from './lib/routes'

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
  const browserLocation = useBrowserHistory()
  const [acceptedLocation, setAcceptedLocation] = createSignal(browserLocation())
  const lifecycle = createSurfaceLifecycleCoordinator()
  const route = createMemo(() => parseRoute(acceptedLocation()))
  let pendingLocation: ReturnType<typeof browserLocation> | null = null
  let transitionRunning = false

  const locationHref = (location: ReturnType<typeof browserLocation>) =>
    `${location.pathname}${location.search}${location.hash}`
  const routeSurface = (value: AppRoute): AppSurface | null =>
    value.kind === 'notFound' ? null : value.kind

  async function applyPendingLocation() {
    if (transitionRunning) return
    transitionRunning = true
    try {
      while (pendingLocation) {
        const requested = pendingLocation
        pendingLocation = null
        const current = acceptedLocation()
        if (locationHref(requested) === locationHref(current)) continue
        const currentSurface = routeSurface(parseRoute(current))
        const requestedSurface = routeSurface(parseRoute(requested))
        if (currentSurface === requestedSurface) {
          setAcceptedLocation(requested)
          continue
        }
        if (currentSurface && !(await lifecycle.leave(currentSurface))) {
          pendingLocation = null
          navigateHref(locationHref(current), 'replace')
          continue
        }
        setAcceptedLocation(pendingLocation ?? requested)
        pendingLocation = null
      }
    } finally {
      transitionRunning = false
      if (pendingLocation) void applyPendingLocation()
    }
  }

  createEffect(() => {
    pendingLocation = browserLocation()
    void applyPendingLocation()
  })

  onMount(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => lifecycle.beforeUnload(event)
    window.addEventListener('beforeunload', beforeUnload)
    onCleanup(() => window.removeEventListener('beforeunload', beforeUnload))
  })
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
  createEffect(() => {
    if (!readerRequest()) return
    const resourceState = readyReaderContent.state
    const unavailable =
      resourceState === 'errored' ||
      (resourceState === 'ready' && readyReaderContent.latest === null)
    if (!unavailable) return
    navigateSearchParams({ reader: null, readerKind: null }, 'replace')
  })
  const visibleReaderContent = createMemo(() => {
    if (!readerRequest()) return null
    const resourceState = readyReaderContent.state
    return resourceState === 'ready' || resourceState === 'refreshing'
      ? (readyReaderContent.latest ?? null)
      : null
  })
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
          <FileBrowser location={acceptedLocation} />
        </Match>
        <Match when={route().kind === 'workspace'}>
          <Suspense fallback={<LoadingSurface />}>
            <WorkspacePage lifecycle={lifecycle} />
          </Suspense>
        </Match>
        <Match when={route().kind === 'canvas'}>
          <Suspense fallback={<LoadingSurface />}>
            <CanvasPage lifecycle={lifecycle} />
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
            onClose={() => navigateSearchParams({ reader: null, readerKind: null }, 'push')}
          />
        </div>
      </Show>
    </>
  )
}
