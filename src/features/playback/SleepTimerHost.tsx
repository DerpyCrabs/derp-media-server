import { Input } from '@/lib/ui/input'
import { Button } from '@/lib/ui/button'
import { controllerView, list, modelOwner, view } from 'effectweb'
import { Dialog } from '@/lib/ui/dialog'
import { getPlaybackSession } from './PlaybackProvider'
import { formatPlaybackTime } from './audio'
import { onSleepTimer } from './sleep-timer'
function controller() {
  const session = getPlaybackSession()
  const owner = modelOwner({
    open: false,
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
    onSleepTimer(() => {
      if (!session.getSnapshot().currentItem) return
      clearInterval(interval)
      owner.patch({ open: true, error: '', now: Date.now() })
      interval = setInterval(() => owner.patch({ now: Date.now() }), 1000)
    }),
  )
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
    return (
      <Dialog
        open={model.open}
        onOpenChange={(open) => {
          if (!open) model.actions.close()
        }}
        title='Sleep timer'
      >
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
            <Button variant='outline' type='button' onClick={() => model.actions.apply(minutes)}>
              {minutes === 60 ? '1 hour' : `${minutes} min`}
            </Button>
          ))}
        </div>
        <Button
          variant='outline'
          type='button'
          class='w-full'
          onClick={() => model.actions.apply('end')}
        >
          End of this item
        </Button>
        <form
          class='mt-3 flex items-center gap-2'
          onSubmit={(event) => {
            event.preventDefault()
            model.actions.apply(Number(model.minutes))
          }}
        >
          <label class='flex min-w-0 flex-1 items-center gap-2 text-sm'>
            Minutes{' '}
            <Input
              type='number'
              min='1'
              max='1440'
              step='1'
              aria-label='Timer minutes'
              class='min-w-0 w-full'
              value={model.minutes}
              onInput={(event) => model.actions.minutes(event.currentTarget.value)}
            />
          </label>
          <Button variant='default' type='submit'>
            Set timer
          </Button>
        </form>
        {model.error ? (
          <p role='alert' class='mt-2 text-sm text-destructive'>
            {model.error}
          </p>
        ) : null}
        {timer ? (
          <Button
            variant='ghost'
            type='button'
            class='w-full'
            onClick={() => model.actions.apply(null)}
          >
            {timer.kind === 'expired' ? 'Dismiss timer' : 'Cancel timer'}
          </Button>
        ) : null}
      </Dialog>
    )
  }),
)
