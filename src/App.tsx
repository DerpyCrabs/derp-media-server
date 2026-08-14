import { Match, Show, Suspense, Switch, createMemo, lazy } from 'solid-js'
import { navigateHref, useBrowserHistory } from './browser-history'
import { FileBrowser } from './FileBrowser'
import { hrefFor, parseRoute } from './lib/routes'
import { SurfaceSwitcher } from './SurfaceSwitcher'

const WorkspacePage = lazy(() =>
  import('./WorkspacePage').then((module) => ({ default: module.WorkspacePage })),
)
const CanvasPage = lazy(() =>
  import('./CanvasPage').then((module) => ({ default: module.CanvasPage })),
)

const ReaderDialog = lazy(() =>
  import('./reader/ReaderDialog').then((module) => ({ default: module.ReaderDialog })),
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
      <Show when={readerPath()} keyed>
        {(sourcePath) => (
          <Suspense fallback={null}>
            <ReaderDialog sourcePath={sourcePath} sourceKind={route().query.readerKind} />
          </Suspense>
        )}
      </Show>
    </>
  )
}
