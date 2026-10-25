import { randomId } from '@/lib/random-id'

export type MediaFocusSource = {
  isPlaying: () => boolean
  pause: () => void
  subscribe: (listener: () => void) => () => void
}
export function createMediaFocus(source: MediaFocusSource) {
  if (typeof BroadcastChannel === 'undefined') return { dispose: () => undefined }
  const channel = new BroadcastChannel('derp-desktop-media-focus')
  const id = randomId()
  let clock = 0
  let claim = 0
  let playing = false
  const update = () => {
    const next = source.isPlaying()
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
      source.isPlaying() &&
      (data.time > claim || (data.time === claim && data.id > id))
    )
      source.pause()
  }
  const stop = source.subscribe(update)
  update()
  return {
    dispose: () => {
      stop()
      channel.close()
    },
  }
}
