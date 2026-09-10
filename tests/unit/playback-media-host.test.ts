import { describe, expect, spyOn, test } from 'bun:test'
import {
  createMediaElementHost,
  createPlaybackSession,
  type PlaybackItem,
  type PlaybackMediaElement,
  type PlaybackSourceRequest,
} from '@/features/playback'

function item(id: string, media: 'audio' | 'video' = 'audio'): PlaybackItem {
  const extension = media === 'audio' ? 'mp3' : 'mp4'
  return {
    locator: `${media}/${id}.${extension}`,
    name: `${id}.${extension}`,
    media,
  }
}

class FakeMediaElement {
  src = ''
  currentSrc = ''
  currentTime = 0
  duration = Number.NaN
  paused = true
  seeking = false
  volume = 1
  muted = false
  playbackRate = 1
  error: { code: number } | null = null
  rejectPlay = false
  playError: Error | null = null
  deferPlay = false
  playCalls = 0
  pauseCalls = 0
  loadCalls = 0
  private listeners = new Map<string, Set<EventListener>>()

  addEventListener(type: string, listener: EventListener) {
    let listeners = this.listeners.get(type)
    if (!listeners) {
      listeners = new Set()
      this.listeners.set(type, listeners)
    }
    listeners.add(listener)
  }

  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener)
  }

  play() {
    this.playCalls += 1
    if (this.rejectPlay) return Promise.reject(new Error('play rejected'))
    if (this.playError) return Promise.reject(this.playError)
    if (this.deferPlay) return new Promise<void>(() => undefined)
    if (this.paused) {
      this.paused = false
      this.emit('play')
      this.emit('playing')
    }
    return Promise.resolve()
  }

  pause() {
    this.pauseCalls += 1
    if (!this.paused) {
      this.paused = true
      this.emit('pause')
    }
  }

  load() {
    this.loadCalls += 1
    this.currentSrc = this.src
  }

  removeAttribute(name: string) {
    if (name === 'src') {
      this.src = ''
      this.currentSrc = ''
    }
  }

  emit(type: string) {
    if (type === 'seeking') this.seeking = true
    if (type === 'seeked') this.seeking = false
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener.call(this, new Event(type))
    }
  }

  ready(duration: number) {
    this.duration = duration
    this.emit('loadedmetadata')
    this.emit('canplay')
  }

  tick(position: number) {
    this.currentTime = position
    this.emit('timeupdate')
  }

  end() {
    this.currentTime = this.duration
    this.paused = true
    this.emit('pause')
    this.emit('ended')
    if (!this.paused) {
      this.paused = true
      this.emit('pause')
    }
  }
}

function resolver(request: PlaybackSourceRequest) {
  return { kind: 'resolved' as const, url: `/${request.mode}/${request.item.name}` }
}

function attach(
  host: ReturnType<typeof createMediaElementHost>,
  element: FakeMediaElement,
  mode: 'audio' | 'video',
) {
  return host.attach(element as unknown as PlaybackMediaElement, mode)
}

