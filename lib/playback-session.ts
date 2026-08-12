import type { ResourceRef, ResourceVersion } from './resource'

export type PlaybackScope = { kind: 'owner' } | { kind: 'grantSession'; id: string }
export type PlaybackMedia = 'audio' | 'video'
export type PlaybackMode = 'audio' | 'video'
export type PlaybackPhase =
  | 'idle'
  | 'resolving'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'recoverable'
  | 'error'
  | 'destroyed'
export type PlaybackIssue =
  | 'missing'
  | 'sourceUnavailable'
  | 'revoked'
  | 'versionChanged'
  | 'offlineUnavailable'
export type PlaybackSourceKind = 'online' | 'offline'
export type PlaybackResolveReason = 'load' | 'restore' | 'refresh' | 'retry' | 'onlineChange'

export type PlaybackItem = Readonly<{
  ref: ResourceRef
  version?: ResourceVersion
  /** Credential-free compatibility locator; stable ResourceRef remains the identity. */
  locator: string
  name: string
  media: PlaybackMedia
}>

export type PlaybackSource = Readonly<{
  url: string
  sourceKind: PlaybackSourceKind
  generation: number
}>

export type PlaybackSnapshot = Readonly<{
  revision: number
  scope: PlaybackScope
  phase: PlaybackPhase
  queue: readonly PlaybackItem[]
  currentIndex: number
  currentItem: PlaybackItem | null
  position: number
  duration: number
  desiredPlaying: boolean
  mode: PlaybackMode
  volume: number
  muted: boolean
  repeat: boolean
  online: boolean
  source: PlaybackSource | null
  issue: PlaybackIssue | null
  error: string | null
}>

export type PlaybackSourceRequest = Readonly<{
  scope: PlaybackScope
  item: PlaybackItem
  mode: PlaybackMode
  online: boolean
  reason: PlaybackResolveReason
  signal: AbortSignal
}>

export type PlaybackSourceResolution =
  | Readonly<{
      kind: 'resolved'
      url: string
      sourceKind: PlaybackSourceKind
      item?: PlaybackItem
    }>
  | Readonly<{
      kind: 'recoverable'
      issue: PlaybackIssue
      message: string
      item?: PlaybackItem
      fallback?: Readonly<{ url: string; sourceKind: PlaybackSourceKind }>
    }>
  | Readonly<{ kind: 'error'; message: string; retryable: boolean }>

export interface PlaybackSourceAdapter {
  resolve(
    request: PlaybackSourceRequest,
  ): PlaybackSourceResolution | Promise<PlaybackSourceResolution>
}

export type PlaybackCommand =
  | Readonly<{
      type: 'load'
      item: PlaybackItem
      queue?: readonly PlaybackItem[]
      autoplay?: boolean
      position?: number
      mode?: PlaybackMode
    }>
  | Readonly<{ type: 'setQueue'; queue: readonly PlaybackItem[]; current?: PlaybackItem }>
  | Readonly<{
      type: 'play' | 'pause' | 'toggle' | 'next' | 'previous' | 'retry' | 'refreshSource'
    }>
  | Readonly<{ type: 'seek'; position: number }>
  | Readonly<{ type: 'time'; generation: number; position: number; duration?: number }>
  | Readonly<{ type: 'duration'; generation: number; duration: number }>
  | Readonly<{
      type: 'mediaReady' | 'mediaPlay' | 'mediaPause' | 'mediaEnded'
      generation: number
    }>
  | Readonly<{ type: 'mediaError'; generation: number; message?: string }>
  | Readonly<{ type: 'onlineChanged' | 'setOnline'; online: boolean }>
  | Readonly<{ type: 'setMode'; mode: PlaybackMode }>
  | Readonly<{ type: 'setVolume'; volume: number }>
  | Readonly<{ type: 'setMuted'; muted: boolean }>
  | Readonly<{ type: 'setRepeat'; repeat: boolean }>
  | Readonly<{ type: 'toggleRepeat' | 'acceptVersion' | 'checkpoint' | 'stop' | 'teardown' }>

