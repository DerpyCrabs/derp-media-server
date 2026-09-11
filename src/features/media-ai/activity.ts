import type { PlaybackCommand, PlaybackSession } from '@/features/playback/types'

export function createActivityId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

export type ActivityEvent = {
  id: string
  path: string
  kind: string
  source: string
  seq: number
  start: number
  end: number
  seconds: number
  duration: number
  hour: number
  completed: boolean
  excluded: boolean
  mode?: string
}
let current: { id: string; exclude: () => void } | undefined
export function currentActivityId() {
  return current?.id
}
export function excludeCurrentActivity() {
  current?.exclude()
}
const pending: ActivityEvent[] = []
let sending = false
function persist() {
  try {
    sessionStorage.setItem('media-activity-pending', JSON.stringify(pending.slice(-100)))
  } catch {}
}
async function drain() {
  if (sending) return
  sending = true
  try {
    while (pending.length) {
      const response = await fetch('/api/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(pending[0]),
        keepalive: true,
      })
      if (!response.ok && response.status >= 500) break
      pending.shift()
      persist()
    }
  } catch {
  } finally {
    sending = false
  }
}
export function sendActivity(event: ActivityEvent) {
  pending.push(event)
  if (pending.length > 100) pending.shift()
  persist()
  void drain()
}
export function restoreActivityQueue() {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem('media-activity-pending') || '[]')
    if (Array.isArray(saved))
      pending.push(
        ...saved
          .filter(
            (v): v is ActivityEvent =>
              v &&
              typeof v.id === 'string' &&
              typeof v.end === 'number' &&
              Date.now() - v.end < 86_400_000,
          )
          .slice(-100),
      )
  } catch {}
  void drain()
  const timer = window.setInterval(() => void drain(), 10_000)
  return () => window.clearInterval(timer)
}

export function trackPlayback(
  session: PlaybackSession,
  emit: (event: ActivityEvent) => void = sendActivity,
  now: () => number = Date.now,
  onEarlySkip: (event: { id: string; path: string }) => void = () => {},
): PlaybackSession {
  let event: ActivityEvent | undefined
  let lastTime = now()
  let lastPosition = 0
  let buffering = false
  let heardSeconds = 0
  function flush(completed = false) {
    if (!event) return
    const end = now()
    // Long pauses have no playback seconds and must not expand reported intervals.
    const start = Math.max(event.start, end - 30_000)
    emit({
      ...event,
      start,
      end,
      completed,
      duration: session.getSnapshot().duration,
      mode: session.getSnapshot().mode,
    })
    event.seq += 1
    event.start = end
    event.seconds = 0
  }
  function begin(source: string) {
    const item = session.getSnapshot().currentItem
    if (!item) {
      event = undefined
      current = undefined
      return
    }
    const at = now()
    buffering = false
    heardSeconds = 0
    event = {
      id: createActivityId(),
      path: item.locator,
      kind: item.media,
      source,
      seq: 0,
      start: at,
      end: at,
      seconds: 0,
      duration: 0,
      hour: new Date(at).getHours(),
      completed: false,
      excluded: false,
    }
    current = {
      id: event.id,
      exclude() {
        if (event) {
          event.excluded = true
          flush()
        }
      },
    }
    lastTime = at
    lastPosition = session.getSnapshot().position
    flush()
  }
  function dispatch(command: PlaybackCommand) {
    const before = session.getSnapshot()
    const at = now()
    const valid = !('generation' in command) || command.generation === before.source?.generation
    if (valid && command.type === 'mediaTime' && event) {
      const wall = Math.max(0, (at - lastTime) / 1000)
      const advance = command.position - lastPosition
      if (
        !buffering &&
        before.phase === 'playing' &&
        wall <= 10 &&
        advance > 0 &&
        advance <= wall * 4 + 0.25
      ) {
        event.seconds += wall
        heardSeconds += wall
      }
      lastTime = at
      lastPosition = command.position
      if (at - event.start >= 5000) flush()
    }
    if (valid && command.type === 'mediaBuffering') {
      flush()
      buffering = command.buffering
    }
    if (valid && command.type === 'mediaEnded') flush(true)
    if (
      [
        'pause',
        'mediaPause',
        'stop',
        'destroy',
        'checkpoint',
        'load',
        'next',
        'previous',
        'selectQueueItem',
        'removeQueueItem',
        'setMode',
        'seek',
      ].includes(command.type)
    )
      flush()
    const skipped =
      command.type === 'next' &&
      event &&
      !event.excluded &&
      before.currentItem?.media === 'audio' &&
      before.desiredPlaying &&
      heardSeconds >= 2 &&
      heardSeconds < Math.min(30, before.duration > 0 ? before.duration / 4 : 30)
        ? { id: event.id, path: event.path }
        : null
    const outcome = session.dispatch(command)
    if (outcome.accepted && skipped && session.getSnapshot().currentItem?.locator !== skipped.path)
      onEarlySkip(skipped)
    if (!outcome.accepted) return outcome
    const after = session.getSnapshot()
    if (
      after.currentItem?.locator !== event?.path ||
      (valid && command.type === 'mediaEnded' && after.desiredPlaying) ||
      (['play', 'toggle', 'mediaPlay'].includes(command.type) &&
        valid &&
        before.phase === 'ended' &&
        after.desiredPlaying)
    ) {
      if (after.source || command.type === 'load')
        begin(
          command.type === 'mediaEnded'
            ? before.repeat
              ? 'repeat'
              : 'autoplay'
            : command.type === 'next' || command.type === 'previous'
              ? 'queued'
              : 'chosen',
        )
    }
    if (command.type !== 'mediaTime') {
      lastPosition = after.position
      lastTime = now()
    }
    if (!after.currentItem || command.type === 'destroy') {
      event = undefined
      current = undefined
    }
    return outcome
  }
  return {
    getSnapshot: () => session.getSnapshot(),
    subscribe: (listener) => session.subscribe(listener),
    dispatch,
  }
}