describe('PlaybackMediaHost', () => {
  test('autoplay permission denial leaves usable paused controls', async () => {
    const session = createPlaybackSession({ sourceResolver: { resolve: resolver } })
    const host = createMediaElementHost(session)
    const media = new FakeMediaElement()
    media.playError = new DOMException('Interaction required', 'NotAllowedError')
    session.dispatch({ type: 'load', item: item('permission', 'video'), autoplay: true })
    attach(host, media, 'video')
    await Promise.resolve()
    expect(session.getSnapshot()).toMatchObject({
      phase: 'paused',
      desiredPlaying: false,
      error: null,
    })
    media.playError = null
    session.dispatch({ type: 'play' })
    expect(media.paused).toBe(false)
    host.dispose()
  })

  test('audio can resume when codec timing places the first buffered sample just after a seek', () => {
    const session = createPlaybackSession({
      sourceResolver: {
        resolve: (request) => ({ ...resolver(request), streaming: true, duration: 100 }),
      },
    })
    const host = createMediaElementHost(session)
    const media = Object.assign(new FakeMediaElement(), {
      buffered: { length: 1, start: () => 53.401, end: () => 80 },
    })
    session.dispatch({ type: 'load', item: item('opus'), autoplay: false, position: 53.4 })
    attach(host, media, 'audio')
    media.ready(100)
    media.emit('seeked')
    expect(media.currentTime).toBe(53.401)
    expect(session.getSnapshot().pendingSeek).toBeNull()
    session.dispatch({ type: 'play' })
    expect(media.paused).toBe(false)
    host.dispose()
  })

  test('applies small audio seeks instead of accepting the previous nearby time', () => {
    const session = createPlaybackSession({ sourceResolver: { resolve: resolver } })
    const host = createMediaElementHost(session)
    const media = new FakeMediaElement()
    session.dispatch({ type: 'load', item: item('fine-seek'), autoplay: false })
    attach(host, media, 'audio')
    media.ready(100)
    media.tick(20)
    session.dispatch({ type: 'seek', position: 20.1 })
    expect(media.currentTime).toBe(20.1)
    media.emit('seeked')
    expect(session.getSnapshot()).toMatchObject({ position: 20.1, pendingSeek: null })
    host.dispose()
  })

  test('loading a seek cannot report zero or finish at an earlier keyframe', () => {
    const session = createPlaybackSession({ sourceResolver: { resolve: resolver } })
    const host = createMediaElementHost(session)
    const media = new FakeMediaElement()
    session.dispatch({ type: 'load', item: item('keyframe', 'video'), autoplay: false })
    attach(host, media, 'video')
    media.ready(100)
    session.dispatch({ type: 'seek', position: 54.3 })
    media.currentTime = 0
    media.emit('seeking')
    media.tick(0)
    expect(session.getSnapshot().position).toBe(54.3)
    media.currentTime = 52.5
    media.emit('seeked')
    expect(session.getSnapshot().position).toBe(54.3)
    expect(media.currentTime).toBe(54.3)
    media.emit('seeked')
    expect(session.getSnapshot()).toMatchObject({ position: 54.3, pendingSeek: null })
    host.dispose()
  })

  test('an interrupted play request does not turn an intentional pause into an error', async () => {
    const session = createPlaybackSession({ sourceResolver: { resolve: resolver } })
    const host = createMediaElementHost(session)
    const media = new FakeMediaElement()
    media.playError = new DOMException('Interrupted by pause', 'AbortError')
    session.dispatch({ type: 'load', item: item('cancelled', 'video'), autoplay: true })
    attach(host, media, 'video')
    session.dispatch({ type: 'pause' })
    await Promise.resolve()
    expect(session.getSnapshot()).toMatchObject({
      phase: 'paused',
      desiredPlaying: false,
      error: null,
    })
    host.dispose()
  })

  test('unsupported play rejection falls back without losing play intent or position', async () => {
    const requests: PlaybackSourceRequest[] = []
    const session = createPlaybackSession({
      sourceResolver: {
        resolve: (request) => {
          requests.push(request)
          return {
            kind: 'resolved',
            url: `/video/${request.fallback}`,
            compatibility: request.fallback,
          }
        },
      },
    })
    const host = createMediaElementHost(session)
    const media = new FakeMediaElement()
    media.playError = new DOMException('Unsupported codec', 'NotSupportedError')
    session.dispatch({ type: 'load', item: item('codec', 'video'), autoplay: true, position: 42 })
    attach(host, media, 'video')
    media.playError = null
    await Promise.resolve()
    expect(requests.at(-1)).toMatchObject({ fallback: 'remux', position: 42 })
    expect(session.getSnapshot()).toMatchObject({ desiredPlaying: true, error: null, position: 42 })
    expect(media.paused).toBe(false)
    host.dispose()
  })

  test('ignores a late conversion error after switching files', async () => {
    let finish!: (response: Response) => void
    const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(
      Object.assign(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve
          }),
        { preconnect: fetch.preconnect },
      ),
    )
    const session = createPlaybackSession({
      sourceResolver: {
        resolve: (request) => ({
          ...resolver(request),
          compatibility: 'video',
          requestId: request.item.locator,
        }),
      },
    })
    const host = createMediaElementHost(session)
    const media = new FakeMediaElement()
    try {
      session.dispatch({ type: 'load', item: item('first', 'video'), autoplay: false })
      attach(host, media, 'video')
      media.emit('error')
      session.dispatch({ type: 'load', item: item('second', 'video'), autoplay: true })
      finish(Response.json({ error: 'Old conversion failed' }))
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(session.getSnapshot()).toMatchObject({
        currentItem: item('second', 'video'),
        desiredPlaying: true,
        error: null,
      })
    } finally {
      fetchMock.mockRestore()
      host.dispose()
    }
  })

  test('seeking beyond a streamed buffer resolves from the requested timestamp', () => {
    const requests: PlaybackSourceRequest[] = []
    const session = createPlaybackSession({
      sourceResolver: {
        resolve: (request) => {
          requests.push(request)
          return {
            kind: 'resolved',
            url: `/stream?start=${request.position}`,
            streaming: true,
            duration: 100,
          }
        },
      },
    })
    const host = createMediaElementHost(session)
    const media = new FakeMediaElement()
    session.dispatch({ type: 'load', item: item('stream', 'video'), autoplay: false })
    attach(host, media, 'video')
    session.dispatch({ type: 'seek', position: 60 })
    expect(requests.at(-1)).toMatchObject({ reason: 'refresh', position: 60 })
    expect(media.currentTime).toBe(60)
    media.tick(0)
    expect(session.getSnapshot().position).toBe(60)
    session.dispatch({ type: 'setPlaybackRate', rate: 2.25 })
    expect(media.playbackRate).toBe(2.25)
    host.dispose()
  })

  test('owns one media element and mirrors source, transport, and position', () => {
    const session = createPlaybackSession({ sourceResolver: { resolve: resolver } })
    const host = createMediaElementHost(session)
    const media = new FakeMediaElement()

    session.dispatch({ type: 'load', item: item('song'), autoplay: true })
    const detach = attach(host, media, 'audio')
    expect(media.src).toBe('/audio/song.mp3')
    expect(media.playCalls).toBe(1)

    media.ready(80)
    media.tick(14)
    expect(session.getSnapshot()).toMatchObject({ phase: 'playing', duration: 80, position: 14 })

    session.dispatch({ type: 'pause' })
    expect(media.paused).toBe(true)
    session.dispatch({ type: 'seek', position: 27 })
    expect(media.currentTime).toBe(27)

    detach()
    host.dispose()
  })

  test('drops stale events when the host changes source or element', () => {
    const session = createPlaybackSession({ sourceResolver: { resolve: resolver } })
    const host = createMediaElementHost(session)
    const first = new FakeMediaElement()
    const second = new FakeMediaElement()

    session.dispatch({ type: 'load', item: item('first'), autoplay: false })
    attach(host, first, 'audio')
    first.ready(100)
    first.tick(22)
    expect(session.getSnapshot().position).toBe(22)

    session.dispatch({ type: 'load', item: item('second'), autoplay: false })
    expect(first.src).toBe('/audio/second.mp3')
    expect(session.dispatch({ type: 'mediaTime', generation: 1, position: 91 })).toMatchObject({
      accepted: false,
      reason: 'staleSource',
    })
    expect(session.getSnapshot().position).toBe(0)

    attach(host, second, 'audio')
    expect(second.src).toBe('/audio/second.mp3')
    second.ready(50)
    second.tick(8)
    expect(session.getSnapshot()).toMatchObject({ currentItem: item('second'), position: 8 })
    host.dispose()
  })

  test('ignores a late play event after pause intent wins', () => {
    const session = createPlaybackSession({ sourceResolver: { resolve: resolver } })
    const host = createMediaElementHost(session)
    const media = new FakeMediaElement()

    session.dispatch({ type: 'load', item: item('late-play'), autoplay: false })
    attach(host, media, 'audio')
    media.ready(100)
    session.dispatch({ type: 'play' })
    session.dispatch({ type: 'pause' })

    media.paused = false
    media.emit('play')

    expect(media.paused).toBe(true)
    expect(session.getSnapshot()).toMatchObject({
      phase: 'paused',
      desiredPlaying: false,
    })
    host.dispose()
  })

  test('ignores a load pause while the first play request is pending', () => {
    const session = createPlaybackSession({ sourceResolver: { resolve: resolver } })
    const host = createMediaElementHost(session)
    const media = new FakeMediaElement()
    media.deferPlay = true

    session.dispatch({ type: 'load', item: item('loading'), autoplay: true })
    attach(host, media, 'audio')
    media.emit('pause')

    expect(session.getSnapshot().desiredPlaying).toBe(true)
    host.dispose()
  })

  test('allows native video playback to resume after a native pause', async () => {
    const session = createPlaybackSession({ sourceResolver: { resolve: resolver } })
    const host = createMediaElementHost(session)
    const media = new FakeMediaElement()

    session.dispatch({
      type: 'load',
      item: item('unpause', 'video'),
      autoplay: true,
      mode: 'video',
    })
    attach(host, media, 'video')
    media.ready(100)
    media.pause()
    expect(session.getSnapshot()).toMatchObject({ desiredPlaying: false, phase: 'paused' })

    await media.play()

    expect(media.paused).toBe(false)
    expect(session.getSnapshot()).toMatchObject({ desiredPlaying: true, phase: 'playing' })
    host.dispose()
  })

  test('native video Play recovers after the initial autoplay request is rejected', async () => {
    const session = createPlaybackSession({ sourceResolver: { resolve: resolver } })
    const host = createMediaElementHost(session)
    const media = new FakeMediaElement()
    media.rejectPlay = true
    session.dispatch({ type: 'load', item: item('blocked', 'video'), autoplay: true })
    attach(host, media, 'video')
    media.ready(100)
    await Promise.resolve()
    expect(session.getSnapshot().phase).toBe('error')
    media.rejectPlay = false
    await media.play()
    expect(media.paused).toBe(false)
    expect(session.getSnapshot()).toMatchObject({
      phase: 'playing',
      desiredPlaying: true,
      error: null,
    })
    host.dispose()
  })

  test('native video Play resumes after an application pause', async () => {
    const session = createPlaybackSession({ sourceResolver: { resolve: resolver } })
    const host = createMediaElementHost(session)
    const media = new FakeMediaElement()
    session.dispatch({ type: 'load', item: item('paused', 'video'), autoplay: true })
    attach(host, media, 'video')
    media.ready(100)
    await Promise.resolve()
    media.tick(24)
    session.dispatch({ type: 'pause' })
    await media.play()
    expect(media.paused).toBe(false)
    expect(session.getSnapshot()).toMatchObject({ phase: 'playing', position: 24 })
    host.dispose()
  })

  test('a pending programmatic video play cannot override a later pause', () => {
    const session = createPlaybackSession({ sourceResolver: { resolve: resolver } })
    const host = createMediaElementHost(session)
    const media = new FakeMediaElement()
    media.deferPlay = true
    session.dispatch({ type: 'load', item: item('late-video', 'video'), autoplay: true })
    attach(host, media, 'video')
    session.dispatch({ type: 'pause' })
    media.paused = false
    media.emit('play')
    expect(media.paused).toBe(true)
    expect(session.getSnapshot().desiredPlaying).toBe(false)
    host.dispose()
  })

  test('preserves the requested position through a native seek pause', () => {
    const session = createPlaybackSession({ sourceResolver: { resolve: resolver } })
    const host = createMediaElementHost(session)
    const media = new FakeMediaElement()

    session.dispatch({ type: 'load', item: item('seek', 'video'), autoplay: true, mode: 'video' })
    attach(host, media, 'video')
    media.ready(100)
    expect(media.paused).toBe(false)

    media.emit('seeking')
    media.pause()
    media.currentTime = 60
    media.emit('seeked')

    expect(media.paused).toBe(false)
    expect(media.currentTime).toBe(60)
    expect(session.getSnapshot().position).toBe(60)
    expect(session.getSnapshot()).toMatchObject({ desiredPlaying: true, phase: 'playing' })
    host.dispose()
  })

  test('allows play to be retried after the media element rejects it', async () => {
    const session = createPlaybackSession({ sourceResolver: { resolve: resolver } })
    const host = createMediaElementHost(session)
    const media = new FakeMediaElement()

    session.dispatch({ type: 'load', item: item('rejected-play'), autoplay: false })
    attach(host, media, 'audio')
    media.ready(100)
    media.rejectPlay = true
    session.dispatch({ type: 'play' })
    await Promise.resolve()
    await Promise.resolve()

    media.rejectPlay = false
    session.dispatch({ type: 'play' })

    expect(media.playCalls).toBe(2)
    expect(media.paused).toBe(false)
    host.dispose()
  })

  test('keeps native video volume and mute changes in session state', () => {
    const session = createPlaybackSession({ sourceResolver: { resolve: resolver } })
    const host = createMediaElementHost(session)
    const media = new FakeMediaElement()

    session.dispatch({ type: 'load', item: item('volume', 'video'), autoplay: true, mode: 'video' })
    attach(host, media, 'video')
    media.ready(100)
    media.volume = 0.25
    media.muted = true
    media.emit('volumechange')

    expect(session.getSnapshot()).toMatchObject({ volume: 0.25, muted: true })
    media.tick(1)
    expect(media).toMatchObject({ volume: 0.25, muted: true })
    host.dispose()
  })

  test('does not clear an existing video when a duplicate pane attaches', () => {
    const session = createPlaybackSession({ sourceResolver: { resolve: resolver } })
    const host = createMediaElementHost(session)
    const first = new FakeMediaElement()
    const second = new FakeMediaElement()

    session.dispatch({
      type: 'load',
      item: item('duplicate', 'video'),
      autoplay: false,
      mode: 'video',
    })
    attach(host, first, 'video')
    first.ready(100)
    attach(host, second, 'video')

    expect(first.currentSrc).toBe('/video/duplicate.mp4')
    expect(second.currentSrc).toBe('/video/duplicate.mp4')
    host.dispose()
  })

  test('resumes when a seek pause event arrives before seeking', () => {
    const session = createPlaybackSession({ sourceResolver: { resolve: resolver } })
    const host = createMediaElementHost(session)
    const media = new FakeMediaElement()

    session.dispatch({
      type: 'load',
      item: item('early-pause', 'video'),
      autoplay: true,
      mode: 'video',
    })
    attach(host, media, 'video')
    media.ready(100)
    expect(media.paused).toBe(false)

    media.seeking = true
    media.pause()
    media.emit('seeking')
    media.currentTime = 60
    media.emit('play')
    media.emit('pause')
    media.emit('seeked')

    expect(media.paused).toBe(false)
    expect(session.getSnapshot()).toMatchObject({ desiredPlaying: true, phase: 'playing' })
    host.dispose()
  })

  test('restarts the same source for repeat', () => {
    const session = createPlaybackSession({ sourceResolver: { resolve: resolver } })
    const host = createMediaElementHost(session)
    const media = new FakeMediaElement()

    session.dispatch({ type: 'load', item: item('loop'), autoplay: true })
    attach(host, media, 'audio')
    media.ready(30)
    session.dispatch({ type: 'setRepeat', repeat: true })
    media.end()
    expect(session.getSnapshot()).toMatchObject({
      phase: 'playing',
      position: 0,
      desiredPlaying: true,
    })
    expect(media.playCalls).toBeGreaterThan(1)
    host.dispose()
  })

  test('keeps repeat intent across native pause and ended events', () => {
    const session = createPlaybackSession({ sourceResolver: { resolve: resolver } })
    const host = createMediaElementHost(session)
    const media = new FakeMediaElement()

    session.dispatch({ type: 'load', item: item('ordered-loop'), autoplay: true })
    attach(host, media, 'audio')
    media.ready(30)
    session.dispatch({ type: 'setRepeat', repeat: true })
    media.end()

    expect(media.paused).toBe(false)
    expect(session.getSnapshot()).toMatchObject({
      phase: 'playing',
      position: 0,
      desiredPlaying: true,
    })
    host.dispose()
  })
})