export type PlaybackOutcome = Readonly<{
  accepted: boolean
  changed: boolean
  reason?: 'destroyed' | 'emptyQueue' | 'staleSource' | 'unavailable' | 'invalid'
  generation?: number
}>

export type PersistedPlaybackState = Readonly<{
  schemaVersion: 1
  queue: readonly PlaybackItem[]
  currentIndex: number
  position: number
  duration: number
  mode: PlaybackMode
  volume: number
  muted: boolean
  repeat: boolean
}>

export interface PlaybackPersistence {
  load(): PersistedPlaybackState | null
  save(state: PersistedPlaybackState): void
  clear?(): void
  legacyProgress?(locator: string): number | null
}

export interface PlaybackSession {
  getSnapshot(): PlaybackSnapshot
  subscribe(listener: () => void): () => void
  dispatch(command: PlaybackCommand): PlaybackOutcome
}

export type CreatePlaybackSessionOptions = Readonly<{
  scope: PlaybackScope
  sourceAdapter: PlaybackSourceAdapter
  persistence?: PlaybackPersistence
  initialOnline?: boolean
}>

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
  online: boolean
  source: PlaybackSource | null
  issue: PlaybackIssue | null
  error: string | null
}

type PendingVersion = Readonly<{
  item: PlaybackItem
  fallback: Readonly<{ url: string; sourceKind: PlaybackSourceKind }>
}> | null

function finiteAtLeast(value: number, minimum: number, fallback = minimum): number {
  return Number.isFinite(value) ? Math.max(minimum, value) : fallback
}

function normalizedItem(item: PlaybackItem): PlaybackItem {
  return Object.freeze({
    ref: Object.freeze({ libraryId: item.ref.libraryId, resourceId: item.ref.resourceId }),
    ...(item.version === undefined ? {} : { version: item.version }),
    locator: item.locator.replace(/\\/g, '/'),
    name: item.name,
    media: item.media,
  })
}

export function playbackResourceKey(value: Pick<PlaybackItem, 'ref'>): string {
  const { libraryId, resourceId } = value.ref
  return `${libraryId.length}:${libraryId}${resourceId.length}:${resourceId}`
}

function sameItem(left: PlaybackItem | null | undefined, right: PlaybackItem | null | undefined) {
  return !!left && !!right && playbackResourceKey(left) === playbackResourceKey(right)
}

