import type { PlaybackMode, PlaybackSession } from './types'

export type PlaybackMediaEvent =
  | 'loadedmetadata'
  | 'canplay'
  | 'durationchange'
  | 'timeupdate'
  | 'play'
  | 'playing'
  | 'waiting'
  | 'stalled'
  | 'pause'
  | 'seeking'
  | 'seeked'
  | 'volumechange'
  | 'ended'
  | 'error'

export interface PlaybackMediaElement {
  src: string
  readonly currentSrc: string
  currentTime: number
  readonly duration: number
  readonly paused: boolean
  readonly seeking: boolean
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
  seeking: boolean
  resumeAfterSeek: boolean
  nativePausePending: boolean
  playPending: boolean
  playRequest: symbol | null
  hasStarted: boolean
  lastMediaPosition: number
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
  const inactive = new Set<Attachment>()
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
    attachment.nativePausePending = false
    attachment.playPending = false
    attachment.playRequest = null
    attachment.hasStarted = false
    attachment.lastMediaPosition = 0
    withSuppressedEvents(attachment, () => {
      if (!attachment.element.paused) attachment.element.pause()
      if (attachment.element.src || attachment.element.currentSrc) {
        attachment.element.removeAttribute('src')
        attachment.element.load()
      }
    })
  }

  function play(attachment: Attachment) {
    if (attachment.playPending || !attachment.element.paused) return
    const request = Symbol('play')
    attachment.playRequest = request
    attachment.playPending = true
    const finish = () => {
      if (active !== attachment || attachment.playRequest !== request) return false
      attachment.playRequest = null
      attachment.playPending = false
      return true
    }
    const failed = (error: unknown) => {
      if (!finish() || !sourceMatches(attachment)) return
      session.dispatch({
        type: 'mediaError',
        generation: attachment.generation,
        message: error instanceof Error ? error.message : 'Playback failed.',
      })
    }
    try {
      void attachment.element.play().then(finish, failed)
    } catch (error) {
      failed(error)
    }
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
        attachment.nativePausePending = false
        attachment.playPending = false
        attachment.playRequest = null
        attachment.hasStarted = false
        attachment.lastMediaPosition = snapshot.position
        element.src = source.url
        element.load()
        if (snapshot.position > 0) {
          try {
            element.currentTime = snapshot.position
          } catch {}
        }
      })
    } else if (
      Math.abs(snapshot.position - attachment.lastMediaPosition) > 0.01 &&
      Math.abs(element.currentTime - snapshot.position) > 0.75
    ) {
      try {
        element.currentTime = snapshot.position
        attachment.lastMediaPosition = snapshot.position
      } catch {}
    }

    if (snapshot.desiredPlaying && snapshot.phase === 'ready' && element.paused) {
      play(attachment)
    }
    if (!snapshot.desiredPlaying && !element.paused) {
      withSuppressedEvents(attachment, () => element.pause())
    }
  }

  function capturePosition(attachment: Attachment) {
    if (!sourceMatches(attachment)) return
    attachment.lastMediaPosition = attachment.element.currentTime
    const duration = finiteDuration(attachment.element)
    session.dispatch({
      type: 'mediaTime',
      generation: attachment.generation,
      position: attachment.element.currentTime,
      ...(duration === undefined ? {} : { duration }),
    })
  }

  function removeAttachment(attachment: Attachment, clear = true) {
    capturePosition(attachment)
    if (!clear && !attachment.element.paused) {
      withSuppressedEvents(attachment, () => attachment.element.pause())
    }
    for (const [type, listener] of attachment.listeners) {
      attachment.element.removeEventListener(type, listener)
    }
    if (clear) clearElement(attachment)
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
    const previous = active
    if (previous) {
      active = null
      removeAttachment(previous, false)
      inactive.add(previous)
    }
    const token = Symbol('playback-media-element')
    const attachment: Attachment = {
      element,
      mode,
      token,
      generation: 0,
      sourceUrl: '',
      suppressEvents: false,
      repeating: false,
      seeking: false,
      resumeAfterSeek: false,
      nativePausePending: false,
      playPending: false,
      playRequest: null,
      hasStarted: false,
      lastMediaPosition: 0,
      listeners: [],
    }

    const validEvent = () =>
      active === attachment &&
      !attachment.suppressEvents &&
      attachment.generation > 0 &&
      sourceMatches(attachment)

    const onReady: EventListener = () => {
      if (!validEvent()) return
      const snapshot = session.getSnapshot()
      if (snapshot.position > 0 && Math.abs(element.currentTime - snapshot.position) > 0.01) {
        try {
          element.currentTime = snapshot.position
          attachment.lastMediaPosition = snapshot.position
        } catch {}
      }
      const duration = finiteDuration(element)
      if (duration !== undefined) {
        session.dispatch({ type: 'mediaDuration', generation: attachment.generation, duration })
      }
      session.dispatch({ type: 'mediaReady', generation: attachment.generation })
      const readySnapshot = session.getSnapshot()
      if (readySnapshot.desiredPlaying && readySnapshot.phase === 'ready' && element.paused) {
        play(attachment)
      }
    }
    const onDurationChange: EventListener = () => {
      if (!validEvent()) return
      const duration = finiteDuration(element)
      if (duration !== undefined) {
        session.dispatch({ type: 'mediaDuration', generation: attachment.generation, duration })
      }
    }
    const onTimeUpdate: EventListener = () => {
      if (!validEvent()) return
      capturePosition(attachment)
    }
    const onPlay: EventListener = () => {
      if (!validEvent()) return
      const state = session.getSnapshot()
      const internalPlayPending = attachment.playPending
      attachment.playPending = true
      if (!state.desiredPlaying) {
        if (
          !internalPlayPending &&
          (attachment.nativePausePending ||
            (attachment.mode === 'video' && !attachment.playRequest))
        ) {
          attachment.nativePausePending = false
          session.dispatch({ type: 'mediaPlay', generation: attachment.generation })
          return
        }
        if (!element.paused) {
          withSuppressedEvents(attachment, () => element.pause())
        }
        attachment.playPending = false
        return
      }
      attachment.nativePausePending = false
      attachment.repeating = state.repeat
      session.dispatch({ type: 'mediaPlay', generation: attachment.generation })
    }
    const onPlaying: EventListener = () => {
      if (!validEvent()) return
      attachment.hasStarted = true
      attachment.playPending = false
      session.dispatch({
        type: 'mediaBuffering',
        generation: attachment.generation,
        buffering: false,
      })
    }
    const onBuffering: EventListener = () => {
      if (validEvent())
        session.dispatch({
          type: 'mediaBuffering',
          generation: attachment.generation,
          buffering: true,
        })
    }
    const onSeeking: EventListener = () => {
      if (!validEvent()) return
      onBuffering(new Event('waiting'))
      capturePosition(attachment)
      attachment.seeking = true
      const state = session.getSnapshot()
      attachment.resumeAfterSeek =
        attachment.resumeAfterSeek ||
        (state.desiredPlaying && attachment.hasStarted && (!element.paused || element.seeking))
    }
    const onSeeked: EventListener = () => {
      if (!validEvent()) return
      capturePosition(attachment)
      session.dispatch({
        type: 'mediaBuffering',
        generation: attachment.generation,
        buffering: false,
      })
      const shouldResume = attachment.resumeAfterSeek
      attachment.seeking = false
      attachment.resumeAfterSeek = false
      if (shouldResume && session.getSnapshot().desiredPlaying && element.paused) {
        play(attachment)
      }
    }
    const onVolumeChange: EventListener = () => {
      if (!validEvent()) return
      session.dispatch({
        type: 'mediaVolume',
        generation: attachment.generation,
        volume: element.volume,
        muted: element.muted,
      })
    }
    const onPause: EventListener = () => {
      if (!validEvent()) return
      const playPending = attachment.playPending
      attachment.playPending = false
      const state = session.getSnapshot()
      if (!attachment.hasStarted && playPending && state.desiredPlaying) return
      if (element.seeking && state.desiredPlaying && attachment.hasStarted) {
        attachment.seeking = true
        attachment.resumeAfterSeek = true
        return
      }
      if (
        attachment.seeking &&
        (attachment.resumeAfterSeek || playPending || !attachment.hasStarted)
      ) {
        return
      }
      if (state.desiredPlaying) attachment.nativePausePending = true
      if (!state.repeat) attachment.repeating = false
      if (state.repeat && state.desiredPlaying) {
        const wasRepeating = attachment.repeating
        attachment.repeating = true
        if (wasRepeating) play(attachment)
        return
      }
      if (attachment.repeating) return
      session.dispatch({ type: 'mediaPause', generation: attachment.generation })
    }
    const onEnded: EventListener = () => {
      if (!validEvent()) return
      const repeat = session.getSnapshot().repeat
      attachment.repeating = repeat
      const eventGeneration = attachment.generation
      session.dispatch({ type: 'mediaEnded', generation: eventGeneration })
      if (!repeat || active !== attachment || attachment.generation !== eventGeneration) return
      try {
        element.currentTime = 0
      } catch {}
      play(attachment)
    }
    const onError: EventListener = () => {
      if (!validEvent()) return
      const code = element.error?.code
      session.dispatch({
        type: 'mediaError',
        generation: attachment.generation,
        message: code ? `Playback failed (media error ${code}).` : 'Playback failed.',
      })
    }
    const listeners: Array<readonly [PlaybackMediaEvent, EventListener]> = [
      ['loadedmetadata', onReady],
      ['canplay', onReady],
      ['durationchange', onDurationChange],
      ['timeupdate', onTimeUpdate],
      ['play', onPlay],
      ['playing', onPlaying],
      ['waiting', onBuffering],
      ['stalled', onBuffering],
      ['pause', onPause],
      ['seeking', onSeeking],
      ['seeked', onSeeked],
      ['volumechange', onVolumeChange],
      ['ended', onEnded],
      ['error', onError],
    ]
    attachment.listeners = listeners
    for (const [type, listener] of listeners) element.addEventListener(type, listener)
    active = attachment
    sync()

    return () => {
      if (active?.token === token) {
        detach()
      } else if (inactive.delete(attachment)) {
        clearElement(attachment)
      }
    }
  }

  const unsubscribe = session.subscribe(sync)
  return Object.freeze({
    attach,
    detach,
    dispose() {
      if (disposed) return
      detach()
      for (const attachment of inactive) clearElement(attachment)
      inactive.clear()
      disposed = true
      unsubscribe()
    },
  })
}
