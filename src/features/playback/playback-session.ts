import type {
  CreatePlaybackSessionOptions,
  PersistedPlaybackState,
  PlaybackCommand,
  PlaybackItem,
  PlaybackMode,
  PlaybackOutcome,
  PlaybackPhase,
  PlaybackPersistence,
  PlaybackResolveReason,
  PlaybackSession,
  PlaybackSnapshot,
  PlaybackSource,
  PlaybackSourceResolution,
  PlaybackFallback,
  QueueContext,
} from './types'

type Transport =
  | { kind: 'idle' }
  | { kind: 'resolving'; previous: PlaybackSource | null }
  | { kind: 'attached'; source: PlaybackSource; playing: boolean }
  | { kind: 'ended'; source: PlaybackSource }
  | { kind: 'error'; source: PlaybackSource | null; message: string }
  | { kind: 'destroyed' }

type MutableState = {
  revision: number
  queue: PlaybackItem[]
  queueContext: QueueContext | null
  currentIndex: number
  mode: PlaybackMode
  desiredPlaying: boolean
  volume: number
  muted: boolean
  repeat: boolean
  playbackRate: number
  transport: Transport
  timeline: {
    position: number
    duration: number
    pending: Readonly<{ id: number; position: number }> | null
  }
  buffering: boolean
}

function finiteAtLeast(value: number, minimum: number, fallback = minimum): number {
  return Number.isFinite(value) ? Math.max(minimum, value) : fallback
}

function normalizedLocator(locator: string): string {
  return locator.replace(/\\/g, '/')
}

function normalizeItem(item: PlaybackItem): PlaybackItem {
  return Object.freeze({
    locator: normalizedLocator(item.locator),
    name: item.name,
    media: item.media,
    ...(item.automatic ? { automatic: true } : {}),
  })
}

function validItem(value: unknown): value is PlaybackItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<PlaybackItem>
  return !!(
    typeof item.locator === 'string' &&
    item.locator.length > 0 &&
    typeof item.name === 'string' &&
    item.name.length > 0 &&
    (item.media === 'audio' || item.media === 'video')
  )
}

function normalizeContext(value: unknown): QueueContext | null {
  if (!value || typeof value !== 'object') return null
  const context = value as QueueContext
  if (!['manual', 'playlist', 'radio'].includes(context.kind) || typeof context.title !== 'string')
    return null
  if (context.kind === 'radio') {
    const radio = context.radio
    if (
      !radio ||
      !Array.isArray(radio.seeds) ||
      !radio.seeds.every((seed) => typeof seed === 'string') ||
      typeof radio.genre !== 'string' ||
      typeof radio.artist !== 'string' ||
      !Number.isFinite(radio.discovery) ||
      radio.discovery < 0 ||
      radio.discovery > 1 ||
      typeof radio.strictGenre !== 'boolean' ||
      typeof radio.allowRepeats !== 'boolean'
    )
      return null
    return Object.freeze({
      ...context,
      radio: Object.freeze({ ...radio, seeds: [...radio.seeds] }),
    })
  }
  return Object.freeze({ ...context })
}

function validPersistedState(value: unknown): value is PersistedPlaybackState {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<PersistedPlaybackState>
  return !!(
    state.schemaVersion === 1 &&
    Array.isArray(state.queue) &&
    state.queue.every(validItem) &&
    typeof state.currentIndex === 'number' &&
    Number.isFinite(state.currentIndex) &&
    typeof state.position === 'number' &&
    Number.isFinite(state.position) &&
    typeof state.duration === 'number' &&
    Number.isFinite(state.duration) &&
    (state.mode === 'audio' || state.mode === 'video') &&
    typeof state.volume === 'number' &&
    Number.isFinite(state.volume) &&
    typeof state.muted === 'boolean' &&
    typeof state.repeat === 'boolean'
  )
}

export function playbackItemKey(value: Pick<PlaybackItem, 'locator'>): string {
  return normalizedLocator(value.locator)
}

function sameItem(left: PlaybackItem | null | undefined, right: PlaybackItem | null | undefined) {
  return !!left && !!right && playbackItemKey(left) === playbackItemKey(right)
}

