import { describe, expect, test } from 'bun:test'
import {
  createBrowserPlaybackPersistence,
  createPlaybackSession,
  playbackItemKey,
  type PersistedPlaybackState,
  type PlaybackItem,
  type PlaybackPersistence,
  type PlaybackSourceRequest,
  type PlaybackSourceResolution,
  type PlaybackSourceResolver,
} from '@/src/features/playback'

type Deferred<T> = {
  promise: Promise<T>
  resolve(value: T): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((onResolve) => {
    resolve = onResolve
  })
  return { promise, resolve }
}

function item(id: string, overrides: Partial<PlaybackItem> = {}): PlaybackItem {
  return {
    resource: { provider: 'filesystem', id: `Music/${id}.mp3` },
    name: `${id}.mp3`,
    media: 'audio',
    ...overrides,
  }
}

function resolved(request: PlaybackSourceRequest): PlaybackSourceResolution {
  return {
    kind: 'resolved',
    url: `/media/${encodeURIComponent(request.item.resource.id)}?mode=${request.mode}`,
  }
}

function resolverHarness(
  implementation: (
    request: PlaybackSourceRequest,
  ) => PlaybackSourceResolution | Promise<PlaybackSourceResolution> = resolved,
) {
  const requests: PlaybackSourceRequest[] = []
  const resolver: PlaybackSourceResolver = {
    resolve(request) {
      requests.push(request)
      return implementation(request)
    },
  }
  return { resolver, requests }
}

function persistenceHarness(restored: unknown = null) {
  const saves: PersistedPlaybackState[] = []
  let cleared = 0
  const persistence: PlaybackPersistence = {
    load: () => restored,
    save: (state) => saves.push(structuredClone(state)),
    clear: () => {
      cleared += 1
    },
  }
  return {
    persistence,
    saves,
    get cleared() {
      return cleared
    },
  }
}

async function flushResolution() {
  await Promise.resolve()
  await Promise.resolve()
}

