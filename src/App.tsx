import { api, post } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { useMutation, useQuery } from '@tanstack/solid-query'
import {
  ErrorBoundary,
  Match,
  Show,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  lazy,
  onCleanup,
  onMount,
  type Accessor,
} from 'solid-js'
import { useBrowserHistory } from './browser-history'
import { FileBrowser } from './FileBrowser'
import { GlobalForbiddenToast } from './GlobalForbiddenToast'
import { OfflineStatus } from './OfflineStatus'
import { SolidThemeSync } from './SolidThemeSync'
import { ThemeSwitcher } from './ThemeSwitcher'
import { shareOfflineJobScope } from './lib/offline-job-observer'
import { recentLocationFromUrl, recordRecentOwnerLocation } from './lib/recent-owner-locations'
import { hrefFor, navigate, parseRoute, type AppRoute } from './lib/routes'
import { captureSharePasscodeFromLocation } from './lib/share-url'
import { OwnerShell, type OwnerSurface } from './owner/OwnerShell'
import { PlaybackProvider } from './media/playback/PlaybackProvider'
import {
  createGrantBrowserPlaybackSession,
  createOwnerBrowserPlaybackSession,
} from './media/playback/browser-session'
import { PlaybackAudioHost } from './media/playback/PlaybackAudioHost'

const ShareRoute = lazy(() =>
  import('./ShareRoute').then((module) => ({ default: module.ShareRoute })),
)
const ShareWorkspacePage = lazy(() =>
  import('./ShareWorkspacePage').then((module) => ({ default: module.ShareWorkspacePage })),
)
const WorkspacePage = lazy(() =>
  import('./WorkspacePage').then((module) => ({ default: module.WorkspacePage })),
)
const CanvasPage = lazy(() =>
  import('./CanvasPage').then((module) => ({ default: module.CanvasPage })),
)
const HomePage = lazy(() => import('./HomePage').then((module) => ({ default: module.HomePage })))
const SpacesPage = lazy(() =>
  import('./SpacesPage').then((module) => ({ default: module.SpacesPage })),
)
const SettingsPage = lazy(() =>
  import('./SettingsPage').then((module) => ({ default: module.SettingsPage })),
)
const ReaderDialog = lazy(() =>
  import('./reader/ReaderDialog').then((module) => ({ default: module.ReaderDialog })),
)

