import { describe, expect, test } from 'bun:test'
import {
  createBrowserPlaybackPersistence,
  createPlaybackSession,
  playbackResourceKey,
  type PersistedPlaybackState,
  type PlaybackItem,
  type PlaybackPersistence,
  type PlaybackSourceAdapter,
  type PlaybackSourceRequest,
  type PlaybackSourceResolution,
} from '@/lib/playback-session'

type Deferred<T> = {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

function item(id: string, overrides: Partial<PlaybackItem> = {}): PlaybackItem {
  return {
    ref: { libraryId: 'library-1', resourceId: id },
    version: 'v1',
    locator: `Music/${id}.mp3`,
    name: `${id}.mp3`,
    media: 'audio',
    ...overrides,
  }
}

function resolved(
  request: PlaybackSourceRequest,
  overrides: Partial<Extract<PlaybackSourceResolution, { kind: 'resolved' }>> = {},
): PlaybackSourceResolution {
  return {
    kind: 'resolved',
    url: `/media/${encodeURIComponent(request.item.locator)}?reason=${request.reason}`,
    sourceKind: request.online ? 'online' : 'offline',
    ...overrides,
  }
}

function adapterHarness(
  implementation: (
    request: PlaybackSourceRequest,
  ) => PlaybackSourceResolution | Promise<PlaybackSourceResolution> = resolved,
) {
  const requests: PlaybackSourceRequest[] = []
  const adapter: PlaybackSourceAdapter = {
    resolve(request) {
      requests.push(request)
      return implementation(request)
    },
  }
  return { adapter, requests }
}

function persistenceHarness(restored: unknown = null, legacy: Record<string, number> = {}) {
  const saves: PersistedPlaybackState[] = []
  let clears = 0
  const persistence: PlaybackPersistence = {
    load: () => restored as PersistedPlaybackState | null,
    save: (state) => saves.push(JSON.parse(JSON.stringify(state)) as PersistedPlaybackState),
    clear: () => {
      clears += 1
    },
    legacyProgress: (locator) => legacy[locator] ?? null,
  }
  return {
    persistence,
    saves,
    get clears() {
      return clears
    },
  }
}

async function flushAsyncResolution() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('PlaybackSession transitions', () => {
  test('publishes resolving before ready and follows explicit transport event order', () => {
    const source = adapterHarness()
    const session = createPlaybackSession({
      scope: { kind: 'owner' },
      sourceAdapter: source.adapter,
    })
    const events: string[] = []
    session.subscribe(() => {
      const snapshot = session.getSnapshot()
      events.push(`${snapshot.revision}:${snapshot.phase}:${snapshot.desiredPlaying}`)
    })

    expect(session.getSnapshot()).toMatchObject({
      phase: 'idle',
      currentItem: null,
      currentIndex: -1,
      desiredPlaying: false,
      revision: 0,
    })
    const load = session.dispatch({ type: 'load', item: item('one'), autoplay: true })
    expect(load).toEqual({ accepted: true, changed: true, generation: 1 })
    expect(events).toEqual(['1:resolving:true', '2:ready:true'])
    expect(source.requests[0]).toMatchObject({
      scope: { kind: 'owner' },
      mode: 'audio',
      online: true,
      reason: 'load',
    })

    session.dispatch({ type: 'mediaReady', generation: 1 })
    session.dispatch({ type: 'mediaPlay', generation: 1 })
    expect(session.getSnapshot()).toMatchObject({ phase: 'playing', desiredPlaying: true })

    session.dispatch({ type: 'duration', generation: 1, duration: 90 })
    session.dispatch({ type: 'time', generation: 1, position: 14, duration: 90 })
    session.dispatch({ type: 'seek', position: 200 })
    expect(session.getSnapshot()).toMatchObject({ position: 90, duration: 90 })

    session.dispatch({ type: 'pause' })
    expect(session.getSnapshot()).toMatchObject({ phase: 'paused', desiredPlaying: false })
    const play = session.dispatch({ type: 'toggle' })
    expect(play).toMatchObject({ accepted: true, generation: 1 })
    expect(session.getSnapshot()).toMatchObject({ phase: 'ready', desiredPlaying: true })

    session.dispatch({ type: 'setVolume', volume: 2 })
    session.dispatch({ type: 'setMuted', muted: true })
    session.dispatch({ type: 'toggleRepeat' })
    expect(session.getSnapshot()).toMatchObject({ volume: 1, muted: true, repeat: true })
  })

  test('unmuting after the volume reaches zero restores an audible level', () => {
    const source = adapterHarness()
    const session = createPlaybackSession({
      scope: { kind: 'owner' },
      sourceAdapter: source.adapter,
    })

    session.dispatch({ type: 'load', item: item('muted') })
    session.dispatch({ type: 'setVolume', volume: 0 })
    expect(session.getSnapshot()).toMatchObject({ volume: 0, muted: true })

    session.dispatch({ type: 'setMuted', muted: false })
    expect(session.getSnapshot()).toMatchObject({ volume: 0.5, muted: false })
  })

  test('same-Resource load enriches queue metadata without resetting continuity', () => {
    const source = adapterHarness()
    const session = createPlaybackSession({
      scope: { kind: 'owner' },
      sourceAdapter: source.adapter,
    })
    const original = item('stable', { locator: 'Music/old.mp3', name: 'old.mp3' })
    const moved = item('stable', { version: 'v2', locator: 'Archive/new.mp3', name: 'new.mp3' })

    session.dispatch({ type: 'load', item: original })
    session.dispatch({ type: 'duration', generation: 1, duration: 120 })
    session.dispatch({ type: 'time', generation: 1, position: 42 })
    session.dispatch({ type: 'load', item: moved, autoplay: false })

    expect(session.getSnapshot()).toMatchObject({
      currentIndex: 0,
      currentItem: moved,
      queue: [moved],
      position: 42,
      duration: 120,
      desiredPlaying: false,
    })
    expect(source.requests).toHaveLength(2)
  })

  test('a resolved same-ref move updates the queue and retains position', () => {
    const moved = item('stable', { locator: 'Moved/track.mp3', name: 'track.mp3' })
    const source = adapterHarness((request) =>
      resolved(request, request.reason === 'refresh' ? { item: moved } : {}),
    )
    const session = createPlaybackSession({
      scope: { kind: 'owner' },
      sourceAdapter: source.adapter,
    })

    session.dispatch({ type: 'load', item: item('stable', { locator: 'Old/track.mp3' }) })
    session.dispatch({ type: 'seek', position: 19 })
    session.dispatch({ type: 'refreshSource' })

    expect(session.getSnapshot()).toMatchObject({
      currentItem: moved,
      queue: [moved],
      position: 19,
      phase: 'ready',
    })
  })
})

describe('PlaybackSession queue semantics', () => {
  test('deduplicates by ResourceRef and implements next and previous without identity loss', () => {
    const source = adapterHarness()
    const a = item('a')
    const duplicateA = item('a', { locator: 'Moved/a.mp3', name: 'moved-a.mp3' })
    const b = item('b', {
      locator: 'Videos/b.mp4',
      name: 'b.mp4',
      media: 'video',
    })
    const c = item('c')
    const session = createPlaybackSession({
      scope: { kind: 'owner' },
      sourceAdapter: source.adapter,
    })

    session.dispatch({ type: 'load', item: a, queue: [a, duplicateA, b, c], autoplay: false })
    expect(session.getSnapshot().queue.map(playbackResourceKey)).toEqual([
      playbackResourceKey(a),
      playbackResourceKey(b),
      playbackResourceKey(c),
    ])

    session.dispatch({ type: 'next' })
    expect(session.getSnapshot()).toMatchObject({ currentItem: b, currentIndex: 1, mode: 'video' })
    session.dispatch({ type: 'seek', position: 25 })
    const restart = session.dispatch({ type: 'previous' })
    expect(restart).toMatchObject({ accepted: true, generation: 2 })
    expect(session.getSnapshot()).toMatchObject({ currentItem: b, currentIndex: 1, position: 0 })

    session.dispatch({ type: 'previous' })
    expect(session.getSnapshot()).toMatchObject({ currentItem: a, currentIndex: 0, mode: 'audio' })
    expect(session.dispatch({ type: 'previous' })).toEqual({
      accepted: false,
      changed: false,
      reason: 'emptyQueue',
    })
    session.dispatch({ type: 'next' })
    session.dispatch({ type: 'next' })
    expect(session.getSnapshot()).toMatchObject({ currentItem: c, currentIndex: 2 })
    expect(session.dispatch({ type: 'next' })).toMatchObject({
      accepted: false,
      reason: 'emptyQueue',
    })
  })

  test('ended advances, repeat replays in place, and the final item becomes ended', () => {
    const source = adapterHarness()
    const a = item('a')
    const b = item('b')
    const session = createPlaybackSession({
      scope: { kind: 'owner' },
      sourceAdapter: source.adapter,
    })

    session.dispatch({ type: 'load', item: a, queue: [a, b] })
    session.dispatch({ type: 'duration', generation: 1, duration: 30 })
    session.dispatch({ type: 'mediaEnded', generation: 1 })
    expect(session.getSnapshot()).toMatchObject({
      currentItem: b,
      currentIndex: 1,
      desiredPlaying: true,
      position: 0,
    })

    session.dispatch({ type: 'duration', generation: 2, duration: 40 })
    session.dispatch({ type: 'time', generation: 2, position: 39 })
    session.dispatch({ type: 'setRepeat', repeat: true })
    session.dispatch({ type: 'mediaEnded', generation: 2 })
    expect(session.getSnapshot()).toMatchObject({
      currentItem: b,
      phase: 'ready',
      desiredPlaying: true,
      position: 0,
    })

    session.dispatch({ type: 'setRepeat', repeat: false })
    session.dispatch({ type: 'mediaEnded', generation: 2 })
    expect(session.getSnapshot()).toMatchObject({
      phase: 'ended',
      desiredPlaying: false,
      position: 40,
    })
    session.dispatch({ type: 'play' })
    expect(session.getSnapshot()).toMatchObject({ phase: 'ready', position: 0 })
  })
})

describe('PlaybackSession source generations and recovery', () => {
  test('new loads abort old resolution and stale source events are inert', async () => {
    const first = deferred<PlaybackSourceResolution>()
    const second = deferred<PlaybackSourceResolution>()
    const source = adapterHarness((request) =>
      request.item.ref.resourceId === 'a' ? first.promise : second.promise,
    )
    const session = createPlaybackSession({
      scope: { kind: 'owner' },
      sourceAdapter: source.adapter,
    })
    let notifications = 0
    session.subscribe(() => {
      notifications += 1
    })

    const firstLoad = session.dispatch({ type: 'load', item: item('a') })
    const secondLoad = session.dispatch({ type: 'load', item: item('b') })
    expect(firstLoad.generation).toBe(1)
    expect(secondLoad.generation).toBe(2)
    expect(source.requests[0]!.signal.aborted).toBe(true)

    first.resolve({ kind: 'resolved', url: '/stale', sourceKind: 'online' })
    await flushAsyncResolution()
    expect(session.getSnapshot()).toMatchObject({ phase: 'resolving', currentItem: item('b') })
    const notificationsBeforeStaleEvent = notifications
    const revisionBeforeStaleEvent = session.getSnapshot().revision
    expect(session.dispatch({ type: 'time', generation: 1, position: 99 })).toEqual({
      accepted: false,
      changed: false,
      reason: 'staleSource',
    })
    expect(
      session.dispatch({ type: 'mediaError', generation: 1, message: 'late failure' }),
    ).toEqual({
      accepted: false,
      changed: false,
      reason: 'staleSource',
    })
    expect(notifications).toBe(notificationsBeforeStaleEvent)
    expect(session.getSnapshot().revision).toBe(revisionBeforeStaleEvent)

    second.resolve({ kind: 'resolved', url: '/current', sourceKind: 'online' })
    await flushAsyncResolution()
    expect(session.getSnapshot()).toMatchObject({
      phase: 'ready',
      source: { url: '/current', generation: 2 },
      position: 0,
    })
  })

  test('queue replacement invalidates a pending resolution for the previous item', async () => {
    const pending = deferred<PlaybackSourceResolution>()
    const source = adapterHarness(() => pending.promise)
    const session = createPlaybackSession({
      scope: { kind: 'owner' },
      sourceAdapter: source.adapter,
    })

    session.dispatch({ type: 'load', item: item('a') })
    session.dispatch({ type: 'setQueue', queue: [item('b')], current: item('b') })
    expect(source.requests[0]!.signal.aborted).toBe(true)
    expect(session.getSnapshot()).toMatchObject({
      currentItem: item('b'),
      phase: 'paused',
      source: null,
    })

    pending.resolve({ kind: 'resolved', url: '/stale-a', sourceKind: 'online' })
    await flushAsyncResolution()
    expect(session.getSnapshot()).toMatchObject({
      currentItem: item('b'),
      phase: 'paused',
      source: null,
    })
  })

  test('retry, refresh, mode, and online changes replace only the source', () => {
    const source = adapterHarness((request) => ({
      kind: 'resolved',
      url: `/${request.reason}/${request.mode}/${request.online ? 'online' : 'offline'}`,
      sourceKind: request.online ? 'online' : 'offline',
    }))
    const video = item('video', {
      locator: 'Videos/video.mp4',
      name: 'video.mp4',
      media: 'video',
    })
    const session = createPlaybackSession({
      scope: { kind: 'owner' },
      sourceAdapter: source.adapter,
    })

    session.dispatch({ type: 'load', item: video })
    session.dispatch({ type: 'seek', position: 31 })
    session.dispatch({ type: 'mediaError', generation: 1, message: 'expired URL' })
    expect(session.getSnapshot()).toMatchObject({ phase: 'error', position: 31 })

    session.dispatch({ type: 'retry' })
    expect(session.getSnapshot()).toMatchObject({
      phase: 'ready',
      desiredPlaying: true,
      position: 31,
      source: { url: '/retry/video/online', generation: 2 },
    })
    session.dispatch({ type: 'refreshSource' })
    expect(session.getSnapshot()).toMatchObject({
      position: 31,
      source: { url: '/refresh/video/online', generation: 3 },
    })
    session.dispatch({ type: 'setMode', mode: 'audio' })
    expect(session.getSnapshot()).toMatchObject({
      mode: 'audio',
      position: 31,
      source: { url: '/load/audio/online', generation: 4 },
    })
    session.dispatch({ type: 'setOnline', online: false })
    expect(session.getSnapshot()).toMatchObject({
      online: false,
      position: 31,
      currentIndex: 0,
      source: { url: '/onlineChange/audio/offline', sourceKind: 'offline', generation: 5 },
    })
    expect(session.getSnapshot().queue).toHaveLength(1)
    session.dispatch({ type: 'onlineChanged', online: true })
    expect(session.getSnapshot()).toMatchObject({
      online: true,
      position: 31,
      source: { url: '/onlineChange/audio/online', generation: 6 },
    })
  })

  test('a media-element failure from an offline source is explicitly recoverable', () => {
    const source = adapterHarness((request) => ({
      kind: 'resolved',
      url: '/offline/media/track.mp3',
      sourceKind: request.online ? 'online' : 'offline',
    }))
    const session = createPlaybackSession({
      scope: { kind: 'owner' },
      sourceAdapter: source.adapter,
      initialOnline: false,
    })

    session.dispatch({ type: 'load', item: item('offline'), position: 19 })
    session.dispatch({
      type: 'mediaError',
      generation: 1,
      message: 'The installed media bytes are unavailable.',
    })

    expect(session.getSnapshot()).toMatchObject({
      phase: 'recoverable',
      issue: 'offlineUnavailable',
      error: 'This media item is not available offline.',
      desiredPlaying: false,
      position: 19,
      source: { sourceKind: 'offline', generation: 1 },
    })
  })

  for (const issue of ['missing', 'sourceUnavailable', 'revoked', 'offlineUnavailable'] as const) {
    test(`${issue} is explicit, recoverable, and blocks implicit play`, () => {
      let recover = false
      const source = adapterHarness((request) =>
        recover ? resolved(request) : { kind: 'recoverable', issue, message: `recover ${issue}` },
      )
      const session = createPlaybackSession({
        scope: { kind: 'owner' },
        sourceAdapter: source.adapter,
      })

      session.dispatch({ type: 'load', item: item(issue), position: 8 })
      expect(session.getSnapshot()).toMatchObject({
        phase: 'recoverable',
        issue,
        error: `recover ${issue}`,
        position: 8,
        source: null,
      })
      expect(session.dispatch({ type: 'play' })).toEqual({
        accepted: false,
        changed: false,
        reason: 'unavailable',
      })
      recover = true
      session.dispatch({ type: 'retry' })
      expect(session.getSnapshot()).toMatchObject({
        phase: 'ready',
        desiredPlaying: true,
        issue: null,
        error: null,
        position: 8,
      })
    })
  }

  test('version changes require acceptance before replacing queued identity metadata', () => {
    const original = item('versioned', { version: 'v1', locator: 'Music/old.mp3' })
    const changedItem = item('versioned', { version: 'v2', locator: 'Music/new.mp3' })
    const source = adapterHarness(() => ({
      kind: 'recoverable',
      issue: 'versionChanged',
      message: 'Media changed',
      item: changedItem,
      fallback: { url: '/accepted-v2', sourceKind: 'online' },
    }))
    const session = createPlaybackSession({
      scope: { kind: 'owner' },
      sourceAdapter: source.adapter,
    })

    session.dispatch({ type: 'load', item: original, position: 17 })
    expect(session.getSnapshot()).toMatchObject({
      phase: 'recoverable',
      issue: 'versionChanged',
      currentItem: original,
      position: 17,
    })
    const accepted = session.dispatch({ type: 'acceptVersion' })
    expect(accepted).toEqual({ accepted: true, changed: true, generation: 2 })
    expect(session.getSnapshot()).toMatchObject({
      phase: 'ready',
      issue: null,
      currentItem: changedItem,
      position: 0,
      duration: 0,
      source: { url: '/accepted-v2', sourceKind: 'online', generation: 2 },
    })
    expect(session.dispatch({ type: 'acceptVersion' })).toMatchObject({
      accepted: false,
      reason: 'unavailable',
    })
  })

  test('teardown aborts resolution, notifies once, and permanently rejects commands', async () => {
    const pending = deferred<PlaybackSourceResolution>()
    const source = adapterHarness(() => pending.promise)
    const session = createPlaybackSession({
      scope: { kind: 'owner' },
      sourceAdapter: source.adapter,
    })
    let notifications = 0
    session.subscribe(() => {
      notifications += 1
    })

    session.dispatch({ type: 'load', item: item('pending') })
    const beforeTeardown = notifications
    expect(session.dispatch({ type: 'teardown' })).toMatchObject({ accepted: true, changed: true })
    expect(source.requests[0]!.signal.aborted).toBe(true)
    expect(session.getSnapshot()).toMatchObject({
      phase: 'destroyed',
      desiredPlaying: false,
      source: null,
    })
    expect(notifications).toBe(beforeTeardown + 1)
    expect(session.dispatch({ type: 'load', item: item('late') })).toEqual({
      accepted: false,
      changed: false,
      reason: 'destroyed',
    })

    const destroyedRevision = session.getSnapshot().revision
    pending.resolve({ kind: 'resolved', url: '/too-late', sourceKind: 'online' })
    await flushAsyncResolution()
    expect(session.getSnapshot().revision).toBe(destroyedRevision)
    expect(notifications).toBe(beforeTeardown + 1)
  })
})

describe('PlaybackSession persistence and scope isolation', () => {
  test('checkpoint persists sub-five-second progress without changing session state', () => {
    const persistence = persistenceHarness()
    const session = createPlaybackSession({
      scope: { kind: 'owner' },
      sourceAdapter: adapterHarness().adapter,
      persistence: persistence.persistence,
    })

    session.dispatch({ type: 'load', item: item('short-video'), autoplay: false })
    const savesBeforeProgress = persistence.saves.length
    session.dispatch({ type: 'time', generation: 1, position: 0.8, duration: 2 })

    expect(persistence.saves).toHaveLength(savesBeforeProgress)
    const snapshotBeforeCheckpoint = session.getSnapshot()
    expect(session.dispatch({ type: 'checkpoint' })).toEqual({ accepted: true, changed: false })
    expect(persistence.saves.at(-1)).toMatchObject({ position: 0.8, duration: 2 })
    expect(session.getSnapshot()).toEqual(snapshotBeforeCheckpoint)
  })

  test('persists only safe queue continuity, never runtime source or scope credentials', () => {
    const persistence = persistenceHarness()
    const source = adapterHarness(() => ({
      kind: 'resolved',
      url: '/api/share/super-secret-token/media/track.mp3',
      sourceKind: 'online',
    }))
    const session = createPlaybackSession({
      scope: { kind: 'grantSession', id: 'secret-grant-session-id' },
      sourceAdapter: source.adapter,
      persistence: persistence.persistence,
    })
    const track = item('shared', { locator: 'SharedContent/track.mp3' })

    session.dispatch({ type: 'load', item: track, position: 12 })
    session.dispatch({ type: 'setRepeat', repeat: true })

    const saved = persistence.saves.at(-1)!
    expect(saved).toEqual({
      schemaVersion: 1,
      queue: [track],
      currentIndex: 0,
      position: 12,
      duration: 0,
      mode: 'audio',
      volume: 1,
      muted: false,
      repeat: true,
    })
    const serialized = JSON.stringify(saved)
    expect(serialized).not.toContain('super-secret-token')
    expect(serialized).not.toContain('secret-grant-session-id')
    expect(serialized).not.toContain('/api/share/')
    expect(serialized).not.toContain('sourceKind')
  })

  test('restores valid state idempotently and resolves the selected item without autoplay', async () => {
    const a = item('a')
    const b = item('b')
    const restored: PersistedPlaybackState = {
      schemaVersion: 1,
      queue: [a, b],
      currentIndex: 1,
      position: 23,
      duration: 80,
      mode: 'audio',
      volume: 0.4,
      muted: true,
      repeat: true,
    }
    const persistence = persistenceHarness(restored)
    const source = adapterHarness()
    const session = createPlaybackSession({
      scope: { kind: 'owner' },
      sourceAdapter: source.adapter,
      persistence: persistence.persistence,
    })

    expect(session.getSnapshot()).toMatchObject({
      phase: 'resolving',
      currentItem: b,
      position: 23,
      duration: 80,
      desiredPlaying: false,
      volume: 0.4,
      muted: true,
      repeat: true,
    })
    await flushAsyncResolution()
    expect(source.requests).toHaveLength(1)
    expect(source.requests[0]).toMatchObject({ reason: 'restore', item: b })
    expect(session.getSnapshot()).toMatchObject({
      phase: 'ready',
      currentItem: b,
      position: 23,
      desiredPlaying: false,
    })

    const secondPersistence = persistenceHarness(persistence.saves.at(-1))
    const secondSource = adapterHarness()
    const second = createPlaybackSession({
      scope: { kind: 'owner' },
      sourceAdapter: secondSource.adapter,
      persistence: secondPersistence.persistence,
    })
    await flushAsyncResolution()
    expect(second.getSnapshot()).toMatchObject({ currentItem: b, position: 23, phase: 'ready' })
  })

  test('ignores corrupt, throwing, and unsupported persisted state', () => {
    const cases: unknown[] = [
      { schemaVersion: 2, queue: [] },
      { schemaVersion: 1, queue: [{ nope: true }] },
      { schemaVersion: 1, queue: [], currentIndex: Number.NaN },
    ]
    for (const restored of cases) {
      const source = adapterHarness()
      const persistence = persistenceHarness(restored)
      const session = createPlaybackSession({
        scope: { kind: 'owner' },
        sourceAdapter: source.adapter,
        persistence: persistence.persistence,
      })
      expect(session.getSnapshot()).toMatchObject({ phase: 'idle', queue: [], currentIndex: -1 })
      expect(source.requests).toEqual([])
    }

    const source = adapterHarness()
    const session = createPlaybackSession({
      scope: { kind: 'owner' },
      sourceAdapter: source.adapter,
      persistence: {
        load() {
          throw new Error('corrupt storage')
        },
        save() {},
      },
    })
    expect(session.getSnapshot().phase).toBe('idle')
  })

  test('migrates legacy path progress and keeps the browser wrapper compatible', () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
    const values = new Map<string, string>()
    const storage = {
      getItem(key: string) {
        return values.get(key) ?? null
      },
      setItem(key: string, value: string) {
        values.set(key, value)
      },
      removeItem(key: string) {
        values.delete(key)
      },
    }
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage: storage },
    })

    try {
      const key = 'stage5-playback-test'
      const legacyKey = 'stage5-legacy-progress-test'
      values.set(
        legacyKey,
        JSON.stringify({
          state: { playbackTimes: { 'Music/legacy.mp3': 7 } },
          version: 0,
        }),
      )
      const persistence = createBrowserPlaybackPersistence(key, legacyKey)
      const source = adapterHarness()
      const session = createPlaybackSession({
        scope: { kind: 'owner' },
        sourceAdapter: source.adapter,
        persistence,
      })

      session.dispatch({
        type: 'load',
        item: item('legacy', { locator: 'Music/legacy.mp3' }),
      })
      expect(session.getSnapshot().position).toBe(7)
      session.dispatch({ type: 'time', generation: 1, position: 13, duration: 100 })

      const stored = values.get(key) ?? ''
      expect(JSON.parse(stored)).toMatchObject({
        version: 1,
        state: { schemaVersion: 1, position: 13, currentIndex: 0 },
      })
      expect(stored).not.toContain('/media/')
      expect(JSON.parse(values.get(legacyKey) ?? '{}')).toMatchObject({
        state: { playbackTimes: { 'Music/legacy.mp3': 13 } },
        version: 0,
      })

      values.set(key, '{bad json')
      expect(persistence.load()).toBeNull()
    } finally {
      if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
      else Reflect.deleteProperty(globalThis, 'window')
    }
  })

  test('owner and Grant instances resolve and mutate independently', () => {
    const ownerSource = adapterHarness()
    const grantSource = adapterHarness()
    const owner = createPlaybackSession({
      scope: { kind: 'owner' },
      sourceAdapter: ownerSource.adapter,
    })
    const grant = createPlaybackSession({
      scope: { kind: 'grantSession', id: 'grant-A' },
      sourceAdapter: grantSource.adapter,
    })

    owner.dispatch({ type: 'load', item: item('same'), position: 11 })
    grant.dispatch({
      type: 'load',
      item: item('same', { locator: 'Shared/track.mp3' }),
      position: 3,
      autoplay: false,
    })
    owner.dispatch({ type: 'setRepeat', repeat: true })
    grant.dispatch({ type: 'setMuted', muted: true })

    expect(ownerSource.requests[0]!.scope).toEqual({ kind: 'owner' })
    expect(grantSource.requests[0]!.scope).toEqual({ kind: 'grantSession', id: 'grant-A' })
    expect(owner.getSnapshot()).toMatchObject({
      position: 11,
      desiredPlaying: true,
      repeat: true,
      muted: false,
    })
    expect(grant.getSnapshot()).toMatchObject({
      position: 3,
      desiredPlaying: false,
      repeat: false,
      muted: true,
    })

    owner.dispatch({ type: 'teardown' })
    expect(owner.getSnapshot().phase).toBe('destroyed')
    expect(grant.getSnapshot().phase).toBe('ready')
    expect(grant.dispatch({ type: 'play' })).toMatchObject({ accepted: true })
  })
})