function dedupeQueue(queue: readonly PlaybackItem[]): PlaybackItem[] {
  const seen = new Set<string>()
  const result: PlaybackItem[] = []
  for (const value of queue) {
    if (!validItem(value)) continue
    const item = normalizeItem(value)
    const key = playbackItemKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

function currentItem(state: MutableState): PlaybackItem | null {
  return state.currentIndex >= 0 ? (state.queue[state.currentIndex] ?? null) : null
}

function modeFor(item: PlaybackItem, requested?: PlaybackMode): PlaybackMode {
  return item.media === 'audio' ? 'audio' : (requested ?? 'video')
}

function playbackPosition(state: MutableState): number {
  return state.timeline.pending?.position ?? state.timeline.position
}

function playbackSource(transport: Transport): PlaybackSource | null {
  if (transport.kind === 'resolving') return transport.previous
  return 'source' in transport ? transport.source : null
}

function playbackPhase(state: MutableState): PlaybackPhase {
  switch (state.transport.kind) {
    case 'idle':
      return currentItem(state) ? 'paused' : 'idle'
    case 'resolving':
      return 'resolving'
    case 'error':
      return 'error'
    case 'ended':
      return 'ended'
    case 'destroyed':
      return 'destroyed'
    case 'attached':
      return state.desiredPlaying ? (state.transport.playing ? 'playing' : 'ready') : 'paused'
  }
  throw new Error('Unhandled playback transport')
}

function safePersistedState(state: MutableState): PersistedPlaybackState {
  const position = playbackPosition(state)
  return {
    schemaVersion: 1,
    queue: state.queue.map(normalizeItem),
    ...(state.queueContext ? { queueContext: state.queueContext } : {}),
    currentIndex: state.currentIndex,
    position:
      state.timeline.duration > 0 && position >= state.timeline.duration * 0.9 ? 0 : position,
    duration: state.timeline.duration,
    mode: state.mode,
    volume: state.volume,
    muted: state.muted,
    repeat: state.repeat,
  }
}

function restore(persistence: PlaybackPersistence | undefined): PersistedPlaybackState | null {
  try {
    const value = persistence?.load()
    return validPersistedState(value) ? value : null
  } catch {
    return null
  }
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return !!value && typeof (value as Promise<T>).then === 'function'
}

export function createPlaybackSession(options: CreatePlaybackSessionOptions): PlaybackSession {
  const restored = restore(options.persistence)
  const queue = dedupeQueue(restored?.queue ?? [])
  const currentIndex = Math.min(
    queue.length - 1,
    Math.max(0, Math.trunc(restored?.currentIndex ?? 0)),
  )
  const restoredItem = queue[currentIndex]
  const state: MutableState = {
    revision: 0,
    queue,
    queueContext: normalizeContext(restored?.queueContext),
    currentIndex,
    mode: restoredItem ? modeFor(restoredItem, restored?.mode) : 'audio',
    desiredPlaying: false,
    volume: Math.min(1, finiteAtLeast(restored?.volume ?? 1, 0, 1)),
    muted: restored?.muted ?? false,
    repeat: restored?.repeat ?? false,
    playbackRate: 1,
    transport: restoredItem ? { kind: 'resolving', previous: null } : { kind: 'idle' },
    timeline: {
      position: finiteAtLeast(restored?.position ?? 0, 0),
      duration: finiteAtLeast(restored?.duration ?? 0, 0),
      pending: null,
    },
    buffering: false,
  }
  const listeners = new Set<() => void>()
  let generation = 0
  let seekId = 0
  let rateRevision = 0
  let sourceAbort: AbortController | null = null
  let fallback: PlaybackFallback = 'original'
  let lastCheckpointPosition = playbackPosition(state)
  let notifying = false
  let queuedNotification = false
  let cachedSnapshot: PlaybackSnapshot | null = null

  function snapshot(): PlaybackSnapshot {
    return (cachedSnapshot ??= Object.freeze({
      revision: state.revision,
      phase: playbackPhase(state),
      queue: Object.freeze([...state.queue]),
      queueContext: state.queueContext,
      currentIndex: state.currentIndex,
      currentItem: currentItem(state),
      position: playbackPosition(state),
      duration: state.timeline.duration,
      pendingSeek: state.timeline.pending,
      buffering: state.buffering,
      desiredPlaying: state.desiredPlaying,
      mode: state.mode,
      volume: state.volume,
      muted: state.muted,
      repeat: state.repeat,
      playbackRate: state.playbackRate,
      source: playbackSource(state.transport),
      error: state.transport.kind === 'error' ? state.transport.message : null,
    }))
  }

  function persist(force: boolean) {
    if (!options.persistence || state.transport.kind === 'destroyed') return
    const position = playbackPosition(state)
    if (!force && Math.abs(position - lastCheckpointPosition) < 5) return
    try {
      options.persistence.save(safePersistedState(state))
      lastCheckpointPosition = position
    } catch {}
  }

  function notify(forcePersist = true, save = true) {
    state.revision += 1
    cachedSnapshot = null
    if (save) persist(forcePersist)
    if (notifying) {
      queuedNotification = true
      return
    }
    notifying = true
    try {
      do {
        queuedNotification = false
        for (const listener of [...listeners]) listener()
      } while (queuedNotification)
    } finally {
      notifying = false
    }
  }

  function reject(reason: PlaybackOutcome['reason']): PlaybackOutcome {
    return { accepted: false, changed: false, reason }
  }
  function changed(): PlaybackOutcome {
    return { accepted: true, changed: true, generation }
  }
  function unchanged(): PlaybackOutcome {
    return { accepted: true, changed: false }
  }
  function boundedPosition(position: number) {
    return Math.min(state.timeline.duration || Infinity, Math.max(0, position))
  }
  function requestSeek(position: number) {
    state.timeline.pending = Object.freeze({ id: ++seekId, position: boundedPosition(position) })
    state.buffering = false
    if (state.transport.kind === 'ended')
      state.transport = { kind: 'attached', source: state.transport.source, playing: false }
  }
  function setDuration(duration: number) {
    if (!Number.isFinite(duration) || duration < 0) return
    state.timeline.duration = duration
    if (duration === 0) return
    state.timeline.position = Math.min(state.timeline.position, duration)
    if (state.timeline.pending && state.timeline.pending.position > duration)
      state.timeline.pending = Object.freeze({ ...state.timeline.pending, position: duration })
  }
  function stopResolution() {
    sourceAbort?.abort()
    sourceAbort = null
    generation += 1
  }
  function currentGeneration(value: number) {
    return (
      state.transport.kind !== 'resolving' &&
      value === generation &&
      playbackSource(state.transport)?.generation === value
    )
  }
  function legacyPosition(item: PlaybackItem): number {
    try {
      return finiteAtLeast(options.persistence?.legacyPosition?.(item.locator) ?? 0, 0)
    } catch {
      return 0
    }
  }
  function resetTimeline(position: number) {
    state.timeline = { position, duration: 0, pending: null }
    state.buffering = false
    state.playbackRate = 1
    rateRevision += 1
    fallback = 'original'
    if (position > 0) requestSeek(position)
  }

  function applyResolution(
    result: PlaybackSourceResolution,
    resolvedGeneration: number,
    resolvedPosition: number,
    requestedRateRevision: number,
  ) {
    if (state.transport.kind === 'destroyed' || generation !== resolvedGeneration) return
    sourceAbort = null
    if (result.kind !== 'resolved' || !result.url) {
      state.transport = {
        kind: 'error',
        source: null,
        message:
          result.kind === 'error' ? result.message : 'Playback source resolution returned no URL.',
      }
      state.desiredPlaying = false
      state.buffering = false
      notify()
      return
    }
    if (result.item && validItem(result.item) && sameItem(currentItem(state), result.item))
      state.queue[state.currentIndex] = normalizeItem(result.item)
    const { kind: _kind, item: _item, playbackRate, ...source } = result
    if (
      playbackRate !== undefined &&
      Number.isFinite(playbackRate) &&
      rateRevision === requestedRateRevision
    )
      state.playbackRate = Math.min(3, Math.max(0.25, playbackRate))
    if (source.duration !== undefined) setDuration(source.duration)
    state.transport = {
      kind: 'attached',
      source: Object.freeze({
        ...source,
        generation: resolvedGeneration,
        initialPosition: resolvedPosition,
      }),
      playing: false,
    }
    state.buffering = false
    notify()
  }

  function resolveSource(reason: PlaybackResolveReason, keepSource = true): PlaybackOutcome {
    const item = currentItem(state)
    if (!item) return reject('emptyQueue')
    const previous = keepSource ? playbackSource(state.transport) : null
    stopResolution()
    const abort = new AbortController()
    sourceAbort = abort
    const sourceGeneration = generation
    const position = playbackPosition(state)
    const requestedRateRevision = rateRevision
    if (!state.timeline.pending && position > 0) requestSeek(position)
    state.transport = { kind: 'resolving', previous }
    state.buffering = false
    notify()
    const finish = (result: PlaybackSourceResolution) => {
      if (!abort.signal.aborted)
        applyResolution(result, sourceGeneration, position, requestedRateRevision)
    }
    const fail = (error: unknown) =>
      finish({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Playback source resolution failed.',
      })
    try {
      const result = options.sourceResolver.resolve({
        item,
        mode: state.mode,
        reason,
        signal: abort.signal,
        position,
        fallback,
      })
      if (isPromiseLike(result)) void result.then(finish, fail)
      else finish(result)
    } catch (error) {
      fail(error)
    }
    return changed()
  }

  function selectIndex(index: number, autoplay: boolean): PlaybackOutcome {
    state.currentIndex = index
    const item = currentItem(state)!
    resetTimeline(legacyPosition(item))
    state.desiredPlaying = autoplay
    state.mode = modeFor(item)
    return resolveSource('load', false)
  }

  function dispatch(command: PlaybackCommand): PlaybackOutcome {
    if (state.transport.kind === 'destroyed') return reject('destroyed')
    switch (command.type) {
      case 'load': {
        if (!validItem(command.item)) return reject('invalid')
        const item = normalizeItem(command.item)
        const isSame = sameItem(currentItem(state), item)
        const mode = modeFor(item, command.mode ?? (isSame ? state.mode : undefined))
        const sameMode = state.mode === mode
        const queue = command.queue ? dedupeQueue(command.queue) : [...state.queue]
        let index = queue.findIndex((candidate) => sameItem(candidate, item))
        if (index < 0) index = queue.push(item) - 1
        else queue[index] = item
        state.queue = queue
        if (command.queueContext !== undefined)
          state.queueContext = normalizeContext(command.queueContext)
        else if (command.queue && !isSame) state.queueContext = null
        state.currentIndex = index
        state.mode = mode
        state.desiredPlaying = command.autoplay ?? true
        if (!isSame) {
          resetTimeline(
            command.position === undefined
              ? legacyPosition(item)
              : finiteAtLeast(command.position, 0),
          )
        } else if (command.position !== undefined) requestSeek(finiteAtLeast(command.position, 0))
        if (isSame && sameMode && state.transport.kind === 'attached') {
          notify()
          return changed()
        }
        return resolveSource('load', isSame && sameMode)
      }
      case 'setQueueContext':
        state.queueContext = normalizeContext(command.context)
        notify()
        return changed()
      case 'selectQueueItem':
        if (!Number.isInteger(command.index) || !state.queue[command.index])
          return reject('invalid')
        return selectIndex(command.index, true)
      case 'enqueue': {
        const current = currentItem(state)
        const additions = dedupeQueue(command.items).filter(
          (item) => !current || item.media === current.media,
        )
        if (!additions.length) return reject('invalid')
        const keys = new Set(additions.map(playbackItemKey))
        const queue = state.queue.filter(
          (item) => sameItem(item, current) || !keys.has(playbackItemKey(item)),
        )
        const index = current ? queue.findIndex((item) => sameItem(item, current)) : -1
        const incoming = additions.filter((item) => !sameItem(item, current))
        const firstAutomatic =
          state.queueContext?.kind === 'radio'
            ? queue.findIndex((item, i) => i > index && item.automatic)
            : -1
        queue.splice(
          command.position === 'next'
            ? index + 1
            : firstAutomatic >= 0
              ? firstAutomatic
              : queue.length,
          0,
          ...incoming,
        )
        return dispatch({
          type: 'setQueue',
          queue,
          ...(current ? { current } : {}),
          queueContext: state.queueContext ?? { kind: 'manual', title: 'Your queue' },
        })
      }
      case 'moveQueueItem': {
        if (
          !Number.isInteger(command.from) ||
          !Number.isInteger(command.to) ||
          !state.queue[command.from] ||
          !state.queue[command.to]
        )
          return reject('invalid')
        const current = currentItem(state)
        const queue = [...state.queue]
        queue.splice(command.to, 0, { ...queue.splice(command.from, 1)[0]!, automatic: false })
        return dispatch({
          type: 'setQueue',
          queue,
          ...(current ? { current } : {}),
          queueContext: state.queueContext ?? { kind: 'manual', title: 'Your queue' },
        })
      }
      case 'removeQueueItem': {
        if (!Number.isInteger(command.index) || !state.queue[command.index])
          return reject('invalid')
        const queue = state.queue.filter((_, index) => index !== command.index)
        if (!queue.length) return dispatch({ type: 'stop' })
        if (command.index === state.currentIndex) {
          state.queueContext ??= { kind: 'manual', title: 'Your queue' }
          state.queue = queue
          return selectIndex(Math.min(command.index, queue.length - 1), state.desiredPlaying)
        }
        return dispatch({
          type: 'setQueue',
          queue,
          queueContext: state.queueContext ?? { kind: 'manual', title: 'Your queue' },
        })
      }
      case 'shuffleQueue': {
        const queue = [...state.queue]
        for (let i = queue.length - 1; i > state.currentIndex + 1; i -= 1) {
          const j = state.currentIndex + 1 + Math.floor(Math.random() * (i - state.currentIndex))
          ;[queue[i], queue[j]] = [queue[j]!, queue[i]!]
        }
        return dispatch({
          type: 'setQueue',
          queue,
          queueContext: state.queueContext ?? { kind: 'manual', title: 'Your queue' },
        })
      }
      case 'setQueue': {
        if (command.queueContext !== undefined)
          state.queueContext = normalizeContext(command.queueContext)
        const previous = currentItem(state)
        const queue = dedupeQueue(command.queue)
        const target = command.current ?? previous
        state.queue = queue
        const index = target ? queue.findIndex((candidate) => sameItem(candidate, target)) : 0
        state.currentIndex = queue.length ? Math.max(0, index) : -1
        const next = currentItem(state)
        if (sameItem(previous, next)) {
          notify()
          return changed()
        }
        stopResolution()
        resetTimeline(next ? legacyPosition(next) : 0)
        state.desiredPlaying = false
        state.mode = next ? modeFor(next) : 'audio'
        state.transport = { kind: 'idle' }
        notify()
        return changed()
      }
      case 'play':
        if (!currentItem(state)) return reject('emptyQueue')
        if (state.desiredPlaying && state.transport.kind !== 'error') return unchanged()
        state.desiredPlaying = true
        if (
          state.transport.kind === 'ended' ||
          (state.timeline.duration > 0 && playbackPosition(state) >= state.timeline.duration)
        )
          requestSeek(0)
        if (state.transport.kind === 'resolving') {
          notify()
          return changed()
        }
        if (state.transport.kind !== 'attached') return resolveSource('retry')
        state.transport.playing = false
        notify()
        return changed()
      case 'pause':
        if (!state.desiredPlaying) return unchanged()
        state.desiredPlaying = false
        notify()
        return changed()
      case 'toggle':
        return dispatch({ type: state.desiredPlaying ? 'pause' : 'play' })
      case 'seek':
        if (!currentItem(state)) return reject('emptyQueue')
        if (!Number.isFinite(command.position)) return reject('invalid')
        if (state.timeline.pending?.position === boundedPosition(command.position))
          return unchanged()
        requestSeek(command.position)
        notify(false)
        return changed()
      case 'mediaSeeked':
        if (!currentGeneration(command.generation)) return reject('staleSource')
        if (!state.timeline.pending || state.timeline.pending.id !== command.seekId)
          return unchanged()
        if (
          !Number.isFinite(command.position) ||
          Math.abs(command.position - state.timeline.pending.position) > 0.25
        )
          return unchanged()
        state.timeline.position = boundedPosition(command.position)
        state.timeline.pending = null
        state.buffering = false
        notify(false)
        return changed()
      case 'mediaTime':
        if (!currentGeneration(command.generation)) return reject('staleSource')
        if (!Number.isFinite(command.position)) return reject('invalid')
        if (command.duration !== undefined) setDuration(command.duration)
        if (state.timeline.pending) return unchanged()
        state.timeline.position = boundedPosition(command.position)
        notify(false)
        return changed()
      case 'mediaDuration':
        if (!currentGeneration(command.generation)) return reject('staleSource')
        setDuration(command.duration)
        notify(false)
        return changed()
      case 'mediaBuffering':
        if (!currentGeneration(command.generation)) return reject('staleSource')
        if (state.buffering === command.buffering) return unchanged()
        state.buffering = command.buffering
        notify(false, false)
        return changed()
      case 'mediaReady': {
        if (!currentGeneration(command.generation)) return reject('staleSource')
        if (state.transport.kind === 'attached') state.buffering = false
        notify(false, false)
        return changed()
      }
      case 'mediaPlay': {
        if (!currentGeneration(command.generation)) return reject('staleSource')
        const source = playbackSource(state.transport)!
        state.transport = { kind: 'attached', source, playing: true }
        state.desiredPlaying = true
        state.buffering = false
        notify()
        return changed()
      }
      case 'mediaPause': {
        if (!currentGeneration(command.generation)) return reject('staleSource')
        if (state.transport.kind === 'error') return unchanged()
        if (state.timeline.pending || state.transport.kind === 'ended') return unchanged()
        const source = playbackSource(state.transport)!
        state.transport = { kind: 'attached', source, playing: false }
        state.desiredPlaying = false
        state.buffering = false
        notify()
        return changed()
      }
      case 'mediaEnded': {
        if (!currentGeneration(command.generation)) return reject('staleSource')
        if (state.transport.kind === 'error') return unchanged()
        if (state.timeline.pending) return unchanged()
        if (state.repeat) {
          requestSeek(0)
          state.desiredPlaying = true
          notify()
          return changed()
        }
        if (state.currentIndex + 1 < state.queue.length)
          return selectIndex(state.currentIndex + 1, true)
        const source = playbackSource(state.transport)!
        state.timeline.position = state.timeline.duration
        state.transport = { kind: 'ended', source }
        state.desiredPlaying = false
        state.buffering = false
        notify()
        return changed()
      }
      case 'mediaError':
        if (!currentGeneration(command.generation)) return reject('staleSource')
        state.transport = {
          kind: 'error',
          source: playbackSource(state.transport),
          message: command.message ?? 'Playback failed.',
        }
        state.desiredPlaying = false
        state.buffering = false
        notify()
        return changed()
      case 'mediaVolume': {
        if (!currentGeneration(command.generation)) return reject('staleSource')
        const volume = Math.min(1, finiteAtLeast(command.volume, 0, 1))
        if (state.volume === volume && state.muted === command.muted) return unchanged()
        state.volume = volume
        state.muted = command.muted
        notify()
        return changed()
      }
      case 'next':
        if (state.currentIndex < 0 || state.currentIndex + 1 >= state.queue.length)
          return reject('emptyQueue')
        return selectIndex(state.currentIndex + 1, true)
      case 'previous':
        if (!currentItem(state)) return reject('emptyQueue')
        if (playbackPosition(state) > 20) return dispatch({ type: 'seek', position: 0 })
        if (state.currentIndex <= 0) return reject('emptyQueue')
        return selectIndex(state.currentIndex - 1, true)
      case 'retry':
        if (!currentItem(state)) return reject('emptyQueue')
        state.desiredPlaying = true
        return resolveSource('retry')
      case 'refreshSource':
        if (command.fallback) fallback = command.fallback
        return resolveSource('refresh')
      case 'setMode': {
        const item = currentItem(state)
        if (!item) return reject('emptyQueue')
        const mode = modeFor(item, command.mode)
        if (mode === state.mode) return unchanged()
        state.mode = mode
        return resolveSource('mode', false)
      }
      case 'setVolume': {
        const volume = Math.min(1, finiteAtLeast(command.volume, 0, 1))
        const muted = volume === 0
        if (state.volume === volume && state.muted === muted) return unchanged()
        state.volume = volume
        state.muted = muted
        notify()
        return changed()
      }
      case 'setPlaybackRate': {
        if (!Number.isFinite(command.rate)) return reject('invalid')
        const rate = Math.min(3, Math.max(0.25, command.rate))
        if (state.playbackRate === rate) return unchanged()
        state.playbackRate = rate
        rateRevision += 1
        notify()
        return changed()
      }
      case 'setMuted':
        if (state.muted === command.muted && !(!command.muted && state.volume === 0))
          return unchanged()
        state.muted = command.muted
        if (!command.muted && state.volume === 0) state.volume = 0.5
        notify()
        return changed()
      case 'setRepeat':
        if (state.repeat === command.repeat) return unchanged()
        state.repeat = command.repeat
        notify()
        return changed()
      case 'toggleRepeat':
        return dispatch({ type: 'setRepeat', repeat: !state.repeat })
      case 'checkpoint':
        persist(true)
        return unchanged()
      case 'stop':
        stopResolution()
        state.queue = []
        state.queueContext = null
        state.currentIndex = -1
        state.mode = 'audio'
        state.desiredPlaying = false
        state.transport = { kind: 'idle' }
        resetTimeline(0)
        try {
          options.persistence?.clear?.()
        } catch {}
        notify(true, false)
        return changed()
      case 'destroy':
        stopResolution()
        persist(true)
        state.desiredPlaying = false
        state.transport = { kind: 'destroyed' }
        notify(false, false)
        listeners.clear()
        return changed()
    }
    throw new Error('Unhandled playback command')
  }

  const session: PlaybackSession = Object.freeze({
    getSnapshot: snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    dispatch,
  })
  if (restoredItem)
    queueMicrotask(() => {
      if (generation === 0 && state.transport.kind === 'resolving') resolveSource('restore')
    })
  return session
}
