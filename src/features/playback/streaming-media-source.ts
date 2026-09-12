import type { PlaybackMediaElement } from './media-element-host'
import type { PlaybackSource } from './types'

function waitForEvent(target: EventTarget, name: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      target.removeEventListener(name, finish)
      signal.removeEventListener('abort', cancel)
    }
    const finish = () => {
      cleanup()
      resolve()
    }
    const cancel = () => {
      cleanup()
      reject(signal.reason)
    }
    target.addEventListener(name, finish, { once: true })
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
  })
}

function updateBuffer(
  buffer: SourceBuffer,
  signal: AbortSignal,
  action: () => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      buffer.removeEventListener('updateend', finish)
      buffer.removeEventListener('error', fail)
      signal.removeEventListener('abort', cancel)
    }
    const finish = () => {
      cleanup()
      resolve()
    }
    const fail = () => {
      cleanup()
      reject(new Error('The browser could not decode the playback stream.'))
    }
    const cancel = () => {
      cleanup()
      reject(signal.reason)
    }
    buffer.addEventListener('updateend', finish, { once: true })
    buffer.addEventListener('error', fail, { once: true })
    signal.addEventListener('abort', cancel, { once: true })
    try {
      signal.throwIfAborted()
      action()
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}

function waitForPlayback(element: PlaybackMediaElement, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      element.removeEventListener('timeupdate', finish)
      element.removeEventListener('seeking', finish)
      signal.removeEventListener('abort', cancel)
    }
    const finish = () => {
      cleanup()
      resolve()
    }
    const cancel = () => {
      cleanup()
      reject(signal.reason)
    }
    element.addEventListener('timeupdate', finish)
    element.addEventListener('seeking', finish)
    signal.addEventListener('abort', cancel, { once: true })
    if (signal.aborted) cancel()
  })
}

export function createStreamingMediaSource(
  element: PlaybackMediaElement,
  source: PlaybackSource,
  onBuffer: () => void,
  onError: (message?: string) => void,
): { url: string; readonly duration: number | undefined; dispose: () => void } {
  const media = new MediaSource()
  const controller = new AbortController()
  const { signal } = controller
  const url = URL.createObjectURL(media)
  let finalDuration: number | undefined
  const closed = () => controller.abort()
  media.addEventListener('sourceclose', closed, { once: true })

  async function read() {
    await waitForEvent(media, 'sourceopen', signal)
    const buffer = media.addSourceBuffer(source.mimeType!)
    if (source.duration) media.duration = source.duration
    const response = await fetch(source.url, { signal })
    if (!response.ok) {
      const result = (await response.json().catch(() => null)) as { error?: string } | null
      onError(result?.error ?? `Playback request failed (${response.status}).`)
      return
    }
    if (!response.body) throw new Error('The playback stream is empty.')
    const reader = response.body.getReader()
    try {
      while (!signal.aborted) {
        const ranges = buffer.buffered
        const position = Math.max(element.currentTime, source.initialPosition ?? 0)
        if (ranges.length && ranges.end(ranges.length - 1) - position > 45) {
          await waitForPlayback(element, signal)
          continue
        }
        if (ranges.length && position - ranges.start(0) > 30) {
          await updateBuffer(buffer, signal, () => buffer.remove(ranges.start(0), position - 15))
        }
        const { value, done } = await reader.read()
        if (done) break
        await updateBuffer(buffer, signal, () => buffer.appendBuffer(value))
        onBuffer()
      }
      if (!signal.aborted && media.readyState === 'open') {
        media.endOfStream()
        if (Number.isFinite(media.duration)) finalDuration = media.duration
        onBuffer()
      }
    } finally {
      await reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
  }
  void read().catch(() => {
    if (!signal.aborted) onError()
  })
  return {
    url,
    get duration() {
      return finalDuration
    },
    dispose() {
      controller.abort()
      media.removeEventListener('sourceclose', closed)
      URL.revokeObjectURL(url)
    },
  }
}