describe('owner PlaybackSession', () => {
  test('runs explicit load, transport, seek, volume, and mute transitions', () => {
    const source = resolverHarness()
    const session = createPlaybackSession({ sourceResolver: source.resolver })
    const revisions: number[] = []
    session.subscribe(() => revisions.push(session.getSnapshot().revision))

    expect(session.getSnapshot()).toMatchObject({
      phase: 'idle',
      currentIndex: -1,
      currentItem: null,
      desiredPlaying: false,
    })

    const loaded = session.dispatch({ type: 'load', item: item('one'), autoplay: true })
    expect(loaded).toMatchObject({ accepted: true, changed: true, generation: 1 })
    expect(session.getSnapshot()).toMatchObject({
      phase: 'ready',
      desiredPlaying: true,
      source: { generation: 1 },
    })
    expect(source.requests[0]).toMatchObject({ reason: 'load', mode: 'audio' })

    session.dispatch({ type: 'mediaPlay', generation: 1 })
    session.dispatch({ type: 'mediaDuration', generation: 1, duration: 90 })
    session.dispatch({ type: 'mediaTime', generation: 1, position: 14 })
    session.dispatch({ type: 'seek', position: 200 })
    expect(session.getSnapshot()).toMatchObject({
      phase: 'playing',
      position: 90,
      duration: 90,
    })

    session.dispatch({ type: 'pause' })
    expect(session.getSnapshot()).toMatchObject({ phase: 'paused', desiredPlaying: false })
    session.dispatch({ type: 'toggle' })
    expect(session.getSnapshot()).toMatchObject({ phase: 'ready', desiredPlaying: true })

    session.dispatch({ type: 'setVolume', volume: 2 })
    session.dispatch({ type: 'setMuted', muted: true })
    session.dispatch({ type: 'setVolume', volume: 0 })
    session.dispatch({ type: 'setMuted', muted: false })
    expect(session.getSnapshot()).toMatchObject({ volume: 0.5, muted: false })
    expect(revisions.length).toBeGreaterThan(0)
  })

  test('deduplicates queue identity and handles previous, next, repeat, and queue end', () => {
    const source = resolverHarness()
    const a = item('a')
    const movedA = item('a', { name: 'moved-a.mp3' })
    const video = item('video', {
      resource: { provider: 'filesystem', id: 'Videos/video.mp4' },
      name: 'video.mp4',
      media: 'video',
    })
    const c = item('c')
    const session = createPlaybackSession({ sourceResolver: source.resolver })

    session.dispatch({ type: 'load', item: a, queue: [a, movedA, video, c] })
    expect(session.getSnapshot().queue.map(playbackItemKey)).toEqual([
      playbackItemKey(a),
      playbackItemKey(video),
      playbackItemKey(c),
    ])

    session.dispatch({ type: 'next' })
    expect(session.getSnapshot()).toMatchObject({
      currentIndex: 1,
      currentItem: video,
      mode: 'video',
    })
    session.dispatch({ type: 'seek', position: 25 })
    session.dispatch({ type: 'previous' })
    expect(session.getSnapshot()).toMatchObject({ currentIndex: 1, position: 0 })
    session.dispatch({ type: 'previous' })
    expect(session.getSnapshot()).toMatchObject({ currentIndex: 0, currentItem: a, mode: 'audio' })

    session.dispatch({ type: 'next' })
    session.dispatch({ type: 'setRepeat', repeat: true })
    const repeatedGeneration = session.getSnapshot().source!.generation
    session.dispatch({ type: 'mediaDuration', generation: repeatedGeneration, duration: 30 })
    session.dispatch({ type: 'mediaTime', generation: repeatedGeneration, position: 29 })
    session.dispatch({ type: 'mediaEnded', generation: repeatedGeneration })
    expect(session.getSnapshot()).toMatchObject({
      currentIndex: 1,
      position: 0,
      desiredPlaying: true,
      repeat: true,
    })

    session.dispatch({ type: 'setRepeat', repeat: false })
    session.dispatch({ type: 'mediaEnded', generation: repeatedGeneration })
    expect(session.getSnapshot()).toMatchObject({ currentIndex: 2, currentItem: c })
    const finalGeneration = session.getSnapshot().source!.generation
    session.dispatch({ type: 'mediaDuration', generation: finalGeneration, duration: 40 })
    session.dispatch({ type: 'mediaEnded', generation: finalGeneration })
    expect(session.getSnapshot()).toMatchObject({
      phase: 'ended',
      position: 40,
      desiredPlaying: false,
    })
    session.dispatch({ type: 'play' })
    expect(session.getSnapshot()).toMatchObject({ phase: 'ready', position: 0 })
  })

  test('aborts replaced source resolution and rejects every stale media event', async () => {
    const first = deferred<PlaybackSourceResolution>()
    const second = deferred<PlaybackSourceResolution>()
    const source = resolverHarness((request) =>
      request.item.resource.id.endsWith('a.mp3') ? first.promise : second.promise,
    )
    const session = createPlaybackSession({ sourceResolver: source.resolver })

    expect(session.dispatch({ type: 'load', item: item('a') }).generation).toBe(1)
    expect(session.dispatch({ type: 'load', item: item('b') }).generation).toBe(2)
    expect(source.requests[0]!.signal.aborted).toBe(true)

    first.resolve({ kind: 'resolved', url: '/stale-a' })
    await flushResolution()
    expect(session.getSnapshot()).toMatchObject({ phase: 'resolving', currentItem: item('b') })

    for (const event of [
      { type: 'mediaReady', generation: 1 },
      { type: 'mediaPlay', generation: 1 },
      { type: 'mediaPause', generation: 1 },
      { type: 'mediaTime', generation: 1, position: 99 },
      { type: 'mediaDuration', generation: 1, duration: 99 },
      { type: 'mediaEnded', generation: 1 },
      { type: 'mediaError', generation: 1, message: 'late failure' },
    ] as const) {
      expect(session.dispatch(event)).toEqual({
        accepted: false,
        changed: false,
        reason: 'staleSource',
      })
    }

    second.resolve({ kind: 'resolved', url: '/current-b' })
    await flushResolution()
    expect(session.getSnapshot()).toMatchObject({
      phase: 'ready',
      source: { url: '/current-b', generation: 2 },
      position: 0,
    })
  })

  test('refreshes source metadata for same resource without resetting progress', () => {
    const source = resolverHarness()
    const session = createPlaybackSession({ sourceResolver: source.resolver })
    const original = item('stable')
    const moved = item('stable', {
      name: 'renamed.mp3',
    })

    session.dispatch({ type: 'load', item: original })
    session.dispatch({ type: 'mediaDuration', generation: 1, duration: 120 })
    session.dispatch({ type: 'mediaTime', generation: 1, position: 42 })
    session.dispatch({ type: 'load', item: moved, autoplay: false })

    expect(session.getSnapshot()).toMatchObject({
      currentItem: moved,
      queue: [moved],
      position: 42,
      duration: 120,
      desiredPlaying: false,
      source: { generation: 2 },
    })
    expect(source.requests).toHaveLength(2)
  })

  test('switches video between video and audio sources without losing continuity', () => {
    const source = resolverHarness((request) => ({
      kind: 'resolved',
      url: `/${request.mode}/${request.item.name}`,
    }))
    const video = item('clip', {
      resource: { provider: 'filesystem', id: 'Videos/clip.mp4' },
      name: 'clip.mp4',
      media: 'video',
    })
    const session = createPlaybackSession({ sourceResolver: source.resolver })

    session.dispatch({ type: 'load', item: video, position: 31 })
    expect(session.getSnapshot()).toMatchObject({
      mode: 'video',
      position: 31,
      source: { url: '/video/clip.mp4', generation: 1 },
    })
    session.dispatch({ type: 'setMode', mode: 'audio' })
    expect(session.getSnapshot()).toMatchObject({
      mode: 'audio',
      position: 31,
      source: { url: '/audio/clip.mp4', generation: 2 },
    })
    session.dispatch({ type: 'setMode', mode: 'video' })
    expect(session.getSnapshot()).toMatchObject({
      mode: 'video',
      position: 31,
      source: { url: '/video/clip.mp4', generation: 3 },
    })

    session.dispatch({ type: 'load', item: item('song'), mode: 'video' })
    expect(session.getSnapshot().mode).toBe('audio')
  })

  test('keeps position through source errors, explicit retry, and refresh', () => {
    let attempt = 0
    const source = resolverHarness((request) => {
      attempt += 1
      if (attempt === 1) return { kind: 'error', message: 'Source unavailable.' }
      return { kind: 'resolved', url: `/${request.reason}/${attempt}` }
    })
    const session = createPlaybackSession({ sourceResolver: source.resolver })

    session.dispatch({ type: 'load', item: item('retry'), position: 18 })
    expect(session.getSnapshot()).toMatchObject({
      phase: 'error',
      position: 18,
      desiredPlaying: false,
      error: 'Source unavailable.',
    })
    session.dispatch({ type: 'retry' })
    expect(session.getSnapshot()).toMatchObject({
      phase: 'ready',
      position: 18,
      desiredPlaying: true,
      source: { url: '/retry/2', generation: 2 },
    })
    session.dispatch({ type: 'refreshSource' })
    expect(session.getSnapshot()).toMatchObject({
      position: 18,
      source: { url: '/refresh/3', generation: 3 },
    })
  })

  test('restores valid state without autoplay and remains idempotent after restart', async () => {
    const restored: PersistedPlaybackState = {
      schemaVersion: 2,
      queue: [item('a'), item('b')],
      currentIndex: 1,
      position: 23,
      duration: 80,
      mode: 'audio',
      volume: 0.4,
      muted: true,
      repeat: true,
    }
    const firstPersistence = persistenceHarness(restored)
    const firstSource = resolverHarness()
    const first = createPlaybackSession({
      sourceResolver: firstSource.resolver,
      persistence: firstPersistence.persistence,
    })

    expect(first.getSnapshot()).toMatchObject({
      phase: 'resolving',
      currentItem: item('b'),
      position: 23,
      desiredPlaying: false,
      volume: 0.4,
      muted: true,
      repeat: true,
    })
    await flushResolution()
    expect(firstSource.requests[0]).toMatchObject({ reason: 'restore', item: item('b') })

    first.dispatch({ type: 'checkpoint' })
    const secondPersistence = persistenceHarness(firstPersistence.saves.at(-1))
    const secondSource = resolverHarness()
    const second = createPlaybackSession({
      sourceResolver: secondSource.resolver,
      persistence: secondPersistence.persistence,
    })
    await flushResolution()
    expect(second.getSnapshot()).toMatchObject({
      phase: 'ready',
      currentItem: item('b'),
      position: 23,
      desiredPlaying: false,
      volume: 0.4,
      muted: true,
      repeat: true,
    })
  })

  test('ignores malformed persisted state', () => {
    for (const restored of [
      { schemaVersion: 2, queue: [] },
      { schemaVersion: 1, queue: [{ invalid: true }] },
      { schemaVersion: 1, queue: [], currentIndex: Number.NaN },
    ]) {
      const session = createPlaybackSession({
        sourceResolver: resolverHarness().resolver,
        persistence: persistenceHarness(restored).persistence,
      })
      expect(session.getSnapshot()).toMatchObject({ phase: 'idle', queue: [], currentIndex: -1 })
    }
  })

  test('browser persistence reads and writes only the owner envelope', () => {
    const values = new Map<string, string>()
    const persistence = createBrowserPlaybackPersistence({
      storage: mapStorage(values),
      key: 'owner-session',
    })
    const state: PersistedPlaybackState = {
      schemaVersion: 2,
      queue: [item('saved')],
      currentIndex: 0,
      position: 17,
      duration: 90,
      mode: 'audio',
      volume: 0.5,
      muted: false,
      repeat: true,
    }

    expect(persistence.load()).toBeNull()
    persistence.save(state)
    expect(persistence.load()).toEqual(state)
    expect([...values.keys()]).toEqual(['owner-session'])

    values.set('owner-session', JSON.stringify(state))
    expect(persistence.load()).toBeNull()
    values.set('owner-session', JSON.stringify({ state, version: 0 }))
    expect(persistence.load()).toBeNull()

    persistence.clear?.()
    expect(values.size).toBe(0)
  })
})

function mapStorage(values: Map<string, string>) {
  return {
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
}
