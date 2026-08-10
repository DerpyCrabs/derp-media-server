import { api, post } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import { useMutation, useQuery } from '@tanstack/solid-query'
import {
  Match,
  Show,
  Suspense,
  Switch,
  createEffect,
  createMemo,
  createSignal,
  lazy,
  onMount,
  type Accessor,
} from 'solid-js'
import { useBrowserHistory } from './browser-history'
import { FileBrowser } from './FileBrowser'
import { GlobalForbiddenToast } from './GlobalForbiddenToast'
import { OfflineStatus } from './OfflineStatus'
import { SolidThemeSync } from './SolidThemeSync'
import { ThemeSwitcher } from './ThemeSwitcher'
import type { AuthConfig } from './file-browser/types'
import { shareOfflineJobScope } from './lib/offline-job-observer'
import { recentLocationFromUrl, recordRecentOwnerLocation } from './lib/recent-owner-locations'
import { navigate, parseRoute, type AppRoute } from './lib/routes'
import { captureSharePasscodeFromLocation } from './lib/share-url'
import { OwnerShell, type OwnerSurface } from './owner/OwnerShell'

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
          href='/library'
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
    <Suspense fallback={<LoadingSurface />}>
      <Switch fallback={<FileBrowser />}>
        <Match when={props.route().kind === 'home'}>
          <HomePage />
        </Match>
        <Match when={props.route().kind === 'library'}>
          <FileBrowser forceOffline={props.route().query.offline} />
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
          <ReaderDialog sourcePath={sourcePath} sourceKind={props.route().query.readerKind} />
        )}
      </Show>
    </Suspense>
  )
}

function LegacyOwnerRoutes(props: { route: Accessor<AppRoute> }) {
  return (
    <>
      <OfflineStatus />
      <Suspense fallback={<LoadingSurface />}>
        <Switch fallback={<FileBrowser forceOffline={props.route().query.offline} />}>
          <Match when={props.route().kind === 'workspace'}>
            <WorkspacePage />
          </Match>
          <Match when={props.route().kind === 'canvas'}>
            <CanvasPage />
          </Match>
        </Switch>
        <Show when={props.route().query.reader} keyed>
          {(sourcePath) => (
            <ReaderDialog sourcePath={sourcePath} sourceKind={props.route().query.readerKind} />
          )}
        </Show>
      </Suspense>
    </>
  )
}

function OwnerApplication(props: { route: Accessor<AppRoute> }) {
  const [cachedNewShell, setCachedNewShell] = createSignal(
    localStorage.getItem('derp-desk-new-shell-v1') !== '0',
  )
  const authQuery = useQuery(() => ({
    queryKey: queryKeys.authConfig(),
    queryFn: () => api<AuthConfig>('/api/auth/config'),
    staleTime: Infinity,
  }))
  const newShell = () => authQuery.data?.newShell ?? cachedNewShell()

  createEffect(() => {
    const value = authQuery.data?.newShell
    if (typeof value !== 'boolean') return
    setCachedNewShell(value)
    try {
      localStorage.setItem('derp-desk-new-shell-v1', value ? '1' : '0')
    } catch {}
  })

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
    <Show when={newShell()} fallback={<LegacyOwnerRoutes route={props.route} />}>
      <OwnerShell active={ownerSurface(props.route())} navigate={navigateHref}>
        <OfflineStatus />
        <OwnerRouteContent route={props.route} />
      </OwnerShell>
    </Show>
  )
}

export function App() {
  const location = useBrowserHistory()
  const route = createMemo(() => parseRoute(location()))
  const shareToken = createMemo(() => {
    const current = route()
    return current.kind === 'share' ? current.token : null
  })
  const shareWorkspaceToken = createMemo(() => {
    const current = route()
    return current.kind === 'shareWorkspace' ? current.token : null
  })

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
      <Switch fallback={<NotFoundPage />}>
        <Match when={route().kind === 'login'}>
          <LoginPage />
        </Match>
        <Match when={shareWorkspaceToken()} keyed>
          {(token) => (
            <Suspense fallback={<LoadingSurface />}>
              <OfflineStatus scope={shareOfflineJobScope(token)} />
              <ShareWorkspacePage token={token} />
            </Suspense>
          )}
        </Match>
        <Match when={shareToken()} keyed>
          {(token) => (
            <Suspense fallback={<LoadingSurface />}>
              <OfflineStatus scope={shareOfflineJobScope(token)} />
              <ShareRoute token={token} />
            </Suspense>
          )}
        </Match>
        <Match when={isOwnerRoute(route())}>
          <OwnerApplication route={route} />
        </Match>
        <Match when={route().kind === 'notFound'}>
          <NotFoundPage />
        </Match>
      </Switch>
    </>
  )
}
