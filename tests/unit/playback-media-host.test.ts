import { describe, expect, test } from 'bun:test'
import {
  createMediaElementHost,
  createPlaybackSession,
  type PlaybackItem,
  type PlaybackMediaElement,
  type PlaybackMode,
  type PlaybackSourceRequest,
  type PlaybackSourceResolver,
} from '@/src/features/playback'

function item(id: string, media: 'audio' | 'video' = 'audio'): PlaybackItem {
  const extension = media === 'audio' ? 'mp3' : 'mp4'
  const locator = `${media === 'audio' ? 'Music' : 'Videos'}/${id}.${extension}`
  return {
    resource: { provider: 'filesystem', id: locator },
    name: `${id}.${extension}`,
    media,
  }
}

function resolver() {
  const requests: PlaybackSourceRequest[] = []
  const sourceResolver: PlaybackSourceResolver = {
    resolve(request) {
      requests.push(request)
      return { kind: 'resolved', url: `/${request.mode}/${request.item.name}` }
    },
  }
  return { sourceResolver, requests }
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
    this.emit('ended')
  }
}

function attach(
  host: ReturnType<typeof createMediaElementHost>,
  element: FakeMediaElement,
  mode: PlaybackMode,
) {
  return host.attach(element as unknown as PlaybackMediaElement, mode)
}

describe('neutral media-element host', () => {
  test('synchronizes source, readiness, transport, seek, volume, and media events', () => {
    const source = resolver()
    const session = createPlaybackSession({ sourceResolver: source.sourceResolver })
    const host = createMediaElementHost(session)
    const element = new FakeMediaElement()
    attach(host, element, 'audio')

    session.dispatch({ type: 'load', item: item('one'), autoplay: false, position: 12 })
    expect(element.src).toBe('/audio/one.mp3')
    expect(element.currentTime).toBe(12)
    element.ready(90)
    expect(session.getSnapshot()).toMatchObject({
      phase: 'paused',
      duration: 90,
      position: 12,
    })

    session.dispatch({ type: 'play' })
    expect(element.playCalls).toBe(1)
    expect(session.getSnapshot()).toMatchObject({ phase: 'playing', desiredPlaying: true })

    session.dispatch({ type: 'seek', position: 40 })
    expect(element.currentTime).toBe(40)
    element.tick(41)
    expect(session.getSnapshot().position).toBe(41)

    session.dispatch({ type: 'setVolume', volume: 0.3 })
    session.dispatch({ type: 'setMuted', muted: true })
    expect(element.volume).toBe(0.3)
    expect(element.muted).toBe(true)

    session.dispatch({ type: 'pause' })
    expect(element.paused).toBe(true)
    expect(session.getSnapshot()).toMatchObject({ phase: 'paused', desiredPlaying: false })
  })

  test('moves one live source between hosts without resetting session or accepting old events', () => {
    const source = resolver()
    const session = createPlaybackSession({ sourceResolver: source.sourceResolver })
    const host = createMediaElementHost(session)
    const first = new FakeMediaElement()
    const detachFirst = attach(host, first, 'audio')

    session.dispatch({ type: 'load', item: item('continuous') })
    first.ready(120)
    first.tick(33)
    expect(session.getSnapshot()).toMatchObject({
      phase: 'playing',
      position: 33,
      desiredPlaying: true,
      source: { generation: 1 },
    })

    const second = new FakeMediaElement()
    attach(host, second, 'audio')
    expect(first.src).toBe('')
    expect(first.paused).toBe(true)
    expect(second.src).toBe('/audio/continuous.mp3')
    expect(second.currentTime).toBe(33)
    expect(second.paused).toBe(false)
    expect(session.getSnapshot()).toMatchObject({
      position: 33,
      desiredPlaying: true,
      source: { generation: 1 },
    })

    first.currentTime = 99
    first.emit('timeupdate')
    first.emit('pause')
    expect(session.getSnapshot()).toMatchObject({ position: 33, desiredPlaying: true })

    detachFirst()
    expect(second.src).toBe('/audio/continuous.mp3')
  })

  test('gates elements by audio/video mode and keeps position across source replacement', () => {
    const source = resolver()
    const session = createPlaybackSession({ sourceResolver: source.sourceResolver })
    const host = createMediaElementHost(session)
    const video = new FakeMediaElement()
    attach(host, video, 'video')

    session.dispatch({ type: 'load', item: item('clip', 'video'), autoplay: false, position: 17 })
    expect(video.src).toBe('/video/clip.mp4')
    video.ready(60)

    session.dispatch({ type: 'setMode', mode: 'audio' })
    expect(video.src).toBe('')
    expect(session.getSnapshot()).toMatchObject({ mode: 'audio', position: 17 })

    const audio = new FakeMediaElement()
    attach(host, audio, 'audio')
    expect(audio.src).toBe('/audio/clip.mp4')
    expect(audio.currentTime).toBe(17)
    expect(source.requests).toHaveLength(2)
  })

  test('drives repeat and next transitions while leaving surface controls outside host', () => {
    const source = resolver()
    const session = createPlaybackSession({ sourceResolver: source.sourceResolver })
    const host = createMediaElementHost(session)
    const element = new FakeMediaElement()
    attach(host, element, 'audio')

    session.dispatch({
      type: 'load',
      item: item('a'),
      queue: [item('a'), item('b')],
    })
    element.ready(30)
    session.dispatch({ type: 'setRepeat', repeat: true })
    element.end()
    expect(session.getSnapshot()).toMatchObject({ currentIndex: 0, position: 0, repeat: true })
    expect(element.paused).toBe(false)

    session.dispatch({ type: 'setRepeat', repeat: false })
    element.end()
    expect(session.getSnapshot()).toMatchObject({ currentIndex: 1, currentItem: item('b') })
    expect(element.src).toBe('/audio/b.mp3')
  })
})
