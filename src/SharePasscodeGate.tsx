import { useMutation, useQueryClient } from '@tanstack/solid-query'
import { post } from '@/lib/api'
import { queryKeys } from '@/lib/query-keys'
import Lock from 'lucide-solid/icons/lock'
import { Show, createEffect, createMemo, createSignal } from 'solid-js'
import { createUrlSearchParamsMemo, useBrowserHistory } from './browser-history'
import { ThemeSwitcher } from './ThemeSwitcher'

type Props = {
  token: string
  shareName: string
}

export function SharePasscodeGate(props: Props) {
  const history = useBrowserHistory()
  const urlSearchParams = createUrlSearchParamsMemo(history)
  const queryClient = useQueryClient()
  const [passcode, setPasscode] = createSignal('')
  const [error, setError] = createSignal('')
  const [autoTried, setAutoTried] = createSignal(false)

  const passcodeFromUrl = createMemo(() => urlSearchParams().get('p') ?? '')

  const verifyMutation = useMutation(() => ({
    mutationFn: (code: string) => post(`/api/share/${props.token}/verify`, { passcode: code }),
    onSuccess: () => {
      queryClient.setQueryData(queryKeys.shareInfo(props.token), (prev: unknown) => {
        if (!prev || typeof prev !== 'object') return prev
        return { ...(prev as Record<string, unknown>), authorized: true }
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.shareInfo(props.token) })
    },
  }))

  createEffect(() => {
    const code = passcodeFromUrl()
    if (!code || autoTried()) return
    setAutoTried(true)
    setError('')
    void verifyMutation.mutateAsync(code).catch(() => {
      setError('Invalid passcode')
    })
  })

  async function handleSubmit(e: Event) {
    e.preventDefault()
    setError('')
    const c = passcode().trim()
    if (!c) return
    try {
      await verifyMutation.mutateAsync(c)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid passcode')
    }
  }

  return (
    <div class='relative flex min-h-screen items-center justify-center p-4'>
      <ThemeSwitcher variant='floating' />
      <div class='bg-card w-full max-w-sm rounded-xl border border-border p-6 shadow-sm'>
        <div class='mb-4 text-center'>
          <div class='bg-muted mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full'>
            <Lock
              class='text-muted-foreground h-6 w-6'
              size={24}
              stroke-width={2}
              aria-hidden='true'
            />
          </div>
          <h1 class='text-xl font-semibold'>Protected Share</h1>
          <p class='text-muted-foreground mt-1 text-sm'>
            Enter the passcode to access &quot;{props.shareName}&quot;
          </p>
        </div>
        <Show when={verifyMutation.isPending}>
          <p class='text-muted-foreground text-center text-sm'>Verifying…</p>
        </Show>
        <Show when={!verifyMutation.isPending}>
          <form onSubmit={handleSubmit} class='space-y-4'>
            <input
              type='text'
              placeholder='Enter passcode'
              class='border-input bg-background flex h-10 w-full rounded-md border px-3 text-center font-mono text-lg tracking-widest shadow-xs focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none'
              value={passcode()}
              autocomplete='off'
              autofocus
              onInput={(e) => setPasscode(e.currentTarget.value)}
            />
            <Show when={error()}>
              <p class='text-destructive text-sm'>{error()}</p>
            </Show>
            <button
              type='submit'
              class='bg-primary text-primary-foreground hover:bg-primary/90 h-9 w-full rounded-md px-4 text-sm font-medium shadow-sm disabled:opacity-50'
              disabled={verifyMutation.isPending || !passcode().trim()}
            >
              Access Share
            </button>
          </form>
        </Show>
      </div>
    </div>
  )
}
