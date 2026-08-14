import type { PlaybackMode, PlaybackSession } from './types'

export type PlaybackMediaEvent =
  | 'loadedmetadata'
  | 'canplay'
  | 'durationchange'
  | 'timeupdate'
  | 'play'
  | 'pause'
  | 'ended'
  | 'error'

export interface PlaybackMediaElement {
  src: string
  readonly currentSrc: string
  currentTime: number
  readonly duration: number
  readonly paused: boolean
  volume: number
  muted: boolean
  readonly error: { readonly code: number } | null
  play(): Promise<void>
  pause(): void
  load(): void
  removeAttribute(name: string): void
  addEventListener(type: PlaybackMediaEvent, listener: EventListener): void
  removeEventListener(type: PlaybackMediaEvent, listener: EventListener): void
}

export interface MediaElementHost {
  attach(element: PlaybackMediaElement, mode: PlaybackMode): () => void
  detach(): void
  dispose(): void
}

type Attachment = {
  element: PlaybackMediaElement
  mode: PlaybackMode
  token: symbol
  generation: number
  sourceUrl: string
  suppressEvents: boolean
  repeating: boolean
  listeners: ReadonlyArray<readonly [PlaybackMediaEvent, EventListener]>
}

function finiteDuration(element: PlaybackMediaElement): number | undefined {
  return Number.isFinite(element.duration) && element.duration >= 0 ? element.duration : undefined
}

function sameUrl(left: string, right: string): boolean {
  if (left === right) return true
  try {
    const base = typeof document === 'undefined' ? undefined : document.baseURI
    if (!base) return false
    return new URL(left, base).href === new URL(right, base).href
  } catch {
    return false
  }
}