function LoginPage() {
  const [password, setPassword] = createSignal('')

  const loginMutation = useMutation(() => ({
    mutationFn: (vars: { password: string }) =>
      post<{ success: boolean }>('/api/auth/login', { password: vars.password }),
    onSuccess: () => window.location.assign('/'),
  }))

  async function handleSubmit(e: Event) {
    e.preventDefault()
    loginMutation.reset()
    try {
      await loginMutation.mutateAsync({ password: password() })
    } catch {}
  }

  return (
    <div class='relative min-h-screen flex items-center justify-center p-4'>
      <ThemeSwitcher variant='floating' />
      <div class='w-full max-w-sm rounded-xl border border-border bg-card text-card-foreground shadow-sm'>
        <div class='p-6 space-y-1'>
          <h1 class='text-xl font-semibold'>Derp Desk</h1>
          <p class='text-sm text-muted-foreground'>Enter password to continue</p>
        </div>
        <div class='p-6 pt-0'>
          <form onSubmit={handleSubmit} class='space-y-4'>
            <input
              type='password'
              placeholder='Password'
              class='flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              autocomplete='current-password'
              autofocus
              disabled={loginMutation.isPending}
            />
            <Show when={loginMutation.isError}>
              <p class='text-sm text-destructive'>
                {loginMutation.error?.message ?? 'Login failed'}
              </p>
            </Show>
            <button
              type='submit'
              class='w-full h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50'
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

function NotFoundPage() {
  return (
    <main
      class='relative flex min-h-screen items-center justify-center p-4'
      data-testid='not-found'
    >
      <ThemeSwitcher variant='floating' />
      <div class='bg-card w-full max-w-md rounded-xl border border-border p-6 text-center shadow-sm'>
        <p class='text-primary text-sm font-semibold'>404</p>
        <h1 class='mt-1 text-2xl font-semibold'>Page not found</h1>
        <p class='text-muted-foreground mt-2 text-sm'>This Derp Desk route does not exist.</p>
        <a
          href={hrefFor({ kind: 'library' })}
          class='bg-primary text-primary-foreground mt-5 inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium'
        >
          Open Library
        </a>
      </div>
    </main>
  )
}

function LoadingSurface() {
  return (
    <div class='flex min-h-40 items-center justify-center p-6'>
      <p class='text-muted-foreground text-sm'>Loading…</p>
    </div>
  )
}

async function activateWaitingWorkerAndReload() {
  const registration = await navigator.serviceWorker?.getRegistration()
  if (!registration?.waiting) return false
  let fallback: number | undefined
  const reload = () => {
    if (fallback !== undefined) window.clearTimeout(fallback)
    window.location.reload()
  }
  navigator.serviceWorker.addEventListener('controllerchange', reload, { once: true })
  registration.waiting.postMessage({ type: 'derp-activate-update' })
  fallback = window.setTimeout(reload, 2_000)
  return true
}

function observeWaitingWorker(onChange: (available: boolean) => void) {
  const serviceWorker = navigator.serviceWorker
  if (!serviceWorker) {
    onChange(false)
    return () => {}
  }

  let disposed = false
  let registration: ServiceWorkerRegistration | undefined
  let installing: ServiceWorker | null = null
  const readWaiting = () => {
    if (!disposed) onChange(!!registration?.waiting)
  }
  const watchInstalling = () => {
    installing?.removeEventListener('statechange', readWaiting)
    installing = registration?.installing ?? null
    installing?.addEventListener('statechange', readWaiting)
    readWaiting()
  }

  void serviceWorker.getRegistration().then(
    (current) => {
      if (disposed) return
      registration = current
      registration?.addEventListener('updatefound', watchInstalling)
      watchInstalling()
    },
    () => readWaiting(),
  )
  serviceWorker.addEventListener('controllerchange', readWaiting)

  return () => {
    disposed = true
    installing?.removeEventListener('statechange', readWaiting)
    registration?.removeEventListener('updatefound', watchInstalling)
    serviceWorker.removeEventListener('controllerchange', readWaiting)
  }
}

function UpdateRequiredNotice() {
  const [required, setRequired] = createSignal(false)
  const [waiting, setWaiting] = createSignal(false)

  onMount(() => {
    const receive = (event: MessageEvent) => {
      if (event.data?.type !== 'derp-update-required') return
      setRequired(true)
      void navigator.serviceWorker
        ?.getRegistration()
        .then((registration) => registration?.update())
        .catch(() => {})
    }
    const stopWaiting = observeWaitingWorker((available) => {
      setWaiting(available)
      if (available) setRequired(true)
    })
    navigator.serviceWorker?.addEventListener('message', receive)
    onCleanup(() => {
      stopWaiting()
      navigator.serviceWorker?.removeEventListener('message', receive)
    })
  })

  return (
    <Show when={required()}>
      <aside
        class='bg-card fixed right-3 bottom-3 z-[100050] max-w-sm rounded-xl border border-border p-4 shadow-xl'
        role='alert'
        data-testid='pwa-update-required'
      >
        <p class='font-semibold'>
          {waiting() ? 'Derp Desk update ready' : 'Feature update needed'}
        </p>
        <p class='text-muted-foreground mt-1 text-sm'>
          {waiting()
            ? 'Apply installed update before opening this feature.'
            : 'Open Library while Derp Desk checks for updated feature files.'}
        </p>
        <Show
          when={waiting()}
          fallback={
            <a
              href={hrefFor({ kind: 'library' })}
              class='bg-primary text-primary-foreground mt-3 inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium'
            >
              Open Library
            </a>
          }
        >
          <button
            type='button'
            class='bg-primary text-primary-foreground mt-3 min-h-11 rounded-md px-4 text-sm font-medium'
            onClick={() => void activateWaitingWorkerAndReload()}
          >
            Update and reload
          </button>
        </Show>
      </aside>
    </Show>
  )
}

function RouteLoadFailure() {
  const [waiting, setWaiting] = createSignal(false)
  const [online, setOnline] = createSignal(navigator.onLine)

  onMount(() => {
    const syncOnline = () => setOnline(navigator.onLine)
    const stopWaiting = observeWaitingWorker(setWaiting)
    window.addEventListener('online', syncOnline)
    window.addEventListener('offline', syncOnline)
    onCleanup(() => {
      stopWaiting()
      window.removeEventListener('online', syncOnline)
      window.removeEventListener('offline', syncOnline)
    })
  })

  return (
    <main
      class='flex min-h-screen items-center justify-center p-4'
      data-testid='route-load-failure'
    >
      <div class='bg-card max-w-md rounded-xl border border-border p-6 text-center shadow-sm'>
        <h1 class='text-xl font-semibold'>
          {waiting() ? 'Derp Desk update ready' : 'Feature unavailable'}
        </h1>
        <p class='text-muted-foreground mt-2 text-sm'>
          {waiting()
            ? 'Apply installed update, then Derp Desk can load this feature safely.'
            : online()
              ? 'Open Library or retry this feature.'
              : 'Open Library now. Reconnect before retrying this feature.'}
        </p>
        <Show
          when={waiting()}
          fallback={
            <div class='mt-4 flex flex-wrap justify-center gap-2'>
              <a
                href={hrefFor({ kind: 'library' })}
                class='bg-primary text-primary-foreground inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium'
              >
                Open Library
              </a>
              <button
                type='button'
                class='border-border bg-card min-h-11 rounded-md border px-4 text-sm font-medium disabled:opacity-50'
                disabled={!online()}
                onClick={() => window.location.reload()}
              >
                Retry after reconnect
              </button>
            </div>
          }
        >
          <button
            type='button'
            class='bg-primary text-primary-foreground mt-4 min-h-11 rounded-md px-4 text-sm font-medium'
            onClick={() => void activateWaitingWorkerAndReload()}
          >
            Update and reload
          </button>
        </Show>
      </div>
    </main>
  )
}

function AssistantRedirect() {
  onMount(() => {
    navigate({ kind: 'workspace' }, { replace: true, query: { dir: 'Hermes Sessions' } })
  })
  return <LoadingSurface />
}

function isOwnerRoute(route: AppRoute) {
  return !['login', 'share', 'shareWorkspace', 'notFound'].includes(route.kind)
}

function ownerSurface(route: AppRoute): OwnerSurface {
  if (route.kind === 'library') {
    if (route.query.offline) return 'offline'
    if (route.directory === 'Shares') return 'shared'
    return 'library'
  }
  if (route.kind === 'home') return 'home'
  if (route.kind === 'spaces') return 'spaces'
  if (route.kind === 'workspace') return 'workspace'
  if (route.kind === 'canvas') return 'canvas'
  if (route.kind === 'assistant') return 'assistant'
  if (route.kind === 'offline') return 'offline'
  if (route.kind === 'settings') return 'settings'
  return 'library'
}

function navigateHref(href: string) {
  const url = new URL(href, window.location.origin)
  navigate(parseRoute(url))
}

function OwnerRouteContent(props: { route: Accessor<AppRoute> }) {
  return (
    <>
      <Switch fallback={<FileBrowser />}>
        <Match when={props.route().kind === 'home'}>
          <HomePage />
        </Match>
        <Match when={props.route().kind === 'library'}>
          <Show when={props.route().query.offline ? 'offline' : 'online'} keyed>
            {(mode) => <FileBrowser forceOffline={mode === 'offline'} />}
          </Show>
        </Match>
        <Match when={props.route().kind === 'spaces'}>
          <SpacesPage />
        </Match>
        <Match when={props.route().kind === 'workspace'}>
          <WorkspacePage />
        </Match>
        <Match when={props.route().kind === 'canvas'}>
          <CanvasPage />
        </Match>
        <Match when={props.route().kind === 'assistant'}>
          <AssistantRedirect />
        </Match>
        <Match when={props.route().kind === 'offline'}>
          <FileBrowser forceOffline />
        </Match>
        <Match when={props.route().kind === 'settings'}>
          <SettingsPage />
        </Match>
      </Switch>
      <Show when={props.route().query.reader} keyed>
        {(sourcePath) => (
          <ReaderDialog
            sourcePath={sourcePath}
            sourceKind={props.route().query.readerKind}
            offline={
              props.route().kind === 'offline' ||
              (props.route().kind === 'library' && props.route().query.offline)
            }
          />
        )}
      </Show>
    </>
  )
}

function OwnerApplication(props: { route: Accessor<AppRoute> }) {
  const playbackSession = createOwnerBrowserPlaybackSession()
  const immersive = () => {
    const route = props.route()
    return (
      route.kind === 'workspace' ||
      route.kind === 'canvas' ||
      !!route.query.viewing ||
      !!route.query.reader
    )
  }

  createEffect(() => {
    const route = props.route()
    if (!isOwnerRoute(route)) return
    const recent = recentLocationFromUrl(
      new URL(
        `${route.location.pathname}${route.location.search}${route.location.hash}`,
        window.location.origin,
      ),
    )
    if (recent) recordRecentOwnerLocation(localStorage, recent)
  })

  return (
    <PlaybackProvider session={playbackSession}>
      <OwnerShell
        active={ownerSurface(props.route())}
        immersive={immersive()}
        navigate={navigateHref}
      >
        <OfflineStatus />
        <OwnerRouteContent route={props.route} />
      </OwnerShell>
    </PlaybackProvider>
  )
}

function GrantApplication(props: { token: string; workspace: Accessor<boolean> }) {
  const shareInfo = useQuery(() => ({
    queryKey: queryKeys.shareInfo(props.token),
    queryFn: () =>
      api<{ path?: string; needsPasscode: boolean; authorized: boolean }>(
        `/api/share/${encodeURIComponent(props.token)}/info`,
      ),
  }))
  const authorizedPath = createMemo(() => {
    const info = shareInfo.data
    if (!info || (info.needsPasscode && !info.authorized)) return null
    return typeof info.path === 'string' ? info.path : null
  })
  const session = createGrantBrowserPlaybackSession({
    token: props.token,
    sharePath: () => authorizedPath() ?? '',
    authorized: () => authorizedPath() !== null,
  })

  createEffect(() => {
    if (authorizedPath() === null) return
    const snapshot = session.getSnapshot()
    if (snapshot.currentItem && snapshot.phase === 'recoverable' && snapshot.issue === 'revoked') {
      session.dispatch({ type: 'refreshSource' })
    }
  })

  return (
    <PlaybackProvider session={session}>
      <Show when={authorizedPath() !== null} fallback={<ShareRoute token={props.token} />}>
        <OfflineStatus scope={shareOfflineJobScope(props.token)} />
        <Show when={props.workspace()} fallback={<ShareRoute token={props.token} />}>
          <ShareWorkspacePage token={props.token} />
        </Show>
        <PlaybackAudioHost
          shareContext={{ token: props.token, sharePath: authorizedPath() ?? '' }}
        />
      </Show>
    </PlaybackProvider>
  )
}

export function App() {
  const location = useBrowserHistory()
  const route = createMemo(() => parseRoute(location()))
  const grantToken = createMemo(() => {
    const current = route()
    return current.kind === 'share' || current.kind === 'shareWorkspace' ? current.token : null
  })
  const grantWorkspace = () => route().kind === 'shareWorkspace'

  createEffect(() => {
    const current = location()
    if (!current.pathname.startsWith('/share/')) return
    void current.search
    void current.hash
    captureSharePasscodeFromLocation()
  })

  return (
    <>
      <SolidThemeSync />
      <GlobalForbiddenToast />
      <UpdateRequiredNotice />
      <ErrorBoundary
        fallback={(error) => {
          console.error('Route feature failed to render', error)
          return <RouteLoadFailure />
        }}
      >
        <Switch fallback={<NotFoundPage />}>
          <Match when={route().kind === 'login'}>
            <LoginPage />
          </Match>
          <Match when={grantToken()} keyed>
            {(token) => <GrantApplication token={token} workspace={grantWorkspace} />}
          </Match>
          <Match when={isOwnerRoute(route())}>
            <OwnerApplication route={route} />
          </Match>
          <Match when={route().kind === 'notFound'}>
            <NotFoundPage />
          </Match>
        </Switch>
      </ErrorBoundary>
    </>
  )
}
