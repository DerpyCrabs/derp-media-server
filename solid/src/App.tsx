import { useMutation } from '@tanstack/solid-query'
import { Switch, Match, Show, createSignal, onCleanup, onMount } from 'solid-js'

function pathnameSnap() {
  return window.location.pathname
}

function usePathname() {
  const [path, setPath] = createSignal(pathnameSnap())

  onMount(() => {
    const sync = () => setPath(pathnameSnap())
    window.addEventListener('popstate', sync)
    const origPush = history.pushState.bind(history)
    const origReplace = history.replaceState.bind(history)
    history.pushState = function (...args: Parameters<typeof origPush>) {
      origPush(...args)
      sync()
    }
    history.replaceState = function (...args: Parameters<typeof origReplace>) {
      origReplace(...args)
      sync()
    }
    onCleanup(() => {
      window.removeEventListener('popstate', sync)
      history.pushState = origPush
      history.replaceState = origReplace
    })
  })

  return path
}

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
    <div class='min-h-screen flex items-center justify-center p-4'>
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

function ShareStub() {
  return (
    <div class='min-h-screen flex items-center justify-center p-4'>
      <div class='w-full max-w-sm rounded-xl border border-border bg-card p-6'>
        <h1 class='text-xl font-semibold'>Protected Share</h1>
        <p class='text-sm text-muted-foreground mt-2'>Solid UI placeholder</p>
      </div>
    </div>
  )
}

function HomePage() {
  return (
    <div class='min-h-screen p-6' data-testid='solid-home'>
      <h1 class='text-lg font-medium'>Media Server (Solid)</h1>
      <p class='text-sm text-muted-foreground mt-2'>Solid shell — UI port in progress.</p>
    </div>
  )
}

function matchRoute(path: string): 'login' | 'share' | 'home' {
  if (path === '/login' || path.startsWith('/login/')) return 'login'
  if (path.startsWith('/share/')) return 'share'
  return 'home'
}

export function App() {
  const path = usePathname()
  return (
    <Switch fallback={<HomePage />}>
      <Match when={matchRoute(path()) === 'login'}>
        <LoginPage />
      </Match>
      <Match when={matchRoute(path()) === 'share'}>
        <ShareStub />
      </Match>
    </Switch>
  )
}
