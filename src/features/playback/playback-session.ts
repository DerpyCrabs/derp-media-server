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
} from './types'

type MutableState = {
  revision: number
  phase: PlaybackPhase
  queue: PlaybackItem[]
  currentIndex: number
  position: number
  duration: number
  desiredPlaying: boolean
  mode: PlaybackMode
  volume: number
  muted: boolean
  repeat: boolean
  source: PlaybackSource | null
  error: string | null
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

function safePersistedState(state: MutableState): PersistedPlaybackState {
  const position =
    state.duration > 0 && state.position >= state.duration * 0.9
      ? 0
      : finiteAtLeast(state.position, 0)
  return {
    schemaVersion: 1,
    queue: state.queue.map(normalizeItem),
    currentIndex: state.currentIndex,
    position,
    duration: finiteAtLeast(state.duration, 0),
    mode: state.mode,
    volume: Math.min(1, finiteAtLeast(state.volume, 0, 1)),
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
  const restoredQueue = dedupeQueue(restored?.queue ?? [])
  const restoredIndex = Math.min(
    restoredQueue.length - 1,
    Math.max(restoredQueue.length ? 0 : -1, Math.trunc(restored?.currentIndex ?? -1)),
  )
  const restoredItem = restoredIndex >= 0 ? restoredQueue[restoredIndex] : null
  const state: MutableState = {
    revision: 0,
    phase: restoredItem ? 'resolving' : 'idle',
    queue: restoredQueue,
    currentIndex: restoredIndex,
    position: finiteAtLeast(restored?.position ?? 0, 0),
    duration: finiteAtLeast(restored?.duration ?? 0, 0),
    desiredPlaying: false,
    mode: restoredItem ? modeFor(restoredItem, restored?.mode) : 'audio',
    volume: Math.min(1, finiteAtLeast(restored?.volume ?? 1, 0, 1)),
    muted: restored?.muted ?? false,
    repeat: restored?.repeat ?? false,
    source: null,
    error: null,
  }

  const listeners = new Set<() => void>()
  let generation = 0
  let sourceAbort: AbortController | null = null
  let lastCheckpointPosition = state.position
  let notifying = false
  let queuedNotification = false

  function snapshot(): PlaybackSnapshot {
    return Object.freeze({
      revision: state.revision,
      phase: state.phase,
      queue: Object.freeze([...state.queue]),
      currentIndex: state.currentIndex,
      currentItem: currentItem(state),
      position: state.position,
      duration: state.duration,
      desiredPlaying: state.desiredPlaying,
      mode: state.mode,
      volume: state.volume,
      muted: state.muted,
      repeat: state.repeat,
      source: state.source,
      error: state.error,
    })
  }

  function persist(force: boolean) {
    if (!options.persistence || state.phase === 'destroyed') return
    if (!force && Math.abs(state.position - lastCheckpointPosition) < 5) return
    try {
      options.persistence.save(safePersistedState(state))
      lastCheckpointPosition = state.position
    } catch {}
  }

  function notify(forcePersist = true, save = true) {
    state.revision += 1
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

  function changed(generationValue?: number): PlaybackOutcome {
    return {
      accepted: true,
      changed: true,
      ...(generationValue === undefined ? {} : { generation: generationValue }),
    }
  }

  function unchanged(): PlaybackOutcome {
    return { accepted: true, changed: false }
  }

  function replaceCurrentItem(item: PlaybackItem) {
    const index = state.queue.findIndex((candidate) => sameItem(candidate, item))
    if (index >= 0) state.queue[index] = normalizeItem(item)
  }

  function applyResolution(result: PlaybackSourceResolution, sourceGeneration: number) {
    if (state.phase === 'destroyed' || generation !== sourceGeneration) return
    if (result.kind === 'resolved' && result.url.length > 0) {
      if (result.item && validItem(result.item) && sameItem(currentItem(state), result.item)) {
        replaceCurrentItem(result.item)
      }
      state.source = Object.freeze({ url: result.url, generation: sourceGeneration })
      state.phase = 'ready'
      state.error = null
      notify()
      return
    }
    state.source = null
    state.desiredPlaying = false
    state.phase = 'error'
    state.error =
      result.kind === 'error' ? result.message : 'Playback source resolution returned no URL.'
    notify()
  }

  function resolveSource(reason: PlaybackResolveReason): PlaybackOutcome {
    const item = currentItem(state)
    if (!item) return reject('emptyQueue')
    sourceAbort?.abort()
    const abort = new AbortController()
    sourceAbort = abort
    generation += 1
    const sourceGeneration = generation
    state.phase = 'resolving'
    state.source = null
    state.error = null
    notify()

    let result: PlaybackSourceResolution | Promise<PlaybackSourceResolution>
    try {
      result = options.sourceResolver.resolve({
        item,
        mode: state.mode,
        reason,
        signal: abort.signal,
      })
    } catch (error) {
      applyResolution(
        {
          kind: 'error',
          message: error instanceof Error ? error.message : 'Playback source resolution failed.',
        },
        sourceGeneration,
      )
      return changed(sourceGeneration)
    }

    if (isPromiseLike(result)) {
      void result.then(
        (resolution) => {
          if (!abort.signal.aborted) applyResolution(resolution, sourceGeneration)
        },
        (error) => {
          if (abort.signal.aborted) return
          applyResolution(
            {
              kind: 'error',
              message:
                error instanceof Error ? error.message : 'Playback source resolution failed.',
            },
            sourceGeneration,
          )
        },
      )
    } else {
      applyResolution(result, sourceGeneration)
    }
    return changed(sourceGeneration)
  }

  function legacyPosition(item: PlaybackItem): number {
    try {
      return finiteAtLeast(options.persistence?.legacyPosition?.(item.locator) ?? 0, 0)
    } catch {
      return 0
    }
  }

  function selectIndex(index: number, autoplay: boolean): PlaybackOutcome {
    state.currentIndex = index
    const item = currentItem(state)!
    state.position = legacyPosition(item)
    state.duration = 0
    state.desiredPlaying = autoplay
    state.mode = modeFor(item)
    return resolveSource('load')
  }

  function stale(sourceGeneration: number): boolean {
    return !state.source || sourceGeneration !== state.source.generation
  }

  function dispatch(command: PlaybackCommand): PlaybackOutcome {
    if (state.phase === 'destroyed') return reject('destroyed')

    switch (command.type) {
      case 'load': {
        if (!validItem(command.item)) return reject('invalid')
        const item = normalizeItem(command.item)
        const previous = currentItem(state)
        const isSame = sameItem(previous, item)
        const requestedQueue = command.queue ? dedupeQueue(command.queue) : [...state.queue]
        const itemKey = playbackItemKey(item)
        let index = requestedQueue.findIndex((candidate) => playbackItemKey(candidate) === itemKey)
        if (index < 0) {
          requestedQueue.push(item)
          index = requestedQueue.length - 1
        } else {
          requestedQueue[index] = item
        }
        state.queue = requestedQueue
        state.currentIndex = index
        state.mode = modeFor(item, command.mode ?? (isSame ? state.mode : undefined))
        state.desiredPlaying = command.autoplay ?? true
        if (!isSame) {
          state.position =
            command.position === undefined
              ? legacyPosition(item)
              : finiteAtLeast(command.position, 0)
          state.duration = 0
        } else if (command.position !== undefined) {
          state.position = finiteAtLeast(command.position, 0)
        }
        return resolveSource('load')
      }
      case 'setQueue': {
        const previous = currentItem(state)
        const queue = dedupeQueue(command.queue)
        const target = command.current ?? previous
        state.queue = queue
        state.currentIndex = target
          ? queue.findIndex((candidate) => sameItem(candidate, target))
          : queue.length
            ? 0
            : -1
        if (state.currentIndex < 0 && queue.length > 0) state.currentIndex = 0
        const next = currentItem(state)
        if (sameItem(previous, next)) {
          notify()
          return changed()
        }
        sourceAbort?.abort()
        sourceAbort = null
        generation += 1
        state.position = next ? legacyPosition(next) : 0
        state.duration = 0
        state.desiredPlaying = false
        state.mode = next ? modeFor(next) : 'audio'
        state.source = null
        state.error = null
        state.phase = next ? 'paused' : 'idle'
        notify()
        return changed()
      }
      case 'play':
        if (!currentItem(state)) return reject('emptyQueue')
        if (state.desiredPlaying && state.phase !== 'error') return unchanged()
        state.desiredPlaying = true
        if (state.phase === 'ended') state.position = 0
        if (!state.source || state.phase === 'error') return resolveSource('retry')
        state.phase = 'ready'
        notify()
        return changed(state.source.generation)
      case 'pause':
        if (!state.desiredPlaying && state.phase === 'paused') return unchanged()
        state.desiredPlaying = false
        if (state.source) state.phase = 'paused'
        notify()
        return changed(state.source?.generation)
      case 'toggle':
        return dispatch({ type: state.desiredPlaying ? 'pause' : 'play' })
      case 'seek': {
        if (!currentItem(state)) return reject('emptyQueue')
        const maximum = state.duration > 0 ? state.duration : Number.POSITIVE_INFINITY
        const position = Math.min(maximum, finiteAtLeast(command.position, 0))
        if (position === state.position) return unchanged()
        state.position = position
        if (state.phase === 'ended' && position < state.duration) state.phase = 'paused'
        notify(false)
        return changed(state.source?.generation)
      }
      case 'mediaTime':
        if (stale(command.generation)) return reject('staleSource')
        state.position = finiteAtLeast(command.position, 0)
        if (command.duration !== undefined && Number.isFinite(command.duration)) {
          state.duration = finiteAtLeast(command.duration, 0)
        }
        notify(false)
        return changed(command.generation)
      case 'mediaDuration':
        if (stale(command.generation)) return reject('staleSource')
        state.duration = finiteAtLeast(command.duration, 0)
        if (state.duration > 0) state.position = Math.min(state.position, state.duration)
        notify(false)
        return changed(command.generation)
      case 'mediaReady':
        if (stale(command.generation)) return reject('staleSource')
        if (state.phase !== 'playing') state.phase = state.desiredPlaying ? 'ready' : 'paused'
        notify()
        return changed(command.generation)
      case 'mediaPlay':
        if (stale(command.generation)) return reject('staleSource')
        state.desiredPlaying = true
        state.phase = 'playing'
        notify()
        return changed(command.generation)
      case 'mediaPause':
        if (stale(command.generation)) return reject('staleSource')
        state.desiredPlaying = false
        state.phase = 'paused'
        notify()
        return changed(command.generation)
      case 'mediaEnded':
        if (stale(command.generation)) return reject('staleSource')
        if (state.repeat) {
          state.position = 0
          state.desiredPlaying = true
          state.phase = 'ready'
          notify()
          return changed(command.generation)
        }
        if (state.currentIndex + 1 < state.queue.length) {
          return selectIndex(state.currentIndex + 1, true)
        }
        state.position = state.duration
        state.desiredPlaying = false
        state.phase = 'ended'
        notify()
        return changed(command.generation)
      case 'mediaError':
        if (stale(command.generation)) return reject('staleSource')
        state.desiredPlaying = false
        state.phase = 'error'
        state.error = command.message ?? 'Playback failed.'
        notify()
        return changed(command.generation)
      case 'next':
        if (state.currentIndex < 0 || state.currentIndex + 1 >= state.queue.length) {
          return reject('emptyQueue')
        }
        return selectIndex(state.currentIndex + 1, true)
      case 'previous':
        if (!currentItem(state)) return reject('emptyQueue')
        if (state.position > 20) return dispatch({ type: 'seek', position: 0 })
        if (state.currentIndex <= 0) return reject('emptyQueue')
        return selectIndex(state.currentIndex - 1, true)
      case 'retry':
        if (!currentItem(state)) return reject('emptyQueue')
        state.desiredPlaying = true
        return resolveSource('retry')
      case 'refreshSource':
        return resolveSource('refresh')
      case 'setMode': {
        const item = currentItem(state)
        if (!item) return reject('emptyQueue')
        const mode = modeFor(item, command.mode)
        if (mode === state.mode) return unchanged()
        state.mode = mode
        return resolveSource('mode')
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
      case 'setMuted':
        if (state.muted === command.muted && !(!command.muted && state.volume === 0)) {
          return unchanged()
        }
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
        sourceAbort?.abort()
        sourceAbort = null
        generation += 1
        state.queue = []
        state.currentIndex = -1
        state.position = 0
        state.duration = 0
        state.desiredPlaying = false
        state.mode = 'audio'
        state.source = null
        state.error = null
        state.phase = 'idle'
        try {
          options.persistence?.clear?.()
        } catch {}
        notify(true, false)
        return changed()
      case 'destroy':
        sourceAbort?.abort()
        sourceAbort = null
        persist(true)
        state.desiredPlaying = false
        state.source = null
        state.phase = 'destroyed'
        state.revision += 1
        for (const listener of [...listeners]) listener()
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

  if (restoredItem) queueMicrotask(() => resolveSource('restore'))
  return session
}
