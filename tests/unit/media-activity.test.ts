import { describe, expect, test } from 'bun:test'
import { createPlaybackSession } from '../../src/features/playback/playback-session'
import { trackPlayback, type ActivityEvent } from '../../src/features/media-ai/activity'
function setup() {
  let clock = 1_000_000
  const events: ActivityEvent[] = []
  const raw = createPlaybackSession({
    sourceResolver: { resolve: () => ({ kind: 'resolved', url: 'http://localhost/test.mp3' }) },
  })
  const session = trackPlayback(
    raw,
    (e) => events.push(e),
    () => clock,
  )
  const one = { locator: 'a.mp3', name: 'a', media: 'audio' as const }
  const two = { locator: 'b.mp3', name: 'b', media: 'audio' as const }
  session.dispatch({ type: 'load', item: one, queue: [one, two] })
  const generation = () => session.getSnapshot().source!.generation
  const tick = (position: number, seconds = 1) => {
    clock += seconds * 1000
    session.dispatch({ type: 'mediaTime', position, duration: 20, generation: generation() })
  }
  return { session, events, tick, generation }
}
describe('media activity', () => {
  test('counts actual playback, ignores seeking and stalled playback', () => {
    const s = setup()
    s.session.dispatch({ type: 'mediaPlay', generation: s.generation() })
    s.tick(1)
    s.tick(2)
    s.session.dispatch({ type: 'seek', position: 15 })
    s.tick(15)
    s.tick(16)
    s.session.dispatch({ type: 'checkpoint' })
    expect(s.events.reduce((n, e) => n + e.seconds, 0)).toBe(3)
    expect(new Set(s.events.map((e) => e.id)).size).toBe(1)
  })
  test('autoplay and repeat create independent sessions with origins', () => {
    const s = setup()
    s.session.dispatch({ type: 'mediaEnded', generation: s.generation() })
    expect(s.events.at(-1)?.path).toBe('b.mp3')
    expect(s.events.at(-1)?.source).toBe('autoplay')
    s.session.dispatch({ type: 'setRepeat', repeat: true })
    s.session.dispatch({ type: 'mediaEnded', generation: s.generation() })
    expect(s.events.at(-1)?.source).toBe('repeat')
    expect(new Set(s.events.map((e) => e.id)).size).toBe(3)
  })
  test('buffering intervals are excluded even if the playhead advances on recovery', () => {
    const s = setup()
    s.session.dispatch({ type: 'mediaPlay', generation: s.generation() })
    s.tick(1)
    s.session.dispatch({ type: 'mediaBuffering', generation: s.generation(), buffering: true })
    s.tick(1.1, 5)
    s.session.dispatch({ type: 'mediaBuffering', generation: s.generation(), buffering: false })
    s.tick(2.1)
    s.session.dispatch({ type: 'checkpoint' })
    expect(s.events.reduce((n, e) => n + e.seconds, 0)).toBe(2)
  })
  test('stale events cannot add time or complete the new item', () => {
    const s = setup()
    const stale = s.generation()
    s.session.dispatch({ type: 'next' })
    s.session.dispatch({ type: 'mediaEnded', generation: stale })
    expect(s.events.filter((e) => e.completed)).toHaveLength(0)
    expect(s.events.at(-1)?.source).toBe('queued')
  })
})