function dedupeQueue(queue: readonly PlaybackItem[]): PlaybackItem[] {
  const seen = new Set<string>()
  const result: PlaybackItem[] = []
  for (const raw of queue) {
    if (!validItem(raw)) continue
    const item = normalizedItem(raw)
    const key = playbackResourceKey(item)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

function validItem(value: unknown): value is PlaybackItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<PlaybackItem>
  return !!(
    item.ref &&
    typeof item.ref.libraryId === 'string' &&
    item.ref.libraryId.length > 0 &&
    typeof item.ref.resourceId === 'string' &&
    item.ref.resourceId.length > 0 &&
    (item.version === undefined || typeof item.version === 'string') &&
    typeof item.locator === 'string' &&
    item.locator.length > 0 &&
    typeof item.name === 'string' &&
    (item.media === 'audio' || item.media === 'video')
  )
}

function validPersisted(value: unknown): value is PersistedPlaybackState {
  if (!value || typeof value !== 'object') return false
  const state = value as Partial<PersistedPlaybackState>
  return !!(
    state.schemaVersion === 1 &&
    Array.isArray(state.queue) &&
    state.queue.every(validItem) &&
    typeof state.currentIndex === 'number' &&
    typeof state.position === 'number' &&
    typeof state.duration === 'number' &&
    (state.mode === 'audio' || state.mode === 'video') &&
    typeof state.volume === 'number' &&
    typeof state.muted === 'boolean' &&
    typeof state.repeat === 'boolean'
  )
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return !!value && typeof (value as Promise<T>).then === 'function'
}

function currentItem(state: MutableState): PlaybackItem | null {
  return state.currentIndex >= 0 ? (state.queue[state.currentIndex] ?? null) : null
}

function modeFor(item: PlaybackItem, requested?: PlaybackMode): PlaybackMode {
  if (item.media === 'audio') return 'audio'
  return requested ?? 'video'
}

function persistedState(state: MutableState): PersistedPlaybackState {
  const position =
    state.duration > 0 && state.position >= state.duration * 0.9
      ? 0
      : finiteAtLeast(state.position, 0)
  return {
    schemaVersion: 1,
    queue: state.queue.map(normalizedItem),
    currentIndex: state.currentIndex,
    position,
    duration: finiteAtLeast(state.duration, 0),
    mode: state.mode,
    volume: Math.min(1, finiteAtLeast(state.volume, 0, 1)),
    muted: state.muted,
    repeat: state.repeat,
  }
}

function restoredState(
  persistence: PlaybackPersistence | undefined,
): PersistedPlaybackState | null {
  try {
    const restored = persistence?.load()
    return validPersisted(restored) ? restored : null
  } catch {
    return null
  }
}

export function createPlaybackSession(options: CreatePlaybackSessionOptions): PlaybackSession {
  const restored = restoredState(options.persistence)
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
    online: options.initialOnline ?? true,
    source: null,
    issue: null,
    error: null,
  }

  const listeners = new Set<() => void>()
  let generation = 0
  let resolveAbort: AbortController | null = null
  let pendingVersion: PendingVersion = null
  let lastCheckpointPosition = state.position
  let notifying = false
  let queuedNotify = false

  const snapshot = (): PlaybackSnapshot =>
    Object.freeze({
      revision: state.revision,
      scope: Object.freeze({ ...options.scope }) as PlaybackScope,
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
      online: state.online,
      source: state.source,
      issue: state.issue,
      error: state.error,
    })

  function persist(force = true) {
    if (!options.persistence || state.phase === 'destroyed') return
    if (!force && Math.abs(state.position - lastCheckpointPosition) < 5) return
    try {
      options.persistence.save(persistedState(state))
      lastCheckpointPosition = state.position
    } catch {}
  }

  function notify(forcePersist = true, save = true) {
    state.revision += 1
    if (save) persist(forcePersist)
    if (notifying) {
      queuedNotify = true
      return
    }
    notifying = true
    try {
      do {
        queuedNotify = false
        for (const listener of [...listeners]) listener()
      } while (queuedNotify)
    } finally {
      notifying = false
    }
  }

  function reject(reason: PlaybackOutcome['reason']): PlaybackOutcome {
    return { accepted: false, changed: false, reason }
  }

  function changed(extra: Partial<PlaybackOutcome> = {}): PlaybackOutcome {
    return { accepted: true, changed: true, ...extra }
  }

  function unchanged(): PlaybackOutcome {
    return { accepted: true, changed: false }
  }

  function updateCurrentItem(item: PlaybackItem) {
    const index = state.queue.findIndex((candidate) => sameItem(candidate, item))
    if (index >= 0) {
      state.queue[index] = normalizedItem(item)
    } else if (state.currentIndex >= 0 && state.currentIndex < state.queue.length) {
      // A legacy path reference can be reconciled to its stable catalog identity.
      state.queue[state.currentIndex] = normalizedItem(item)
    }
  }

  function applyResolution(result: PlaybackSourceResolution, sourceGeneration: number) {
    if (state.phase === 'destroyed' || sourceGeneration !== generation) return
    if (result.kind === 'resolved') {
      if (result.item) updateCurrentItem(result.item)
      state.source = Object.freeze({
        url: result.url,
        sourceKind: result.sourceKind,
        generation: sourceGeneration,
      })
      state.phase = 'ready'
      state.issue = null
      state.error = null
      pendingVersion = null
      notify()
      return
    }
    state.source = null
    state.desiredPlaying = false
    if (result.kind === 'recoverable') {
      if (result.item && result.issue !== 'versionChanged') updateCurrentItem(result.item)
      state.phase = 'recoverable'
      state.issue = result.issue
      state.error = result.message
      pendingVersion =
        result.issue === 'versionChanged' && result.item && result.fallback
          ? { item: normalizedItem(result.item), fallback: result.fallback }
          : null
    } else {
      state.phase = 'error'
      state.issue = null
      state.error = result.message
      pendingVersion = null
    }
    notify()
  }

  function resolveSource(reason: PlaybackResolveReason): PlaybackOutcome {
    const item = currentItem(state)
    if (!item) return reject('emptyQueue')
    resolveAbort?.abort()
    const abort = new AbortController()
    resolveAbort = abort
    generation += 1
    const sourceGeneration = generation
    state.phase = 'resolving'
    state.source = null
    state.issue = null
    state.error = null
    pendingVersion = null
    notify()
    let result: PlaybackSourceResolution | Promise<PlaybackSourceResolution>
    try {
      result = options.sourceAdapter.resolve({
        scope: options.scope,
        item,
        mode: state.mode,
        online: state.online,
        reason,
        signal: abort.signal,
      })
    } catch (error) {
      applyResolution(
        {
          kind: 'error',
          message: error instanceof Error ? error.message : 'Playback source resolution failed.',
          retryable: true,
        },
        sourceGeneration,
      )
      return changed({ generation: sourceGeneration })
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
              retryable: true,
            },
            sourceGeneration,
          )
        },
      )
    } else {
      applyResolution(result, sourceGeneration)
    }
    return changed({ generation: sourceGeneration })
  }

  function selectIndex(index: number, reason: PlaybackResolveReason, autoplay: boolean) {
    state.currentIndex = index
    const item = currentItem(state)!
    state.position = options.persistence?.legacyProgress?.(item.locator) ?? 0
    state.duration = 0
    state.desiredPlaying = autoplay
    state.mode = modeFor(item)
    return resolveSource(reason)
  }

  function stale(given: number) {
    return !state.source || given !== state.source.generation
  }

  function dispatch(command: PlaybackCommand): PlaybackOutcome {
    if (state.phase === 'destroyed') return reject('destroyed')

    switch (command.type) {
      case 'load': {
        if (!validItem(command.item)) return reject('invalid')
        const item = normalizedItem(command.item)
        const previous = currentItem(state)
        const same = sameItem(previous, item)
        const requestedQueue = command.queue ? dedupeQueue(command.queue) : [...state.queue]
        const itemKey = playbackResourceKey(item)
        let index = requestedQueue.findIndex(
          (candidate) => playbackResourceKey(candidate) === itemKey,
        )
        if (index < 0) {
          requestedQueue.push(item)
          index = requestedQueue.length - 1
        } else {
          requestedQueue[index] = item
        }
        state.queue = requestedQueue
        state.currentIndex = index
        state.mode = modeFor(item, command.mode ?? (same ? state.mode : undefined))
        state.desiredPlaying = command.autoplay ?? true
        if (!same) {
          state.position =
            command.position ?? options.persistence?.legacyProgress?.(item.locator) ?? 0
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
        if (state.currentIndex < 0 && queue.length) state.currentIndex = 0
        if (!sameItem(previous, currentItem(state))) {
          resolveAbort?.abort()
          resolveAbort = null
          generation += 1
          state.position = 0
          state.duration = 0
          state.desiredPlaying = false
          state.source = null
          state.phase = currentItem(state) ? 'paused' : 'idle'
        }
        notify()
        return changed()
      }
      case 'play':
        if (!currentItem(state)) return reject('emptyQueue')
        if (state.phase === 'recoverable') return reject('unavailable')
        if (state.desiredPlaying) return unchanged()
        state.desiredPlaying = true
        if (state.phase === 'ended') state.position = 0
        if (!state.source) return resolveSource('retry')
        state.phase = 'ready'
        notify()
        return changed({ generation: state.source.generation })
      case 'pause':
        if (!state.desiredPlaying && state.phase === 'paused') return unchanged()
        state.desiredPlaying = false
        if (state.source) state.phase = 'paused'
        notify()
        return changed({ generation: state.source?.generation })
      case 'toggle':
        return dispatch({ type: state.desiredPlaying ? 'pause' : 'play' })
      case 'seek': {
        if (!currentItem(state)) return reject('emptyQueue')
        const max = state.duration > 0 ? state.duration : Number.POSITIVE_INFINITY
        const position = Math.min(max, finiteAtLeast(command.position, 0))
        if (position === state.position) return unchanged()
        state.position = position
        if (state.phase === 'ended' && position < state.duration) state.phase = 'paused'
        notify(false)
        return changed({ generation: state.source?.generation })
      }
      case 'time':
        if (stale(command.generation)) return reject('staleSource')
        state.position = finiteAtLeast(command.position, 0)
        if (command.duration !== undefined && Number.isFinite(command.duration)) {
          state.duration = finiteAtLeast(command.duration, 0)
        }
        notify(false)
        return changed({ generation: command.generation })
      case 'duration':
        if (stale(command.generation)) return reject('staleSource')
        state.duration = finiteAtLeast(command.duration, 0)
        notify(false)
        return changed({ generation: command.generation })
      case 'mediaReady':
        if (stale(command.generation)) return reject('staleSource')
        state.phase = 'ready'
        notify()
        return changed({ generation: command.generation })
      case 'mediaPlay':
        if (stale(command.generation)) return reject('staleSource')
        state.desiredPlaying = true
        state.phase = 'playing'
        notify()
        return changed({ generation: command.generation })
      case 'mediaPause':
        if (stale(command.generation)) return reject('staleSource')
        state.desiredPlaying = false
        state.phase = 'paused'
        notify()
        return changed({ generation: command.generation })
      case 'mediaEnded':
        if (stale(command.generation)) return reject('staleSource')
        if (state.repeat) {
          state.position = 0
          state.desiredPlaying = true
          state.phase = 'ready'
          notify()
          return changed({ generation: command.generation })
        }
        if (state.currentIndex + 1 < state.queue.length) {
          return selectIndex(state.currentIndex + 1, 'load', true)
        }
        state.position = state.duration
        state.desiredPlaying = false
        state.phase = 'ended'
        notify()
        return changed({ generation: command.generation })
      case 'mediaError':
        if (stale(command.generation)) return reject('staleSource')
        state.desiredPlaying = false
        state.phase = state.online ? 'error' : 'recoverable'
        state.issue = state.online ? null : 'offlineUnavailable'
        state.error = state.online
          ? (command.message ?? 'Playback failed.')
          : 'This media item is not available offline.'
        notify()
        return changed({ generation: command.generation })
      case 'next':
        if (state.currentIndex < 0 || state.currentIndex + 1 >= state.queue.length) {
          return reject('emptyQueue')
        }
        return selectIndex(state.currentIndex + 1, 'load', true)
      case 'previous':
        if (!currentItem(state)) return reject('emptyQueue')
        if (state.position > 20) return dispatch({ type: 'seek', position: 0 })
        if (state.currentIndex <= 0) return reject('emptyQueue')
        return selectIndex(state.currentIndex - 1, 'load', true)
      case 'retry':
        if (!currentItem(state)) return reject('emptyQueue')
        state.desiredPlaying = true
        return resolveSource('retry')
      case 'refreshSource':
        return resolveSource('refresh')
      case 'onlineChanged':
      case 'setOnline':
        if (state.online === command.online) return unchanged()
        state.online = command.online
        if (currentItem(state)) return resolveSource('onlineChange')
        notify()
        return changed()
      case 'setMode': {
        const item = currentItem(state)
        if (!item) return reject('emptyQueue')
        const mode = modeFor(item, command.mode)
        if (state.mode === mode) return unchanged()
        state.mode = mode
        return resolveSource('load')
      }
      case 'setVolume': {
        const volume = Math.min(1, finiteAtLeast(command.volume, 0, 1))
        if (state.volume === volume && state.muted === (volume === 0)) return unchanged()
        state.volume = volume
        state.muted = volume === 0
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
      case 'acceptVersion':
        if (!pendingVersion) return reject('unavailable')
        updateCurrentItem(pendingVersion.item)
        state.position = 0
        state.duration = 0
        state.source = Object.freeze({
          ...pendingVersion.fallback,
          generation: ++generation,
        })
        state.issue = null
        state.error = null
        state.desiredPlaying = true
        state.phase = 'ready'
        pendingVersion = null
        notify()
        return changed({ generation })
      case 'checkpoint':
        persist(true)
        return unchanged()
      case 'stop':
        resolveAbort?.abort()
        resolveAbort = null
        state.queue = []
        state.currentIndex = -1
        state.position = 0
        state.duration = 0
        state.desiredPlaying = false
        state.source = null
        state.issue = null
        state.error = null
        state.phase = 'idle'
        pendingVersion = null
        try {
          options.persistence?.clear?.()
        } catch {}
        notify(true, false)
        return changed()
      case 'teardown':
        resolveAbort?.abort()
        resolveAbort = null
        state.desiredPlaying = false
        state.source = null
        persist(true)
        state.phase = 'destroyed'
        pendingVersion = null
        state.revision += 1
        for (const listener of [...listeners]) listener()
        listeners.clear()
        return changed()
    }
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

export const OWNER_PLAYBACK_STORAGE_KEY = 'derp-playback-session-owner-v1'

export function createBrowserPlaybackPersistence(
  key = OWNER_PLAYBACK_STORAGE_KEY,
  legacyProgressKey = 'video-playback-times',
): PlaybackPersistence {
  const storage = typeof window === 'undefined' ? null : window.localStorage
  const readRaw = (storageKey: string): unknown => {
    if (!storage) return null
    try {
      const parsed = JSON.parse(storage.getItem(storageKey) ?? 'null') as unknown
      if (parsed && typeof parsed === 'object' && 'state' in parsed) {
        return (parsed as { state?: unknown }).state ?? null
      }
      return parsed
    } catch {
      return null
    }
  }
  return {
    load() {
      const value = readRaw(key)
      return validPersisted(value) ? value : null
    },
    save(value) {
      if (!storage) return
      storage.setItem(key, JSON.stringify({ state: value, version: 1 }))
      const progress = readRaw(legacyProgressKey)
      const playbackTimes =
        progress && typeof progress === 'object' && 'playbackTimes' in progress
          ? { ...((progress as { playbackTimes?: Record<string, number> }).playbackTimes ?? {}) }
          : {}
      const current = value.queue[value.currentIndex]
      if (current) {
        if (
          value.position === 0 ||
          (value.duration > 0 && value.position >= value.duration * 0.9)
        ) {
          delete playbackTimes[current.locator]
        } else if (value.position > 0) {
          playbackTimes[current.locator] = value.position
        }
        storage.setItem(legacyProgressKey, JSON.stringify({ state: { playbackTimes }, version: 0 }))
      }
    },
    clear() {
      storage?.removeItem(key)
    },
    legacyProgress(locator) {
      const value = readRaw(legacyProgressKey)
      if (!value || typeof value !== 'object' || !('playbackTimes' in value)) return null
      const time = (value as { playbackTimes?: Record<string, unknown> }).playbackTimes?.[locator]
      return typeof time === 'number' && Number.isFinite(time) && time >= 0 ? time : null
    },
  }
}
