import type { PlaybackFallback, PlaybackMode, PlaybackSession } from './types'
import { createStreamingMediaSource } from './streaming-media-source'

export type PlaybackMediaEvent =
  | 'loadedmetadata'
  | 'canplay'
  | 'durationchange'
  | 'progress'
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
  readonly readyState?: number
  readonly paused: boolean
  readonly seeking: boolean
  volume: number
  muted: boolean
  playbackRate: number
  readonly buffered?: TimeRanges
  readonly videoWidth?: number
  readonly webkitAudioDecodedByteCount?: number
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
  mediaUrl: string
  stream: ReturnType<typeof createStreamingMediaSource> | null
  sourceDuration: number | undefined
  errorGeneration: number | null
  handleError: () => void
  suppressEvents: boolean
  repeating: boolean
  seeking: boolean
  resumeAfterSeek: boolean
  nativePausePending: boolean
  playPending: boolean
  playRequest: symbol | null
  hasStarted: boolean
  metadataLoaded: boolean
  appliedSeekId: number | null
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
    if (
      !source ||
      session.getSnapshot().phase === 'resolving' ||
      source.generation !== attachment.generation
    )
      return false
    const elementUrl = attachment.element.currentSrc || attachment.element.src
    return !!elementUrl && sameUrl(elementUrl, attachment.mediaUrl)
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
    attachment.stream?.dispose()
    attachment.stream = null
    attachment.mediaUrl = ''
    attachment.generation = 0
    attachment.sourceUrl = ''
    attachment.sourceDuration = undefined
    attachment.errorGeneration = null
    attachment.nativePausePending = false
    attachment.playPending = false
    attachment.playRequest = null
    attachment.hasStarted = false
    attachment.metadataLoaded = false
    attachment.appliedSeekId = null
    attachment.seeking = false
    attachment.resumeAfterSeek = false
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
      if (error instanceof Error && error.name === 'AbortError') return
      if (error instanceof Error && error.name === 'NotAllowedError') {
        session.dispatch({ type: 'pause' })
        return
      }
      if (error instanceof Error && error.name === 'NotSupportedError') {
        attachment.handleError()
        return
      }
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

  function applySeek(attachment: Attachment, retry = false): boolean {
    const snapshot = session.getSnapshot()
    const pending = snapshot.pendingSeek
    if (!pending || !snapshot.source) return true
    const element = attachment.element
    const buffered = element.buffered
    const bufferedRange =
      buffered &&
      Array.from({ length: buffered.length }, (_, index) => index).find(
        (index) =>
          pending.position >= buffered.start(index) - 0.025 &&
          pending.position <= buffered.end(index) + 0.025,
      )
    const bufferedTarget = bufferedRange !== undefined
    const seekPosition =
      buffered && bufferedRange !== undefined
        ? Math.max(
            buffered.start(bufferedRange),
            Math.min(pending.position, buffered.end(bufferedRange)),
          )
        : pending.position
    if (
      snapshot.source.streaming &&
      !bufferedTarget &&
      Math.abs((snapshot.source.initialPosition ?? 0) - pending.position) > 0.01
    ) {
      session.dispatch({ type: 'refreshSource' })
      return false
    }
    if (attachment.metadataLoaded && snapshot.source.streaming && !bufferedTarget) return false
    if (
      attachment.appliedSeekId === pending.id &&
      attachment.metadataLoaded &&
      !element.seeking &&
      (element.readyState ?? 4) >= 2 &&
      Math.abs(element.currentTime - pending.position) <= 0.15
    ) {
      session.dispatch({
        type: 'mediaSeeked',
        generation: attachment.generation,
        seekId: pending.id,
        position: element.currentTime,
      })
      return true
    }
    if (attachment.appliedSeekId !== pending.id || (retry && !element.seeking)) {
      attachment.appliedSeekId = pending.id
      try {
        element.currentTime = seekPosition
      } catch {}
    }
    return false
  }

  function sync() {
    const attachment = active
    if (!attachment || disposed) return
    const snapshot = session.getSnapshot()
    const element = attachment.element
    if (element.volume !== snapshot.volume) element.volume = snapshot.volume
    if (element.muted !== snapshot.muted) element.muted = snapshot.muted
    if (element.playbackRate !== snapshot.playbackRate) element.playbackRate = snapshot.playbackRate

    if (snapshot.phase === 'resolving' && snapshot.source && snapshot.mode === attachment.mode) {
      if (!element.paused) withSuppressedEvents(attachment, () => element.pause())
      return
    }
    if (snapshot.phase === 'destroyed' || !snapshot.source || snapshot.mode !== attachment.mode) {
      if (attachment.generation || attachment.sourceUrl) clearElement(attachment)
      return
    }
    const source = snapshot.source
    if (attachment.generation !== source.generation || !sameUrl(attachment.sourceUrl, source.url)) {
      withSuppressedEvents(attachment, () => {
        attachment.stream?.dispose()
        attachment.stream = null
        attachment.playRequest = null
        attachment.playPending = false
        if (!element.paused) element.pause()
        attachment.generation = source.generation
        attachment.sourceUrl = source.url
        attachment.sourceDuration = source.duration
        attachment.errorGeneration = null
        attachment.nativePausePending = false
        attachment.hasStarted = false
        attachment.metadataLoaded = false
        attachment.appliedSeekId = null
        attachment.seeking = false
        attachment.resumeAfterSeek = false
        if (source.streaming && source.mimeType && typeof MediaSource !== 'undefined') {
          const generation = attachment.generation
          attachment.stream = createStreamingMediaSource(
            element,
            source,
            () => {
              if (!sourceMatches(attachment)) return
              const duration = attachment.stream?.duration
              if (duration !== undefined) {
                attachment.sourceDuration = duration
                session.dispatch({ type: 'mediaDuration', generation, duration })
              }
              applySeek(attachment, true)
            },
            (message) => {
              if (!sourceMatches(attachment) || attachment.generation !== generation) return
              if (message) session.dispatch({ type: 'mediaError', generation, message })
              else attachment.handleError()
            },
          )
        }
        attachment.mediaUrl = attachment.stream?.url ?? source.url
        element.src = attachment.mediaUrl
        element.load()
      })
    }
    const seekComplete = applySeek(attachment)
    if (!sourceMatches(attachment)) return
    if (
      snapshot.desiredPlaying &&
      snapshot.phase === 'ready' &&
      element.paused &&
      (seekComplete || !attachment.metadataLoaded)
    )
      play(attachment)
    if (!snapshot.desiredPlaying && !element.paused)
      withSuppressedEvents(attachment, () => element.pause())
  }

  function capturePosition(attachment: Attachment) {
    if (!sourceMatches(attachment)) return
    if (!attachment.metadataLoaded || session.getSnapshot().pendingSeek) return
    const duration = attachment.sourceDuration ?? finiteDuration(attachment.element)
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
      mediaUrl: '',
      stream: null,
      sourceDuration: undefined,
      errorGeneration: null,
      handleError: () => undefined,
      suppressEvents: false,
      repeating: false,
      seeking: false,
      resumeAfterSeek: false,
      nativePausePending: false,
      playPending: false,
      playRequest: null,
      hasStarted: false,
      metadataLoaded: false,
      appliedSeekId: null,
      listeners: [],
    }

    const validEvent = () =>
      active === attachment &&
      !attachment.suppressEvents &&
      attachment.generation > 0 &&
      sourceMatches(attachment)

    const recover = (requested?: PlaybackFallback): boolean => {
      if (attachment.mode === 'audio') return false
      const source = session.getSnapshot().source
      if (!source?.compatibility) return false
      const stages: PlaybackFallback[] = ['original', 'remux', 'audio', 'video']
      const current = stages.indexOf(source.compatibility)
      const next = requested ? stages.indexOf(requested) : current + 1
      if (next <= current || next >= stages.length) return false
      session.dispatch({ type: 'refreshSource', fallback: stages[next] })
      return true
    }

    const onReady: EventListener = () => {
      if (!validEvent()) return
      const snapshot = session.getSnapshot()
      if (snapshot.source?.expectedVideo && element.videoWidth === 0 && recover('video')) return
      const duration = attachment.sourceDuration ?? finiteDuration(element)
      attachment.metadataLoaded = true
      const seekComplete = applySeek(attachment, true)
      if (duration !== undefined) {
        session.dispatch({ type: 'mediaDuration', generation: attachment.generation, duration })
      }
      session.dispatch({ type: 'mediaReady', generation: attachment.generation })
      const readySnapshot = session.getSnapshot()
      if (
        seekComplete &&
        readySnapshot.desiredPlaying &&
        readySnapshot.phase === 'ready' &&
        element.paused
      ) {
        play(attachment)
      }
    }
    const onDurationChange: EventListener = () => {
      if (!validEvent()) return
      const duration = attachment.sourceDuration ?? finiteDuration(element)
      if (duration !== undefined) {
        session.dispatch({ type: 'mediaDuration', generation: attachment.generation, duration })
      }
    }
    const onTimeUpdate: EventListener = () => {
      if (!validEvent()) return
      if (session.getSnapshot().pendingSeek && !applySeek(attachment, true)) return
      if (
        attachment.hasStarted &&
        element.currentTime > 1 &&
        session.getSnapshot().source?.expectedAudio &&
        element.webkitAudioDecodedByteCount === 0 &&
        recover('audio')
      )
        return
      capturePosition(attachment)
    }
    const onProgress: EventListener = () => {
      if (validEvent() && session.getSnapshot().pendingSeek) applySeek(attachment, true)
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
      if (!applySeek(attachment, true)) return
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
      const generation = attachment.generation
      if (attachment.errorGeneration === generation) return
      attachment.errorGeneration = generation
      const code = element.error?.code
      const requestId = session.getSnapshot().source?.requestId
      if (requestId) {
        void fetch(`/api/playback/status?${new URLSearchParams({ id: requestId })}`)
          .then((response) => response.json() as Promise<{ error?: string | null }>)
          .catch(() => ({ error: null }))
          .then((result) => {
            if (!validEvent() || attachment.generation !== generation) return
            if (!result.error && recover()) return
            session.dispatch({
              type: 'mediaError',
              generation: attachment.generation,
              message:
                result.error ??
                'Compatibility playback failed. This codec or resolution may not be supported.',
            })
          })
        return
      }
      if (recover()) return
      session.dispatch({
        type: 'mediaError',
        generation: attachment.generation,
        message: code ? `Playback failed (media error ${code}).` : 'Playback failed.',
      })
    }
    attachment.handleError = () => onError(new Event('error'))
    const listeners: Array<readonly [PlaybackMediaEvent, EventListener]> = [
      ['loadedmetadata', onReady],
      ['canplay', onReady],
      ['durationchange', onDurationChange],
      ['progress', onProgress],
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
    if (session.getSnapshot().position > 0 && !session.getSnapshot().pendingSeek)
      session.dispatch({ type: 'seek', position: session.getSnapshot().position })
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
