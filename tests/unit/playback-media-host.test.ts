import { describe, expect, test } from 'bun:test'
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
  volume = 1
  muted = false
  error: { code: number } | null = null
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

  test('keeps playing through a native seek pause', () => {
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
