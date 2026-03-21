import { useMutation } from '@tanstack/solid-query'
import { Switch, Match, Show, createSignal, createMemo } from 'solid-js'
import { useBrowserHistory } from './browser-history'
import { SolidThemeSync } from './SolidThemeSync'
import { ThemeSwitcher } from './ThemeSwitcher'
import { FileBrowser } from './FileBrowser'
import { ShareRoute } from './ShareRoute'
import { ShareWorkspacePage } from './ShareWorkspacePage'
import { WorkspacePage } from './WorkspacePage'

async function postLogin(password: string) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error || res.statusText)
  }
}

function LoginPage() {
  const [password, setPassword] = createSignal('')

  const loginMutation = useMutation(() => ({
    mutationFn: (vars: { password: string }) => postLogin(vars.password),
    onSuccess: () => window.location.assign('/'),
  }))

  async function handleSubmit(e: Event) {
    e.preventDefault()
    loginMutation.reset()
    try {
      await loginMutation.mutateAsync({ password: password() })
    } catch {
      // Error surface via loginMutation.isError / loginMutation.error
    }
  }

  return (
    <div class='relative min-h-screen flex items-center justify-center p-4'>
      <ThemeSwitcher variant='floating' />
      <div class='w-full max-w-sm rounded-xl border border-border bg-card text-card-foreground shadow-sm'>
        <div class='p-6 space-y-1'>
          <h1 class='text-xl font-semibold'>Media Server</h1>
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

function matchRoute(pathname: string): 'login' | 'share' | 'home' | 'workspace' {
  if (pathname === '/login' || pathname.startsWith('/login/')) return 'login'
  if (pathname.startsWith('/share/')) return 'share'
  if (pathname === '/workspace') return 'workspace'
  return 'home'
}

function parseShareWorkspaceToken(pathname: string): string | null {
  const m = pathname.match(/^\/share\/([^/]+)\/workspace\/?$/)
  return m?.[1] ?? null
}

export function App() {
  const loc = useBrowserHistory()
  const path = createMemo(() => loc().pathname)
  const shareWorkspaceToken = createMemo(() => parseShareWorkspaceToken(path()))

  return (
    <Switch
      fallback={
        <>
          <SolidThemeSync />
          <FileBrowser />
        </>
      }
    >
      <Match when={matchRoute(path()) === 'login'}>
        <>
          <SolidThemeSync />
          <LoginPage />
        </>
      </Match>
      <Match when={shareWorkspaceToken()} keyed>
        {(token) => (
          <>
            <SolidThemeSync />
            <ShareWorkspacePage token={token} />
          </>
        )}
      </Match>
      <Match when={matchRoute(path()) === 'share'}>
        <>
          <SolidThemeSync />
          <ShareRoute />
        </>
      </Match>
      <Match when={matchRoute(path()) === 'workspace'}>
        <>
          <SolidThemeSync />
          <WorkspacePage />
        </>
      </Match>
    </Switch>
  )
}
