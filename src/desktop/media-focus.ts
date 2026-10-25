import { randomId } from '@/lib/random-id'
import type { PlaybackSession } from '@/features/playback'

export function createDesktopMediaFocus(session: PlaybackSession) {
  if (typeof BroadcastChannel === 'undefined') return { dispose: () => undefined }
  const channel = new BroadcastChannel('derp-desktop-media-focus')
  const id = randomId()
  let clock = 0
  let claim = 0
  let playing = false
  const update = () => {
    const next = session.getSnapshot().desiredPlaying
    if (next && !playing) {
      claim = clock = Math.max(Date.now(), clock + 1)
      channel.postMessage({ id, time: claim })
    }
    playing = next
  }
  channel.onmessage = (event: MessageEvent<unknown>) => {
    const data = event.data
    if (
      !data ||
      typeof data !== 'object' ||
      !('id' in data) ||
      typeof data.id !== 'string' ||
      !('time' in data) ||
      typeof data.time !== 'number' ||
      !Number.isFinite(data.time)
    )
      return
    clock = Math.max(clock, data.time)
    if (
      data.id !== id &&
      session.getSnapshot().desiredPlaying &&
      (data.time > claim || (data.time === claim && data.id > id))
    )
      session.dispatch({ type: 'pause' })
  }
  const stop = session.subscribe(update)
  update()
  return {
    dispose: () => {
      stop()
      channel.close()
    },
  }
}
