import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import { createPlaybackSession, type PlaybackItem } from '@/features/playback'
const first: PlaybackItem = { locator: 'first.mp3', name: 'First', media: 'audio' }
const second: PlaybackItem = { locator: 'second.mp3', name: 'Second', media: 'audio' }
function setup() {
  const session = createPlaybackSession({
    sourceResolver: { resolve: () => Effect.succeed({ kind: 'resolved', url: '/audio' }) },
  })
  session.dispatch({ type: 'load', item: first, queue: [first, second] })
  session.dispatch({ type: 'mediaDuration', generation: 1, duration: 120 })
  return session
}
const wait = () => new Promise((resolve) => setTimeout(resolve, 60))
describe('playback sleep timer', () => {
  test('deadline pauses the player and blocks late media events until explicit resume', async () => {
    const session = setup()
    try {
      session.dispatch({ type: 'setSleepTimer', duration: 15 })
      await wait()
      expect(session.getSnapshot()).toMatchObject({
        desiredPlaying: false,
        currentItem: first,
        sleepTimer: { kind: 'expired' },
      })
      session.dispatch({ type: 'mediaPlay', generation: 1 })
      session.dispatch({ type: 'mediaEnded', generation: 1 })
      expect(session.getSnapshot()).toMatchObject({ desiredPlaying: false, currentItem: first })
      session.dispatch({ type: 'play' })
      expect(session.getSnapshot()).toMatchObject({ desiredPlaying: true, sleepTimer: null })
    } finally {
      session.dispatch({ type: 'destroy' })
    }
  })
  test('end-of-item takes priority over repeat and queue advancement', () => {
    const session = setup()
    try {
      session.dispatch({ type: 'setRepeat', repeat: true })
      session.dispatch({ type: 'setSleepTimer', duration: 'end' })
      session.dispatch({ type: 'mediaEnded', generation: 1 })
      expect(session.getSnapshot()).toMatchObject({
        phase: 'ended',
        desiredPlaying: false,
        currentItem: first,
        position: 120,
        sleepTimer: { kind: 'expired' },
      })
    } finally {
      session.dispatch({ type: 'destroy' })
    }
  })
  test('deadline follows the queue and continues while paused', async () => {
    const session = setup()
    try {
      session.dispatch({ type: 'setSleepTimer', duration: 15 })
      const timer = session.getSnapshot().sleepTimer
      session.dispatch({ type: 'next' })
      expect(session.getSnapshot().sleepTimer).toEqual(timer)
      session.dispatch({ type: 'pause' })
      await wait()
      expect(session.getSnapshot()).toMatchObject({
        desiredPlaying: false,
        currentItem: second,
        sleepTimer: { kind: 'expired' },
      })
    } finally {
      session.dispatch({ type: 'destroy' })
    }
  })
  test('manual track change cancels an end-of-item timer', () => {
    const session = setup()
    try {
      session.dispatch({ type: 'setSleepTimer', duration: 'end' })
      session.dispatch({ type: 'next' })
      expect(session.getSnapshot()).toMatchObject({ currentItem: second, sleepTimer: null })
    } finally {
      session.dispatch({ type: 'destroy' })
    }
  })
  test('cancel, replacement, stop and empty queues dispose the deadline', async () => {
    for (const action of ['cancel', 'replace', 'stop', 'empty', 'destroy'] as const) {
      const session = setup()
      session.dispatch({ type: 'setSleepTimer', duration: 15 })
      if (action === 'cancel') session.dispatch({ type: 'setSleepTimer', duration: null })
      if (action === 'replace') session.dispatch({ type: 'setSleepTimer', duration: 'end' })
      if (action === 'stop' || action === 'destroy') session.dispatch({ type: action })
      if (action === 'empty') session.dispatch({ type: 'setQueue', queue: [] })
      await wait()
      expect(session.getSnapshot().sleepTimer?.kind ?? null).toBe(
        action === 'replace' ? 'end' : null,
      )
      session.dispatch({ type: 'destroy' })
    }
  })
  test('rejects invalid durations without overwriting the current timer', () => {
    const session = setup()
    try {
      session.dispatch({ type: 'setSleepTimer', duration: 'end' })
      for (const duration of [0, -1, NaN, Infinity, 86400001]) {
        expect(session.dispatch({ type: 'setSleepTimer', duration })).toMatchObject({
          accepted: false,
        })
        expect(session.getSnapshot().sleepTimer?.kind).toBe('end')
      }
      session.dispatch({ type: 'stop' })
      expect(session.dispatch({ type: 'setSleepTimer', duration: 100 })).toMatchObject({
        accepted: false,
      })
    } finally {
      session.dispatch({ type: 'destroy' })
    }
  })
})
