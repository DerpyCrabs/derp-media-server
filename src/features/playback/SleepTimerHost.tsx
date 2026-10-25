import { controllerView, list, modelOwner, Portal, view } from 'effectweb'
import { modalFocus } from '@/lib/ui/modal-focus'
import { getPlaybackSession } from './PlaybackProvider'
import { formatPlaybackTime } from './audio'
import { onSleepTimer } from './sleep-timer'
import X from '@effectweb/lucide/icons/x'
function controller() {
  const session = getPlaybackSession()
  const owner = modelOwner({
    open: false,
    mount: undefined as HTMLElement | undefined,
    playback: session.getSnapshot(),
    minutes: '30',
    error: '',
    now: Date.now(),
  })
  let interval: ReturnType<typeof setInterval> | undefined
  const close = () => {
    clearInterval(interval)
    interval = undefined
    owner.patch({ open: false })
  }
  owner.own(() => clearInterval(interval))
  owner.own(
    session.subscribe(() => {
      const playback = session.getSnapshot()
      owner.patch({ playback })
      if (!playback.currentItem) close()
    }),
  )
  owner.own(
    onSleepTimer((mount) => {
      if (!session.getSnapshot().currentItem) return
      clearInterval(interval)
      owner.patch({ open: true, mount, error: '', now: Date.now() })
      interval = setInterval(() => owner.patch({ now: Date.now() }), 1000)
    }),
  )
  const fullscreen = () => {
    if (owner.read().open && owner.read().mount)
      owner.patch({
        mount:
          document.fullscreenElement instanceof HTMLElement
            ? document.fullscreenElement
            : undefined,
      })
  }
  document.addEventListener('fullscreenchange', fullscreen)
  owner.own(() => document.removeEventListener('fullscreenchange', fullscreen))
  const apply = (minutes: number | 'end' | null) => {
    if (
      typeof minutes === 'number' &&
      (!Number.isFinite(minutes) || minutes < 1 || minutes > 1440)
    ) {
      owner.patch({ error: 'Choose between 1 and 1440 minutes.' })
      return
    }
    const result = session.dispatch({
      type: 'setSleepTimer',
      duration: typeof minutes === 'number' ? minutes * 60000 : minutes,
    })
    if (result.accepted) close()
    else owner.patch({ error: 'Start or select a media file first.' })
  }
  return {
    source: owner.source,
    close,
    apply,
    minutes: (minutes: string) => owner.patch({ minutes, error: '' }),
    lifetime: owner,
  }
}
export const SleepTimerHost = controllerView(
  { controller },
  view((model) => {
    if (!model.open) return null
    const timer = model.playback.sleepTimer
    const remaining =
      timer?.kind === 'deadline' ? Math.max(0, Math.ceil((timer.endsAt - model.now) / 1000)) : 0
    const button =
      'min-h-10 rounded-md border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-40'
    return (
      <Portal mount={model.mount}>
        <div
          class='fixed inset-0 z-[1000003] flex items-center justify-center bg-black/55 p-4'
          onClick={(event) => {
            if (event.target === event.currentTarget) model.actions.close()
          }}
        >
          <section
            role='dialog'
            aria-modal='true'
            aria-label='Sleep timer'
            class='w-full max-w-sm rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-2xl'
            use={modalFocus({ onEscape: model.actions.close })}
          >
            <header class='flex items-center justify-between gap-3'>
              <h2 class='text-base font-semibold'>Sleep timer</h2>
              <button
                type='button'
                aria-label='Close sleep timer'
                class='rounded p-2 hover:bg-accent'
                onClick={model.actions.close}
              >
                <X size={18} />
              </button>
            </header>
            <p class='mb-4 text-sm text-muted-foreground'>
              Pause this player after a delay or when the current item ends.
            </p>
            {timer ? (
              <p role='status' class='mb-3 rounded bg-muted px-3 py-2 text-sm'>
                {timer.kind === 'deadline'
                  ? `Pauses in ${formatPlaybackTime(remaining)}`
                  : timer.kind === 'end'
                    ? `Pauses at the end of ${model.playback.currentItem?.name ?? 'this item'}`
                    : 'Playback paused by the sleep timer.'}
              </p>
            ) : null}
            <div class='grid grid-cols-3 gap-2'>
              {list([5, 10, 15, 30, 45, 60], (minutes) => (
                <button type='button' class={button} onClick={() => model.actions.apply(minutes)}>
                  {minutes === 60 ? '1 hour' : `${minutes} min`}
                </button>
              ))}
            </div>
            <button
              type='button'
              disabled={model.playback.loop?.end != null}
              class={`${button} mt-2 w-full`}
              onClick={() => model.actions.apply('end')}
            >
              End of this item
            </button>
            {model.playback.loop?.end != null ? (
              <p class='mt-1 text-xs text-muted-foreground'>
                Turn off A–B repeat to use the end-of-item timer.
              </p>
            ) : null}
            <form
              class='mt-3 flex items-center gap-2'
              onSubmit={(event) => {
                event.preventDefault()
                model.actions.apply(Number(model.minutes))
              }}
            >
              <label class='flex min-w-0 flex-1 items-center gap-2 text-sm'>
                Minutes{' '}
                <input
                  type='number'
                  min='1'
                  max='1440'
                  step='1'
                  aria-label='Timer minutes'
                  class='min-w-0 w-full rounded-md border border-input bg-background px-2 py-2'
                  value={model.minutes}
                  onInput={(event) => model.actions.minutes(event.currentTarget.value)}
                />
              </label>
              <button type='submit' class={button}>
                Set timer
              </button>
            </form>
            {model.error ? (
              <p role='alert' class='mt-2 text-sm text-destructive'>
                {model.error}
              </p>
            ) : null}
            <p class='mt-3 text-xs text-muted-foreground'>
              The clock keeps running while paused. Closing or reloading this player clears the
              timer.
            </p>
            {timer ? (
              <button
                type='button'
                class={`${button} mt-3 w-full`}
                onClick={() => model.actions.apply(null)}
              >
                {timer.kind === 'expired' ? 'Dismiss timer' : 'Cancel timer'}
              </button>
            ) : null}
          </section>
        </div>
      </Portal>
    )
  }),
)
