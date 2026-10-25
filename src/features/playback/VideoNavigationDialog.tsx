import { controllerView, list, modelOwner, view } from 'effectweb'
import { modalFocus } from '@/lib/ui/modal-focus'
import type { PlaybackLoop } from './types'
import { chapterAt, parsePlaybackTime, precisePlaybackTime } from './video-navigation'
type Props = {
  position: number
  duration: number
  chapters: readonly { start: number; title: string }[]
  loop: PlaybackLoop | null
  onSeek: (position: number) => void
  onLoop: (loop: PlaybackLoop | null) => void
  onClose: () => void
}
function controller(props: Props) {
  const owner = modelOwner({
    props,
    time: precisePlaybackTime(props.position),
    start: precisePlaybackTime(props.loop?.start ?? props.position),
    end: props.loop?.end == null ? '' : precisePlaybackTime(props.loop.end),
    filter: '',
    limit: 100,
    error: '',
  })
  return {
    source: owner.source,
    time: (time: string) => owner.patch({ time, error: '' }),
    start: (start: string) => owner.patch({ start, error: '' }),
    end: (end: string) => owner.patch({ end, error: '' }),
    filter: (filter: string) => owner.patch({ filter, limit: 100 }),
    more: () => owner.patch({ limit: owner.read().limit + 100 }),
    current: (point: 'start' | 'end') =>
      owner.patch({ [point]: precisePlaybackTime(owner.read().props.position), error: '' }),
    jump: () => {
      const m = owner.read(),
        time = parsePlaybackTime(m.time)
      if (time === null || time > m.props.duration) {
        owner.patch({
          error: `Enter a time between 0:00 and ${precisePlaybackTime(m.props.duration)}.`,
        })
        return
      }
      m.props.onSeek(time)
      m.props.onClose()
    },
    apply: () => {
      const m = owner.read(),
        start = parsePlaybackTime(m.start),
        end = parsePlaybackTime(m.end)
      if (start === null || end === null || end - start < 0.25 || end > m.props.duration) {
        owner.patch({ error: 'Set a start and end within the video, at least 0.25 seconds apart.' })
        return
      }
      m.props.onLoop({ start, end })
      owner.patch({ error: '' })
    },
    clear: () => {
      owner.read().props.onLoop(null)
      owner.patch({ error: '' })
    },
    receive: (next: Props) => owner.patch({ props: next }),
    lifetime: owner,
  }
}
const input =
  'min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-sm tabular-nums'
const button =
  'rounded-md border border-input px-2 py-1.5 text-sm hover:bg-accent disabled:opacity-40'
export const VideoNavigationDialog = controllerView(
  { controller },
  view((model) => {
    const { actions, props } = model
    const current = chapterAt(props.chapters, props.position)
    const matches = props.chapters
      .map((chapter, index) => ({ ...chapter, index }))
      .filter(
        (chapter) =>
          !model.filter ||
          chapter.title.toLocaleLowerCase().includes(model.filter.toLocaleLowerCase()),
      )
    return (
      <div
        class='fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-3'
        onClick={(event) => {
          if (event.target === event.currentTarget) props.onClose()
        }}
      >
        <section
          role='dialog'
          aria-modal='true'
          aria-label='Video navigation'
          class='flex max-h-[calc(100dvh-1.5rem)] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-2xl'
          use={modalFocus({ onEscape: props.onClose })}
        >
          <header class='flex shrink-0 items-center justify-between border-b border-border px-4 py-3'>
            <h2 class='text-base font-medium'>Video navigation</h2>
            <button class='rounded px-2 py-1 text-sm hover:bg-accent' onClick={props.onClose}>
              Close
            </button>
          </header>
          <div class='min-h-0 space-y-4 overflow-y-auto p-4'>
            <form
              class='space-y-2'
              onSubmit={(event) => {
                event.preventDefault()
                actions.jump()
              }}
            >
              <label class='block text-sm' for='video-jump-time'>
                Go to time
              </label>
              <div class='flex gap-2'>
                <input
                  id='video-jump-time'
                  autofocus
                  class={`${input} flex-1`}
                  value={model.time}
                  placeholder='h:mm:ss.mmm'
                  onInput={(event) => actions.time(event.currentTarget.value)}
                />
                <button type='submit' class={button}>
                  Go
                </button>
              </div>
              <p class='text-xs text-muted-foreground'>
                Seconds, m:ss or h:mm:ss · Duration {precisePlaybackTime(props.duration)}
              </p>
            </form>
            {props.chapters.length ? (
              <div class='space-y-2'>
                <h3 class='text-sm font-medium'>Chapters</h3>
                {props.chapters.length > 8 ? (
                  <input
                    type='search'
                    aria-label='Filter chapters'
                    placeholder='Filter chapters…'
                    class={`${input} w-full`}
                    value={model.filter}
                    onInput={(event) => actions.filter(event.currentTarget.value)}
                  />
                ) : null}
                <div class='max-h-52 overflow-y-auto rounded-md border border-border'>
                  {list(
                    matches.slice(0, model.limit),
                    (chapter) => chapter.index,
                    (chapter) => (
                      <button
                        class='flex w-full items-center gap-3 px-2 py-2 text-left text-sm hover:bg-accent aria-current:bg-accent'
                        aria-current={chapter.index === current ? 'true' : undefined}
                        onClick={() => {
                          props.onSeek(chapter.start)
                          props.onClose()
                        }}
                      >
                        <span class='shrink-0 text-xs tabular-nums text-muted-foreground'>
                          {precisePlaybackTime(chapter.start)}
                        </span>
                        <span class='truncate'>{chapter.title}</span>
                      </button>
                    ),
                  )}
                  {!matches.length ? (
                    <p class='p-2 text-sm text-muted-foreground'>No matching chapters.</p>
                  ) : null}
                </div>
                {matches.length > model.limit ? (
                  <button class={button} onClick={actions.more}>
                    Show more chapters
                  </button>
                ) : null}
              </div>
            ) : null}
            <div class='space-y-2 border-t border-border pt-3'>
              <div class='flex items-center justify-between gap-2'>
                <h3 class='text-sm font-medium'>Repeat a section</h3>
                {props.loop?.end != null ? (
                  <span class='text-xs text-primary'>A–B active</span>
                ) : null}
              </div>
              <div class='grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2'>
                <label class='text-sm' for='video-loop-start'>
                  A
                </label>
                <input
                  id='video-loop-start'
                  aria-label='Loop start'
                  class={input}
                  value={model.start}
                  onInput={(event) => actions.start(event.currentTarget.value)}
                />
                <button class={button} onClick={() => actions.current('start')}>
                  Set A here
                </button>
                <label class='text-sm' for='video-loop-end'>
                  B
                </label>
                <input
                  id='video-loop-end'
                  aria-label='Loop end'
                  class={input}
                  placeholder='End time'
                  value={model.end}
                  onInput={(event) => actions.end(event.currentTarget.value)}
                />
                <button class={button} onClick={() => actions.current('end')}>
                  Set B here
                </button>
              </div>
              <div class='flex gap-2'>
                <button class={button} onClick={actions.apply}>
                  Repeat A–B
                </button>
                {props.loop ? (
                  <button class={button} onClick={actions.clear}>
                    Clear repeat
                  </button>
                ) : null}
              </div>
              <p class='text-xs text-muted-foreground'>
                Shift+L sets A, then B, then clears the repeat. Seeking outside the section clears
                it.
              </p>
            </div>
            {model.error ? (
              <p role='alert' class='text-sm text-destructive'>
                {model.error}
              </p>
            ) : null}
          </div>
        </section>
      </div>
    )
  }),
)