export function createMediaElementHost(session: PlaybackSession): MediaElementHost {
  let active: Attachment | null = null
  let disposed = false

  function sourceMatches(attachment: Attachment): boolean {
    const source = session.getSnapshot().source
    if (!source || source.generation !== attachment.generation) return false
    const elementUrl = attachment.element.currentSrc || attachment.element.src
    return !!elementUrl && sameUrl(elementUrl, attachment.sourceUrl)
  }

  function withSuppressedEvents(attachment: Attachment, action: () => void) {
    attachment.suppressEvents = true
    try {
      action()
    } finally {
      attachment.suppressEvents = false
    }
  }

  function clearElement(attachment: Attachment) {
    attachment.generation = 0
    attachment.sourceUrl = ''
    withSuppressedEvents(attachment, () => {
      if (!attachment.element.paused) attachment.element.pause()
      if (attachment.element.src || attachment.element.currentSrc) {
        attachment.element.removeAttribute('src')
        attachment.element.load()
      }
    })
  }

  function play(element: PlaybackMediaElement) {
    void element.play().catch(() => undefined)
  }

  function sync() {
    const attachment = active
    if (!attachment || disposed) return
    const snapshot = session.getSnapshot()
    const element = attachment.element
    element.volume = snapshot.volume
    element.muted = snapshot.muted

    if (snapshot.phase === 'destroyed' || !snapshot.source || snapshot.mode !== attachment.mode) {
      if (attachment.generation || attachment.sourceUrl) clearElement(attachment)
      return
    }

    const source = snapshot.source
    const sourceChanged =
      attachment.generation !== source.generation || !sameUrl(attachment.sourceUrl, source.url)
    if (sourceChanged) {
      withSuppressedEvents(attachment, () => {
        if (!element.paused) element.pause()
        attachment.generation = source.generation
        attachment.sourceUrl = source.url
        element.src = source.url
        element.load()
        if (snapshot.position > 0) {
          try {
            element.currentTime = snapshot.position
          } catch {}
        }
      })
    } else if (Math.abs(element.currentTime - snapshot.position) > 0.75) {
      try {
        element.currentTime = snapshot.position
      } catch {}
    }

    if (snapshot.desiredPlaying && element.paused) play(element)
    if (!snapshot.desiredPlaying && !element.paused) {
      withSuppressedEvents(attachment, () => element.pause())
    }
  }

  function capturePosition(attachment: Attachment) {
    if (!sourceMatches(attachment)) return
    session.dispatch({
      type: 'mediaTime',
      generation: attachment.generation,
      position: attachment.element.currentTime,
      ...(finiteDuration(attachment.element) === undefined
        ? {}
        : { duration: finiteDuration(attachment.element) }),
    })
  }

  function removeAttachment(attachment: Attachment) {
    capturePosition(attachment)
    for (const [type, listener] of attachment.listeners) {
      attachment.element.removeEventListener(type, listener)
    }
    clearElement(attachment)
    session.dispatch({ type: 'checkpoint' })
  }

  function detach() {
    const attachment = active
    if (!attachment) return
    active = null
    removeAttachment(attachment)
  }

  function attach(element: PlaybackMediaElement, mode: PlaybackMode): () => void {
    if (disposed) return () => undefined
    detach()
    const token = Symbol('playback-media-element')
    const attachment: Attachment = {
      element,
      mode,
      token,
      generation: 0,
      sourceUrl: '',
      suppressEvents: false,
      repeating: false,
      listeners: [],
    }

    const currentGeneration = () => attachment.generation
    const validEvent = () =>
      active === attachment &&
      !attachment.suppressEvents &&
      currentGeneration() > 0 &&
      sourceMatches(attachment)

    const onReady: EventListener = () => {
      if (!validEvent()) return
      const snapshot = session.getSnapshot()
      if (snapshot.position > 0 && Math.abs(element.currentTime - snapshot.position) > 0.01) {
        try {
          element.currentTime = snapshot.position
        } catch {}
      }
      const duration = finiteDuration(element)
      if (duration !== undefined) {
        session.dispatch({ type: 'mediaDuration', generation: currentGeneration(), duration })
      }
      session.dispatch({ type: 'mediaReady', generation: currentGeneration() })
      if (session.getSnapshot().desiredPlaying && element.paused) play(element)
    }
    const onDurationChange: EventListener = () => {
      if (!validEvent()) return
      const duration = finiteDuration(element)
      if (duration !== undefined) {
        session.dispatch({ type: 'mediaDuration', generation: currentGeneration(), duration })
      }
    }
    const onTimeUpdate: EventListener = () => {
      if (!validEvent()) return
      const duration = finiteDuration(element)
      session.dispatch({
        type: 'mediaTime',
        generation: currentGeneration(),
        position: element.currentTime,
        ...(duration === undefined ? {} : { duration }),
      })
    }
    const onPlay: EventListener = () => {
      if (!validEvent()) return
      attachment.repeating = false
      session.dispatch({ type: 'mediaPlay', generation: currentGeneration() })
    }
    const onPause: EventListener = () => {
      if (!validEvent() || attachment.repeating) return
      session.dispatch({ type: 'mediaPause', generation: currentGeneration() })
    }
    const onEnded: EventListener = () => {
      if (!validEvent()) return
      const repeat = session.getSnapshot().repeat
      attachment.repeating = repeat
      const eventGeneration = currentGeneration()
      session.dispatch({ type: 'mediaEnded', generation: eventGeneration })
      if (!repeat || active !== attachment || attachment.generation !== eventGeneration) return
      try {
        element.currentTime = 0
      } catch {}
      if (element.paused) play(element)
    }
    const onError: EventListener = () => {
      if (!validEvent()) return
      const code = element.error?.code
      session.dispatch({
        type: 'mediaError',
        generation: currentGeneration(),
        message: code ? `Playback failed (media error ${code}).` : 'Playback failed.',
      })
    }
    const listeners: Array<readonly [PlaybackMediaEvent, EventListener]> = [
      ['loadedmetadata', onReady],
      ['canplay', onReady],
      ['durationchange', onDurationChange],
      ['timeupdate', onTimeUpdate],
      ['play', onPlay],
      ['pause', onPause],
      ['ended', onEnded],
      ['error', onError],
    ]
    attachment.listeners = listeners
    for (const [type, listener] of listeners) element.addEventListener(type, listener)
    active = attachment
    sync()

    return () => {
      if (active?.token === token) detach()
    }
  }

  const unsubscribe = session.subscribe(sync)
  return Object.freeze({
    attach,
    detach,
    dispose() {
      if (disposed) return
      detach()
      disposed = true
      unsubscribe()
    },
  })
}
