import { describe, expect, test } from 'bun:test'
import { createPlaybackSession } from '@/features/playback/playback-session'
import type { PersistedPlaybackState, PlaybackItem } from '@/features/playback/types'
import { trackPlayback } from '@/features/media-ai/activity'

const item = (name: string, automatic = false): PlaybackItem => ({
  locator: `Music/${name}.mp3`,
  name,
  media: 'audio',
  ...(automatic ? { automatic: true } : {}),
})
const resolver = { resolve: () => ({ kind: 'resolved' as const, url: '/music.mp3' }) }

describe('music queue', () => {
  test('manual additions precede radio suggestions and edits preserve playback position and source', () => {
    const session = createPlaybackSession({ sourceResolver: resolver })
    session.dispatch({
      type: 'load',
      item: item('a'),
      queue: [item('a'), item('b', true), item('c', true)],
      queueContext: {
        kind: 'radio',
        id: 'station',
        title: 'Jazz radio',
        radio: {
          seeds: [],
          genre: 'jazz',
          artist: '',
          discovery: 0.3,
          strictGenre: true,
          allowRepeats: false,
        },
      },
    })
    session.dispatch({ type: 'mediaTime', generation: 1, position: 25, duration: 200 })
    const source = session.getSnapshot().source
    session.dispatch({ type: 'enqueue', items: [item('d')], position: 'end' })
    session.dispatch({ type: 'enqueue', items: [item('e')], position: 'end' })
    expect(session.getSnapshot().queue.map((t) => t.name)).toEqual(['a', 'd', 'e', 'b', 'c'])
    session.dispatch({ type: 'enqueue', items: [item('c')], position: 'next' })
    expect(session.getSnapshot().queue.map((t) => t.name)).toEqual(['a', 'c', 'd', 'e', 'b'])
    session.dispatch({ type: 'moveQueueItem', from: 3, to: 1 })
    session.dispatch({ type: 'removeQueueItem', index: 3 })
    session.dispatch({ type: 'shuffleQueue' })
    expect(session.getSnapshot()).toMatchObject({
      position: 25,
      currentItem: item('a'),
      queueContext: { kind: 'radio' },
      desiredPlaying: true,
    })
    expect(session.getSnapshot().source).toBe(source)
  })

  test('explicit queues persist and selecting a queued track retains their identity', async () => {
    let saved: PersistedPlaybackState | null = null
    const persistence = {
      load: () => saved,
      save: (value: PersistedPlaybackState) => {
        saved = value
      },
    }
    const session = createPlaybackSession({ sourceResolver: resolver, persistence })
    session.dispatch({
      type: 'load',
      item: item('a'),
      queue: [item('a'), item('b')],
      queueContext: { kind: 'playlist', title: 'Night music', id: 'one' },
    })
    session.dispatch({ type: 'selectQueueItem', index: 1 })
    session.dispatch({ type: 'mediaTime', generation: 2, position: 20, duration: 120 })
    session.dispatch({ type: 'checkpoint' })
    const restored = createPlaybackSession({ sourceResolver: resolver, persistence })
    await Promise.resolve()
    expect(restored.getSnapshot()).toMatchObject({
      currentItem: item('b'),
      position: 20,
      desiredPlaying: false,
      queueContext: { kind: 'playlist', title: 'Night music', id: 'one' },
    })
    restored.dispatch({ type: 'load', item: item('c'), queue: [item('c')] })
    expect(restored.getSnapshot().queueContext).toBeNull()
  })

  test('only a deliberate early skip after actual listening gives a weak negative signal', () => {
    let now = 1000
    const skips: { id: string; path: string }[] = []
    const session = trackPlayback(
      createPlaybackSession({ sourceResolver: resolver }),
      () => {},
      () => now,
      (skip) => skips.push(skip),
    )
    session.dispatch({ type: 'load', item: item('a'), queue: [item('a'), item('b'), item('c')] })
    session.dispatch({ type: 'mediaPlay', generation: 1 })
    for (let i = 1; i <= 4; i++) {
      now += 1000
      session.dispatch({ type: 'mediaTime', generation: 1, position: i, duration: 180 })
    }
    session.dispatch({ type: 'next' })
    expect(skips.map((s) => s.path)).toEqual(['Music/a.mp3'])
    session.dispatch({ type: 'seek', position: 5 })
    session.dispatch({ type: 'next' })
    expect(skips).toHaveLength(1)
  })
})
