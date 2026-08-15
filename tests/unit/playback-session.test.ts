import { describe, expect, test } from 'bun:test'
import {
  createPlaybackSession,
  type PersistedPlaybackState,
  type PlaybackItem,
  type PlaybackPersistence,
  type PlaybackSourceRequest,
  type PlaybackSourceResolution,
  type PlaybackSourceResolver,
} from '@/features/playback'

function item(id: string, media: 'audio' | 'video' = 'audio'): PlaybackItem {
  const extension = media === 'audio' ? 'mp3' : 'mp4'
  const folder = media === 'audio' ? 'Music' : 'Videos'
  return {
    locator: `${folder}/${id}.${extension}`,
    name: `${id}.${extension}`,
    media,
  }
}

function resolverHarness(
  resolve: (
    request: PlaybackSourceRequest,
  ) => PlaybackSourceResolution | Promise<PlaybackSourceResolution> = (request) => ({
    kind: 'resolved',
    url: `/${request.mode}/${request.item.name}`,
  }),
) {
  const requests: PlaybackSourceRequest[] = []
  const sourceResolver: PlaybackSourceResolver = {
    resolve(request) {
      requests.push(request)
      return resolve(request)
    },
  }
  return { sourceResolver, requests }
}

function flush() {
  return Promise.resolve().then(() => Promise.resolve())
}

describe('PlaybackSession', () => {
  test('loads, clamps seeks, and navigates a deduplicated queue', () => {
    const { sourceResolver } = resolverHarness()
    const first = item('first')
    const second = item('second')
    const session = createPlaybackSession({ sourceResolver })

    session.dispatch({ type: 'load', item: first, queue: [first, first, second] })
    expect(session.getSnapshot()).toMatchObject({
      phase: 'ready',
      currentIndex: 0,
      desiredPlaying: true,
      queue: [first, second],
    })

    session.dispatch({ type: 'mediaDuration', generation: 1, duration: 90 })
    session.dispatch({ type: 'seek', position: 200 })
    expect(session.getSnapshot().position).toBe(90)

    session.dispatch({ type: 'next' })
    expect(session.getSnapshot()).toMatchObject({ currentIndex: 1, currentItem: second })
    session.dispatch({ type: 'mediaTime', generation: 2, position: 10 })
    session.dispatch({ type: 'previous' })
    expect(session.getSnapshot()).toMatchObject({ currentIndex: 0, position: 0 })
  })

  test('rejects stale asynchronous source resolutions and media events', async () => {
    let resolveFirst!: (value: PlaybackSourceResolution) => void
    let resolveSecond!: (value: PlaybackSourceResolution) => void
    const first = new Promise<PlaybackSourceResolution>((resolve) => {
      resolveFirst = resolve
    })
    const second = new Promise<PlaybackSourceResolution>((resolve) => {
      resolveSecond = resolve
    })
    const { sourceResolver, requests } = resolverHarness((request) =>
      request.item.name === 'first.mp3' ? first : second,
    )
    const session = createPlaybackSession({ sourceResolver })

    session.dispatch({ type: 'load', item: item('first') })
    session.dispatch({ type: 'load', item: item('second') })
    resolveFirst({ kind: 'resolved', url: '/stale' })
    await flush()
    expect(session.getSnapshot().source).toBeNull()

    expect(session.dispatch({ type: 'mediaTime', generation: 1, position: 99 })).toMatchObject({
      accepted: false,
      reason: 'staleSource',
    })
    resolveSecond({ kind: 'resolved', url: '/current' })
    await flush()
    expect(session.getSnapshot()).toMatchObject({
      currentItem: item('second'),
      source: { url: '/current', generation: 2 },
    })
    expect(requests.map((request) => request.item.name)).toEqual(['first.mp3', 'second.mp3'])
  })

  test('switches video between visual and audio sources without losing position', () => {
    const { sourceResolver, requests } = resolverHarness()
    const session = createPlaybackSession({ sourceResolver })
    const video = item('clip', 'video')

    session.dispatch({ type: 'load', item: video, position: 31, mode: 'video' })
    session.dispatch({ type: 'mediaDuration', generation: 1, duration: 120 })
    session.dispatch({ type: 'setMode', mode: 'audio' })
    expect(session.getSnapshot()).toMatchObject({
      mode: 'audio',
      position: 31,
      source: { generation: 2 },
    })
    session.dispatch({ type: 'setMode', mode: 'video' })
    expect(session.getSnapshot()).toMatchObject({
      mode: 'video',
      position: 31,
      source: { generation: 3 },
    })
    expect(requests.map((request) => request.mode)).toEqual(['video', 'audio', 'video'])
  })

  test('reads legacy positions and writes only the existing resume shape', () => {
    const saves: PersistedPlaybackState[] = []
    const persistence: PlaybackPersistence = {
      load: () => null,
      save: (state) => saves.push(state),
      legacyPosition: (locator) => (locator === 'Videos/remember.mp4' ? 7 : 0),
    }
    const { sourceResolver } = resolverHarness()
    const session = createPlaybackSession({ sourceResolver, persistence })

    session.dispatch({ type: 'load', item: item('remember', 'video') })
    expect(session.getSnapshot().position).toBe(7)
    session.dispatch({ type: 'mediaTime', generation: 1, position: 13, duration: 100 })
    session.dispatch({ type: 'checkpoint' })
    expect(saves.at(-1)).toMatchObject({
      schemaVersion: 1,
      position: 13,
      currentIndex: 0,
      queue: [item('remember', 'video')],
    })
  })
})
